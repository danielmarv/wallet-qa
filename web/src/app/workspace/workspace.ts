import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { Api, ApiError, LAST_WORKSPACE_KEY, activeRunKey, errorText, storage } from '../api';
import { E2E } from '../e2e';
import {
  LiveRun,
  DC_API_ELSEWHERE_TEXT,
  RunControl,
  SyncState,
  credentialRequest,
  dcApiErrorText,
  dcApiRequest,
  dcApiResponseBody,
  hasDcApi,
} from '../model/run-view';
import {
  PUBLISH_WARNING,
  Scenario,
  Workspace,
  WorkspaceFormValue,
  publishErrorText,
  publishedText,
  runLine,
  scenarioChips,
  workspaceBody,
  workspaceForm,
  workspaceSummary,
} from '../model/workspace-view';
import { confirm } from '../shared/confirm-dialog';
import { download } from '../shared/download';
import { InstanceInfo } from '../shared/instance-info';
import { WorkspaceForm } from '../shared/workspace-form';
import { Catalog } from './catalog';
import { Answers, LiveRunPanel } from './live-run';

/**
 * A workspace at /w/<id>: the catalog, the selected test, the live run, the runs, reports and
 * publishing. ?scenario=<id> preselects a test, ?run=<id> shows a run, ?timeoutSeconds= sets the
 * run timeout, ?e2e=1 switches off animations.
 */
@Component({
  selector: 'qa-workspace',
  imports: [MatButtonModule, MatCardModule, Catalog, LiveRunPanel, InstanceInfo, WorkspaceForm],
  templateUrl: './workspace.html',
  styleUrl: './workspace.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspacePage implements OnInit {
  private readonly api = inject(Api);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  readonly e2e = inject(E2E);

  /** Route parameter and query parameters (withComponentInputBinding). */
  readonly workspaceId = input.required<string>();
  readonly scenario = input<string>();
  readonly run = input<string>();
  readonly timeoutSeconds = input<string>();

  readonly loading = signal(true);
  readonly workspace = signal<Workspace | undefined>(undefined);
  readonly scenarios = signal<Scenario[]>([]);
  readonly runs = signal<LiveRun[]>([]);
  readonly selectedId = signal('');
  readonly live = signal<LiveRun | undefined>(undefined);
  readonly sync = signal<SyncState>('idle');
  readonly emptyVerdict = signal('pending');
  readonly message = signal('');
  readonly editing = signal(false);
  readonly showJoin = signal(false);
  readonly busy = signal(false);
  readonly starting = signal(false);
  readonly saving = signal(false);
  readonly pendingControls = signal<ReadonlySet<string>>(new Set());
  readonly dcApiBusy = signal(false);

  readonly selected = computed(() => this.scenarios().find((s) => s.id === this.selectedId()));
  readonly chips = computed(() => {
    const test = this.selected();
    return test ? scenarioChips(test) : [];
  });
  /** While a run waits for the wallet, a phone shows the live run above the test card. */
  readonly runActive = computed(() => {
    const run = this.live();
    return !!run && !run.completed;
  });
  readonly summary = computed(() => {
    const workspace = this.workspace();
    return workspace ? workspaceSummary(workspace) : '';
  });
  readonly formValue = computed(() => workspaceForm(this.workspace()));
  readonly joinLink = computed(() => `${window.location.origin}/w/${this.workspaceId()}`);
  readonly joinQr = computed(() => `/api/qr-code?value=${encodeURIComponent(this.joinLink())}`);
  readonly runLine = runLine;

  private activeRunId?: string;
  private refreshing = false;
  private knownRunIds?: Set<string>;

  private get ws() {
    return encodeURIComponent(this.workspaceId());
  }

  ngOnInit() {
    const visible = () => document.visibilityState !== 'hidden';
    const runTimer = setInterval(() => {
      if (visible() && !this.live()?.completed) void this.refreshActiveRun();
    }, 1000);
    const listTimer = setInterval(() => {
      if (visible() && this.workspace()) void this.loadRuns().catch(() => undefined);
    }, 3000);
    const refresh = () => {
      if (visible()) void this.refreshActiveRun();
    };
    window.addEventListener('pageshow', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    this.destroyRef.onDestroy(() => {
      clearInterval(runTimer);
      clearInterval(listTimer);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    });
    void this.init();
  }

  private async init() {
    try {
      const [workspace, { scenarios }] = await Promise.all([
        this.api.get<Workspace>(`/workspaces/${this.ws}`),
        this.api.get<{ scenarios: Scenario[] }>('/scenarios'),
      ]);
      this.workspace.set(workspace);
      this.scenarios.set(scenarios);
    } catch (error) {
      storage.remove(LAST_WORKSPACE_KEY);
      const text =
        error instanceof ApiError && error.status === 404
          ? 'This workspace does not exist or has expired. Create a new one.'
          : `Could not load: ${errorText(error)}`;
      await this.router.navigate(['/start'], { queryParamsHandling: 'preserve', state: { message: text } });
      return;
    }
    storage.set(LAST_WORKSPACE_KEY, this.workspaceId());
    // Query parameters let a UI test open the page with its test preselected.
    const scenarios = this.scenarios();
    const preset =
      scenarios.find((s) => s.id === this.scenario()) ?? scenarios.find((s) => s.availability === 'ready');
    this.selectedId.set(preset?.id ?? '');
    this.loading.set(false);
    await this.loadRuns().catch(() => undefined);
    this.activeRunId = this.run() ?? storage.get(activeRunKey(this.workspaceId())) ?? undefined;
    if (this.activeRunId) await this.refreshActiveRun();
    // A restored run decides the selected test, unless the link asked for another one.
    const restored = this.live();
    if (restored && !this.scenario()) this.followRun(restored);
    // Back from the wallet (?run=): show the result.
    if (this.run() && this.live()) this.reveal('liveRun');
  }

  /** Scrolls an element to the top; on a phone the catalog is below the test and the live run. */
  private reveal(id: string) {
    afterNextRender(
      () => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: this.e2e ? 'instant' : 'smooth' }),
      { injector: this.injector },
    );
  }

  choose(id: string) {
    this.selectedId.set(id);
    this.reveal('test-detail');
  }

  /** On a phone the catalog is below the live run; the test card links to it. */
  changeTest() {
    this.reveal('catalog');
  }

  // ------------------------------------------------------------------ workspace
  async saveWorkspace(form: WorkspaceFormValue) {
    this.busy.set(true);
    try {
      this.workspace.set(await this.api.patch<Workspace>(`/workspaces/${this.ws}`, workspaceBody(form)));
      this.editing.set(false);
      this.message.set('');
    } catch (error) {
      this.message.set(errorText(error));
    } finally {
      this.busy.set(false);
    }
  }

  // ------------------------------------------------------------------ runs
  async start() {
    const scenario = this.selected();
    if (scenario?.availability !== 'ready') return;
    this.starting.set(true);
    const body: { scenarioId: string; timeoutSeconds?: number } = { scenarioId: scenario.id };
    const timeout = Number(this.timeoutSeconds());
    if (Number.isInteger(timeout) && timeout > 0) body.timeoutSeconds = timeout;
    try {
      this.selectRun(await this.api.post<LiveRun>(`/workspaces/${this.ws}/runs`, body));
      this.message.set('');
      this.reveal('liveRun');
      await this.loadRuns();
    } catch (error) {
      this.message.set(errorText(error));
    } finally {
      this.starting.set(false);
    }
  }

  view(run: LiveRun) {
    this.selectRun(run);
    this.reveal('liveRun');
    void this.refreshActiveRun();
  }

  private selectRun(run: LiveRun) {
    this.activeRunId = run.id;
    storage.set(activeRunKey(this.workspaceId()), run.id);
    this.show(run);
    this.followRun(run);
  }

  /** The selected test is the shown run's test, so the card above the live run matches it. */
  private followRun(run: LiveRun) {
    if (this.scenarios().some((s) => s.id === run.scenarioId)) this.selectedId.set(run.scenarioId);
  }

  private show(run: LiveRun) {
    this.live.set(run);
    this.sync.set('fresh');
  }

  private clearRun(verdict: string) {
    this.activeRunId = undefined;
    storage.remove(activeRunKey(this.workspaceId()));
    this.live.set(undefined);
    this.emptyVerdict.set(verdict);
  }

  async refreshActiveRun() {
    if (!this.activeRunId || this.refreshing) return;
    const id = this.activeRunId;
    this.refreshing = true;
    this.sync.set('refreshing');
    try {
      const run = await this.api.get<LiveRun>(`/runs/${encodeURIComponent(id)}`);
      // An older in-flight poll must not replace a newly selected run.
      if (this.activeRunId === id) this.show(run);
    } catch (error) {
      if (this.activeRunId !== id) return;
      this.sync.set('error');
      if (error instanceof ApiError && (error.status === 404 || error.status === 410)) {
        this.clearRun('unavailable');
        this.message.set('The saved run has expired or was deleted.');
      } else this.message.set(errorText(error));
    } finally {
      this.refreshing = false;
    }
  }

  /**
   * A run started on another device of this workspace takes over the live panel, so the phone
   * shows Open wallet for a run started on the laptop.
   */
  private async loadRuns() {
    const { runs } = await this.api.get<{ runs: LiveRun[] }>(`/workspaces/${this.ws}/runs`);
    this.runs.set(runs);
    const known = this.knownRunIds;
    this.knownRunIds = new Set(runs.map((run) => run.id));
    if (!known) return;
    const fresh = runs.find((run) => !known.has(run.id) && !run.completed && run.id !== this.activeRunId);
    if (fresh) {
      this.selectRun(fresh);
      this.reveal('liveRun');
    }
  }

  openWallet(uri: string) {
    // selectRun has already stored the run ID, so the page finds the run again after the wallet.
    window.location.assign(uri);
  }

  /**
   * Hands a dc-api step's request to the wallet through the browser and posts what came back.
   * Runs from the button press: navigator.credentials.get needs a user gesture.
   */
  async requestDcApi() {
    const run = this.live();
    const dcApi = run && dcApiRequest(run);
    if (!run || !dcApi || this.dcApiBusy()) return;
    if (!hasDcApi(window)) {
      this.message.set(DC_API_ELSEWHERE_TEXT);
      return;
    }
    this.dcApiBusy.set(true);
    try {
      let credential: unknown;
      try {
        credential = await navigator.credentials.get(credentialRequest(dcApi) as CredentialRequestOptions);
      } catch (error) {
        this.message.set(dcApiErrorText(error));
        return;
      }
      const body = dcApiResponseBody(credential);
      if (!body) {
        this.message.set('The wallet returned no OpenID4VP response.');
        return;
      }
      const updated = await this.api.post<LiveRun>(`/runs/${encodeURIComponent(run.id)}/dc-api/response`, body);
      if (this.activeRunId === run.id) this.show(updated);
      this.message.set('error' in body ? `The wallet answered with the error ${body.error}.` : 'Wallet response sent to the verifier.');
    } catch (error) {
      this.message.set(errorText(error));
    } finally {
      this.dcApiBusy.set(false);
    }
  }

  async useControl(control: RunControl) {
    const run = this.live();
    if (!run) return;
    this.pendingControls.update((ids) => new Set([...ids, control.id]));
    try {
      this.show(
        await this.api.post<LiveRun>(
          `/runs/${encodeURIComponent(run.id)}/controls/${encodeURIComponent(control.id)}`,
        ),
      );
      this.message.set(`${control.label}: done.`);
    } catch (error) {
      this.message.set(errorText(error));
    } finally {
      this.pendingControls.update((ids) => new Set([...ids].filter((id) => id !== control.id)));
    }
  }

  async saveAnswers(answers: Answers) {
    const run = this.live();
    if (!run) return;
    if (!Object.keys(answers).length) {
      this.message.set('Choose Yes or No first.');
      return;
    }
    this.saving.set(true);
    try {
      this.show(await this.api.post<LiveRun>(`/runs/${encodeURIComponent(run.id)}/answers`, { answers }));
      this.message.set('Answers saved.');
      await this.loadRuns();
    } catch (error) {
      this.message.set(errorText(error));
    } finally {
      this.saving.set(false);
    }
  }

  async downloadAudit() {
    const run = this.live();
    if (!run) return;
    try {
      const report = await this.api.get<unknown>(`/runs/${encodeURIComponent(run.id)}/report`);
      download(`wallet-qa-${run.id}.json`, JSON.stringify(report, null, 2), 'application/json');
    } catch (error) {
      this.message.set(errorText(error));
    }
  }

  async cancel() {
    const run = this.live();
    if (!run) return;
    try {
      await this.api.delete(`/runs/${encodeURIComponent(run.id)}`);
      this.clearRun('cancelled');
      this.message.set('Run cancelled.');
      await this.loadRuns();
    } catch (error) {
      this.message.set(errorText(error));
    }
  }

  // ------------------------------------------------------------------ reports
  async reportJunit() {
    try {
      download(`wallet-qa-${this.workspaceId()}.xml`, await this.api.text(`/workspaces/${this.ws}/report?format=junit`), 'application/xml');
    } catch (error) {
      this.message.set(errorText(error));
    }
  }

  async reportJson() {
    try {
      const report = await this.api.get<unknown>(`/workspaces/${this.ws}/report`);
      download(`wallet-qa-${this.workspaceId()}.json`, JSON.stringify(report, null, 2), 'application/json');
    } catch (error) {
      this.message.set(errorText(error));
    }
  }

  async publish() {
    const ok = await confirm(this.dialog, { title: 'Publish results?', text: PUBLISH_WARNING, confirm: 'Publish' });
    if (!ok) return;
    try {
      const result = await this.api.post<{ tests: unknown[] }>(`/workspaces/${this.ws}/publish`);
      this.message.set(publishedText(result.tests.length));
    } catch (error) {
      this.message.set(publishErrorText(error instanceof ApiError ? error.status : undefined, errorText(error)));
    }
  }
}
