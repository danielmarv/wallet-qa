export type Verdict =
  | 'passed'
  | 'failed'
  | 'inconclusive'
  | 'error'
  | 'skipped';
export type Assertion = {
  id: string;
  /** server: decided from EUDIPLO or Wallet QA evidence; tester: answered in the checklist. */
  source: 'server' | 'wallet' | 'tester';
  status: 'pending' | 'passed' | 'failed';
  expected: string;
  actual?: string;
  /** Tester assertions only: a non-blocking check is reported but never decides the verdict. */
  blocking?: boolean;
};
/** A claim path as in DCQL: ['address', 'locality'] or ['eu.europa.ec.eudi.pid.1', 'given_name']. */
export type ClaimPath = string[];
/** What one DCQL credential query must have returned, checked against EUDIPLO's verified claims. */
export type DisclosurePolicy = {
  /** DCQL credential query id. */
  credentialId: string;
  /** Claims that must be present, with any value. */
  present?: ClaimPath[];
  /** Claims that must be present with exactly this value. */
  equals?: { path: ClaimPath; value: unknown }[];
  /** Claims that must not be disclosed. */
  absent?: ClaimPath[];
  /** When set, any other top-level business claim fails the check. */
  allowedOnly?: string[];
};
export type StepDefinition = {
  id: string;
  kind: 'issuance' | 'presentation' | 'fault';
  backendProfile: string;
  configId?: string;
  /**
   * Presentation only. dc-api: the request is handed to the wallet by the browser's
   * Digital Credentials API (navigator.credentials.get) instead of a link or QR code.
   */
  channel?: 'dc-api';
  credentialConfigurationIds?: string[];
  claims?: Record<string, Record<string, unknown>>;
  flow?: 'pre_authorized_code' | 'authorization_code';
  /** EUDIPLO authorization server id for authorization_code offers (e.g. an oid4vp PID check). */
  authorizationServer?: string;
  txCode?: string;
  httpStatus?: 408 | 429 | 504;
  /**
   * completed: EUDIPLO session completes.
   * rejected: the wallet refuses and sends an error response EUDIPLO records.
   * verifier_rejects: the wallet presents, and EUDIPLO's verification fails
   * (revoked, expired). A wallet that refuses on its own is left to the tester.
   */
  expected: 'completed' | 'rejected' | 'verifier_rejects';
  /** Checked when the step completes; every policy must hold. */
  disclosures?: DisclosurePolicy[];
  walletObservation?:
    | 'credential_stored'
    | 'presentation_approved'
    | 'request_rejected';
  backendErrorCodes?: string[];
  rejectionReason?: string;
  /** Text shown to the tester while this step waits for the wallet. */
  instruction?: string;
};
/** A question the tester answers in the tool. */
export type ManualCheck = {
  id: string;
  ask: string;
  expect: 'yes' | 'no';
  /** Blocking checks decide the verdict; non-blocking ones are only reported. Default true. */
  blocking?: boolean;
};
/** A button the tester presses during a run, e.g. to revoke the credential issued in step 1. */
export type RunControl = {
  id: string;
  label: string;
  /** Step whose EUDIPLO session holds the credential. */
  stepId: string;
  action: 'set_status';
  /** Status list value: 0 valid, 1 revoked, 2 suspended. */
  status: 0 | 1 | 2;
  /** The control is offered only once this step is reached. */
  availableFromStep?: string;
};
export type Scenario = {
  id: string;
  version: string;
  label: string;
  description: string;
  profile: string;
  /** Catalog section, e.g. "Issuance", "Presentation", "Rejection". */
  section: string;
  tags: string[];
  prerequisites: string[];
  availability: 'ready' | 'unsupported';
  unavailableReason?: string;
  steps: StepDefinition[];
  /** Tester checklist; see docs/design.md section 3. */
  manual?: ManualCheck[];
  /**
   * attest: when EUDIPLO has no deciding evidence (timeout, silent rejection,
   * HTTP fault), blocking checklist answers may decide, provided no server
   * assertion failed and the wallet did not complete the step. The verdict is
   * then marked tester-attested.
   */
  fallback?: 'attest';
  controls?: RunControl[];
  /** Tests that should run first in the same wallet, e.g. issuance before presentation. */
  requires?: string[];
};
export type SessionEvidence = {
  status: 'active' | 'fetched' | 'completed' | 'expired' | 'failed';
  failureCode?: string;
  walletErrorCode?: string;
  credentials?: Record<string, unknown>[];
};
export type Observation = {
  id: string;
  stepId: string;
  event: NonNullable<StepDefinition['walletObservation']>;
  success: boolean;
  reason?: string;
  observedAt: string;
};
export type BackendBinding = {
  profileId: string;
  instanceId: string;
  tenantId: string;
  configVersion: string;
  eudiploVersion: string;
  identityHash: string;
};
export type Step = {
  backend?: BackendBinding;
  definition: StepDefinition;
  state: 'preparing' | 'awaiting_wallet' | 'finished';
  startedAt?: string;
  sessionId?: string;
  uri?: string;
  crossDeviceUri?: string;
  /** Set for dc-api steps: what the page passes to navigator.credentials.get. */
  dcApi?: { protocol: string; request: string; responseUri: string };
  session?: SessionEvidence;
  assertions: Assertion[];
  observations: Observation[];
  fault?: {
    sourceUri: string;
    token: string;
    deliveredAt?: string;
    servedHttpStatus?: 408 | 429 | 504;
    originalSha256?: string;
    mutatedSha256?: string;
  };
  lastPolledAt?: string;
  pollError?: string;
  cleaned?: boolean;
};
export type Workspace = {
  /** Unguessable; the workspace link is the access right. */
  id: string;
  tester?: string;
  wallet: { name: string; version?: string; platform?: string; device?: string };
  createdAt: string;
  lastSeenAt: string;
};
export type ManualAnswer = {
  answer: 'yes' | 'no';
  note?: string;
  at: string;
};
export type Run = {
  id: string;
  /** Workspace the run belongs to. */
  owner: string;
  scenario: Scenario;
  /** awaiting_tester: the server side is done (or has no evidence); checklist answers decide. */
  state: 'preparing' | 'awaiting_wallet' | 'awaiting_tester' | 'finished';
  verdict: Verdict | null;
  /** The verdict rests on checklist answers instead of EUDIPLO protocol evidence. */
  attested?: boolean;
  reason?: string;
  /** Checklist results, one tester assertion per ManualCheck. */
  manual: Assertion[];
  answers: Record<string, ManualAnswer>;
  /** Set when EUDIPLO evidence ran out and the scenario allows attestation. */
  serverNoEvidence?: string;
  /** When each scenario control was last used. */
  controlsUsed?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  deadlineAt: string;
  expiresAt: string;
  currentStep: number;
  steps: Step[];
  wallet: { name: string; version?: string; platform?: string };
  versions: { catalog: string; eudiplo: string; sdk: string };
  events: { at: string; type: string; stepId?: string; detail?: string }[];
  deleted?: boolean;
};
export function record(run: Run, type: string, detail?: string) {
  run.updatedAt = new Date().toISOString();
  run.events.push({
    at: run.updatedAt,
    type,
    stepId: run.steps[run.currentStep]?.definition.id,
    detail,
  });
  // Bounded evidence prevents misbehaving clients growing a run indefinitely.
  if (run.events.length > 500) run.events.splice(0, run.events.length - 500);
}
export function finish(run: Run, verdict: Verdict, reason: string) {
  if (run.state === 'finished') return;
  run.state = 'finished';
  run.verdict = verdict;
  run.reason = reason;
  if (run.steps[run.currentStep]) run.steps[run.currentStep].state = 'finished';
  record(run, 'run.finished', reason);
}
