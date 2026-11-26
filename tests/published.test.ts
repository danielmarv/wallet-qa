import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { Engine } from '../src/testing/engine.js';
import type { Backend } from '../src/testing/eudiplo.js';
import { auditReport } from '../src/testing/report.js';
import { FileRunStore } from '../src/testing/store.js';
import { SCENARIOS } from '../src/testing/catalog.js';
import { FilePublishedStore } from '../src/testing/store.js';
import {
  feed,
  PublishError,
  publishFromRuns,
  publishFromUpload,
  scenarioFeatures,
} from '../src/testing/published.js';
import type { SessionEvidence, StepDefinition } from '../src/testing/types.js';
import { testWorkspaces, WS } from './helpers.js';

class FakeBackend implements Backend {
  sessions = new Map<string, SessionEvidence>();
  async start(_step: StepDefinition) {
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, { status: 'active' });
    return { sessionId, uri: 'openid-credential-offer://?credential_offer_uri=https%3A%2F%2Feudiplo.test' };
  }
  async session(id: string) { return structuredClone(this.sessions.get(id)!); }
  async deleteSession(id: string) { this.sessions.delete(id); }
  async setStatus() {}
  async health() {}
  async requestObject() { return ''; }
}

const ORIGIN = 'https://qa.test';
const ADMIN = 'a'.repeat(40);

async function setup() {
  const store = await new FileRunStore().init();
  const workspaces = await testWorkspaces();
  const backend = new FakeBackend();
  const engine = new Engine(store, workspaces, backend, {
    publicOrigin: ORIGIN,
    retentionMs: 3600000,
    pollMs: 0,
    versions: { catalog: '3.1.0', sdk: '7.6.0', eudiplo: '9.2.0' },
  });
  return { store, workspaces, backend, engine };
}

/** Runs a single-step issuance test to a passed verdict. */
async function passIssuance(ctx: Awaited<ReturnType<typeof setup>>, scenarioId = 'I-EAA-NOTX') {
  const { run } = await ctx.engine.create({ workspaceId: WS, scenarioId });
  const current = (await ctx.store.get(run.id))!;
  ctx.backend.sessions.set(current.steps[current.currentStep].sessionId!, { status: 'completed' });
  await ctx.engine.tick(run.id);
  const finished = (await ctx.store.get(run.id))!;
  // Scenarios with a checklist wait for the tester; answer every check as expected.
  if (finished.state === 'awaiting_tester') {
    const answers = Object.fromEntries((finished.scenario.manual ?? []).map((c) => [c.id, { answer: c.expect, note: 'Max Mustermann saw it', at: new Date().toISOString() }]));
    await ctx.engine.answer(run.id, answers);
  }
  return (await ctx.store.get(run.id))!;
}

async function listen(app: ReturnType<typeof createApp>) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('features come from the test definition', () => {
  const byId = (id: string) => SCENARIOS.find((s) => s.id === id)!;
  assert.deepEqual(scenarioFeatures(byId('I-DPOP')), ['pre-authorized-code', 'dpop', 'sd-jwt-vc']);
  assert.ok(scenarioFeatures(byId('I-PID-MDOC')).includes('mdoc'));
  assert.deepEqual(scenarioFeatures(byId('R-SIG')), ['presentation']);
  const features = feed([], SCENARIOS).features;
  assert.ok(scenarioFeatures(byId('P-DCAPI-MDOC')).includes('dc-api'));
  assert.equal(features.find((f) => f.id === 'dc-api')?.covered, true);
  assert.equal(features.find((f) => f.id === 'annex-c')?.covered, false);
  assert.equal(features.find((f) => f.id === 'dpop')?.covered, true);
  // Only I-WIA has it, and I-WIA is not ready yet.
  assert.equal(features.find((f) => f.id === 'wallet-attestation')?.covered, false);
});

test('publishing from runs keeps only the published fields and the latest result per test', async () => {
  const ctx = await setup();
  const workspace = (await ctx.workspaces.get(WS))!;
  workspace.wallet.device = 'Pixel 8';
  const first = await passIssuance(ctx);
  const latest = await passIssuance(ctx);
  await ctx.engine.create({ workspaceId: WS, scenarioId: 'I-EAA-NOTX' }); // still running: not published
  const runs = await ctx.engine.runs(WS);
  runs.find((r) => r.id === first.id)!.updatedAt = '2026-02-01T00:00:00.000Z';
  runs.find((r) => r.id === latest.id)!.updatedAt = '2026-03-01T00:00:00.000Z';
  const result = publishFromRuns(workspace, runs, ORIGIN);
  assert.equal(result.provenance, 'instance');
  assert.equal(result.instance, ORIGIN);
  assert.deepEqual(result.wallet, { name: 'Test wallet', version: 'test-build', platform: 'ios', device: 'Pixel 8' });
  assert.equal(result.tests.length, 1);
  assert.equal(result.tests[0].scenarioId, 'I-EAA-NOTX');
  assert.equal(result.tests[0].testedAt, '2026-03-01T00:00:00.000Z');
  assert.deepEqual(result.tests[0].versions, { catalog: '3.1.0', eudiplo: '9.2.0' });
  const serialized = JSON.stringify(result);
  for (const secret of ['Test"', 'Mustermann', latest.id, latest.steps[0].sessionId!])
    assert.ok(!serialized.includes(secret), `published record contains ${secret}`);
});

test('publishing from runs keeps attested passes and leaves out skipped runs', async () => {
  const ctx = await setup();
  const passed = await passIssuance(ctx);
  await ctx.engine.create({ workspaceId: WS, scenarioId: 'I-WIA' }); // unsupported: finishes as skipped
  const runs = await ctx.engine.runs(WS);
  assert.equal(runs.find((r) => r.scenario.id === 'I-WIA')?.verdict, 'skipped');
  runs.find((r) => r.id === passed.id)!.attested = true;
  const workspace = (await ctx.workspaces.get(WS))!;
  const result = publishFromRuns(workspace, runs, ORIGIN);
  assert.deepEqual(result.tests.map((t) => [t.scenarioId, t.attested]), [['I-EAA-NOTX', true]]);
  const failed = runs.find((r) => r.id === passed.id)!;
  failed.verdict = 'failed';
  assert.equal(publishFromRuns(workspace, [failed], ORIGIN).tests[0].attested, false);
  assert.throws(() => publishFromRuns(workspace, runs.filter((r) => r.scenario.id === 'I-WIA'), ORIGIN), PublishError);
});

test('publishing a workspace without finished runs is refused', async () => {
  const ctx = await setup();
  await ctx.engine.create({ workspaceId: WS, scenarioId: 'I-EAA-NOTX' });
  const workspace = (await ctx.workspaces.get(WS))!;
  const runs = await ctx.engine.runs(WS);
  assert.throws(() => publishFromRuns(workspace, runs, ORIGIN), PublishError);
});

test('an upload is self-reported and drops everything outside the published fields', async () => {
  const ctx = await setup();
  const run = await passIssuance(ctx);
  const workspace = (await ctx.workspaces.get(WS))!;
  const report = {
    workspace: { ...workspace, tester: 'Erika Mustermann', wallet: { ...workspace.wallet, name: '<b>Wallet</b>' } },
    runs: [
      auditReport(run),
      { ...auditReport(run), run: { ...auditReport(run).run, scenarioId: 'X-UNKNOWN' } },
      { ...auditReport(run), run: { ...auditReport(run).run, scenarioId: 'I-DPOP', verdict: 'failed' }, attested: true },
    ],
  };
  const result = publishFromUpload(report, SCENARIOS, ORIGIN);
  assert.equal(result.provenance, 'self-reported');
  assert.equal(result.wallet.name, '<b>Wallet</b>'); // the page renders it as text
  assert.deepEqual(result.tests.map((t) => t.scenarioId), ['I-DPOP', 'I-EAA-NOTX']);
  const dpop = result.tests.find((t) => t.scenarioId === 'I-DPOP')!;
  assert.equal(dpop.attested, false);
  assert.equal(dpop.label, SCENARIOS.find((s) => s.id === 'I-DPOP')!.label);
  assert.ok(!JSON.stringify(result).includes('Mustermann'));
  assert.throws(() => publishFromUpload({ workspace: { wallet: {} }, runs: [] }, SCENARIOS, ORIGIN), PublishError);
});

test('an upload keeps only completed runs with a date, and its attested passes', async () => {
  const ctx = await setup();
  const run = await passIssuance(ctx);
  const base = auditReport(run);
  const report = {
    workspace: { wallet: { name: 'Wallet', version: 'v'.repeat(129) } },
    runs: [
      { ...base, attested: true, versions: undefined },
      { ...base, run: { ...base.run, scenarioId: 'I-DPOP', completed: false } },
      { ...base, run: { ...base.run, scenarioId: 'P-SELECTIVE', updatedAt: 'nope' } },
      { ...base, run: { ...base.run, scenarioId: 'R-SIG', verdict: 'skipped' } },
    ],
  };
  const result = publishFromUpload(report, SCENARIOS, ORIGIN);
  assert.deepEqual(result.wallet, { name: 'Wallet' });
  assert.equal(result.tests.length, 1);
  assert.equal(result.tests[0].attested, true);
  assert.deepEqual(result.tests[0].versions, { catalog: 'unknown', eudiplo: 'unknown' });
  const unknown = { ...report, runs: [{ ...base, run: { ...base.run, scenarioId: 'X-UNKNOWN' } }] };
  assert.throws(() => publishFromUpload(unknown, SCENARIOS, ORIGIN), /known tests/);
  assert.throws(() => publishFromUpload({ workspace: { wallet: { name: 'n'.repeat(129) } }, runs: [] }, SCENARIOS, ORIGIN), /longer than 128/);
});

test('the feed lists the newest published result first', () => {
  const result = (id: string, publishedAt: string) => ({ id, publishedAt, provenance: 'instance' as const, instance: ORIGIN, wallet: { name: 'W' }, tests: [] });
  const { results } = feed([result('jan', '2026-01-01T00:00:00.000Z'), result('feb', '2026-02-01T00:00:00.000Z')], SCENARIOS);
  assert.deepEqual(results.map((r) => r.id), ['feb', 'jan']);
});

test('published results survive a restart', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wallet-qa-published-'));
  try {
    const file = path.join(dir, 'published.json');
    const store = await new FilePublishedStore(file).init();
    const ctx = await setup();
    await passIssuance(ctx);
    const result = publishFromRuns((await ctx.workspaces.get(WS))!, await ctx.engine.runs(WS), ORIGIN);
    await store.add(result);
    const reopened = await new FilePublishedStore(file).init();
    assert.deepEqual(await reopened.list(), [result]);
    assert.equal(await reopened.delete(result.id), true);
    assert.deepEqual(await (await new FilePublishedStore(file).init()).list(), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('API: publish, public feed, upload and removal with the admin token', async () => {
  const ctx = await setup();
  const run = await passIssuance(ctx);
  const published = await new FilePublishedStore().init();
  const app = createApp(ctx.engine, { publicDir: path.resolve('public'), publicOrigin: ORIGIN, published, adminToken: ADMIN });
  const { base, close } = await listen(app);
  try {
    // A cross-site form post cannot send JSON without a preflight; the route refuses it.
    const form = await fetch(`${base}/v1/workspaces/${WS}/publish`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '' });
    assert.equal(form.status, 415);
    const publish = await fetch(`${base}/v1/workspaces/${WS}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(publish.status, 201);
    const record = await publish.json();

    const feedResponse = await fetch(`${base}/v1/published`);
    assert.equal(feedResponse.headers.get('access-control-allow-origin'), '*');
    assert.equal(feedResponse.headers.get('cache-control'), 'public, max-age=60');
    const body = await feedResponse.json();
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].id, record.id);

    // A workspace report larger than the general 64 kB body limit is accepted.
    const workspace = (await ctx.workspaces.get(WS))!;
    const report = { workspace, runs: [auditReport(run)], padding: 'x'.repeat(100_000) };
    const upload = await fetch(`${base}/v1/uploads`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
    assert.equal(upload.status, 201);
    assert.equal((await upload.json()).provenance, 'self-reported');
    // The page shows this exact message as "the file is not JSON".
    const notJson = await fetch(`${base}/v1/uploads`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not json' });
    assert.equal(notJson.status, 400);
    assert.equal((await notJson.json()).error.message, 'Invalid JSON body');
    const bad = await fetch(`${base}/v1/uploads`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"runs":[]}' });
    assert.equal(bad.status, 400);

    assert.equal((await fetch(`${base}/v1/published/${record.id}`, { method: 'DELETE' })).status, 403);
    assert.equal((await fetch(`${base}/v1/published/${record.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer wrong' } })).status, 403);
    assert.equal((await fetch(`${base}/v1/published/${record.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ADMIN}` } })).status, 204);
    assert.equal((await fetch(`${base}/v1/published/${record.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ADMIN}` } })).status, 404);
    assert.equal((await (await fetch(`${base}/v1/published`)).json()).results.length, 1);

    // The results page is the Angular app (served at /results, tests/web.test.ts); without a
    // built page it says so, while the feed above keeps working.
    assert.equal((await fetch(`${base}/results`)).status, 503);
  } finally {
    await close();
  }
});

const publishJson = (base: string, ws = WS) =>
  fetch(`${base}/v1/workspaces/${ws}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });

test('API: without an admin token, removal is off', async () => {
  const ctx = await setup();
  await passIssuance(ctx);
  const app = createApp(ctx.engine, { publicDir: path.resolve('public'), publicOrigin: ORIGIN, published: await new FilePublishedStore().init() });
  const { base, close } = await listen(app);
  try {
    const record = await (await publishJson(base)).json();
    const response = await fetch(`${base}/v1/published/${record.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ADMIN}` } });
    assert.equal(response.status, 403);
    assert.equal((await (await fetch(`${base}/v1/published`)).json()).results.length, 1);
  } finally {
    await close();
  }
});

test('API: publishing refuses unknown and empty workspaces and stops at the store limit', async () => {
  const ctx = await setup();
  const published = await new FilePublishedStore(undefined, 1).init();
  const app = createApp(ctx.engine, { publicDir: path.resolve('public'), publicOrigin: ORIGIN, published });
  const { base, close } = await listen(app);
  try {
    assert.equal((await publishJson(base, 'unknown-workspace-0001')).status, 404);
    await ctx.engine.create({ workspaceId: WS, scenarioId: 'I-EAA-NOTX' });
    const empty = await publishJson(base);
    assert.equal(empty.status, 400);
    assert.equal((await empty.json()).error.message, 'The workspace has no finished runs to publish');
    await passIssuance(ctx);
    assert.equal((await publishJson(base)).status, 201);
    assert.equal((await publishJson(base)).status, 409);
    assert.equal((await published.list()).length, 1);
  } finally {
    await close();
  }
});

test('API: without a published store, the publish routes answer 404', async () => {
  const ctx = await setup();
  await passIssuance(ctx);
  const { base, close } = await listen(createApp(ctx.engine, { publicDir: path.resolve('public'), publicOrigin: ORIGIN }));
  try {
    assert.equal((await fetch(`${base}/v1/published`)).status, 404);
    assert.equal((await publishJson(base)).status, 404);
    assert.equal((await fetch(`${base}/v1/uploads`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
  } finally {
    await close();
  }
});
