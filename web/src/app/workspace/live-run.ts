import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { E2E } from '../e2e';
import {
  ChecklistItem,
  Draft,
  LiveRun,
  RunControl,
  SyncState,
  answersToSend,
  awaitingWallet,
  checklistDue,
  checklistLaterText,
  DC_API_ELSEWHERE_TEXT,
  hasDcApi,
  badgeText,
  contractAttributes,
  dcApiRequest,
  qrValue,
  reasonText,
  stepText,
  transactionCodeText,
  verdictTone,
  walletLink,
} from '../model/run-view';

export type Answers = ReturnType<typeof answersToSend>;

/**
 * The live run: status badge, wallet hand-off (Open wallet, transaction code, QR code, or the
 * Digital Credentials API button), run
 * controls, checklist and evidence. The workspace page owns the run and its polling; this panel
 * shows it and keeps unsaved checklist answers.
 */
@Component({
  selector: 'qa-live-run',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  templateUrl: './live-run.html',
  styleUrl: './live-run.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveRunPanel {
  readonly e2e = inject(E2E);

  readonly live = input<LiveRun>();
  readonly sync = input<SyncState>('idle');
  /** data-verdict without a run: why the panel is empty ("cancelled", "unavailable"). */
  readonly emptyVerdict = input('pending');
  readonly saving = input(false);
  readonly pendingControls = input<ReadonlySet<string>>(new Set());

  readonly dcApiBusy = input(false);

  readonly openWalletClicked = output<string>();
  /** The Digital Credentials API button: the handler must call navigator.credentials.get right away. */
  readonly dcApiClicked = output<void>();
  readonly controlUsed = output<RunControl>();
  readonly answersSaved = output<Answers>();
  readonly auditRequested = output<void>();
  readonly cancelRequested = output<void>();

  /** Checked once: whether this browser can hand a dc-api request to a wallet. */
  readonly dcApiSupported = hasDcApi(window);
  readonly dcApiElsewhere = DC_API_ELSEWHERE_TEXT;
  /** Runs whose checklist the tester opened before the wallet part was over. */
  readonly checklistOpened = signal<ReadonlySet<string>>(new Set());
  readonly checklistShown = computed(() => {
    const run = this.live();
    return !!run && (checklistDue(run) || this.checklistOpened().has(run.id));
  });
  readonly checklistLater = computed(() => {
    const run = this.live();
    return run ? checklistLaterText(run) : '';
  });

  /** Unsaved checklist answers per run. */
  readonly drafts = signal<Record<string, Draft>>({});

  readonly contract = computed(() => contractAttributes(this.live(), this.sync(), this.emptyVerdict()));
  readonly badge = computed(() => badgeText(this.live()));
  readonly tone = computed(() => verdictTone(this.live()));
  readonly awaiting = computed(() => {
    const run = this.live();
    return !!run && awaitingWallet(run);
  });
  /** Set on a dc-api step: the browser hands the request over, there is no link or QR code. */
  readonly dcApi = computed(() => {
    const run = this.live();
    return run ? dcApiRequest(run) : undefined;
  });
  readonly walletUri = computed(() => {
    const run = this.live();
    return run ? walletLink(run) : undefined;
  });
  readonly qrSrc = computed(() => {
    const run = this.live();
    const value = run && qrValue(run);
    return value ? `/api/qr-code?value=${encodeURIComponent(value)}` : '';
  });
  readonly reason = computed(() => {
    const run = this.live();
    return run ? reasonText(run) : '';
  });
  readonly step = computed(() => {
    const run = this.live();
    return run ? stepText(run) : '';
  });
  readonly instruction = computed(() => (this.awaiting() ? (this.live()!.currentStep.instruction ?? '') : ''));
  readonly txCode = computed(() => {
    const run = this.live();
    return run ? transactionCodeText(run) : '';
  });

  openWallet() {
    const uri = this.walletUri();
    if (uri) this.openWalletClicked.emit(uri);
  }

  requestDcApi() {
    if (this.dcApi()) this.dcApiClicked.emit();
  }

  useControl(control: RunControl) {
    this.controlUsed.emit(control);
  }

  openChecklist() {
    const run = this.live();
    if (run) this.checklistOpened.update((ids) => new Set([...ids, run.id]));
  }

  answerOf(item: ChecklistItem) {
    const run = this.live();
    return (run && this.drafts()[run.id]?.[item.id]?.answer) ?? item.answer;
  }

  noteOf(item: ChecklistItem) {
    const run = this.live();
    return (run && this.drafts()[run.id]?.[item.id]?.note) ?? item.note ?? '';
  }

  draft(item: ChecklistItem, change: { answer?: 'yes' | 'no'; note?: string }) {
    const run = this.live();
    if (!run) return;
    this.drafts.update((drafts) => {
      const current = drafts[run.id]?.[item.id] ?? { answer: item.answer ?? undefined, note: item.note ?? undefined };
      return { ...drafts, [run.id]: { ...drafts[run.id], [item.id]: { ...current, ...change } } };
    });
  }

  saveAnswers() {
    const run = this.live();
    if (run) this.answersSaved.emit(answersToSend(this.drafts()[run.id] ?? {}));
  }

  downloadAudit() {
    this.auditRequested.emit();
  }

  cancel() {
    this.cancelRequested.emit();
  }
}
