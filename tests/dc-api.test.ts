import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import { FileRunStore } from '../src/testing/store.js';
import { Engine, liveRun } from '../src/testing/engine.js';
import { SCENARIOS } from '../src/testing/catalog.js';
import { createApp } from '../src/app.js';
import { auditReport } from '../src/testing/report.js';
import { createBackendRegistry } from '../src/testing/backends.js';
import type { Backend, DcApiResponse } from '../src/testing/eudiplo.js';
import type { SessionEvidence, StepDefinition } from '../src/testing/types.js';
import { testWorkspaces, WS } from './helpers.js';

const RESPONSE_URI = 'https://eudiplo.test/presentations/nonce-1/oid4vp';
const requestObject = (payload: object = { response_uri: RESPONSE_URI, response_mode: 'dc_api.jwt' }) =>
  `${Buffer.from('{"alg":"ES256"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.c2ln`;
// EUDIPLO flattens mDOC namespaces in its verified claims.
const AGE = [{ id: 'pid-mso-mdoc', values: [{ age_over_18: true }] }];

/** A verifier that completes the session when it gets a response and fails it on a wallet error. */
class FakeBackend implements Backend {
  sessions = new Map<string, SessionEvidence>();
  steps: StepDefinition[] = [];
  delivered: { responseUri: string; body: DcApiResponse }[] = [];
  request = requestObject();
  refuse = false;
  async start(step: StepDefinition) {
    const sessionId = crypto.randomUUID();
    this.steps.push(step); this.sessions.set(sessionId, { status: 'active' });
    return { sessionId, uri: 'openid4vp://?request_uri=https%3A%2F%2Feudiplo.test%2Frequest', ...(step.channel === 'dc-api' ? { dcApi: { request: this.request } } : {}) };
  }
  async dcApiResponse(responseUri: string, body: DcApiResponse) {
    this.delivered.push({ responseUri, body });
    if (this.refuse) return 400;
    const [sessionId] = [...this.sessions.keys()].slice(-1);
    this.sessions.set(sessionId, 'error' in body ? { status: 'failed', walletErrorCode: body.error } : { status: 'completed', credentials: AGE });
    return 200;
  }
  async session(id: string) { return structuredClone(this.sessions.get(id)!); }
  async deleteSession(id: string) { this.sessions.delete(id); }
  async setStatus() {}
  async health() {}
  async requestObject(): Promise<string> { throw new Error('not used'); }
}
async function setup() {
  const store = await new FileRunStore().init();
  const backend = new FakeBackend();
  // A long poll interval shows that a delivered response is evaluated at once.
  const engine = new Engine(store, await testWorkspaces(), backend, { publicOrigin: 'https://qa.test', retentionMs: 3600000, pollMs: 60000, versions: { catalog: '', sdk: 'test', eudiplo: 'test' } });
  const start = async (scenarioId = 'P-DCAPI-MDOC') => (await engine.create({ workspaceId: WS, scenarioId })).run;
  return { store, backend, engine, start };
}
const yes = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { answer: 'yes' as const, at: new Date().toISOString() }]));

test('the Digital Credentials API tests ask EUDIPLO for a dc-api request and show no link or QR code', async () => {
  const { backend, start } = await setup();
  for (const id of ['P-DCAPI-SDJWT', 'P-DCAPI-MDOC']) {
    const scenario = SCENARIOS.find((s) => s.id === id)!;
    assert.equal(scenario.availability, 'ready');
    assert.ok(scenario.tags.includes('dc-api'));
    const live = liveRun(await start(id));
    assert.equal(live.state, 'awaiting_wallet');
    assert.deepEqual(live.currentStep.interaction, { uri: null, crossDeviceUri: null, transactionCode: null, dcApi: { protocol: 'openid4vp-v1-signed', request: backend.request } });
  }
  assert.deepEqual(backend.steps.map((s) => s.channel), ['dc-api', 'dc-api']);
  // Every other presentation keeps its link.
  const plain = liveRun(await start('P-PID-AGE-MDOC'));
  assert.match(plain.currentStep.interaction.uri!, /^openid4vp:/);
  assert.equal(plain.currentStep.interaction.dcApi, null);
});

test('a wallet response is forwarded to the verifier and the session decides the run', async () => {
  const { engine, backend, start } = await setup();
  const run = await start();
  const after = await engine.dcApiResponse(run.id, { response: 'encrypted.jwe' });
  assert.deepEqual(backend.delivered, [{ responseUri: RESPONSE_URI, body: { response: 'encrypted.jwe' } }]);
  assert.equal(after.state, 'awaiting_tester');
  assert.ok(after.steps[0].assertions.every((a) => a.status === 'passed'));
  const done = await engine.answer(run.id, yes(['dc-api-dialog', 'verifier-shown']));
  assert.equal(done.verdict, 'passed');
  assert.ok(!done.attested);
  // The request and the response stay out of the audit report.
  const audit = JSON.stringify(auditReport(done));
  assert.ok(!audit.includes(backend.request) && !audit.includes('encrypted.jwe'));
  assert.ok(done.events.some((e) => e.type === 'dcapi.response.delivered'));
  await assert.rejects(engine.dcApiResponse(run.id, { response: 'again' }), /not waiting/);
});

test('over-disclosure through the Digital Credentials API fails like any other presentation', async () => {
  const { engine, backend, start } = await setup();
  const run = await start();
  backend.dcApiResponse = async () => {
    backend.sessions.set(run.steps[0].sessionId!, { status: 'completed', credentials: [{ id: 'pid-mso-mdoc', values: [{ age_over_18: true, birth_date: '1964-08-12' }] }] });
    return 200;
  };
  assert.equal((await engine.dcApiResponse(run.id, { response: 'encrypted.jwe' })).verdict, 'failed');
});

test('a wallet error fails the run; a response the verifier refuses leaves it open', async () => {
  const { engine, backend, store, start } = await setup();
  const denied = await start();
  const after = await engine.dcApiResponse(denied.id, { error: 'access_denied', error_description: 'User said no' });
  assert.equal(after.verdict, 'failed');
  assert.ok(after.events.some((e) => e.type === 'dcapi.response.delivered' && e.detail === 'wallet error access_denied'));
  assert.ok(!JSON.stringify(after.events).includes('User said no'));

  backend.refuse = true;
  const open = await start();
  await assert.rejects(engine.dcApiResponse(open.id, { response: 'garbage' }), /refused the wallet response \(HTTP 400\)/);
  const current = (await store.get(open.id))!;
  assert.equal(current.verdict, null);
  assert.ok(current.events.some((e) => e.type === 'dcapi.response.refused' && e.detail === 'HTTP 400'));
});

test('only a run waiting on a Digital Credentials API step accepts a response', async () => {
  const { engine, backend, start } = await setup();
  const plain = await start('P-PID-AGE-MDOC');
  await assert.rejects(engine.dcApiResponse(plain.id, { response: 'encrypted.jwe' }), /not waiting/);
  assert.equal(backend.delivered.length, 0);
  // A backend answer without a usable request is a setup error, not a wallet failure.
  backend.request = requestObject({ response_mode: 'dc_api.jwt' });
  const broken = await start();
  assert.equal(broken.verdict, 'error');
  assert.match(broken.reason!, /Digital Credentials API request/);
});

test('API: the page posts what navigator.credentials.get returned', async () => {
  const { engine, backend, start } = await setup();
  const app = createApp(engine, { publicDir: path.resolve('public'), publicOrigin: 'https://qa.test' });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (id: string, body: unknown) => fetch(`${base}/v1/runs/${id}/dc-api/response`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const run = await start();
    for (const invalid of [{}, { response: '' }, { response: 7 }, { error: 'not a code!' }, []])
      assert.equal((await post(run.id, invalid)).status, 400);
    assert.equal(backend.delivered.length, 0);
    // A presentation is larger than the 64 kB limit of the other endpoints.
    const large = 'a'.repeat(200000);
    const response = await post(run.id, { response: large, ignored: true });
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as { awaitingTester: boolean }).awaitingTester, true);
    assert.deepEqual(backend.delivered[0].body, { response: large });
    assert.equal((await post(run.id, { response: 'again' })).status, 409);
    assert.equal((await post(crypto.randomUUID(), { response: 'x' })).status, 404);

    const denied = await start();
    assert.equal((await post(denied.id, { error: 'access_denied', error_description: 'User said no' })).status, 200);
    assert.deepEqual(backend.delivered[1].body, { error: 'access_denied', error_description: 'User said no' });
    backend.refuse = true;
    assert.equal((await post((await start()).id, { response: 'garbage' })).status, 422);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test('the EUDIPLO adapter binds the request to the Wallet QA origin and only posts to its own verifier', async () => {
  const originalFetch = globalThis.fetch;
  const seen: { url: string; method: string; body?: any }[] = [];
  const registry = createBackendRegistry(
    [{ id: 'default', instanceId: 'i', tenantId: 'base', configVersion: 'v1', eudiploVersion: 'test', baseUrl: 'http://eudiplo.internal:3000', publicUrl: 'https://eudiplo.test', clientId: 'client', clientSecret: 'secret' }],
    'https://qa.test', 'https://qa.test/r/{sessionId}',
  );
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init); const url = new URL(request.url);
    if (url.pathname === '/api/oauth2/token')
      return Response.json({ access_token: `h.${Buffer.from(JSON.stringify({ tenant_id: 'base' })).toString('base64url')}.s`, expires_in: 3600 });
    seen.push({ url: request.url, method: request.method, body: request.method === 'POST' ? await request.json() : undefined });
    if (url.pathname.endsWith('/offer')) return Response.json({ session: 'session-1', uri: 'openid4vp://test' });
    if (url.pathname === '/api/session/session-1') return Response.json({ status: 'active', requestObject: requestObject() });
    return Response.json({}, { status: url.pathname.endsWith('/oid4vp') ? 200 : 404 });
  };
  try {
    const backend = registry.resolve(registry.snapshot('default'));
    const step = SCENARIOS.find((s) => s.id === 'P-DCAPI-MDOC')!.steps[0];
    const started = await backend.start(step);
    assert.deepEqual(seen[0].body, { requestId: 'qa-pid-age-over-mdoc', response_type: 'dc-api', expected_origin: 'https://qa.test' });
    assert.deepEqual(started.dcApi, { request: requestObject() });
    assert.equal(await backend.dcApiResponse!(RESPONSE_URI, { response: 'encrypted.jwe' }), 200);
    const posted = seen.at(-1)!;
    assert.equal(posted.url, 'http://eudiplo.internal:3000/presentations/nonce-1/oid4vp');
    assert.deepEqual(posted.body, { response: 'encrypted.jwe', sendResponse: false });
    const before = seen.length;
    await assert.rejects(backend.dcApiResponse!('https://elsewhere.test/presentations/nonce-1/oid4vp', { response: 'x' }), /Unexpected response origin/);
    assert.equal(seen.length, before);
  } finally { globalThis.fetch = originalFetch; }
});
