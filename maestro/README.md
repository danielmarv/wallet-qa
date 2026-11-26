# Maestro flows (proof of concept)

[Maestro](https://maestro.dev/) drives a wallet through Wallet QA tests, without a tester.
Wallet QA still decides the verdict from EUDIPLO's evidence. The flow only plays the user: it
opens the offer or request link, taps through the wallet, and answers the checklist questions
it can check on screen.

```text
run.sh ──► POST /v1/workspaces            one workspace per list of tests
  └─ maestro test wallets/<wallet>/test.yaml   (per test)
       ├─ wallet-qa.js start   POST /v1/workspaces/:ws/runs → output.qa.step.uri
       ├─ per step: openLink uri → accept-offer | share | refuse (wallet adapter)
       │            wallet-qa.js step     wait until EUDIPLO saw the wallet
       └─ wallet-qa.js finish  send checklist answers, wait for the verdict, fail unless passed
```

Same-device links replace QR scanning, so the flows need no camera. They run on emulators,
simulators and USB-connected Android phones.

## Layout

| Path | Purpose |
| --- | --- |
| `scripts/wallet-qa.js` | Talks to the Wallet QA API (`runScript`). Shared by every wallet. |
| `wallets/<wallet>/test.yaml` | The test loop: start, one pass per wallet step, finish. Same for every wallet. |
| `wallets/<wallet>/accept-offer.yaml` | Accept a credential offer, enter the transaction code and PIN. |
| `wallets/<wallet>/share.yaml` | Consent to a presentation request. |
| `wallets/<wallet>/refuse.yaml` | A request the wallet must refuse: note what the wallet shows. |
| `run.sh` | Runs a list of tests in one workspace and saves the JUnit report. |
| `web/live-run.yaml` | Drives the page in the phone's browser instead of the API: start run, open wallet, verdict. |

`wallets/paradym` is the first adapter for a real wallet (see its README for the results).
`wallets/example` has example selectors (`Add`, `Share`, `Send data`, …) and is the template:
copy it and change the three adapter flows. `test.yaml` stays as it is.

The adapters answer checklist questions through `output.qa.answers`, for example
`evalScript: ${output.qa.answers['verifier-shown'] = 'yes'}` once the consent screen names
the verifier. Wallet QA marks those answers "Answered by Maestro from the wallet screen".
Answers for questions a test does not ask are dropped. A test whose blocking question
has no automatic answer stays open for a tester, and the flow fails with that question
named.

## Run

Needs the [Maestro CLI](https://docs.maestro.dev/getting-started/installing-maestro), a
booted emulator or simulator, or an Android phone connected with USB debugging, with the
wallet installed (and onboarded, if it needs a PID),
and a Wallet QA instance the device can reach.

```bash
cp maestro/.env.example maestro/.env      # wallet app id, PIN, Wallet QA URL and login
maestro/run.sh example I-PID-SDJWT P-PID-ALL-SDJWT
```

A single test, without `run.sh`:

```bash
maestro test -e WALLET_APP_ID=com.example.wallet -e SCENARIO=I-EAA-NOTX \
  -e QA_URL=http://127.0.0.1:8787 maestro/wallets/example/test.yaml
```

Order matters: a test with *Run first* on the page (for example `P-PID-ALL-SDJWT`, which
needs `I-PID-SDJWT`) uses the credential an earlier test put in the wallet, so `run.sh`
keeps the order you give.

| Variable | Default | Meaning |
| --- | --- | --- |
| `SCENARIO` | | Test id from the catalog (`GET /v1/scenarios`). |
| `WALLET_APP_ID` | | Bundle id or package name of the wallet. |
| `WALLET_PIN` | unset | Entered when the wallet asks for its PIN. |
| `QA_URL` | `http://127.0.0.1:8787` | Wallet QA, as the machine running Maestro reaches it. |
| `QA_USER`, `QA_PASSWORD` | unset | The team login of a hosted instance. |
| `WORKSPACE` | new one | Workspace for the run (`run.sh` sets it). |
| `QA_STEP_TIMEOUT` | `120` | Seconds to wait for EUDIPLO to see the wallet finish a step. |
| `WALLET_LANG` | all | Adapters with texts in several languages (Paradym): limit the selectors to one, e.g. `en`. |

Screenshots the adapters take (`takeScreenshot`) are saved with Maestro's debug output, in
`~/.maestro/tests/<date>_<time>/<flow name>/takeScreenshot/<name>.png`; `maestro test`
prints that folder at the end.

### Driving the page instead of the API

`web/live-run.yaml` taps the [page](../README.md#page-contract-for-ui-automation) in the phone's
browser (Chrome by default, `BROWSER_APP_ID` for another one). It needs a workspace ID; create the workspace on the page or with `POST /v1/workspaces`.

```bash
maestro test -e WORKSPACE=<workspace id> -e SCENARIO=I-EAA-NOTX \
  -e QA_URL=http://localhost:8787 maestro/web/live-run.yaml
```

It selects elements by their test hooks (`id: start-run`, `id: open-wallet`, `id: verdict`).
Chrome on Android hands Maestro an element's HTML `id` as its resource-id, but not
`data-testid`, so every hook carries both with the same value.

Before Chrome hands an `openid-credential-offer:` link to the wallet, it can ask "Do you trust
this site with your data?" (on the emulator it asked once and then remembered the answer). When
it asks, the flow taps `CHROME_WALLET_PROMPT` (default `Continue`; `Cancel` also opens the
wallet). Then it runs the wallet adapter, brings the browser back and reads the verdict.
Set `QA_URL`, `BROWSER_APP_ID` and `CHROME_WALLET_PROMPT` with `-e`.
The flow passed on a Pixel 9 emulator (Android 16, Chrome) against a fake EUDIPLO backend.
Safari on iOS and real wallets behind the page are not checked yet.

### Reaching the stack from a device

- **Hosted instance**: nothing to do; the links point to public HTTPS hosts.
- **Local stack, iOS simulator**: `localhost` is the Mac. The simulator must trust the
  test TLS root (`scripts/trust-simulator.sh`).
- **Local stack, Android emulator**: forward the ports the links use:
  `adb reverse tcp:3443 tcp:3443 && adb reverse tcp:8443 tcp:8443 && adb reverse tcp:8787 tcp:8787`.
  The emulator must also trust `deploy/tls/root.crt`.

## Limits of this proof of concept

- One real adapter: Paradym on Android, issuance and sharing. Its refusal flow is not
  mapped and its automatic PIN entry (`WALLET_PIN`) is untested; a person entered the PIN.
- `claims-shown` is answered when the wallet reaches its claims screen; the flows do not
  compare the shown claims with the credential.
- Wallet onboarding (PID, PIN setup) is not part of the flows; prepare the wallet once.
- Steps with run controls (`P-REVOKED`, `P-SUSPENDED`) need a control call between steps.
- Biometric prompts and system dialogs beyond the iOS "Open in …" prompt are not handled.
- Real devices: Android phones over USB work (the Paradym results come from one). iPhones
  and device farms are not covered; for those, use a cloud that runs Maestro flows or Appium
  (see `docs/design.md`).
- The flows ran through Maestro's MCP server and `maestro test` (the Paradym adapter);
  `run.sh` itself has not been tried end to end.
- Maestro must run its JavaScript with GraalJS (the default in current versions).
