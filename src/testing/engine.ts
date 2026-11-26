import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { SCENARIOS, CATALOG_VERSION, scenarioForRun } from './catalog.js';
import {
  applyAnswers,
  evaluate,
  initialAssertions,
  manualAssertions,
  noEvidence,
} from './assertions.js';
import {
  corruptSignature,
  DC_API_PROTOCOL,
  digest,
  type Backend,
  type DcApiResponse,
} from './eudiplo.js';
import {
  finish,
  record,
  type ManualAnswer,
  type Run,
  type RunControl,
  type Scenario,
  type Workspace,
} from './types.js';
import { BackendRegistry } from './backends.js';
import type { RunStore, WorkspaceStore } from './store.js';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const equalSecret = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
export type CreateRunInput = {
  workspaceId: string;
  scenarioId: string;
  timeoutSeconds?: number;
};
/** 128-bit random, URL-safe. The workspace link is the access right, so it must not be guessable. */
export const newWorkspaceId = () => randomBytes(16).toString('base64url');
export const workspaceIdPattern = /^[A-Za-z0-9_-]{22}$/;
function preparationErrorDetail(error: unknown) {
  if (!(error instanceof Error) || !error.message)
    return 'Unknown backend error';
  return error.message
    .replace(
      /(authorization|bearer|token|secret|password)\s*[=:]\s*[^\s,;]+/gi,
      '$1=[redacted]',
    )
    .replace(/https?:\/\/[^\s,;]+/gi, '[URL redacted]')
    .slice(0, 240);
}
export class Engine {
  private backends: BackendRegistry;
  readonly catalog: Scenario[];
  constructor(
    public store: RunStore,
    public workspaces: WorkspaceStore,
    backend: Backend | BackendRegistry,
    private options: {
      publicOrigin: string;
      retentionMs: number;
      pollMs: number;
      versions: Run['versions'];
      /** Defaults to the built-in catalog; tests and later custom catalogs pass their own. */
      catalog?: Scenario[];
    },
  ) {
    this.catalog = options.catalog ?? SCENARIOS;
    this.backends =
      backend instanceof BackendRegistry
        ? backend
        : new BackendRegistry([
            {
              backend,
              binding: {
                profileId: 'default',
                instanceId: 'default',
                tenantId: 'eudiplo-config',
                configVersion: 'default',
                eudiploVersion: options.versions.eudiplo,
                identityHash: digest(JSON.stringify(options.versions)),
              },
            },
          ]);
  }
  backendProfiles() {
    return this.backends.profiles();
  }
  async createWorkspace(input: Pick<Workspace, 'tester' | 'wallet'>) {
    const now = new Date().toISOString();
    const workspace: Workspace = {
      id: newWorkspaceId(),
      ...input,
      createdAt: now,
      lastSeenAt: now,
    };
    await this.workspaces.put(workspace);
    return workspace;
  }
  /** Looks up a workspace and marks it as used, which keeps it from expiring. */
  async workspace(id: string) {
    if (!workspaceIdPattern.test(id))
      throw new ApiError(404, 'Workspace not found');
    const workspace = await this.workspaces.get(id);
    if (!workspace || this.workspaceExpired(workspace))
      throw new ApiError(404, 'Workspace not found');
    // Touch at most once a minute to keep writes rare.
    if (Date.now() - Date.parse(workspace.lastSeenAt) > 60000) {
      workspace.lastSeenAt = new Date().toISOString();
      await this.workspaces.put(workspace);
    }
    return workspace;
  }
  async updateWorkspace(
    id: string,
    changes: Partial<Pick<Workspace, 'tester' | 'wallet'>>,
  ) {
    const workspace = await this.workspace(id);
    const next = { ...workspace, ...changes, lastSeenAt: new Date().toISOString() };
    await this.workspaces.put(next);
    return next;
  }
  private workspaceExpired(workspace: Workspace) {
    return (
      Date.parse(workspace.lastSeenAt) + this.options.retentionMs <= Date.now()
    );
  }
  async runs(workspaceId: string) {
    return (await this.store.list()).filter(
      (r) =>
        r.owner === workspaceId &&
        !r.deleted &&
        Date.parse(r.expiresAt) > Date.now(),
    );
  }
  async create(input: CreateRunInput) {
    const workspace = await this.workspace(input.workspaceId);
    const scenario = this.catalog.find((s) => s.id === input.scenarioId);
    if (!scenario) throw new ApiError(404, 'Unknown scenario');
    if ((await this.store.list()).length >= 10000)
      throw new ApiError(429, 'Retained run limit reached; delete old runs');
    const id = randomUUID();
    const now = new Date();
    const instantiated = scenarioForRun(scenario, id, now);
    const steps: Run['steps'] = instantiated.steps.map((definition) => {
      let backend;
      try {
        backend = this.backends.snapshot(definition.backendProfile);
      } catch {
        throw new ApiError(
          503,
          `Backend profile ${definition.backendProfile} is not configured`,
        );
      }
      return {
        definition,
        backend,
        state: 'preparing',
        assertions: initialAssertions(definition),
        observations: [],
      };
    });
    const run: Run = {
      id,
      owner: workspace.id,
      scenario: instantiated,
      state: 'preparing',
      verdict: null,
      manual: manualAssertions(instantiated),
      answers: {},
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      deadlineAt: new Date(
        now.getTime() + (input.timeoutSeconds ?? 300) * 1000,
      ).toISOString(),
      expiresAt: new Date(
        now.getTime() + this.options.retentionMs,
      ).toISOString(),
      currentStep: 0,
      steps,
      wallet: workspace.wallet,
      versions: { ...this.options.versions, catalog: CATALOG_VERSION },
      events: [],
    };
    record(run, 'run.created');
    if (scenario.availability !== 'ready')
      finish(run, 'skipped', scenario.unavailableReason!);
    await this.store.create(run);
    await this.tick(id);
    return { run: (await this.store.get(id))! };
  }
  async lookup(id: string) {
    const run = await this.store.get(id);
    if (!run || run.deleted || Date.parse(run.expiresAt) <= Date.now())
      throw new ApiError(404, 'Run not found');
    return run;
  }
  async tick(id: string) {
    let startIndex: number | undefined;
    await this.store.update(id, async (run) => {
      if (run.deleted || run.state === 'finished') return;
      // The server side is done; only checklist answers can finish the run now.
      if (run.state === 'awaiting_tester') {
        evaluate(run);
        return;
      }
      if (Date.now() >= Date.parse(run.deadlineAt)) {
        const problem = run.steps[run.currentStep].pollError;
        if (problem)
          finish(run, 'error', 'Backend evidence unavailable at deadline');
        else noEvidence(run, 'Deadline reached without all required evidence');
        return;
      }
      const step = run.steps[run.currentStep];
      if (step.state === 'preparing') {
        if (step.startedAt) {
          if (Date.now() - Date.parse(step.startedAt) > 30000)
            finish(
              run,
              'error',
              'Interrupted or timed-out scenario preparation; create a new run',
            );
          return;
        }
        // Persist the reservation before external effects so a step is never started twice.
        step.startedAt = new Date().toISOString();
        startIndex = run.currentStep;
        record(run, 'step.preparing');
        return;
      }
      if (
        step.definition.httpStatus === undefined &&
        step.sessionId &&
        (!step.lastPolledAt ||
          Date.now() - Date.parse(step.lastPolledAt) >= this.options.pollMs)
      ) {
        step.lastPolledAt = new Date().toISOString();
        try {
          const session = await this.backends
            .resolve(step.backend)
            .session(step.sessionId);
          if (JSON.stringify(session) !== JSON.stringify(step.session))
            record(run, 'session.changed', session.status);
          step.session = session;
          step.pollError = undefined;
        } catch (error) {
          if (!step.pollError) {
            console.error(
              `EUDIPLO session retrieval failed (run ${run.id}, step ${step.definition.id}, profile ${step.definition.backendProfile}): ${preparationErrorDetail(error)}`,
            );
            record(run, 'session.unavailable');
          }
          step.pollError = 'Could not retrieve valid backend evidence';
          return;
        }
      }
      if (Date.now() >= Date.parse(run.deadlineAt)) {
        noEvidence(run, 'Evidence arrived after the run deadline');
        return;
      }
      evaluate(run);
    });
    if (startIndex !== undefined) {
      const reserved = (await this.store.get(id))!;
      const step = reserved.steps[startIndex];
      try {
        const result = await this.backends
          .resolve(step.backend)
          .start(step.definition);
        if (!result.sessionId || !result.uri)
          throw new Error(
            'Backend did not return a session and interaction URI',
          );
        if (step.definition.channel === 'dc-api' && !result.dcApi?.request)
          throw new Error(
            'Backend did not return a Digital Credentials API request',
          );
        await this.store.update(id, async (run) => {
          const current = run.steps[startIndex!];
          current.sessionId = result.sessionId;
          if (run.state === 'finished' || run.deleted) return;
          if (current.definition.channel === 'dc-api') {
            // The browser hands the request over; there is no link or QR code.
            let responseUri: unknown;
            try {
              responseUri = JSON.parse(
                Buffer.from(
                  result.dcApi!.request.split('.')[1],
                  'base64url',
                ).toString(),
              ).response_uri;
            } catch {
              /* Reported below. */
            }
            if (typeof responseUri !== 'string') {
              finish(
                run,
                'error',
                'Backend did not return a Digital Credentials API request',
              );
              return;
            }
            current.dcApi = {
              protocol: DC_API_PROTOCOL,
              request: result.dcApi!.request,
              responseUri,
            };
          } else {
            current.uri = result.uri;
            current.crossDeviceUri = result.crossDeviceUri;
          }
          if (current.definition.kind === 'fault') {
            const uri = new URL(result.uri);
            const sourceUri = uri.searchParams.get('request_uri');
            if (!sourceUri) {
              finish(
                run,
                'error',
                'Protocol fault requires an offer with request_uri',
              );
              return;
            }
            const token = randomBytes(32).toString('base64url');
            current.fault = { sourceUri, token };
            const faultUri = `${this.options.publicOrigin}/protocol/${id}/${token}/request`;
            uri.searchParams.set('request_uri', faultUri);
            current.uri = uri.toString();
            if (result.crossDeviceUri) {
              const cross = new URL(result.crossDeviceUri);
              cross.searchParams.set('request_uri', faultUri);
              current.crossDeviceUri = cross.toString();
            }
          }
          current.state = 'awaiting_wallet';
          run.state = 'awaiting_wallet';
          record(run, 'step.ready');
        });
      } catch (error) {
        const detail = preparationErrorDetail(error);
        console.error(
          `EUDIPLO offer preparation failed (run ${id}, step ${step.definition.id}, profile ${step.definition.backendProfile}): ${detail}`,
        );
        await this.store.update(id, async (run) => {
          finish(run, 'error', `Could not prepare backend scenario: ${detail}`);
        });
      }
    }
    // Advancing a step is visible as preparing until the next tick; no offer is re-used.
  }
  async faultRequest(id: string, token: string, method: string, body?: string) {
    return this.store.update(id, async (run) => {
      const step = run.steps[run.currentStep];
      if (
        run.deleted ||
        run.state === 'finished' ||
        !step.fault ||
        !equalSecret(step.fault.token, token) ||
        Date.parse(run.deadlineAt) <= Date.now()
      ) {
        throw new ApiError(404, 'Request not found');
      }

      const httpStatus = step.definition.httpStatus;
      if (httpStatus !== undefined) {
        step.fault.deliveredAt ??= new Date().toISOString();
        step.fault.servedHttpStatus = httpStatus;
        record(run, 'fault.http.served', `HTTP ${httpStatus}`);
        return httpStatus;
      }

      try {
        const result = corruptSignature(
          await this.backends
            .resolve(step.backend)
            .requestObject(step.fault.sourceUri, method, body),
        );
        step.fault.deliveredAt = new Date().toISOString();
        step.fault.originalSha256 = result.originalSha256;
        step.fault.mutatedSha256 = result.mutatedSha256;
        record(run, 'fault.served', 'invalid_signature');
        return result.jwt;
      } catch (error) {
        console.error(
          `EUDIPLO request-object retrieval failed (run ${run.id}, step ${step.definition.id}, profile ${step.definition.backendProfile}): ${preparationErrorDetail(error)}`,
        );
        finish(
          run,
          'error',
          'Could not verify and activate the signature fault',
        );
        return null;
      }
    });
  }
  /**
   * Takes what navigator.credentials.get returned on the page and forwards it to
   * the verifier. The verdict still comes from the EUDIPLO session, like for a
   * response the wallet posts itself.
   */
  async dcApiResponse(id: string, body: DcApiResponse) {
    const run = await this.lookup(id);
    const step = run.steps[run.currentStep];
    if (
      run.state === 'finished' ||
      step.state !== 'awaiting_wallet' ||
      !step.dcApi ||
      Date.parse(run.deadlineAt) <= Date.now()
    )
      throw new ApiError(
        409,
        'This run is not waiting for a Digital Credentials API response',
      );
    const backend = this.backends.resolve(step.backend);
    if (!backend.dcApiResponse)
      throw new ApiError(501, 'This backend has no Digital Credentials API support');
    let status: number;
    try {
      status = await backend.dcApiResponse(step.dcApi.responseUri, body);
    } catch (error) {
      console.error(
        `EUDIPLO DC API response delivery failed (run ${run.id}, step ${step.definition.id}, profile ${step.definition.backendProfile}): ${preparationErrorDetail(error)}`,
      );
      throw new ApiError(502, 'Could not deliver the wallet response to EUDIPLO');
    }
    const accepted = status >= 200 && status < 300;
    await this.store.update(id, async (current) => {
      // Only the outcome is kept; the response itself holds the presentation.
      record(
        current,
        accepted ? 'dcapi.response.delivered' : 'dcapi.response.refused',
        'error' in body ? `wallet error ${body.error}` : `HTTP ${status}`,
      );
    });
    if (!accepted)
      throw new ApiError(
        422,
        `EUDIPLO refused the wallet response (HTTP ${status})`,
      );
    // Poll right away, whatever the poll interval says.
    await this.store.update(id, async (current) => {
      current.steps[current.currentStep].lastPolledAt = undefined;
    });
    await this.tick(id);
    return this.lookup(id);
  }
  /** Records the wallet's same-device redirect and returns the run it belongs to. */
  async redirectReceived(sessionId: string) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(sessionId)) return undefined;
    const run = (await this.store.list()).find(
      (r) => !r.deleted && r.steps.some((s) => s.sessionId === sessionId),
    );
    if (!run) return undefined;
    await this.store.update(run.id, async (current) => {
      record(current, 'redirect.received', sessionId);
    });
    return run;
  }
  /** Stores checklist answers and re-evaluates. Answers can change until the run finishes. */
  async answer(id: string, answers: Record<string, ManualAnswer>) {
    await this.tick(id);
    return this.store.update(id, async (run) => {
      if (run.deleted) throw new ApiError(404, 'Run not found');
      if (run.state === 'finished')
        throw new ApiError(409, 'The run is finished; start a new run to retry');
      const known = new Set(run.manual.map((a) => a.id));
      for (const key of Object.keys(answers))
        if (!known.has(key))
          throw new ApiError(400, `Unknown checklist item ${key}`);
      applyAnswers(run, answers);
      evaluate(run);
      return run;
    });
  }
  /** Runs a scenario control, e.g. revoking the credential issued in an earlier step. */
  async control(id: string, controlId: string) {
    const run = await this.lookup(id);
    const control = run.scenario.controls?.find((c) => c.id === controlId);
    if (!control) throw new ApiError(404, 'Unknown control');
    if (!controlAvailable(run, control))
      throw new ApiError(409, 'This control is not available in the current step');
    const step = run.steps.find((s) => s.definition.id === control.stepId);
    if (!step?.sessionId)
      throw new ApiError(409, 'The step holding the credential has no session');
    try {
      await this.backends
        .resolve(step.backend)
        .setStatus(step.sessionId, control.status);
    } catch (error) {
      console.error(
        `EUDIPLO status update failed (run ${run.id}, control ${control.id}): ${preparationErrorDetail(error)}`,
      );
      throw new ApiError(502, 'EUDIPLO could not update the credential status');
    }
    return this.store.update(id, async (current) => {
      current.controlsUsed = { ...current.controlsUsed, [control.id]: new Date().toISOString() };
      record(current, 'control.applied', `${control.id}: status ${control.status}`);
      return current;
    });
  }
  async delete(id: string) {
    await this.store.update(id, async (run) => {
      finish(run, 'inconclusive', 'Run cancelled by caller');
      run.deleted = true;
      record(run, 'run.deleted');
    });
    await this.cleanup(id);
  }
  private async cleanup(id: string) {
    let remove = false;
    await this.store.update(id, async (run) => {
      // Wait for an in-flight offer creation to attach its session before cleanup.
      if (
        run.steps.some(
          (s) =>
            s.startedAt &&
            !s.sessionId &&
            Date.now() - Date.parse(s.startedAt) < 30000,
        )
      )
        return;
      for (const step of run.steps) {
        if (step.sessionId && !step.cleaned) {
          try {
            await this.backends
              .resolve(step.backend)
              .deleteSession(step.sessionId);
            step.cleaned = true;
          } catch (error) {
            console.error(
              `EUDIPLO session cleanup failed (run ${run.id}, step ${step.definition.id}, profile ${step.definition.backendProfile}): ${preparationErrorDetail(error)}`,
            );
            return;
          } // Keep tombstone for the next cleanup attempt.
        }
      }
      remove = true;
    });
    if (remove) await this.store.delete(id);
  }
  async sweep() {
    const expired = new Set(
      (await this.workspaces.list())
        .filter((w) => this.workspaceExpired(w))
        .map((w) => w.id),
    );
    const runs = await this.store.list();
    for (const run of runs) if (expired.has(run.owner)) run.deleted = true;
    for (const id of expired) await this.workspaces.delete(id);
    for (const run of runs) {
      try {
        if (run.deleted || Date.parse(run.expiresAt) <= Date.now())
          await this.delete(run.id);
        else if (run.state !== 'finished') await this.tick(run.id);
      } catch {
        /* Transient errors are retried on the next sweep. */
      }
    }
  }
  async ready() {
    await this.store.list();
    await this.backends.health();
  }
}
export function controlAvailable(run: Run, control: RunControl) {
  if (run.state === 'finished' || run.deleted) return false;
  if (!control.availableFromStep) return true;
  const from = run.steps.findIndex(
    (s) => s.definition.id === control.availableFromStep,
  );
  return from >= 0 && run.currentStep >= from;
}
export function liveRun(run: Run) {
  const steps = run.steps.map((step) => ({
    id: step.definition.id,
    kind: step.definition.kind,
    /** What the wallet should do: complete it, or refuse (rejected, verifier_rejects). */
    expected: step.definition.expected,
    state: step.state,
    instruction: step.definition.instruction ?? null,
    backend: step.backend ?? null,
    interaction: {
      uri: step.uri ?? null,
      crossDeviceUri: step.crossDeviceUri ?? null,
      transactionCode: step.definition.txCode ?? null,
      /** Set instead of uri: the page passes it to navigator.credentials.get. */
      dcApi: step.dcApi
        ? { protocol: step.dcApi.protocol, request: step.dcApi.request }
        : null,
    },
    assertions: step.assertions.filter((a) => a.source !== 'wallet'),
    backendStatus: step.session?.status ?? null,
    backendError: step.pollError ?? null,
  }));
  return {
    id: run.id,
    workspaceId: run.owner,
    scenarioId: run.scenario.id,
    scenarioLabel: run.scenario.label,
    scenarioVersion: run.scenario.version,
    state: run.state,
    completed: run.state === 'finished',
    passed: run.verdict === null ? null : run.verdict === 'passed',
    verdict: run.verdict,
    attested: run.verdict === 'passed' ? !!run.attested : null,
    reason: run.reason ?? null,
    awaitingTester: run.state === 'awaiting_tester',
    noEvidence: run.serverNoEvidence ?? null,
    currentStep: steps[run.currentStep],
    steps,
    checklist: (run.scenario.manual ?? []).map((check) => {
      const assertion = run.manual.find((a) => a.id === check.id);
      return {
        id: check.id,
        ask: check.ask,
        expect: check.expect,
        blocking: check.blocking ?? true,
        status: assertion?.status ?? 'pending',
        answer: run.answers[check.id]?.answer ?? null,
        note: run.answers[check.id]?.note ?? null,
      };
    }),
    controls: (run.scenario.controls ?? []).map((control) => ({
      id: control.id,
      label: control.label,
      available: controlAvailable(run, control),
      usedAt: run.controlsUsed?.[control.id] ?? null,
    })),
    assertions: [
      ...steps.flatMap((step) =>
        step.assertions.map((assertion) => ({
          ...assertion,
          stepId: step.id,
        })),
      ),
      ...run.manual.map((assertion) => ({ ...assertion, stepId: null })),
    ],
    wallet: run.wallet,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    deadlineAt: run.deadlineAt,
    expiresAt: run.expiresAt,
    pollAfterMs: run.state === 'finished' ? null : 1000,
  };
}
