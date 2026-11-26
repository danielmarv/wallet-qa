// The public results page (web/src/app/results): the texts it shows for the feed at /v1/published.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  featureText,
  filterResults,
  loadErrorText,
  provenanceText,
  resultDetails,
  verdictTone,
  versionText,
  walletNames,
  walletTitle,
  type PublishedFeed,
  type PublishedResult,
} from '../web/src/app/model/results-view.js';

const result = (name: string, provenance: PublishedResult['provenance'], wallet: Partial<PublishedResult['wallet']> = {}): PublishedResult => ({
  id: name, publishedAt: '2026-11-18T10:00:00.000Z', provenance, instance: 'https://qa.test',
  wallet: { name, version: '1.0', ...wallet },
  tests: [{ scenarioId: 'I-EAA-NOTX', label: 'Issue', section: 'Issuance', features: ['dpop', 'unknown'], verdict: 'passed', attested: true, testedAt: '2026-11-18T09:00:00.000Z', versions: { catalog: '3.0.0', eudiplo: '9.2.0' } }],
});
const feed: PublishedFeed = {
  features: [{ id: 'dpop', label: 'DPoP-bound access tokens', covered: true }, { id: 'dc-api', label: 'DC API', covered: false }],
  results: [result('<b>Wallet</b>', 'self-reported', { platform: 'android', device: 'Pixel 9' }), result('Other', 'instance'), result('Another', 'instance')],
};

test('results page: wallet, provenance, features and versions of an entry', () => {
  const [selfReported, instance] = feed.results;
  // Angular interpolation renders this as text; the model keeps it as it came.
  assert.equal(walletTitle(selfReported.wallet), '<b>Wallet</b> 1.0');
  assert.equal(walletTitle({ name: 'W' }), 'W');
  assert.equal(resultDetails(selfReported), 'android · Pixel 9 · published 2026-11-18');
  assert.equal(resultDetails(instance), 'published 2026-11-18');
  assert.equal(provenanceText(selfReported), 'Self-reported, uploaded to https://qa.test');
  assert.equal(provenanceText(instance), 'Recorded by the instance https://qa.test');
  assert.equal(featureText(feed.features, selfReported.tests[0].features), 'DPoP-bound access tokens, unknown');
  assert.equal(versionText(selfReported.tests[0]), '9.2.0 (catalog 3.0.0)');
});

test('results page: the wallet filter lists each wallet once, sorted, and filters by it', () => {
  assert.deepEqual(walletNames([...feed.results, result('Other', 'self-reported')]), ['<b>Wallet</b>', 'Another', 'Other']);
  assert.deepEqual(filterResults(feed.results, '').map((r) => r.id), ['<b>Wallet</b>', 'Other', 'Another']);
  assert.deepEqual(filterResults(feed.results, 'Other').map((r) => r.id), ['Other']);
});

test('results page: verdict colours and the load error', () => {
  assert.equal(verdictTone('passed'), 'passed');
  assert.equal(verdictTone('failed'), 'failed');
  assert.equal(verdictTone('error'), 'failed');
  assert.equal(verdictTone('inconclusive'), 'neutral');
  assert.equal(loadErrorText(500, 'Request failed'), 'Could not load the published results: HTTP 500');
  assert.equal(loadErrorText(undefined, 'Failed to fetch'), 'Could not load the published results: Failed to fetch');
});
