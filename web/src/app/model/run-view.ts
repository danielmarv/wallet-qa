// What the live run shows, derived from GET /v1/runs/:id. No Angular imports: the repository's
// node:test suite (tests/web.test.ts) checks these texts directly.
//
// The texts "Status: …", "Verdict: …", "Run ID: …" and "Transaction code: …" and the data-*
// attributes from contractAttributes() are the page contract UI test runners match on (README,
// "Page contract"). They are unchanged from the plain-JS page this app replaced. Keep them stable.

export type RunState = 'preparing' | 'awaiting_wallet' | 'awaiting_tester' | 'finished';

export interface ChecklistItem {
  id: string;
  ask: string;
  blocking: boolean;
  status: string;
  answer: 'yes' | 'no' | null;
  note: string | null;
}

export interface RunControl {
  id: string;
  label: string;
  available: boolean;
  usedAt: string | null;
}

export interface RunAssertion {
  id: string;
  stepId: string | null;
  source: string;
  status: string;
  expected?: string;
  actual?: string;
}

export interface LiveRun {
  id: string;
  scenarioId: string;
  scenarioLabel: string;
  state: RunState;
  completed: boolean;
  passed: boolean | null;
  verdict: string | null;
  attested: boolean | null;
  reason: string | null;
  awaitingTester: boolean;
  noEvidence: string | null;
  currentStep: {
    id: string;
    state: string;
    instruction: string | null;
    interaction: {
      uri: string | null;
      crossDeviceUri: string | null;
      transactionCode: string | null;
      /** Set instead of uri on a dc-api step: the page passes it to navigator.credentials.get. */
      dcApi?: DcApiRequest | null;
    };
  };
  checklist: ChecklistItem[];
  controls: RunControl[];
  assertions: RunAssertion[];
  createdAt: string;
}

/** A dc-api step's request, as GET /v1/runs/:id returns it. */
export interface DcApiRequest {
  protocol: string;
  request: string;
}

/** The value of #liveRun's data-sync: idle before the first load, then the state of the last poll. */
export type SyncState = 'idle' | 'refreshing' | 'fresh' | 'error';

/** Schemes the Open wallet button may navigate to. Anything else stays QR and link only. */
export const WALLET_SCHEMES = ['openid4vp:', 'openid-credential-offer:', 'haip:', 'eudi-openid4vp:', 'https:'];

const words = (value: string) => value.replaceAll('_', ' ');

/** The status badge: "Status: awaiting wallet" while running, "Verdict: passed" once finished. */
export function badgeText(run: LiveRun | undefined): string {
  if (!run) return 'Verdict: none';
  if (!run.completed) return `Status: ${words(run.state)}`;
  const attested = run.attested ? ' (tester-attested)' : '';
  return `Verdict: ${run.verdict}${attested}`;
}

export function reasonText(run: LiveRun): string {
  if (run.reason) return run.reason;
  if (run.awaitingTester)
    return run.noEvidence
      ? `${run.noEvidence}. Answer the checklist to finish the run.`
      : 'The server checks passed. Answer the checklist to finish the run.';
  return 'Waiting for the wallet. The result updates automatically.';
}

export function stepText(run: LiveRun): string {
  return `Step ${run.currentStep.id}: ${words(run.currentStep.state)}`;
}

/**
 * True while the wallet has to act on the current step: show QR, link and Open wallet, or on a
 * dc-api step the Digital Credentials API button.
 */
export function awaitingWallet(run: LiveRun): boolean {
  const { uri, dcApi } = run.currentStep.interaction;
  return !run.completed && run.currentStep.state === 'awaiting_wallet' && !!(uri || dcApi);
}

/** The request for navigator.credentials.get while a dc-api step waits for the wallet. */
export function dcApiRequest(run: LiveRun): DcApiRequest | undefined {
  return (awaitingWallet(run) && run.currentStep.interaction.dcApi) || undefined;
}

/** The argument of navigator.credentials.get for a dc-api step. Must be called from a user gesture. */
export function credentialRequest(dcApi: DcApiRequest) {
  return {
    mediation: 'required' as const,
    digital: { requests: [{ protocol: dcApi.protocol, data: { request: dcApi.request } }] },
  };
}

/** The body of POST /v1/runs/:id/dc-api/response: the wallet's response or its OAuth error. */
export type DcApiResponseBody = { response: string } | { error: string; error_description?: string };

/**
 * What to post from the credential navigator.credentials.get returned, or undefined when it holds
 * no OpenID4VP response. Older implementations return the data as a JSON string.
 */
export function dcApiResponseBody(credential: unknown): DcApiResponseBody | undefined {
  let data = (credential as { data?: unknown } | null | undefined)?.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  const value = data as { response?: unknown; error?: unknown; error_description?: unknown } | undefined;
  if (typeof value?.response === 'string') return { response: value.response };
  if (typeof value?.error === 'string')
    return {
      error: value.error,
      ...(typeof value.error_description === 'string'
        ? { error_description: value.error_description.slice(0, 500) }
        : {}),
    };
  return undefined;
}

/** The status message after navigator.credentials.get failed. */
export function dcApiErrorText(error: unknown): string {
  // NotAllowedError: the request was dismissed, or no wallet on the device can answer it.
  if ((error as { name?: unknown } | null)?.name === 'NotAllowedError')
    return 'No credential was returned: the request was cancelled or no wallet could answer it.';
  return `Digital Credentials API: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * True once the tester should answer the checklist: the wallet part is over. While the run waits
 * for the wallet the checklist stays folded, so nobody answers before trying; it can still be
 * opened early, since a No ends the run right away.
 */
export function checklistDue(run: LiveRun): boolean {
  return run.completed || run.state === 'awaiting_tester';
}

/** The folded checklist's line while the wallet part is still running. */
export function checklistLaterText(run: LiveRun): string {
  const count = run.checklist.length;
  return `${count} ${count === 1 ? 'question' : 'questions'} to answer once the wallet is done.`;
}

/** Whether this browser has the Digital Credentials API (window.DigitalCredential). */
export function hasDcApi(scope: object): boolean {
  const credentials = (scope as { navigator?: { credentials?: { get?: unknown } } }).navigator?.credentials;
  return 'DigitalCredential' in scope && typeof credentials?.get === 'function';
}

export const DC_API_ELSEWHERE_TEXT =
  'This browser has no Digital Credentials API. Open this workspace in a current Chrome on the phone with the wallet (Join on another device).';

/** The URI the Open wallet button navigates to, or undefined when it must stay disabled. */
export function walletLink(run: LiveRun): string | undefined {
  if (!awaitingWallet(run)) return undefined;
  const uri = run.currentStep.interaction.uri;
  if (!uri) return undefined;
  try {
    return WALLET_SCHEMES.includes(new URL(uri).protocol) ? uri : undefined;
  } catch {
    return undefined;
  }
}

/** What the QR code encodes: the cross-device URI when the backend has one. */
export function qrValue(run: LiveRun): string | undefined {
  const { uri, crossDeviceUri } = run.currentStep.interaction;
  return crossDeviceUri ?? uri ?? undefined;
}

export function transactionCodeText(run: LiveRun): string {
  const code = run.currentStep.interaction.transactionCode;
  return code ? `Transaction code: ${code}` : '';
}

/**
 * The data-* attributes on #liveRun. Without a run they hold their initial values; after a cancel
 * or an expired run, data-verdict says why the panel is empty ("cancelled", "unavailable").
 */
export function contractAttributes(run: LiveRun | undefined, sync: SyncState, emptyVerdict = 'pending') {
  if (!run)
    return { runId: '', completed: 'false', passed: 'pending', verdict: emptyVerdict, attested: 'false', sync };
  return {
    runId: run.id,
    completed: String(run.completed),
    passed: run.passed === null ? 'pending' : String(run.passed),
    verdict: run.verdict ?? 'pending',
    attested: String(!!run.attested),
    sync,
  };
}

/** Tone of the badge: passed, failed or neutral (running, skipped, cancelled …). */
export function verdictTone(run: LiveRun | undefined): 'passed' | 'failed' | 'neutral' {
  if (!run?.completed) return 'neutral';
  if (run.verdict === 'passed') return 'passed';
  return run.verdict === 'failed' || run.verdict === 'error' ? 'failed' : 'neutral';
}

/** A checklist item's answers, ready to send: only items with a Yes or No. */
export type Draft = Record<string, { answer?: 'yes' | 'no'; note?: string }>;
export function answersToSend(draft: Draft): Record<string, { answer: 'yes' | 'no'; note?: string }> {
  return Object.fromEntries(
    Object.entries(draft)
      .filter(([, value]) => value.answer)
      .map(([id, value]) => [id, { answer: value.answer!, ...(value.note ? { note: value.note } : {}) }]),
  );
}
