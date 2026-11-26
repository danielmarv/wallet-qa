import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import path from 'node:path';
import fs from 'node:fs';
import QRCode from 'qrcode';
import { CATALOG_VERSION } from './testing/catalog.js';
import { Engine, ApiError, equalSecret, liveRun } from './testing/engine.js';
import {
  feed,
  PublishError,
  publishFromRuns,
  publishFromUpload,
} from './testing/published.js';
import {
  auditReport,
  junitReport,
  workspaceJunitReport,
} from './testing/report.js';
import type { ManualAnswer, Workspace } from './testing/types.js';
import {
  MissingRun,
  PublishedStoreFull,
  type PublishedStore,
} from './testing/store.js';
import type { TenantTrust } from './testing/trust.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function text(value: unknown, name: string, max = 128): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new ApiError(400, `Invalid ${name}`);
  return value;
}
function integer(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback;
  const result = Number(value);
  if (
    typeof value === 'boolean' ||
    value === null ||
    value === '' ||
    !Number.isInteger(result) ||
    result < min ||
    result > max
  )
    throw new ApiError(400, `Expected integer between ${min} and ${max}`);
  return result;
}
function optionalText(value: unknown, name: string, max = 128) {
  return value === undefined || value === null || value === ''
    ? undefined
    : text(value, name, max);
}
function walletInput(value: unknown): Workspace['wallet'] {
  if (!object(value)) throw new ApiError(400, 'Expected wallet metadata');
  const wallet: Workspace['wallet'] = { name: text(value.name, 'wallet.name') };
  for (const key of ['version', 'platform', 'device'] as const) {
    const item = optionalText(value[key], `wallet.${key}`);
    if (item) wallet[key] = item;
  }
  return wallet;
}
// Access model: the workspace ID (128-bit random) and run IDs (UUID v4) are
// capabilities. Anyone holding the link can use that workspace. Protect the
// whole instance at the proxy (SSO or IP allow-list) when it is reachable
// beyond a trusted network.
export function createApp(
  engine: Engine,
  options: {
    publicDir: string;
    publicOrigin: string;
    trust?: () => TenantTrust[];
    /** Published results; without it the publish routes answer 404. */
    published?: PublishedStore;
    /** Bearer token that may remove published results; without it removal is off. */
    adminToken?: string;
    /** The built page (dist/web/browser); without it / and /w/<id> answer 503. */
    webDir?: string;
  },
) {
  const published = () => {
    if (!options.published) throw new ApiError(404, 'Publishing is not enabled');
    return options.published;
  };
  // The public feed is serialized once and rebuilt only after a publish or removal,
  // so anonymous readers cannot make the process clone and sort the store per request.
  let feedCache: string | undefined;
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    next();
  });
  app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/health/ready', async (_req, res) => {
    try {
      await engine.ready();
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
  // Signature-fault delivery: the wallet fetches a deliberately corrupted request object here.
  app.all(
    '/protocol/:id/:token/request',
    express.urlencoded({ extended: false, limit: '32kb' }),
    async (req, res) => {
      if (!uuid.test(String(req.params.id)))
        throw new ApiError(404, 'Request not found');
      if (!['GET', 'POST'].includes(req.method)) {
        res.set('Allow', 'GET, POST');
        throw new ApiError(405, 'Method not allowed');
      }
      const body = new URLSearchParams();
      if (req.method === 'POST') {
        if (!req.is('application/x-www-form-urlencoded'))
          throw new ApiError(415, 'Expected form-encoded request');
        for (const [key, value] of Object.entries(req.body ?? {})) {
          if (typeof value !== 'string')
            throw new ApiError(400, 'Invalid form value');
          body.set(key, value);
        }
      }
      const response = await engine.faultRequest(
        String(req.params.id),
        String(req.params.token),
        req.method,
        body.toString(),
      );

      if (!response) {
        throw new ApiError(502, 'Fault fixture could not be activated');
      }

      if (typeof response === 'number') {
        res.status(response).json({
          error: {
            code: `HTTP_${response}`,
            message: `Simulated HTTP ${response}`,
          },
        });
        return;
      }

      res.type('application/oauth-authz-req+jwt').send(response);
    },
  );
  // A self-reported result: a workspace JSON report from another instance. It
  // carries the audit events of every run, so it gets a larger body limit.
  app.post(
    '/v1/uploads',
    express.json({ limit: '5mb' }),
    async (req, res) => {
      const store = published();
      const result = publishFromUpload(req.body, engine.catalog, options.publicOrigin);
      await store.add(result);
      feedCache = undefined;
      res.status(201).location('/v1/published').json(result);
    },
  );
  const lookup = async (req: Request) => {
    const id = String(req.params.id);
    if (!uuid.test(id)) throw new ApiError(404, 'Run not found');
    return engine.lookup(id);
  };
  // Registered before the 64 kB JSON limit below: a presentation can be larger.
  // What navigator.credentials.get returned on the page for a dc-api step: the
  // wallet's encrypted response, or its OAuth error.
  app.post(
    '/v1/runs/:id/dc-api/response',
    express.json({ limit: '1mb' }),
    async (req, res) => {
      const run = await lookup(req);
      if (!object(req.body)) throw new ApiError(400, 'Expected a JSON object');
      const { response, error } = req.body;
      if (typeof response === 'string' && response && response.length <= 1048576)
        res.json(liveRun(await engine.dcApiResponse(run.id, { response })));
      else if (typeof error === 'string' && /^[a-zA-Z0-9_]{1,64}$/.test(error))
        res.json(
          liveRun(
            await engine.dcApiResponse(run.id, {
              error,
              error_description: optionalText(
                req.body.error_description,
                'error_description',
                500,
              ),
            }),
          ),
        );
      else throw new ApiError(400, 'Expected response or error');
    },
  );
  app.use(express.json({ limit: '64kb' }));
  app.get('/v1/environment', (_req, res) => {
    const file = path.join(options.publicDir, 'trust', 'trust.json');
    res.json({
      catalogVersion: CATALOG_VERSION,
      sdkVersion: '7.6.0',
      publicOrigin: options.publicOrigin,
      backendProfiles: engine.backendProfiles(),
      // The fixed tenants of this instance and where each one's access certificate comes from.
      tenants: options.trust?.() ?? [],
      trust: fs.existsSync(file)
        ? {
            ...JSON.parse(fs.readFileSync(file, 'utf8')),
            rootCertificateUrl: `${options.publicOrigin}/trust/test-root.pem`,
          }
        : null,
    });
  });
  app.get('/v1/scenarios', (_req, res) => {
    res.json({
      catalogVersion: CATALOG_VERSION,
      sections: [...new Set(engine.catalog.map((s) => s.section))],
      scenarios: engine.catalog,
    });
  });
  app.post('/v1/workspaces', async (req, res) => {
    if (!object(req.body)) throw new ApiError(400, 'Expected a JSON object');
    const workspace = await engine.createWorkspace({
      tester: optionalText(req.body.tester, 'tester'),
      wallet: walletInput(req.body.wallet),
    });
    res
      .status(201)
      .location(`/v1/workspaces/${workspace.id}`)
      .json(workspace);
  });
  app.get('/v1/workspaces/:ws', async (req, res) => {
    res.json(await engine.workspace(String(req.params.ws)));
  });
  app.patch('/v1/workspaces/:ws', async (req, res) => {
    if (!object(req.body)) throw new ApiError(400, 'Expected a JSON object');
    const changes: Partial<Pick<Workspace, 'tester' | 'wallet'>> = {};
    if ('tester' in req.body) changes.tester = optionalText(req.body.tester, 'tester');
    if ('wallet' in req.body) changes.wallet = walletInput(req.body.wallet);
    res.json(await engine.updateWorkspace(String(req.params.ws), changes));
  });
  app.get('/v1/workspaces/:ws/runs', async (req, res) => {
    const workspace = await engine.workspace(String(req.params.ws));
    const limit = integer(req.query.limit, 100, 1, 500);
    const runs = (await engine.runs(workspace.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(liveRun);
    res.json({ runs });
  });
  app.post('/v1/workspaces/:ws/runs', async (req, res) => {
    if (!object(req.body)) throw new ApiError(400, 'Expected scenarioId');
    const { run } = await engine.create({
      workspaceId: String(req.params.ws),
      scenarioId: text(req.body.scenarioId, 'scenarioId'),
      timeoutSeconds: integer(req.body.timeoutSeconds, 600, 1, 3600),
    });
    res.status(201).location(`/v1/runs/${run.id}`).json(liveRun(run));
  });
  app.get('/v1/workspaces/:ws/report', async (req, res) => {
    const workspace = await engine.workspace(String(req.params.ws));
    const runs = (await engine.runs(workspace.id)).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    if (req.query.format === 'junit')
      res.type('application/xml').send(workspaceJunitReport(workspace, runs));
    else
      res.json({
        workspace,
        catalogVersion: CATALOG_VERSION,
        runs: runs.map(auditReport),
      });
  });
  app.post('/v1/workspaces/:ws/publish', async (req, res) => {
    // A JSON content type needs a CORS preflight, so another site cannot make a
    // logged-in tester's browser publish a workspace with a plain form post.
    if (!req.is('application/json'))
      throw new ApiError(415, 'Expected Content-Type: application/json');
    const store = published();
    const workspace = await engine.workspace(String(req.params.ws));
    const runs = await engine.runs(workspace.id);
    const record = publishFromRuns(workspace, runs, options.publicOrigin);
    await store.add(record);
    feedCache = undefined;
    res.status(201).location('/v1/published').json(record);
  });
  // The public feed of published results. Readable without the team login.
  app.get('/v1/published', async (_req, res) => {
    const store = published();
    feedCache ??= JSON.stringify(feed(await store.list(), engine.catalog));
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60',
    });
    res.type('application/json').send(feedCache);
  });
  app.delete('/v1/published/:id', async (req, res) => {
    const store = published();
    const token = /^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1];
    if (!options.adminToken || !token || !equalSecret(token, options.adminToken))
      throw new ApiError(403, 'Removing published results needs the admin token');
    if (!(await store.delete(String(req.params.id))))
      throw new ApiError(404, 'Published result not found');
    feedCache = undefined;
    res.status(204).end();
  });
  app.get('/v1/runs/:id', async (req, res) => {
    let run = await lookup(req);
    const waitMs = integer(req.query.waitMs, 0, 0, 25000);
    const end = Date.now() + waitMs;
    do {
      if (waitMs === 0) await engine.tick(run.id);
      else {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            engine.tick(run.id),
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, Math.max(0, end - Date.now()));
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      run = await engine.lookup(run.id);
      if (run.state === 'finished' || Date.now() >= end || res.destroyed) break;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(250, end - Date.now())),
      );
    } while (!res.destroyed);
    if (!res.destroyed) res.json(liveRun(run));
  });
  app.get('/v1/runs/:id/report', async (req, res) => {
    const run = await lookup(req);
    if (
      req.query.format !== undefined &&
      !['json', 'junit'].includes(String(req.query.format))
    )
      throw new ApiError(400, 'Supported formats: json, junit');
    if (req.query.format === 'junit')
      res.type('application/xml').send(junitReport(run));
    else res.json(auditReport(run));
  });
  app.post('/v1/runs/:id/answers', async (req, res) => {
    const run = await lookup(req);
    if (!object(req.body) || !object(req.body.answers))
      throw new ApiError(400, 'Expected answers');
    const answers: Record<string, ManualAnswer> = {};
    const at = new Date().toISOString();
    for (const [id, value] of Object.entries(req.body.answers)) {
      if (!object(value) || !['yes', 'no'].includes(String(value.answer)))
        throw new ApiError(400, `Answer for ${id} must be yes or no`);
      answers[id] = {
        answer: value.answer as 'yes' | 'no',
        note: optionalText(value.note, 'note', 1000),
        at,
      };
    }
    res.json(liveRun(await engine.answer(run.id, answers)));
  });
  app.post('/v1/runs/:id/controls/:control', async (req, res) => {
    const run = await lookup(req);
    res.json(liveRun(await engine.control(run.id, String(req.params.control))));
  });
  app.delete('/v1/runs/:id', async (req, res) => {
    const run = await lookup(req);
    await engine.delete(run.id);
    res.status(204).end();
  });
  app.use('/v1', (_req, _res) => {
    throw new ApiError(404, 'API endpoint not found');
  });
  app.get('/api/qr-code', async (req, res) => {
    const value = text(req.query.value, 'value', 4096);
    res
      .type('image/svg+xml')
      .send(
        await QRCode.toString(value, { type: 'svg', margin: 1, width: 260 }),
      );
  });
  // The page is the Angular app in web/ (built to dist/web/browser). Its bundle is served under
  // /web/ (deployUrl in web/angular.json), so a hosted proxy can open the bundle for the public
  // results page with one path prefix. public/ keeps the trust files.
  const webDir = options.webDir;
  if (webDir) app.use('/web', express.static(webDir, { index: false }));
  app.use(express.static(options.publicDir, { index: false }));
  // Same-device return after a presentation (EUDIPLO redirectUri with {sessionId}).
  app.get('/r/:sessionId', async (req, res) => {
    const run = await engine.redirectReceived(String(req.params.sessionId));
    res.redirect(
      303,
      run ? `/w/${encodeURIComponent(run.owner)}?run=${run.id}` : '/',
    );
  });
  // The page reads the workspace from the path: /w/<workspace id>. Its routes are client-side.
  // /start creates or joins a workspace. /results is the public results page, reading only
  // GET /v1/published.
  app.get(['/', '/start', '/w/:ws', '/results'], (_req, res) => {
    if (!webDir)
      throw new ApiError(503, 'The page is not built; run pnpm build');
    res.sendFile(path.join(webDir, 'index.html'));
  });
  app.use((_req, _res) => {
    throw new ApiError(404, 'Not found');
  });
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof PublishError) error = new ApiError(400, error.message);
      if (error instanceof PublishedStoreFull)
        error = new ApiError(409, 'Published results are at their limit; ask the operator to remove old ones');
      if (res.headersSent) return;
      const status =
        error instanceof ApiError
          ? error.status
          : error instanceof MissingRun
            ? 404
            : (error as { status?: number })?.status === 413
              ? 413
              : error instanceof SyntaxError
                ? 400
                : 500;
      const message =
        error instanceof ApiError
          ? error.message
          : status === 400
            ? 'Invalid JSON body'
            : status === 404
              ? 'Run not found'
              : status === 413
                ? 'Request body too large'
                : 'Internal service error';
      if (status === 500)
        console.error(
          'Wallet QA operation failed',
          error instanceof Error ? error.name : 'unknown',
        );
      res.status(status).json({ error: { code: `HTTP_${status}`, message } });
    },
  );
  return app;
}
