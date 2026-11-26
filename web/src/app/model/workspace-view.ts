// Texts and lists of the setup and workspace screens. No Angular imports, so the repository's
// node:test suite (tests/web.test.ts) checks them directly.
import type { LiveRun } from './run-view';

export interface Wallet {
  name: string;
  version?: string;
  platform?: string;
  device?: string;
}

export interface Workspace {
  id: string;
  tester?: string;
  wallet: Wallet;
}

export interface Scenario {
  id: string;
  section: string;
  label: string;
  description: string;
  profile: string;
  tags: string[];
  prerequisites: string[];
  requires?: string[];
  availability: string;
  unavailableReason?: string;
}

export interface AccessCertificate {
  source: string;
  issuer: string;
  validTo: string;
}

export interface Tenant {
  tenantId: string;
  profileIds: string[];
  description?: string;
  accessCertificate: AccessCertificate | null;
  error?: string;
}

export interface Environment {
  trust?: { sha256: string; rootCertificateDer?: string };
  tenants?: Tenant[];
}

/** The fields of the workspace form, as typed. */
export interface WorkspaceFormValue {
  tester: string;
  name: string;
  version: string;
  platform: string;
  device: string;
}

/** Workspace IDs are 22 URL-safe characters (src/testing/store.ts). */
const WORKSPACE_ID = /^[A-Za-z0-9_-]{22}$/;
export const isWorkspaceId = (value: string) => WORKSPACE_ID.test(value);

/** The body of POST/PATCH /v1/workspaces: empty fields are left out. */
export function workspaceBody(form: WorkspaceFormValue): { tester?: string; wallet: Wallet } {
  const wallet: Wallet = { name: form.name.trim() };
  for (const key of ['version', 'platform', 'device'] as const) {
    const value = form[key].trim();
    if (value) wallet[key] = value;
  }
  const tester = form.tester.trim();
  return tester ? { tester, wallet } : { wallet };
}

export function workspaceForm(workspace?: Workspace): WorkspaceFormValue {
  return {
    tester: workspace?.tester ?? '',
    name: workspace?.wallet.name ?? 'EUDI Wallet',
    version: workspace?.wallet.version ?? '',
    platform: workspace?.wallet.platform ?? '',
    device: workspace?.wallet.device ?? '',
  };
}

/** "Alice · EUDI Wallet 1.4.2 · android · Pixel 8" */
export function workspaceSummary(workspace: Workspace): string {
  const { wallet } = workspace;
  return [workspace.tester, [wallet.name, wallet.version].filter(Boolean).join(' '), wallet.platform, wallet.device]
    .filter(Boolean)
    .join(' · ');
}

/** The workspace ID in a pasted workspace link or ID, or undefined. */
export function workspaceIdFrom(input: string): string | undefined {
  return /([A-Za-z0-9_-]{22})\/?$/.exec(input.trim())?.[1];
}

/** The latest run of a test in this workspace decides its status in the catalog. */
export function latestRun(runs: LiveRun[], scenarioId: string): LiveRun | undefined {
  return runs.find((run) => run.scenarioId === scenarioId);
}

export function statusText(run: LiveRun | undefined): string {
  if (!run) return 'not run';
  if (!run.completed) return run.awaitingTester ? 'answer checklist' : 'running';
  return run.verdict === 'passed' && run.attested ? 'passed (attested)' : (run.verdict ?? 'finished');
}

export type StatusTone = 'passed' | 'failed' | 'running' | 'neutral';
export function statusTone(scenario: Scenario, run: LiveRun | undefined): StatusTone {
  if (scenario.availability !== 'ready' || !run) return 'neutral';
  if (!run.completed) return 'running';
  if (run.verdict === 'passed') return 'passed';
  return run.verdict === 'failed' || run.verdict === 'error' ? 'failed' : 'neutral';
}

export interface CatalogItem {
  scenario: Scenario;
  status: string;
  tone: StatusTone;
  /** Only tests with a run or without support get a chip, so the few results stand out. */
  chip: boolean;
}

export interface CatalogSection {
  name: string;
  items: CatalogItem[];
  /** "3/11": tests of the section with a finished run, of those this instance supports. */
  count: string;
}

/** The catalog, grouped by section, filtered by search text (ID, name, tags) and tag. */
export function catalogSections(scenarios: Scenario[], runs: LiveRun[], query: string, tag: string) {
  const text = query.trim().toLowerCase();
  const sections: CatalogSection[] = [];
  for (const scenario of scenarios) {
    if (tag && !scenario.tags.includes(tag)) continue;
    if (text && !`${scenario.id} ${scenario.label} ${scenario.tags.join(' ')}`.toLowerCase().includes(text)) continue;
    const run = latestRun(runs, scenario.id);
    const item = {
      scenario,
      status: scenario.availability === 'ready' ? statusText(run) : 'unsupported',
      tone: statusTone(scenario, run),
      chip: scenario.availability !== 'ready' || !!run,
    };
    const section = sections.find((s) => s.name === scenario.section);
    if (section) section.items.push(item);
    else sections.push({ name: scenario.section, items: [item], count: '' });
  }
  for (const section of sections) {
    const ready = section.items.filter((i) => i.scenario.availability === 'ready');
    const done = ready.filter((i) => latestRun(runs, i.scenario.id)?.completed).length;
    section.count = `${done}/${ready.length}`;
  }
  return sections;
}

/** The selected test's header chips: test ID, protocol profile, then its tags. */
export function scenarioChips(scenario: Scenario): string[] {
  return [scenario.profile, ...scenario.tags];
}

export const tagsOf = (scenarios: Scenario[]) =>
  [...new Set(scenarios.flatMap((s) => s.tags))].sort((a, b) => a.localeCompare(b));

/** "3 of 41 run": tests with a finished run, of the tests this instance supports. */
export function progressText(scenarios: Scenario[], runs: LiveRun[]): string {
  const done = scenarios.filter((s) => latestRun(runs, s.id)?.completed).length;
  return `${done} of ${scenarios.filter((s) => s.availability === 'ready').length} run`;
}

export function runLine(run: LiveRun): string {
  return `${run.scenarioId} · ${statusText(run)} · ${new Date(run.createdAt).toLocaleString()}`;
}

export function certificateText(tenant: Tenant): string {
  const cert = tenant.accessCertificate;
  if (tenant.error) return `trust check failed: ${tenant.error}`;
  if (!cert) return 'no access certificate (issuer only)';
  const until = `valid until ${cert.validTo.slice(0, 10)}`;
  return cert.source === 'test-root'
    ? `access certificate from the Wallet QA test root (${until})`
    : `access certificate issued by ${cert.issuer} (${until})`;
}

/** "This instance: 2 EUDIPLO tenants · wallet must trust Registrar CA" */
export function instanceSummary(environment: Environment): string {
  const tenants = environment.tenants ?? [];
  const issuers = [
    ...new Set(
      tenants
        .map((t) => t.accessCertificate)
        .filter((c): c is AccessCertificate => !!c)
        .map((c) => (c.source === 'test-root' ? 'the Wallet QA test root' : c.issuer)),
    ),
  ];
  return (
    `This instance: ${tenants.length} EUDIPLO tenant${tenants.length === 1 ? '' : 's'}` +
    (issuers.length ? ` · wallet must trust ${issuers.join(' and ')}` : '')
  );
}

export function instanceRootText(environment: Environment): string {
  const root = environment.trust;
  return root ? `Wallet QA test root SHA-256 ${root.sha256} — /trust/${root.rootCertificateDer ?? 'test-root.pem'}` : '';
}

export const PUBLISH_WARNING = 'Published results are public and stay until an operator removes them.';

export function publishedText(count: number, selfReported = false): string {
  return `Published ${count}${selfReported ? ' self-reported' : ''} test result${count === 1 ? '' : 's'} to /results.`;
}

/** The server answers an upload that is not JSON with 400 "Invalid JSON body". */
export function publishErrorText(status: number | undefined, message: string): string {
  return `Could not publish: ${status === 400 && message === 'Invalid JSON body' ? 'the file is not JSON' : message}`;
}
