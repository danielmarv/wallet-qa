# Hosting Wallet QA

A hosted instance (e.g. `conformance.eudiplo.dev`) is the easy setup for testers: no Docker,
no TLS root on the phone, no `adb reverse`, physical iPhones work, and the whole team shares
workspaces and results. The local stack stays for developing Wallet QA itself.

## What an instance is

A Wallet QA instance is **one EUDIPLO instance with a fixed set of tenants**, all set up for
**one wallet trust setup** (the same registrar and trust anchors):

| Tenant | Used for |
| --- | --- |
| `base` | Most tests: PID, loyalty, event and mixed credentials, every presentation and rejection test. |
| `issuer-dpop-v1` | Issuance with DPoP-bound access tokens (I-DPOP). |
| later `qa-issuer-wia`, `qa-issuer-untrusted` | Wallet attestation, an issuer outside the wallet's trust ([design](design.md)). |

Separate tenants exist because some settings apply to a whole tenant, not to one credential.
Each test step names the tenant it uses (the backend profiles in `config/eudiplo-backends.json`);
testers never choose or configure tenants, and nobody changes certificates from the page.
That is decided when the instance is deployed, because every workspace shares the tenants and
a change would hit other testers' runs.

All wallet builds that share the trust setup (Android and iOS, versions, dev and nightly
builds) can be tested on the same instance; each workspace records which build it tests. A
wallet with other trust anchors (another member state's wallet, another registrar) needs its
own instance: the same repository with its own `.env.hosted` and trust material.

The start page shows the setup under **This instance**: the tenants, where each one's access
certificate comes from, and what the wallet has to trust. The same data is at
`/v1/environment` (`tenants`).

## Local and hosted

It is the same Compose stack with an override on top. There are two hosted variants that
differ only in the TLS proxy:

| Variant | Override | Env template | Use when |
| --- | --- | --- | --- |
| Bundled Caddy | `docker-compose.hosted.yml` | `.env.hosted.example` | The server has nothing on ports 80/443; Caddy gets the certificates. |
| Existing Traefik | `docker-compose.traefik.yml` | `.env.traefik.example` | Traefik already terminates TLS on the server ([below](#with-an-existing-traefik)); Caddy is not started. |

Both behave the same towards testers and wallets:

| | Local (`docker-compose.yml`) | Hosted (`+ docker-compose.hosted.yml`) |
| --- | --- | --- |
| Hostnames | `localhost:8443`, `localhost:3443` | `QA_HOST`, `EUDIPLO_HOST` on port 443 |
| TLS | Caddy internal CA, test root on every device | Let's Encrypt via Caddy or your Traefik, nothing to install |
| EUDIPLO tenant config | committed `eudiplo-config/` | the same, from the image, plus the deployment's overlay (`QA_FIXTURES_DIR/overlay`) |
| Key chains | committed, for `localhost` | in the overlay: generated for `EUDIPLO_HOST`, or the deployment's own |
| `/trust` on Wallet QA | committed `public/trust/` | `QA_FIXTURES_DIR/public` |
| Wallet QA page and API | open on `localhost` | basic auth (one team login); wallet-facing paths and the published results stay open |
| EUDIPLO management API (`/api`) | on `localhost` | blocked at the proxy; only Wallet QA reaches it inside the stack |
| EUDIPLO database | lost on `down` | `eudiplo-db` volume |

## Requirements

- A Linux VM with Docker Engine and the Compose plugin (2.24 or later), 2 vCPU and 4 GB RAM
  are plenty.
- Two DNS names pointing at it, for example `conformance.eudiplo.dev` (Wallet QA) and
  `issuer.conformance.eudiplo.dev` (EUDIPLO).
- Ports 80 and 443 open to the internet (Let's Encrypt and the wallets), served either by the
  bundled Caddy or by your existing Traefik.

## 1. Generate the trust material

On a trusted machine with Node and OpenSSL, in a checkout of this repository:

```sh
pnpm install
pnpm fixtures:generate issuer.conformance.eudiplo.dev ../wallet-qa-fixtures
```

This creates:

| Directory | Content | Where it goes |
| --- | --- | --- |
| `overlay/` | the key chains (private keys) per tenant | the server, `QA_FIXTURES_DIR/overlay`; add your own files here (next section) |
| `config/` | the whole tenant config with these key chains | not needed for hosting (it updates `eudiplo-config/` for local use) |
| `public/` | root certificate, `trust.json`, leaf certificates | the server, `QA_FIXTURES_DIR/public` |
| `ca/` | the root CA's private key | offline backup only; not needed to run |

Never commit the output. Regenerating is cheap: run the generator again, replace `public/` and
the key chains in `overlay/` (keep your own files there) and restart.

## What a deployment changes

The repository holds the complete EUDIPLO config, and it works as it is wherever the wallet
trusts the generated Wallet QA test root. A deployment for a real wallet trust setup changes
only what git cannot hold, in **`QA_FIXTURES_DIR/overlay`**. Its layout is
`<tenant>/<path in the tenant config>`; at startup every file there replaces (or adds) the file
at the same path in the tenant config from git (`scripts/eudiplo-entrypoint.sh`, logged as
`[config-overlay] …`). Everything else, including new tests, keeps coming from git.

| What | File in the overlay | When |
| --- | --- | --- |
| Key chains for your hostname | `<tenant>/key-chains/*.json` | Always; the generator writes them. |
| **Access certificate** the wallet trusts | `base/key-chains/access.json`: keep `spec.id` (`access`) and the key, put the chain your registrar or PKI issued for that key in `spec.crt` (leaf first). Create the CSR from the generated key (below), or replace `keySource` with your own key. | When wallets should trust your registrar instead of the Wallet QA test root. |
| **Registration certificates** | `base/presentation/<config>.json`: a copy of the presentation config from git with `"registration_cert": { "jwt": "<registration certificate>" }` added. | For every presentation that should carry one. See the limitation below. |
| Registrar account | `base/registrar.json` (EUDIPLO's `RegistrarConfig`: `registrarUrl`, `oidcUrl`, `clientId`, `username`, `password`) | Only needed for registration certificates (below). |
| Issuer certificates | `<tenant>/key-chains/attestation.json`, `status-list.json`, `trust-list.json` | When wallets should trust the issuer through your own PKI instead of the test root. |

A CSR for the generated access key, to send to your registrar:

```sh
node -e 'const fs=require("fs");const k=JSON.parse(fs.readFileSync(process.argv[1])).spec.keySource.jwk;process.stdout.write(require("crypto").createPrivateKey({key:k,format:"jwk"}).export({type:"pkcs8",format:"pem"}))' \
  /srv/wallet-qa/fixtures/overlay/base/key-chains/access.json > access.key
openssl req -new -key access.key -subj '/CN=<verifier name>' -out access.csr && rm access.key
```

Leave alone what the tests depend on being broken: `base/key-chains/access-untrusted.json`
must stay chained to the untrusted root, or R-ACCESS-UNTRUSTED passes for the wrong reason.
A copied presentation config replaces the one from git completely, so compare it after a
`git pull` that changed the original.

**Limitation in EUDIPLO:** a presentation request only carries its `registration_cert`,
even a pre-issued `jwt`, when the tenant has a registrar configuration, and importing
`registrar.json` checks the account against the registrar. Without a reachable registrar
account, registration certificates are silently left out. The pre-issued JWT itself is used
as given. Lifting that check in EUDIPLO would make registration certificates work without
any registrar API.

After a restart, **This instance** on the start page shows who issued each tenant's access
certificate (`/v1/environment`, `tenants`), so you and the testers can see whether the
instance matches the wallet's trust.

## 2. Configure the server

```sh
git clone <wallet-qa repository> /srv/wallet-qa/app
mkdir -p /srv/wallet-qa/fixtures
# copy overlay/ and public/ from step 1 into /srv/wallet-qa/fixtures, then add your own
# files to overlay/ (see "What a deployment changes")
cd /srv/wallet-qa/app
cp .env.hosted.example .env.hosted
```

Fill in `.env.hosted`: both hostnames, `ACME_EMAIL`, `QA_FIXTURES_DIR=/srv/wallet-qa/fixtures`,
two fresh secrets (`openssl rand -hex 32` each) and the team login:

```sh
docker run --rm caddy:2.10.2-alpine caddy hash-password --plaintext '<password>'
```

Put the output into `QA_AUTH_HASH` **in single quotes** (it contains `$`), and the user name
into `QA_AUTH_USER`. Keep the file readable only by the deploying user.

## 3. Start and check

```sh
docker compose -p wallet-qa --env-file .env.hosted \
  -f docker-compose.yml -f docker-compose.hosted.yml up --build -d --wait
```

Caddy requests the certificates on the first request to each hostname; give it a minute.
Then:

```sh
curl -s https://conformance.eudiplo.dev/health/ready
curl -s -o /dev/null -w '%{http_code}\n' https://conformance.eudiplo.dev/                   # 401
curl -s -o /dev/null -w '%{http_code}\n' -u 'qa:<password>' https://conformance.eudiplo.dev/ # 200
curl -s https://conformance.eudiplo.dev/trust/trust.json      # eudiploHost = your EUDIPLO_HOST
curl -s -o /dev/null -w '%{http_code}\n' https://issuer.conformance.eudiplo.dev/api/version   # 404
EUDIPLO_BASE_URL=http://localhost:3000 EUDIPLO_PUBLIC_URL=https://issuer.conformance.eudiplo.dev pnpm smoke
```

`pnpm smoke` needs `pnpm install` on the server and starts (and deletes) one EUDIPLO session
per test step. Finally open the page and check **This instance**: each tenant's access
certificate should be issued by what your wallets trust.

## With an existing Traefik

If Traefik already terminates TLS on the server, use `docker-compose.traefik.yml` instead of
`docker-compose.hosted.yml`. Caddy is not started; EUDIPLO and Wallet QA join Traefik's Docker
network and carry labels that do what `deploy/Caddyfile.hosted` does:

| Router | Rule | Middleware |
| --- | --- | --- |
| `wallet-qa-open` | `QA_HOST` and `/protocol/`, `/trust/`, `/health/`, `/r/`, `/results`, `/web/`, `/v1/published` (priority 200) | none: wallets call these, and the results page is public |
| `wallet-qa` | `QA_HOST` (priority 100) | `wallet-qa-auth` (basic auth) |
| `wallet-qa-eudiplo` | `EUDIPLO_HOST` and not `/api` | none; `/api` has no router, so Traefik answers 404 |

Your Traefik needs the Docker provider (`exposedByDefault=false` is fine, the services set
`traefik.enable=true`), an HTTPS entrypoint and a certificate resolver. Name them in
`.env.traefik` (copy of `.env.traefik.example`): `TRAEFIK_NETWORK` (the external Docker network
Traefik is attached to, default `traefik`), `TRAEFIK_ENTRYPOINT` (default `websecure`) and
`TRAEFIK_CERTRESOLVER` (default `letsencrypt`). The rest of `.env.traefik` is as in step 2:
hostnames, `QA_FIXTURES_DIR`, the two EUDIPLO secrets and the login. For the hash,
`htpasswd -nbB qa '<password>' | cut -d: -f2` works as well as `caddy hash-password`; keep it
in single quotes.

```sh
docker compose -p wallet-qa --env-file .env.traefik \
  -f docker-compose.yml -f docker-compose.traefik.yml up --build -d --wait
```

Then run the checks of step 3; they are the same. If you route HTTP to HTTPS in Traefik, do it
on the entrypoint; the routers here only listen on `TRAEFIK_ENTRYPOINT`.

## Updating

```sh
git pull
docker compose -p wallet-qa --env-file .env.hosted \
  -f docker-compose.yml -f docker-compose.hosted.yml up --build -d --wait
```

(With Traefik: `.env.traefik` and `docker-compose.traefik.yml`.) Runs, workspaces (`qa-data`),
EUDIPLO's database (`eudiplo-db`) and, with Caddy, its certificates (`caddy-data`) are volumes
and survive. EUDIPLO re-imports the tenant config on every start.
To move to a new EUDIPLO version, change `EUDIPLO_VERSION` and run `pnpm smoke` afterwards.

Back up the `qa-data` volume if run history matters; everything else can be rebuilt.

### Unprivileged containers

Wallet QA and its EUDIPLO image run as the unprivileged `node` user (uid 1000). Named Docker
volumes created by these images already belong to it. Two cases need a hand:

- **Volumes created by an older Wallet QA** (before the containers ran as `node`) belong to
  root. Give them to uid 1000 once:

  ```sh
  for v in wallet-qa_qa-data wallet-qa_eudiplo-db wallet-qa_eudiplo-uploads; do
    docker run --rm -v "$v:/v" alpine chown -R 1000:1000 /v
  done
  ```

- **Bind mounts** (the overlay, or data directories you mount yourself) must be readable, and
  data directories writable, by uid 1000. The generator writes the overlay with mode 600, so
  either own it as uid 1000 (`chown -R 1000:1000 "$QA_FIXTURES_DIR"`) or, with rootless Podman,
  map your user to uid 1000 in the container (`UserNS=keep-id:uid=1000,gid=1000` in a Quadlet,
  `--userns keep-id:uid=1000,gid=1000` with `podman run`).

## Access and abuse

- The Wallet QA page and API need the team login (basic auth). To change it, set a new hash
  and run the `up` command again. Inside the instance, a workspace link is still the access
  right to that workspace.
- Open without login, because wallets call them: `/protocol/*` (fault request objects),
  `/trust/*`, `/health/*`, `/r/*` (redirects to the workspace page, which asks for the login),
  and the EUDIPLO hostname apart from `/api`.
- Open without login by design: the published results page and its feed (`/results`,
  `/v1/published`), and the page's bundle under `/web/` that `/results` loads. The bundle is
  the same static code for every visitor and holds no data. Publishing, uploads and removal
  stay behind the login.
- The login is optional. Without it (remove the basic auth middleware from the proxy, as
  `conformance.eudiplo.dev` does), anyone with the address can create workspaces, publish and
  upload; workspace retention and `QA_PUBLISHED_MAX` bound what they can store, and removal
  still needs `QA_ADMIN_TOKEN`.
- Published results stay until removed. Set `QA_ADMIN_TOKEN` (at least 32 characters,
  `openssl rand -hex 32`) to remove one with
  `curl -u 'qa:<password>' -X DELETE -H "Authorization: Bearer $QA_ADMIN_TOKEN" https://$QA_HOST/v1/published/<id>`.
  Removal requests come in as issues in EUDIPLO/wallet-qa.
- Workspaces and runs are deleted after `QA_RETENTION_HOURS` without use.
- Credentials issued here are test credentials; they are worthless outside wallets that
  trust the instance.
- The EUDIPLO client secrets in `eudiplo-config/*/clients` are public. That is safe only
  because `/api` is blocked at the proxy; keep that block if you change the Caddyfile or the
  Traefik labels. Wallet QA's
  clients have `presentation:manage` so they can read the key chains for **This instance**.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Caddy has no certificate | DNS points at the server, ports 80/443 are open, `docker compose -p wallet-qa logs caddy`. |
| Wallets reject presentation requests | **This instance** on the start page: is the access certificate issued by what the wallet trusts? Check `overlay/base/key-chains/access.json` and the `[config-overlay]` lines in `docker compose -p wallet-qa logs eudiplo`. |
| Requests carry no registration certificate | EUDIPLO needs the tenant's `registrar.json` for that (see *What a deployment changes*). |
| The browser keeps asking for the login | Wrong user or hash; the hash must be in single quotes in `.env.hosted`. |
| `Certificate validation failed` in EUDIPLO logs | An access certificate expired: generated ones last 365 days (regenerate), your own as long as your registrar issued them. |
| EUDIPLO does not start after a config change | `docker compose -p wallet-qa logs eudiplo`; the import aborts on unknown variables or invalid files. |
