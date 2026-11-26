// The start page: what a run looks like and what the catalog of this instance tests.
import type { Scenario } from './workspace-view';

export type TraceTone = 'waiting' | 'running' | 'passed' | 'failed' | 'neutral';

/** One step of a run, with the status texts the run screen shows at that point. */
export interface TraceStep {
  title: string;
  text: string;
  statuses: { text: string; tone: TraceTone }[];
}

/** A run from start to verdict; the statuses are the page-contract texts of the live run. */
export const RUN_TRACE: TraceStep[] = [
  {
    title: 'Create a workspace',
    text: 'Name the wallet build and the device. Open the workspace link on the phone and on the laptop to see the same runs on both.',
    statuses: [],
  },
  {
    title: 'Start a run',
    text: 'Pick a test. Wallet QA asks EUDIPLO for a credential offer or a presentation request and shows its link and QR code.',
    statuses: [{ text: 'Status: awaiting wallet', tone: 'waiting' }],
  },
  {
    title: 'Use the wallet',
    text: 'Open the link or scan the code, then accept, share or refuse as the test asks. EUDIPLO records what the wallet sent.',
    statuses: [{ text: 'Status: awaiting tester', tone: 'running' }],
  },
  {
    title: 'Answer the checklist',
    text: 'Say what the wallet showed. Your answers never overrule a server check that failed.',
    statuses: [],
  },
  {
    title: 'Get the verdict',
    text: 'Decided from the evidence EUDIPLO recorded and your answers. A pass that rests on your answers alone is marked as such.',
    statuses: [
      { text: 'passed', tone: 'passed' },
      { text: 'failed', tone: 'failed' },
      { text: 'inconclusive', tone: 'neutral' },
      { text: 'passed (tester-attested)', tone: 'passed' },
    ],
  },
];

/** The question each catalog section answers about a wallet. */
const SECTION_QUESTIONS: Record<string, string> = {
  Issuance: 'Does the wallet accept credentials it is offered over OpenID4VCI?',
  Presentation: 'Does it share exactly the claims a verifier asks for over OpenID4VP?',
  Rejection: 'Does it refuse requests it must refuse, and say so?',
};

export interface CatalogSectionSummary {
  name: string;
  question: string;
  ready: number;
  pending: number;
  examples: string[];
}

/** Per section: how many tests run on this instance, how many still wait, and a few examples. */
export function catalogOverview(scenarios: Scenario[], examples = 3): CatalogSectionSummary[] {
  const sections = [...new Set(scenarios.map((scenario) => scenario.section))];
  return sections.map((name) => {
    const tests = scenarios.filter((scenario) => scenario.section === name);
    const ready = tests.filter((scenario) => scenario.availability === 'ready');
    return {
      name,
      question: SECTION_QUESTIONS[name] ?? '',
      ready: ready.length,
      pending: tests.length - ready.length,
      examples: ready.slice(0, examples).map((scenario) => scenario.label),
    };
  });
}

export function sectionCountText(section: CatalogSectionSummary): string {
  const ready = `${section.ready} ${section.ready === 1 ? 'test' : 'tests'}`;
  return section.pending ? `${ready}, ${section.pending} more waiting for fixtures` : ready;
}

export function catalogTotalText(sections: CatalogSectionSummary[]): string {
  const ready = sections.reduce((sum, section) => sum + section.ready, 0);
  return `${ready} tests run on this instance.`;
}
