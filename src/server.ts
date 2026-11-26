import 'dotenv/config';
import { X509Certificate } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { SCENARIOS } from './testing/catalog.js';
import { Engine } from './testing/engine.js';
import {
  createBackendRegistry,
  loadBackendProfiles,
} from './testing/backends.js';
import {
  FilePublishedStore,
  FileRunStore,
  FileWorkspaceStore,
} from './testing/store.js';
import { TrustMonitor } from './testing/trust.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
// The page (web/): dist/web/browser next to the built server, or after `pnpm build:spa` in dev.
const webDir = [path.join(root, 'web', 'browser'), path.join(root, 'dist', 'web', 'browser')].find(
  (dir) => existsSync(path.join(dir, 'index.html')),
);
const port = Number(process.env.PORT ?? 8787);
const origin = (
  process.env.PUBLIC_ORIGIN ?? `http://localhost:${port}`
).replace(/\/$/, '');
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('Invalid PORT');
if (!['http:', 'https:'].includes(new URL(origin).protocol))
  throw new Error('PUBLIC_ORIGIN must be HTTP(S)');
const retentionHours = Number(process.env.QA_RETENTION_HOURS ?? 168);
if (
  !Number.isFinite(retentionHours) ||
  retentionHours < 1 ||
  retentionHours > 8760
)
  throw new Error('QA_RETENTION_HOURS must be between 1 and 8760');
const backend = createBackendRegistry(
  loadBackendProfiles(
    process.env.QA_BACKENDS_FILE ??
      path.resolve('config/eudiplo-backends.json'),
  ),
  origin,
  // Same-device presentations return here; /r/:sessionId leads back to the run.
  process.env.REDIRECT_URI ?? `${origin}/r/{sessionId}`,
);
for (const scenario of SCENARIOS)
  for (const step of scenario.steps) backend.snapshot(step.backendProfile);
const store = await new FileRunStore(
  process.env.QA_DATA_FILE ?? path.resolve('data/runs.json'),
).init();
const dataFile = process.env.QA_DATA_FILE ?? path.resolve('data/runs.json');
const workspaces = await new FileWorkspaceStore(
  path.join(path.dirname(dataFile), 'workspaces.json'),
).init();
// Published results are kept until an operator removes them, not for QA_RETENTION_HOURS.
const publishedMax = Number(process.env.QA_PUBLISHED_MAX ?? 1000);
if (!Number.isInteger(publishedMax) || publishedMax < 1 || publishedMax > 100000)
  throw new Error('QA_PUBLISHED_MAX must be between 1 and 100000');
const published = await new FilePublishedStore(
  path.join(path.dirname(dataFile), 'published.json'),
  publishedMax,
).init();
const adminToken = process.env.QA_ADMIN_TOKEN || undefined;
if (adminToken && adminToken.length < 32)
  throw new Error('QA_ADMIN_TOKEN must have at least 32 characters');
const engine = new Engine(store, workspaces, backend, {
  publicOrigin: origin,
  retentionMs: retentionHours * 3600000,
  pollMs: 1000,
  versions: {
    catalog: '',
    sdk: '7.6.0',
    eudiplo: process.env.EUDIPLO_VERSION ?? 'main',
  },
});
// The generated test root, to tell its access certificates apart from the registrar's.
const testRootFile = path.join(publicDir, 'trust', 'test-root.pem');
const trust = new TrustMonitor(
  () => backend.tenants(),
  existsSync(testRootFile) ? new X509Certificate(readFileSync(testRootFile)) : undefined,
);
trust.start();
const app = createApp(engine, {
  publicDir,
  publicOrigin: origin,
  trust: () => trust.current(),
  published,
  adminToken,
  webDir,
});
// Loopback by default; Docker sets HOST=0.0.0.0 so the proxy container can reach it.
const server = app.listen(port, process.env.HOST ?? '127.0.0.1', () =>
  console.log(`Wallet QA listening on ${origin}`),
);
let sweeping = false;
const interval = setInterval(async () => {
  if (sweeping) return;
  sweeping = true;
  try {
    await engine.sweep();
  } catch {
    console.error('Run reconciliation unavailable');
  } finally {
    sweeping = false;
  }
}, 1000);
interval.unref();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  trust.stop();
  clearInterval(interval);
  server.close(async () => {
    while (sweeping) await new Promise((resolve) => setTimeout(resolve, 100));
    await store.close();
    process.exit(0);
  });
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
