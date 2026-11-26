# Wallet QA: design

Wallet QA is a manual test bench for EUDI wallets. A tester picks a test, starts it, completes
it with a real wallet on a phone, and gets a verdict. EUDIPLO plays issuer and verifier; Wallet
QA decides from what EUDIPLO recorded and what the tester saw. Automated flows (Maestro,
Appium, XCUITest, Espresso) can drive the same page and API; a Maestro proof of concept is
in [maestro/](../maestro/README.md).

This document explains the test catalog, the EUDIPLO configuration, the evaluation logic and
the workspace model. How to run and deploy it is in the [README](../README.md),
[tester-guide.md](tester-guide.md) and [hosting.md](hosting.md).

## 1. Test catalog

The catalog lives in `src/testing/catalog.ts`; the page and `GET /v1/scenarios` list it with
each test's availability. Tests are grouped into three sections:

- **Issuance (I-…)**: OpenID4VCI flows, credential formats, transaction codes, DPoP, display
  metadata, short-lived credentials, credentials without key binding.
- **Presentation (P-…)**: OpenID4VP with DCQL: the QA PID with all, one or age attributes in
  both formats, PIDs from a PID provider test environment, one or several EAAs, `credential_sets`
  (OR/AND), value filters, selective disclosure, revoked, suspended and expired credentials,
  the tester declining a request, and the PID age check over the W3C Digital Credentials API
  (`P-DCAPI-*`).
- **Rejection (R-…)**: requests the wallet must refuse: credential not available, value filter
  that matches nothing, corrupted request signature, access certificate from an untrusted root,
  HTTP errors when fetching the request.

Every presentation test can be run cross-device (QR code) and same-device (link); same-device
runs return to Wallet QA through the presentation's redirect URI. The `P-DCAPI-*` tests have
neither: EUDIPLO creates a `dc-api` request bound to the Wallet QA origin (`expected_origins`),
the page passes it to `navigator.credentials.get` as `openid4vp-v1-signed`, and posts what the
wallet returned to `POST /v1/runs/<id>/dc-api/response`. Wallet QA forwards it to EUDIPLO's
response endpoint; the verdict comes from the EUDIPLO session as for every other presentation.

### Evaluation modes

| Mode | Meaning |
| --- | --- |
| Automatic | The verdict comes from EUDIPLO's evidence: session status, disclosed claims and values, protocol error codes. |
| Automatic + checklist | Evidence plus tester questions about what the wallet showed. |
| Checklist with attestation | The wallet's reaction leaves no evidence at EUDIPLO (a silent refusal, an HTTP fault); the tester's answers can pass the test, marked *tester-attested*. |

### Not available yet

| Test | Why |
| --- | --- |
| I-WIA (wallet attestation required) | Needs a tenant that trusts the wallet provider's attestation keys. |
| I-DEFERRED (deferred issuance) | Needs an issuance webhook in Wallet QA, which it does not provide yet. |
| R-ACCESS-EXPIRED, R-ACCESS-REVOKED | EUDIPLO validates its own access certificate before signing and refuses expired or revoked ones. |
| R-REG-INVALID, R-REG-REVOKED, R-REG-OVERASK | Need registration certificate fixtures; EUDIPLO also sends registration certificates only when the tenant has a registrar account. |

### Ideas for later

Authorization code flow with the built-in authorization server, several credentials in one
offer, batch issuance with an unlinkability check across two presentations, expired and
replayed offers, an issuer outside the wallet's trust, HTTP faults on the issuer endpoints,
`claim_sets`, optional credential sets, mDL with PID, verifier information from the
registration certificate, transaction data, ISO 18013-7 Annex C over the Digital Credentials
API, and a request object with an expired `exp` or a mismatching `client_id`.

Out of scope: proximity (ISO 18013-5 over BLE/NFC), PID issuance through a real eID flow,
wallet onboarding, PIN and biometrics, backup. They have no EUDIPLO side.

## 2. EUDIPLO configuration

A Wallet QA instance is one EUDIPLO instance with a fixed set of tenants (`eudiplo-config/`):

- `base`: the issuer and verifier for most tests.
- `issuer-dpop-v1`: an issuer that requires DPoP-bound tokens.

Tests that need a tenant-wide setting (wallet attestation, an untrusted issuer) get their own
tenant. Each test step names its backend profile, which maps to a tenant in
`config/eudiplo-backends.json`.

Findings from the EUDIPLO configuration that shape the fixtures:

- A presentation config picks its signing key chain with `accessKeyChainId`, so one verifier
  tenant holds the valid access certificate and the deliberately broken one. Every
  presentation names its chain; with more than one access chain, EUDIPLO would otherwise pick
  any of them.
- `registration_cert.jwt` takes a pre-built registration certificate, so invalid, revoked and
  over-asking registration certificates can be fixtures rather than code.
- `POST /api/session/revoke` sets the status of the credentials issued in a session (valid,
  revoked, suspended); the tests offer it as a button during the run.

Fixture rules:

- `statusCheckMode: strict` unless a test needs otherwise.
- "All attributes" fixtures list every claim the QA PID carries, and the evaluator checks that
  exactly that set came back.
- Same-device presentations redirect to `<tool>/r/{sessionId}`, so Wallet QA sees the return.

`scripts/generate-fixtures.mjs` creates the test trust material: a Wallet QA test root, every
tenant's key chains for a given hostname, and the `access-untrusted` chain from a second root
whose key is never published. A deployment replaces what it needs through an overlay
([hosting.md](hosting.md#what-a-deployment-changes)).

## 3. Evaluation logic

Two sources of evidence:

1. **Server assertions**: session status, disclosed claims and values, protocol error code,
   delivered fault, redirect received.
2. **Checklist**: questions defined per test, answered by the tester, each with an expected
   answer and a `blocking` flag, plus an optional note.

| Server result | Checklist | Verdict |
| --- | --- | --- |
| a check failed (e.g. EUDIPLO `completed` on a request the wallet had to refuse) | anything | **failed**; answers cannot override server evidence |
| all checks passed | blocking answers as expected | **passed** |
| all checks passed | a blocking answer not as expected | **failed**, naming the question |
| no evidence (timeout, silent refusal, HTTP fault), test allows attestation | blocking answers as expected, the wallet engaged and did not complete | **passed (tester-attested)** |
| no evidence, test does not allow attestation | | **inconclusive** |
| infrastructure failure | | **error** |

The tester-attested pass is the fallback for silent refusals: the server shows that no valid
presentation reached the verifier, the tester confirms what the user was told. Reports keep it
apart from an automatic pass, so later automation knows which tests still depend on a human.

## 4. Workspaces instead of API keys

An API key suits CI: one team, one secret, a machine client. It suits manual testing badly:
testers would paste a secret on laptop and phone, and runs would not be grouped by session.

Wallet QA uses **workspaces** instead:

- A tester creates a workspace with an unguessable ID (`/w/<22 characters>`). It records the
  tester, wallet, build, platform and device; every run and report inherits them.
- The page shows a QR code to open the same workspace on the phone. Both screens show the same
  runs: start on the laptop, scan with the wallet, see the verdict on both.
- The workspace link is the access right. Runs, reports and run controls are scoped to it; it
  expires after a period without use, together with its EUDIPLO sessions.
- A hosted instance puts the page and API behind a team login at the proxy.
- For automation, a per-workspace token is the natural extension.

Data protection: a tester who presents a real PID discloses real personal data into EUDIPLO
sessions and reports. The PID tests default to the QA PID issued by Wallet QA itself, and
retention is short.

## 5. Page for testers

1. Workspace header with tester and wallet build, and a QR code to join on another device.
2. Test list by section, with search, tag filter and the latest result per test.
3. Test page: description, prerequisites, *Run first* hints, Start, QR code, link and
   transaction code, live step status, checklist, run controls (revoke, suspend).
4. Reports per workspace as JUnit XML and JSON, and an audit JSON per run.
5. **This instance**: the tenants and what the wallet has to trust.
6. Publishing: the latest result per test to the public `/results` page and its feed,
   labelled by provenance (recorded by the instance, or self-reported upload), without
   tester, notes, answers or claim values.

The visible texts and `#liveRun` data attributes are a stable contract (README, *Page contract
for UI automation*), so UI automation can drive the page without changes.

## 6. Open points

- The expected wallet behaviour for some tests (I-NOKB, I-SHORT-LIFE, an untrusted issuer):
  refuse, warn or mark. The checklist needs it.
- Whether wallet dev builds accept the QA PID as a PID; if not, PID presentations rely on a PID
  provider test environment and value checks become presence checks.
- Registration certificates without a registrar account (needs a change in EUDIPLO).
- Test plans: saved lists of tests run in order, and an HTML report per workspace.
