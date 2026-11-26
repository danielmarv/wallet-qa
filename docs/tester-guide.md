# Wallet QA tester guide

How to test a wallet build with Wallet QA: set up the stack and the phone once, then run
tests from the catalog and hand in a report. For how the tool decides verdicts in detail,
see the [README](../README.md#verdict-rules); for the full test list and rationale, see
[design.md](design.md).

## Hosted or local?

**Use the hosted instance if your team has one** (e.g. `https://conformance.eudiplo.dev`).
Then you need only a phone with a wallet dev build that trusts the instance's credential root
(`/trust/wallet-qa-test-root.der` on the instance, fingerprint in `/trust/trust.json`), and,
if the instance has one, the team login (your browser asks for it once;
`conformance.eudiplo.dev` has none): skip steps 1 to 3 and start at [step 4](#4-create-a-workspace). Any phone works, physical
iPhones included, and nothing has to be installed on it besides the wallet. Setting up an
instance is described in [hosting.md](hosting.md).

**Check that your build fits the instance.** The start page shows **This instance**: the
EUDIPLO tenants the tests use and what your wallet has to trust (a registrar, the Wallet QA
test root, or both). An instance is set up for one trust setup; if your build trusts something
else, ask for the instance that matches it. You cannot change certificates from the page.

**Run it locally** when there is no hosted instance or you test a change to Wallet QA itself.
Then follow every step.

## 1. What you need (local)

- A Mac or Linux machine with **Docker Desktop**.
- A **wallet dev build** that trusts the two Wallet QA test roots (see [step 3](#3-trust-the-test-roots-local)).
  Store builds do not trust them and cannot be tested here.
- One of:
  - an **iOS simulator** on the same Mac,
  - an **Android emulator** or an **Android phone** on USB with `adb`.
  A physical iPhone cannot reach a local stack; use a hosted instance.

## 2. Start the stack (local)

```sh
git clone <wallet-qa repository> && cd wallet-qa
cp .env.example .env
```

Edit `.env`:

- set `EUDIPLO_MASTER_SECRET` and `EUDIPLO_ADMIN_CLIENT_SECRET` to random values
  (`openssl rand -hex 32` for each);
- if something else already uses port 3000 on your machine, add `EUDIPLO_HOST_PORT=3010`
  and set `EUDIPLO_BASE_URL=http://localhost:3010`.

Then:

```sh
docker compose -p wallet-qa up --build -d --wait
```

The first start pulls EUDIPLO and takes a few minutes. When it returns, open
**https://localhost:8443** in the browser. Your browser will warn about the certificate
until you trust the TLS root on the laptop too (optional; see step 3).

Stop it with `docker compose -p wallet-qa down`. Runs and workspaces survive a restart;
`down -v` wipes everything.

## 3. Trust the test roots (local)

Wallet QA uses two separate test roots. Both are public test material and only valid for
`localhost`-style setups; never install them on a phone you use for anything else.

| Root | File | Why |
| --- | --- | --- |
| **TLS root** | `deploy/tls/root.crt` | HTTPS to `localhost:8443` (Wallet QA) and `localhost:3443` (EUDIPLO). Installed on the **device**. |
| **Credential root** | `public/trust/wallet-qa-test-root.der`, also at `https://localhost:8443/trust/wallet-qa-test-root.der` | Signs presentation requests and issued credentials. Must be a trust anchor in the **wallet build**. |

The credential root is built into the wallet dev build by the wallet team (or loaded through
the build's test-trust setting, if it has one). Check the SHA-256 fingerprint against
`https://localhost:8443/trust/trust.json`. If you regenerate the fixtures, the root changes
and the wallet build has to be updated.

### iOS simulator

```sh
scripts/trust-simulator.sh            # the booted simulator; or pass a UDID
```

Once per simulator. The simulator shares the Mac's network, so `localhost` just works.

### Android emulator or phone

1. Connect the device (`adb devices` must list it) and forward the ports, so `localhost`
   on the device reaches your machine. Repeat after every reconnect or emulator restart:

   ```sh
   adb reverse tcp:8443 tcp:8443
   adb reverse tcp:3443 tcp:3443
   ```

2. Install the TLS root as a user CA:

   ```sh
   adb push deploy/tls/root.crt /sdcard/Download/wallet-qa-tls-root.crt
   ```

   On the device: **Settings → Security → More security settings → Encryption &
   credentials → Install a certificate → CA certificate**, pick the file. (Menu names vary
   by vendor; search Settings for "CA certificate".)
3. The wallet dev build must accept user CAs (Android `network_security_config` with
   `<certificates src="user"/>` for debug builds). If HTTPS fails although the root is
   installed, ask the wallet team.

## 4. Create a workspace

A workspace groups your runs for one wallet build. Its link is the only access right:
anyone with the link can see and start runs in it, so share it only with your team.

1. Open the hosted instance or **https://localhost:8443**, fill in your name, wallet, build/version, platform and
   device, and press **Create workspace**. Use one workspace per build you test.
2. To follow the same runs on the phone, press **Join on another device** and scan the QR
   code. Both screens stay in sync; a run started on one shows up on the other.
3. Coming back later: the page offers **Continue the last workspace**, or paste the
   workspace link into **Join a workspace**.

## 5. Run a test

Tests are grouped into **Issuance** (I-…), **Presentation** (P-…) and **Rejection** (R-…).
Search by ID, name or tag, or filter by tag.

1. **Pick a test** and read its description and prerequisites. Tests that need something in
   the wallet name the issuance test to run first (e.g. *Run first: I-PID-SDJWT*). Tests
   marked *unsupported* cannot be started; the reason is shown.
2. Press **Start run**. The live panel shows the instruction, a QR code, **Open wallet** (on
   the phone) and the transaction code if one is needed.
3. **Do what the instruction says** with the wallet: scan the QR code or tap Open wallet,
   go through the wallet's screens as a normal user would. The Digital Credentials API
   tests (P-DCAPI-…) have no QR code: press **Request with Digital Credentials API** and
   pick the wallet in the browser's dialog. This needs a browser with that API (a current
   Chrome, for example) and a wallet registered with the operating system for it.
4. **Controls.** Some tests show buttons during the run, such as *Revoke the issued
   credential* or *Suspend the issued credential*. Press them when the instruction says so,
   not earlier.
5. **Answer the checklist.** Answer **Yes** or **No** to what you saw in the wallet, add a
   note when something looks off, and press **Save answers**. Blocking questions decide the
   verdict; the others are recorded in the report.
6. Read the **verdict**:

| Verdict | Meaning |
| --- | --- |
| **passed** | EUDIPLO's evidence and your blocking answers agree with what the test expects. |
| **passed (tester-attested)** | EUDIPLO had no evidence (e.g. the wallet refused silently or the test injects an HTTP error), so the pass rests on your answers. |
| **failed** | A server check failed, or a blocking answer was not as expected. Answers cannot turn a failed server check into a pass. |
| **inconclusive** | Nothing to decide on, e.g. the run timed out before the wallet did anything. Run it again. |
| **error** | Wallet QA or EUDIPLO had a problem; not the wallet's fault. Run it again; report it if it repeats. |

**Evidence** (under the live run) lists every check with its source (server, wallet,
tester). Download the **audit JSON** when you file a bug; it contains everything EUDIPLO
recorded for the run. **Cancel run** ends a run you started by mistake.

### Tips

- A run times out 10 minutes after **Start run** if the wallet has not finished the flow, so
  start it only when the phone is ready. Once a run waits for your checklist answers, it no
  longer times out.
- Answer what you *saw*, not what you expect. A wrong-looking screen with a passing protocol
  is exactly what the checklist is for.
- For language tests (I-DISPLAY), switch the phone language before you answer.
- If the wallet holds several matching credentials, pick the one issued in the same run
  when the instruction says so.

## 6. Hand in the results

In the test list, use **Reports**:

- **JUnit XML** — for CI dashboards and test management tools; one test case per run, with
  the verdict, whether it was attested, and the run's audit record (including your answers
  and notes).
- **JSON** — everything, including the wallet details from the workspace.

Attach the report (and the audit JSON of failed runs) to the test cycle or bug ticket, with
the workspace's wallet build.

### Publish the results

**Publish results** puts the latest finished result of each test on the public
[results page](/results): wallet name, build, platform, device, the catalog and EUDIPLO
versions, the verdicts and whether a pass was tester-attested. Your name, notes and
checklist answers are not published. Published results are public and stay until an operator
removes them, so do not put personal data in the wallet or device fields. To have a result
removed, open an issue in EUDIPLO/wallet-qa.

Ran the tests on your own instance? Download the **JSON** report there and upload it on the
start page of a hosted instance under **Publish a report from another instance**. It is shown
as self-reported, because that instance did not see the runs.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| The wallet says it cannot connect / SSL error | TLS root not installed on the device, or (Android) `adb reverse` not set after reconnecting. |
| The wallet rejects every presentation request as untrusted | Open **This instance** on the start page: the build must trust what it lists (the registrar or the current Wallet QA test root). A trust-check error there is for whoever runs the instance. |
| Start run fails with an EUDIPLO error | The stack is not up or EUDIPLO is still starting: `docker compose -p wallet-qa ps`, then `pnpm smoke` to check every test can start. |
| A test says it needs a credential you have | It was issued by a different test or an older stack; run the named issuance test again in this workspace. |
| The page says the workspace does not exist | Finished runs and idle workspaces are deleted after the retention time (7 days by default). Create a new one. |
