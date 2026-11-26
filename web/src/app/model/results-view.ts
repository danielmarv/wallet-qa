// The public results page: the feed at GET /v1/published (src/testing/published.ts) and the
// texts the page shows for it. Wallet fields come from uploads and are only ever shown as text.

export interface PublishedTest {
  scenarioId: string;
  label: string;
  section: string;
  features: string[];
  verdict: string;
  attested: boolean;
  testedAt: string;
  versions: { catalog: string; eudiplo: string };
}

export interface PublishedResult {
  id: string;
  publishedAt: string;
  provenance: 'instance' | 'self-reported';
  instance: string;
  wallet: { name: string; version?: string; platform?: string; device?: string };
  tests: PublishedTest[];
}

export interface FeatureCoverage {
  id: string;
  label: string;
  covered: boolean;
}

export interface PublishedFeed {
  features: FeatureCoverage[];
  results: PublishedResult[];
}

export const dateText = (value: string) => new Date(value).toISOString().slice(0, 10);

export const walletTitle = (wallet: PublishedResult['wallet']) => [wallet.name, wallet.version].filter(Boolean).join(' ');

/** Platform, device and publishing date, for the line under the wallet name. */
export function resultDetails(result: PublishedResult): string {
  return [result.wallet.platform, result.wallet.device, `published ${dateText(result.publishedAt)}`].filter(Boolean).join(' · ');
}

export function provenanceText(result: PublishedResult): string {
  return result.provenance === 'instance'
    ? `Recorded by the instance ${result.instance}`
    : `Self-reported, uploaded to ${result.instance}`;
}

/** The wallet filter: every wallet name once, sorted. */
export const walletNames = (results: PublishedResult[]) =>
  [...new Set(results.map((result) => result.wallet.name))].sort((a, b) => a.localeCompare(b));

export const filterResults = (results: PublishedResult[], wallet: string) =>
  results.filter((result) => !wallet || result.wallet.name === wallet);

/** The labels of a test's features, from the feed's feature list. */
export function featureText(features: FeatureCoverage[], ids: string[]): string {
  return ids.map((id) => features.find((feature) => feature.id === id)?.label ?? id).join(', ');
}

export const versionText = (test: PublishedTest) => `${test.versions.eudiplo} (catalog ${test.versions.catalog})`;

export function verdictTone(verdict: string): 'passed' | 'failed' | 'neutral' {
  if (verdict === 'passed') return 'passed';
  if (verdict === 'failed' || verdict === 'error') return 'failed';
  return 'neutral';
}

export function loadErrorText(status: number | undefined, message: string): string {
  const reason = status ? `HTTP ${status}` : message;
  return `Could not load the published results: ${reason}`;
}
