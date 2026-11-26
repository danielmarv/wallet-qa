# Wallet QA

A manual test bench for EUDI wallets. A tester picks a test, runs it with a real
wallet on a phone, answers a short checklist, and gets a verdict. EUDIPLO plays issuer
and verifier; Wallet QA decides from what EUDIPLO recorded and what the tester saw.

It is part of the [EUDIPLO](https://github.com/EUDIPLO) project and licensed under
[Apache-2.0](LICENSE). The design, the test catalog and the open points are in
[docs/design.md](docs/design.md).

**Testers:** start with the [tester guide](docs/tester-guide.md). It covers starting the
stack, setting up a simulator or phone, running tests and handing in reports. The rest of
this README is for people who run or develop Wallet QA. To run a shared instance on a
public hostname (the easy setup for testers), with the bundled Caddy or behind an existing
Traefik, see [docs/hosting.md](docs/hosting.md). An
instance is one EUDIPLO with a fixed set of tenants for one wallet trust setup; the start page
shows it under **This instance**.

**Test keys in this repository.** `deploy/tls/root.key` and the private keys in
`eudiplo-config/*/key-chains/` are deliberately public test material: the TLS root only
signs `localhost` (name constraint), and the credential keys chain to the Wallet QA test
root, which only test wallets trust. Never use them, or trust their roots, outside testing.
Report real security issues as described in the
[EUDIPLO security policy](https://github.com/EUDIPLO/.github/blob/main/SECURITY.md).

## How a test works

1. The tester opens Wallet QA and creates a **workspace**: name, wallet, build,
   platform, device. The workspace link is the access right; open it on the laptop and
   on the phone (**Join on another device** shows it as a QR code).
2. They pick a test and press **Start run**. Wallet QA asks EUDIPLO for a credential
   offer or presentation request and shows the QR code, the link (**Open wallet**) and
   any transaction code.
3. The wallet completes the flow against EUDIPLO. Some tests offer controls during the
   run, e.g. **Revoke the issued credential** before the presentation step.
4. Wallet QA checks EUDIPLO's evidence (session status, disclosed claims and values,
   protocol error codes, served faults) and asks the checklist questions.
5. The run ends with `passed`, `failed`, `inconclusive`, `error` or `skipped`. A pass
   that rests on checklist answers instead of protocol evidence is marked
   **tester-attested**.

### Verdict rules

| EUDIPLO evidence | Checklist | Verdict |
| --- | --- | --- |
| a server check failed (e.g. the wallet completed a request it had to refuse) | anything | failed; answers cannot override it |
| all server checks passed | blocking answers as expected | passed |
| all server checks passed | a blocking answer not as expected | failed |
| none (timeout, silent rejection, HTTP fault), test allows attestation | blocking answers as expected, the wallet engaged and did not complete | passed, tester-attested |
| none, test does not allow attestation | | inconclusive |
| EUDIPLO infrastructure failure | | error |

Non-blocking questions are reported but never decide.

## Test catalog

`src/testing/catalog.ts` holds every test: EUDIPLO steps, server checks (`expected`,
`disclosures`), the checklist (`manual`), controls and the attestation fallback.
IDs: `I-*` issuance, `P-*` presentation, `R-*` rejection. Tests whose fixtures do not
exist yet are listed as unsupported and produce `skipped` runs. `pnpm test` checks the
catalog for consistency.

Disclosure rules per DCQL credential query: `present` (claim exists), `equals` (claim
has this value), `absent` (claim must not be disclosed), `allowedOnly` (no other
business claims). EUDIPLO flattens mDOC namespaces, so `['eu.europa.ec.eudi.pid.1',
'given_name']` resolves to `given_name`.

PID tests come in two flavours: **QA PID** (issued by `I-PID-SDJWT` / `I-PID-MDOC`,
values known and compared) and **PID provider PID** (from the PID provider test
environment, presence only).

## Run it

Requires Docker Desktop. Node 22.19+ and pnpm 11.20 only for development.

```sh
cp .env.example .env            # set the two EUDIPLO secrets: openssl rand -hex 32
docker compose -p wallet-qa up --build -d --wait
curl -sk https://localhost:8443/health/ready
```

If port 3000 is taken on your machine, add `EUDIPLO_HOST_PORT=3010` and
`EUDIPLO_BASE_URL=http://localhost:3010` to `.env`. Stop with `docker compose -p wallet-qa down`
(`down -v` also deletes runs, workspaces and EUDIPLO's data).

| Service | URL | Notes |
| --- | --- | --- |
| Wallet QA page and API | `https://localhost:8443` | Caddy → the `app` service on port 8787 |
| EUDIPLO | `https://localhost:3443` | Caddy → EUDIPLO on `localhost:3000` (same network namespace); the wallet talks to this |

HTTPS is mandatory: the wallet's OpenID4VCI library refuses plain-http issuers. Caddy
issues the certificates from its internal CA, whose root is the committed **Wallet QA TLS
Test Root** (`deploy/tls/root.crt`, valid until 2036, name-constrained to `localhost`).
The root never changes, so trust it in the simulator once:

```sh
scripts/trust-simulator.sh            # or: scripts/trust-simulator.sh <simulator udid>
```

The iOS simulator shares the Mac's loopback, so `localhost` resolves to the Mac inside
it. Re-run the script only on a fresh simulator. Android emulators and phones need
`adb reverse` and the root as a user CA; see the [tester guide](docs/tester-guide.md#android-emulator-or-phone).
A physical iPhone cannot reach `localhost` and needs a [hosted instance](docs/hosting.md). If you ran the stack before the fixed
root existed, run `docker compose down -v` once so Caddy discards the intermediate it
had signed with its old random root.

The TLS root is deliberately public test material, key included: it is only trusted by
the wallets' dev builds, and only for `localhost`. It is unrelated to the credential
trust root in `public/trust/` (see [Test trust](#test-trust)).

EUDIPLO runs inside Caddy's network namespace (`network_mode: service:caddy`) and trusts
the Wallet QA TLS Test Root through `NODE_EXTRA_CA_CERTS`. That is what lets EUDIPLO fetch its own
`https://localhost:3443/.well-known/jwks.json/...` when it verifies an access token issued by
a chained authorization server, which the PID-check mDL scenario needs. Wallet QA reaches
EUDIPLO as `http://caddy:3000`.

Verify EUDIPLO accepts every fixture (creates and deletes one session per step):

```sh
pnpm install && pnpm smoke
```

## API

All IDs in paths are capabilities: workspace IDs are 128-bit random, run IDs UUID v4.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/scenarios` | Catalog with sections |
| GET | `/v1/environment` | Catalog version, backend profiles, published test trust |
| POST | `/v1/workspaces` | `{ tester?, wallet: { name, version?, platform?, device? } }` |
| GET, PATCH | `/v1/workspaces/:ws` | Read or change tester and wallet metadata |
| GET, POST | `/v1/workspaces/:ws/runs` | List runs; start one with `{ scenarioId, timeoutSeconds? }` |
| GET | `/v1/workspaces/:ws/report?format=json\|junit` | Every run of the workspace |
| GET | `/v1/runs/:id?waitMs=25000` | Live run: step, interaction, checklist, controls, verdict |
| POST | `/v1/runs/:id/answers` | `{ answers: { <checkId>: { answer: "yes"\|"no", note? } } }` |
| POST | `/v1/runs/:id/controls/:control` | Run a control (e.g. revoke) |
| GET | `/v1/runs/:id/report?format=json\|junit` | Audit report of one run |
| DELETE | `/v1/runs/:id` | Cancel a run and delete its EUDIPLO sessions |
| POST | `/v1/workspaces/:ws/publish` | Publish the latest finished result of each test (provenance `instance`) |
| POST | `/v1/uploads` | Publish an uploaded workspace JSON report (provenance `self-reported`, up to 5 MB) |
| GET | `/v1/published` | Public feed of published results, with the feature list and its coverage |
| DELETE | `/v1/published/:id` | Remove a published result; needs `Authorization: Bearer <QA_ADMIN_TOKEN>` |
| GET | `/r/:sessionId` | Same-device return from the wallet; redirects to the run |

`src/client.ts` (`WalletQaClient`) wraps this for automation: create a workspace, start
runs, answer checklists, assert `completed === true && passed === true`.

### Access

There are no accounts. The workspace link is the access right, and a workspace with all
its runs expires after `QA_RETENTION_HOURS` without use. When the instance is
reachable beyond a trusted network, put SSO or an IP allow-list in front of it at the
proxy. If testers present a production PID, disclosed values end up in EUDIPLO sessions
and reports; use QA PIDs.

### Published results

`/results` is a public page of published results, built from the feed at `/v1/published`.
It is not a certification: an entry is what one tester saw with one wallet build, and anyone
can repeat it. Each entry says where it came from:

- **Recorded by the instance**: published with **Publish results** in a workspace, from this
  instance's own run records.
- **Self-reported**: a workspace JSON report uploaded on the start page. Test labels and
  features come from this instance's catalog; unknown tests are dropped.

Only the latest finished result per test is published (skipped runs are left out), with
wallet name, build, platform, device, the catalog and EUDIPLO versions, the verdict and
whether a pass was tester-attested. Tester names, notes, checklist answers, claim values,
session and run IDs are never published. Published results are kept in `published.json`
next to `QA_DATA_FILE` and are not subject to `QA_RETENTION_HOURS`; several results for the
same wallet build are kept side by side. Remove one with `DELETE /v1/published/<id>` and
`QA_ADMIN_TOKEN`, or by editing the file while Wallet QA is stopped. At most
`QA_PUBLISHED_MAX` results (default 1,000) are kept; after that, publishing answers 409
until results are removed.

Each test lists the features it exercises (authorization code, pre-authorized code, DPoP,
wallet attestation, presentation, DC API, Annex C, SD-JWT VC, mdoc). They come from the
step definitions and the tags `dpop`, `wallet-attestation`, `dc-api`, `annex-c`,
`dc+sd-jwt` and `mso_mdoc`; the feed marks features no ready test covers.

### Page contract for UI automation

The page is an Angular app with Angular Material and the EUDIPLO client's Material 3 theme
(source in `web/`, [issue #11](https://github.com/EUDIPLO/wallet-qa/issues/11)). It has a
stable contract so Maestro, XCUITest, Espresso or Playwright can drive it:

- Visible texts: `Start run`, `Open wallet`, `Run ID: <uuid>`, `Transaction code: <digits>`,
  `Status: …` / `Verdict: …`.
- On `#liveRun` the attributes `data-run-id`, `data-completed`, `data-passed`, `data-verdict`,
  `data-attested`, `data-sync`.
- Links: `/` is the overview, `/start` creates or joins a workspace, `/w/<workspace>?scenario=<id>` preselects a test, `?run=<id>` shows a run,
  `?timeoutSeconds=<n>` sets the run timeout.
- `?e2e=1` switches off Material animations and ripples, CSS transitions and the progress bar.
- Test hooks: every element a flow taps or reads has an `id` and a `data-testid` with the same
  value. Chrome on Android exposes the `id` to Maestro and UiAutomator, `data-testid` to
  WebDriver and Playwright. `#liveRun` keeps its id (hook `live-run`).

  | Hook | Element |
  | --- | --- |
  | `start-session`, `resume-workspace`, `intro-results`, `run-trace`, `catalog-overview`, `catalog-total`, `catalog-<section>`, `cta-start` | Overview (`/`): links to `/start`, continue the last workspace, the catalog at a glance |
  | `start-link`, `results-link` | Top bar links to `/start` and `/results` |
  | `workspace-form`, `tester`, `wallet-name`, `wallet-version`, `wallet-platform`, `wallet-device`, `save-workspace` | Create (`/start`) or edit a workspace (platform is a native `<select>`) |
  | `resume-workspace`, `join-input`, `join-button` | `/start`: continue the last workspace, join one by its link or ID |
  | `upload-report`, `upload-file`, `choose-file`, `upload-button` | `/start`: publish a report from another instance (a folded panel; open `upload-report` first) |
  | `edit-workspace`, `join-toggle`, `join-link`, `join-qr` | Workspace bar, join on another device |
  | `search`, `tag-filter`, `test-<test id>`, `progress`, `section-<section>` | Catalog (the tag filter is a native `<select>`; `section-issuance` etc. fold a section) |
  | `test-label`, `test-id`, `test-tags`, `test-description`, `start-run`, `change-test` | Selected test, Start run, Change test (phone only: jumps to the catalog) |
  | `verdict` | `Status: …` / `Verdict: …` |
  | `open-wallet`, `tx-code`, `qr`, `wallet-uri` | Open wallet, `Transaction code: …`, QR code, link |
  | `dc-api-button`, `dc-api-unsupported` | `Request with Digital Credentials API`, shown instead of Open wallet, QR code and link on the `P-DCAPI-*` tests; the hint when the browser lacks the API |
  | `run-id`, `scenario-id`, `reason`, `step`, `instruction` | Run details |
  | `checklist-q-<id>`, `checklist-q-<id>-yes`, `-no`, `-note`, `save-answers` | Checklist, shown once the wallet part is over |
  | `checklist-later`, `checklist-open` | The folded checklist while the run waits for the wallet; `checklist-open` shows it early |
  | `control-<id>` | Run controls (revoke, suspend) |
  | `evidence`, `audit`, `cancel-run` | Evidence, audit JSON, cancel |
  | `view-run-<run id>`, `report-junit`, `report-json`, `publish-results`, `confirm-ok`, `confirm-cancel` | Runs, reports, publishing |
  | `message`, `instance-info` | Status message, this instance's trust setup |
  | `features`, `feature-<id>`, `wallet-filter`, `results`, `result-<id>` | Results page (`/results`; the wallet filter is a native `<select>`) |

The [Maestro flows](maestro/README.md) use the API instead of the page: they start a run,
open its same-device link in the wallet, and wait for the verdict.
[`maestro/web/live-run.yaml`](maestro/web/live-run.yaml) drives the page itself.

`web/` is its own pnpm package: Angular 22 needs TypeScript 6.0 (the server uses 7) and
Node.js 22.22.3 or later. `pnpm run build` builds it into `dist/web`, which the server serves
under `/web/`; without it, `/`, `/w/<workspace>` and `/results` answer 503. `pnpm check` builds
the page too.

## Test trust

`pnpm fixtures:generate <eudiplo-host> fixtures eudiplo-config` creates a
new **Wallet QA Test Root CA**, every tenant key chain, and for the verifier tenant the
`access-untrusted` chain (from a second root whose key is never published) that
`R-ACCESS-UNTRUSTED` uses. Every certificate subject carries a country and organisation
(`C=DE, O=Wallet QA`; set `FIXTURE_COUNTRY` for another country), as ISO/IEC 18013-5 requires
for mdoc issuers. Every presentation config names its chain with
`accessKeyChainId`: with more than one access chain, EUDIPLO otherwise picks any of them. Copy the output as described in
[eudiplo-config/README.md](eudiplo-config/README.md).

Wallet dev builds must trust `public/trust/wallet-qa-test-root.der` for presentation
requests, and `deploy/tls/root.crt` (the TLS root) for HTTPS to
`localhost`. A hosted instance generates its own fixtures for its hostname and uses a
publicly trusted TLS certificate; see [docs/hosting.md](docs/hosting.md).

## Development

```sh
pnpm install
pnpm run build && pnpm test       # unit tests use a fake EUDIPLO backend
pnpm dev                          # http://127.0.0.1:8787 (EUDIPLO via Compose)
pnpm dev:spa                      # rebuilds the page (web/) on change; Node.js 22.22.3+
pnpm smoke                        # creates and deletes one EUDIPLO session per test step
```

## Not done yet

- Hosting: a [single-instance setup](docs/hosting.md) with basic auth exists; missing is a
  PostgreSQL store for more than one instance.
- Registration certificates: a deployment can add them to presentation configs
  ([hosting](docs/hosting.md#what-a-deployment-changes)), but EUDIPLO sends them only when the
  tenant has a registrar account. The `R-REG-*` fault tests still need fixtures.
- Expired and revoked access certificates (`R-ACCESS-EXPIRED`, `R-ACCESS-REVOKED`): EUDIPLO
  validates its own access certificate before signing and refuses both, so these need a
  switch in EUDIPLO or a request signed by Wallet QA itself.
- Fixtures: registration certificates (`R-REG-*`), wallet attestation tenant (`I-WIA`),
  deferred issuance webhook (`I-DEFERRED`), Annex C and transaction data tests.
- Maestro flows on top of `WalletQaClient` and the page contract.

## EUDIPLO notes

- An issuance session stays at `fetched` after the credential is issued; EUDIPLO only sets
  `completed` when the wallet posts a `credential_accepted` notification. The iOS wallet sends
  that notification without a DPoP proof for its DPoP-bound token and EUDIPLO rejects it, so
  Wallet QA counts the notification entry (created only when a credential was issued) as issuance
  completion. Wallet-side storage is asserted by the UI test. A `credential_failure` or
  `credential_deleted` notification still fails the step.
- The wallet refuses SD-JWT credentials without a `cnf` claim, so every issued credential
  fixture must use `keyBinding: true`.
- PID presentation fixtures run with `statusCheckMode: disabled`: the demo PID provider's status
  list JWT is expired and EUDIPLO would otherwise reject every PID presentation. These scenarios
  judge disclosure, not revocation.
- After the wallet enabled relying-party registration certificate (WRPRC) validation, the local
  verifier (no registrar) is only accepted when the app runs with `UI_TEST_SKIP_WRPRC=1` in
  UI-testing mode. Configuring a registrar for the EUDIPLO tenant is the follow-up that removes it.
