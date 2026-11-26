// The page (web/): its page-contract texts and attributes, checked against real run views from
// the engine, the texts and lists of its screens, and how Express serves it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { Engine, liveRun } from '../src/testing/engine.js';
import type { Backend } from '../src/testing/eudiplo.js';
import { FileRunStore } from '../src/testing/store.js';
import type { SessionEvidence, StepDefinition } from '../src/testing/types.js';
import {
  answersToSend,
  awaitingWallet,
  badgeText,
  checklistDue,
  checklistLaterText,
  contractAttributes,
  hasDcApi,
  credentialRequest,
  dcApiErrorText,
  dcApiRequest,
  dcApiResponseBody,
  qrValue,
  reasonText,
  stepText,
  transactionCodeText,
  verdictTone,
  walletLink,
  type LiveRun,
} from '../web/src/app/model/run-view.js';
import {
  catalogSections,
  scenarioChips,
  certificateText,
  instanceRootText,
  instanceSummary,
  progressText,
  publishErrorText,
  publishedText,
  statusText,
  tagsOf,
  workspaceBody,
  workspaceIdFrom,
  workspaceSummary,
  type Scenario,
} from '../web/src/app/model/workspace-view.js';
import { RUN_TRACE, catalogOverview, catalogTotalText, sectionCountText } from '../web/src/app/model/home-view.js';
import { testWorkspaces, WS } from './helpers.js';

class FakeBackend implements Backend {
  sessions = new Map<string, SessionEvidence>();
  async start(step: StepDefinition) {
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, { status: 'active' });
    const uri = `openid-credential-offer://?credential_offer_uri=https%3A%2F%2Feudiplo.test%2F${sessionId}`;
    if (step.channel !== 'dc-api') return { sessionId, uri };
    const payload = Buffer.from(JSON.stringify({ response_uri: 'https://eudiplo.test/presentations/1/oid4vp' })).toString('base64url');
    return { sessionId, uri, dcApi: { request: `e30.${payload}.c2ln` } };
  }
  async session(id: string) { return structuredClone(this.sessions.get(id)!); }
  async deleteSession(id: string) { this.sessions.delete(id); }
  async setStatus() {}
  async health() {}
  async requestObject() { return ''; }
}

async function setup() {
  const store = await new FileRunStore().init();
  const backend = new FakeBackend();
  const engine = new Engine(store, await testWorkspaces(), backend, {
    publicOrigin: 'https://qa.test',
    retentionMs: 3600000,
    pollMs: 0,
    versions: { catalog: '', sdk: '7.6.0', eudiplo: '7.6.0' },
  });
  return { store, backend, engine };
}

/** The run view the page gets from GET /v1/runs/:id. */
const view = (run: Parameters<typeof liveRun>[0]) => JSON.parse(JSON.stringify(liveRun(run))) as LiveRun;

test('page: a running issuance shows its status, transaction code and an Open wallet link', async () => {
  const { engine, store } = await setup();
  const { run } = await engine.create({ workspaceId: WS, scenarioId: 'I-EAA-TX' });
  const live = view((await store.get(run.id))!);
  assert.equal(badgeText(live), 'Status: awaiting wallet');
  assert.equal(stepText(live), `Step ${live.currentStep.id}: awaiting wallet`);
  assert.equal(reasonText(live), 'Waiting for the wallet. The result updates automatically.');
  assert.equal(awaitingWallet(live), true);
  assert.match(walletLink(live)!, /^openid-credential-offer:/);
  assert.equal(qrValue(live), live.currentStep.interaction.crossDeviceUri ?? live.currentStep.interaction.uri);
  assert.match(transactionCodeText(live), /^Transaction code: \S+$/);
  assert.deepEqual(contractAttributes(live, 'fresh'), {
    runId: run.id, completed: 'false', passed: 'pending', verdict: 'pending', attested: 'false', sync: 'fresh',
  });
  assert.equal(verdictTone(live), 'neutral');
});

test('page: after the wallet, the checklist and then the verdict; no wallet link', async () => {
  const { engine, store, backend } = await setup();
  const { run } = await engine.create({ workspaceId: WS, scenarioId: 'I-EAA-NOTX' });
  backend.sessions.set((await store.get(run.id))!.steps[0].sessionId!, { status: 'completed' });
  await engine.tick(run.id);
  const tester = view((await store.get(run.id))!);
  assert.equal(badgeText(tester), 'Status: awaiting tester');
  assert.equal(reasonText(tester), 'The server checks passed. Answer the checklist to finish the run.');
  assert.equal(walletLink(tester), undefined);
  assert.ok(tester.checklist.length > 0);
  const at = new Date().toISOString();
  const checks = (await store.get(run.id))!.scenario.manual ?? [];
  await engine.answer(run.id, Object.fromEntries(checks.map((check) => [check.id, { answer: check.expect, at }])));
  const live = view((await store.get(run.id))!);
  assert.equal(live.completed, true, live.reason ?? live.state);
  assert.match(badgeText(live), /^Verdict: \w+/);
  assert.equal(walletLink(live), undefined);
  assert.equal(contractAttributes(live, 'fresh').completed, 'true');
  assert.equal(contractAttributes(live, 'fresh').verdict, live.verdict);
});

test('page: texts and attributes without a run, and for attested and failed runs', () => {
  assert.equal(badgeText(undefined), 'Verdict: none');
  assert.deepEqual(contractAttributes(undefined, 'idle'), {
    runId: '', completed: 'false', passed: 'pending', verdict: 'pending', attested: 'false', sync: 'idle',
  });
  assert.equal(contractAttributes(undefined, 'error', 'unavailable').verdict, 'unavailable');
  const base = {
    id: 'r1', scenarioId: 'P-X', scenarioLabel: 'X', state: 'finished', completed: true, passed: true,
    verdict: 'passed', attested: true, reason: null, awaitingTester: false, noEvidence: null,
    currentStep: { id: 'present', state: 'finished', instruction: null, interaction: { uri: 'openid4vp://x', crossDeviceUri: null, transactionCode: null } },
    checklist: [], controls: [], assertions: [], createdAt: '',
  } satisfies LiveRun;
  assert.equal(badgeText(base), 'Verdict: passed (tester-attested)');
  assert.equal(contractAttributes(base, 'fresh').attested, 'true');
  assert.equal(verdictTone(base), 'passed');
  assert.equal(verdictTone({ ...base, verdict: 'failed', passed: false }), 'failed');
  assert.equal(verdictTone({ ...base, verdict: 'skipped', passed: false }), 'neutral');
  const tester = { ...base, state: 'awaiting_tester', completed: false, passed: null, verdict: null, attested: null, awaitingTester: true } satisfies LiveRun;
  assert.equal(reasonText(tester), 'The server checks passed. Answer the checklist to finish the run.');
  assert.equal(reasonText({ ...tester, noEvidence: 'EUDIPLO has no evidence' }), 'EUDIPLO has no evidence. Answer the checklist to finish the run.');
});

test('page: Open wallet only navigates to wallet hand-off schemes', () => {
  const run = (uri: string) => ({
    id: 'r1', scenarioId: 'P-X', scenarioLabel: 'X', state: 'awaiting_wallet', completed: false, passed: null,
    verdict: null, attested: null, reason: null, awaitingTester: false, noEvidence: null,
    currentStep: { id: 'present', state: 'awaiting_wallet', instruction: null, interaction: { uri, crossDeviceUri: null, transactionCode: null } },
    checklist: [], controls: [], assertions: [], createdAt: '',
  }) satisfies LiveRun;
  for (const uri of ['openid4vp://?a=1', 'openid-credential-offer://?a=1', 'haip://?a=1', 'eudi-openid4vp://?a=1', 'https://wallet.test/x'])
    assert.equal(walletLink(run(uri)), uri);
  for (const uri of ['javascript:alert(1)', 'http://wallet.test/x', 'not a url'])
    assert.equal(walletLink(run(uri)), undefined, uri);
});

test('page: a Digital Credentials API step has no link or QR code, only the request for the browser', () => {
  const dcApi = { protocol: 'openid4vp-v1-signed', request: 'signed.request.jwt' };
  const live = {
    id: 'run-1', completed: false, state: 'awaiting_wallet',
    currentStep: { id: 'present', state: 'awaiting_wallet', instruction: null, interaction: { uri: null, crossDeviceUri: null, transactionCode: null, dcApi } },
  } as unknown as LiveRun;
  assert.equal(awaitingWallet(live), true);
  assert.deepEqual(dcApiRequest(live), dcApi);
  assert.equal(walletLink(live), undefined);
  assert.equal(qrValue(live), undefined);
  assert.deepEqual(credentialRequest(dcApi), {
    mediation: 'required',
    digital: { requests: [{ protocol: 'openid4vp-v1-signed', data: { request: 'signed.request.jwt' } }] },
  });
  assert.equal(dcApiRequest({ ...live, completed: true }), undefined);
});

test('page: what the Digital Credentials API returned is posted as a response or a wallet error', () => {
  assert.deepEqual(dcApiResponseBody({ protocol: 'openid4vp-v1-signed', data: { response: 'encrypted.jwe' } }), { response: 'encrypted.jwe' });
  // Older implementations return the data as a JSON string.
  assert.deepEqual(dcApiResponseBody({ data: JSON.stringify({ error: 'access_denied' }) }), { error: 'access_denied' });
  assert.equal(dcApiResponseBody({ data: { error_description: 'no error code' } }), undefined);
  assert.equal(dcApiResponseBody({ data: 'not json' }), undefined);
  assert.equal(dcApiResponseBody(null), undefined);
  assert.match(dcApiErrorText(Object.assign(new Error('dismissed'), { name: 'NotAllowedError' })), /cancelled or no wallet/);
  assert.equal(dcApiErrorText(new Error('boom')), 'Digital Credentials API: boom');
});

test('page: the dc-api steps of P-DCAPI-* reach the page as a request, not a link', async () => {
  const { engine, store } = await setup();
  const { run } = await engine.create({ workspaceId: WS, scenarioId: 'P-DCAPI-SDJWT' });
  const live = view((await store.get(run.id))!);
  assert.equal(live.currentStep.interaction.uri, null);
  assert.equal(dcApiRequest(live)?.protocol, 'openid4vp-v1-signed');
  assert.equal(walletLink(live), undefined);
});

test('page: only answered checklist items are sent, without empty notes', () => {
  assert.deepEqual(answersToSend({ a: { answer: 'yes', note: '' }, b: { note: 'only a note' }, c: { answer: 'no', note: 'seen' } }), {
    a: { answer: 'yes' },
    c: { answer: 'no', note: 'seen' },
  });
});

test('page: the setup form sends only filled fields and finds workspace IDs in links', () => {
  assert.deepEqual(workspaceBody({ tester: ' ', name: ' EUDI Wallet ', version: '1.4.2', platform: 'android', device: '' }), {
    wallet: { name: 'EUDI Wallet', version: '1.4.2', platform: 'android' },
  });
  assert.deepEqual(workspaceBody({ tester: 'Alice', name: 'W', version: '', platform: '', device: '' }), { tester: 'Alice', wallet: { name: 'W' } });
  assert.equal(workspaceIdFrom(`https://qa.test/w/${WS}/`), WS);
  assert.equal(workspaceIdFrom(` ${WS} `), WS);
  assert.equal(workspaceIdFrom('https://qa.test/w/short'), undefined);
  assert.equal(
    workspaceSummary({ id: WS, tester: 'Alice', wallet: { name: 'EUDI Wallet', version: '1.4.2', platform: 'android', device: 'Pixel 8' } }),
    'Alice · EUDI Wallet 1.4.2 · android · Pixel 8',
  );
});

test('page: the catalog groups by section, filters, and shows the latest status of each test', () => {
  const scenario = (id: string, section: string, tags: string[], availability = 'ready'): Scenario => ({
    id, section, label: `Label ${id}`, description: '', profile: 'p', tags, prerequisites: [], availability,
  });
  const scenarios = [scenario('I-A', 'Issuance', ['eaa']), scenario('P-B', 'Presentation', ['pid']), scenario('R-OFF', 'Rejection', [], 'unsupported')];
  const run = (scenarioId: string, extra: Partial<LiveRun>) => ({ id: scenarioId, scenarioId, completed: true, verdict: 'passed', attested: false, awaitingTester: false, ...extra }) as LiveRun;
  const runs = [run('I-A', { attested: true }), run('P-B', { completed: false, verdict: null, awaitingTester: true })];
  const all = catalogSections(scenarios, runs, '', '');
  assert.deepEqual(all.map((s) => s.name), ['Issuance', 'Presentation', 'Rejection']);
  assert.deepEqual(all.flatMap((s) => s.items.map((i) => `${i.scenario.id}:${i.status}:${i.tone}`)), [
    'I-A:passed (attested):passed', 'P-B:answer checklist:running', 'R-OFF:unsupported:neutral',
  ]);
  assert.deepEqual(catalogSections(scenarios, runs, 'label p-b', '').flatMap((s) => s.items.map((i) => i.scenario.id)), ['P-B']);
  assert.deepEqual(catalogSections(scenarios, runs, '', 'eaa').flatMap((s) => s.items.map((i) => i.scenario.id)), ['I-A']);
  assert.deepEqual(tagsOf(scenarios), ['eaa', 'pid']);
  assert.equal(progressText(scenarios, runs), '1 of 2 run');
  assert.equal(statusText(undefined), 'not run');
  assert.equal(statusText(run('X', { verdict: 'failed' })), 'failed');
  assert.equal(statusText(run('X', { completed: false, verdict: null })), 'running');
  // Only tests with a run or without support get a chip; sections count finished of supported tests.
  const quiet = catalogSections([...scenarios, scenario('I-NEW', 'Issuance', [])], runs, '', '');
  assert.deepEqual(quiet.flatMap((s) => s.items.map((i) => `${i.scenario.id}:${i.chip}`)), ['I-A:true', 'I-NEW:false', 'P-B:true', 'R-OFF:true']);
  assert.deepEqual(quiet.map((s) => s.count), ['1/2', '0/1', '0/0']);
  assert.deepEqual(scenarioChips(scenarios[0]), ['p', 'eaa']);
});

test('page: the checklist stays folded while the wallet part runs', () => {
  const live = (extra: Partial<LiveRun>) => ({ completed: false, state: 'awaiting_wallet', checklist: [{ id: 'a' }, { id: 'b' }], ...extra }) as LiveRun;
  assert.equal(checklistDue(live({})), false);
  assert.equal(checklistDue(live({ state: 'awaiting_tester' })), true);
  assert.equal(checklistDue(live({ completed: true, state: 'finished' })), true);
  assert.equal(checklistLaterText(live({})), '2 questions to answer once the wallet is done.');
  assert.equal(checklistLaterText(live({ checklist: [{ id: 'a' }] as LiveRun['checklist'] })), '1 question to answer once the wallet is done.');
});

test('page: the Digital Credentials API is detected before the button is pressed', () => {
  assert.equal(hasDcApi({}), false);
  assert.equal(hasDcApi({ navigator: { credentials: { get: () => undefined } } }), false);
  assert.equal(hasDcApi({ DigitalCredential: class {}, navigator: { credentials: { get: () => undefined } } }), true);
});

test('start page: the run trace uses the live run texts, and the catalog overview counts per section', () => {
  // The trace shows the statuses a tester will see on the run screen (badgeText above).
  const statuses = RUN_TRACE.flatMap((step) => step.statuses.map((status) => status.text));
  assert.ok(statuses.includes('Status: awaiting wallet'));
  assert.ok(statuses.includes('Status: awaiting tester'));
  const scenario = (id: string, section: string, availability = 'ready'): Scenario => ({
    id, section, label: `Label ${id}`, description: '', profile: 'p', tags: [], prerequisites: [], availability,
  });
  const sections = catalogOverview([
    scenario('I-1', 'Issuance'), scenario('I-2', 'Issuance', 'unsupported'), scenario('P-1', 'Presentation'),
    scenario('P-2', 'Presentation'), scenario('P-3', 'Presentation'), scenario('P-4', 'Presentation'), scenario('X-1', 'Other'),
  ]);
  assert.deepEqual(sections.map((s) => [s.name, s.ready, s.pending]), [['Issuance', 1, 1], ['Presentation', 4, 0], ['Other', 1, 0]]);
  assert.deepEqual(sections[1].examples, ['Label P-1', 'Label P-2', 'Label P-3']);
  assert.match(sections[0].question, /OpenID4VCI/);
  assert.equal(sections[2].question, '');
  assert.equal(sectionCountText(sections[0]), '1 test, 1 more waiting for fixtures');
  assert.equal(sectionCountText(sections[1]), '4 tests');
  assert.equal(catalogTotalText(sections), '6 tests run on this instance.');
});

test('page: the instance trust setup and the publish messages', () => {
  const environment = {
    trust: { sha256: 'AB:CD', rootCertificateDer: 'wallet-qa-test-root.der' },
    tenants: [
      { tenantId: 'base', profileIds: ['default'], description: 'Main verifier', accessCertificate: { source: 'other', issuer: 'Registrar CA', validTo: '2027-01-01T00:00:00.000Z' } },
      { tenantId: 'issuer-dpop-v1', profileIds: ['dpop-v1'], accessCertificate: null },
    ],
  };
  assert.equal(instanceSummary(environment), 'This instance: 2 EUDIPLO tenants · wallet must trust Registrar CA');
  assert.equal(certificateText(environment.tenants[0]), 'access certificate issued by Registrar CA (valid until 2027-01-01)');
  assert.equal(certificateText(environment.tenants[1]), 'no access certificate (issuer only)');
  assert.equal(certificateText({ ...environment.tenants[1], error: 'expired' }), 'trust check failed: expired');
  assert.equal(certificateText({ ...environment.tenants[0], accessCertificate: { source: 'test-root', issuer: 'x', validTo: '2030-05-01' } }), 'access certificate from the Wallet QA test root (valid until 2030-05-01)');
  assert.match(instanceRootText(environment), /SHA-256 AB:CD — \/trust\/wallet-qa-test-root\.der/);
  assert.equal(instanceSummary({ tenants: [{ tenantId: 'a', profileIds: [], accessCertificate: null }] }), 'This instance: 1 EUDIPLO tenant');
  assert.equal(publishedText(2), 'Published 2 test results to /results.');
  assert.equal(publishedText(1, true), 'Published 1 self-reported test result to /results.');
  // The server answers a body that is not JSON with 400 "Invalid JSON body" (tests/published.test.ts).
  assert.equal(publishErrorText(400, 'Invalid JSON body'), 'Could not publish: the file is not JSON');
  assert.equal(publishErrorText(409, 'Already published'), 'Could not publish: Already published');
});

test('HTTP: the page is served at /, /start, /w/<workspace> and /results, its bundle under /web/; trust and the API stay', async () => {
  const { engine } = await setup();
  const webDir = await mkdtemp(path.join(os.tmpdir(), 'wallet-qa-web-'));
  await writeFile(path.join(webDir, 'index.html'), '<qa-root></qa-root>');
  await writeFile(path.join(webDir, 'main-ABC.js'), 'console.log(1)');
  const listen = async (app: ReturnType<typeof createApp>) => {
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise((resolve) => server.close(resolve)) };
  };
  const withWeb = await listen(createApp(engine, { publicDir: path.resolve('public'), publicOrigin: 'http://localhost', webDir }));
  const without = await listen(createApp(engine, { publicDir: path.resolve('public'), publicOrigin: 'http://localhost' }));
  try {
    for (const route of ['/', '/start', '/start?e2e=1', `/w/${WS}`, `/w/${WS}?scenario=I-EAA-NOTX&e2e=1`, '/results']) {
      const response = await fetch(withWeb.base + route);
      assert.equal(response.status, 200, route);
      assert.equal(await response.text(), '<qa-root></qa-root>', route);
    }
    // The bundle is under /web/ only (deployUrl), the one prefix a hosted proxy opens for /results.
    assert.match(await (await fetch(`${withWeb.base}/web/main-ABC.js`)).text(), /console/);
    assert.equal((await fetch(`${withWeb.base}/main-ABC.js`)).status, 404);
    assert.equal((await fetch(`${withWeb.base}/web/missing.js`)).status, 404);
    assert.equal((await fetch(`${withWeb.base}/results.js`)).status, 404);
    assert.equal((await fetch(`${withWeb.base}/trust/trust.json`)).status, 200);
    assert.equal((await fetch(`${withWeb.base}/v1/scenarios`)).status, 200);
    // Without a build the page says so instead of serving an empty page.
    const missing = await fetch(`${without.base}/w/${WS}`);
    assert.equal(missing.status, 503);
    assert.match((await missing.json()).error.message, /pnpm build/);
  } finally {
    await withWeb.close();
    await without.close();
    await rm(webDir, { recursive: true, force: true });
  }
});
