import {
  credentialOfferControllerGetOffer,
  verifierOfferControllerGetOffer,
  sessionControllerGetSession,
} from '@eudiplo/sdk-core';
import { createClient } from '@eudiplo/sdk-core/api/client/index';
import {
  createHash,
  createPublicKey,
  verify,
  X509Certificate,
} from 'node:crypto';
import type { SessionEvidence, StepDefinition } from './types.js';
export interface Backend {
  start(
    step: StepDefinition,
  ): Promise<{
    sessionId: string;
    uri: string;
    crossDeviceUri?: string;
    /** dc-api steps: the signed request object for navigator.credentials.get. */
    dcApi?: { request: string };
  }>;
  session(id: string): Promise<SessionEvidence>;
  deleteSession(id: string): Promise<void>;
  /** Sets the status-list entry of every credential issued in the session (0 valid, 1 revoked, 2 suspended). */
  setStatus(sessionId: string, status: 0 | 1 | 2): Promise<void>;
  health(): Promise<void>;
  requestObject(uri: string, method: string, body?: string): Promise<string>;
  /**
   * Forwards what the Digital Credentials API returned in the browser to the
   * verifier's response endpoint. Returns the verifier's HTTP status.
   */
  dcApiResponse?(responseUri: string, body: DcApiResponse): Promise<number>;
  /** PEM chain of the tenant's access key chain, or null when it does not exist. */
  accessCertificate?(keyId: string): Promise<string | null>;
}
/** The wallet's answer over the Digital Credentials API: an encrypted response or an OAuth error. */
export type DcApiResponse =
  | { response: string }
  | { error: string; error_description?: string };
/** OpenID4VP 1.0 Digital Credentials API protocol identifier for signed requests. */
export const DC_API_PROTOCOL = 'openid4vp-v1-signed';
export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export function normalizeSession(value: unknown): SessionEvidence {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid EUDIPLO session');
  const session = value as Record<string, unknown>;
  if (
    !['active', 'fetched', 'completed', 'expired', 'failed'].includes(
      String(session.status),
    )
  )
    throw new Error('Unsupported EUDIPLO session status');
  // EUDIPLO (since 8.x) serializes unset columns as null rather than omitting them.
  const credentials = session.credentials ?? undefined;
  if (
    credentials !== undefined &&
    (!Array.isArray(credentials) ||
      !credentials.every(
        (c) => c && typeof c === 'object' && !Array.isArray(c),
      ))
  )
    throw new Error('Unsupported EUDIPLO credential evidence');
  // EUDIPLO records OAuth error responses in errorReason, without failureCode.
  // Keep only the protocol error identifier, never the free-form description.
  const walletErrorCode =
    typeof session.errorReason === 'string'
      ? /^Wallet error: ([a-zA-Z0-9_]+)(?::|$)/.exec(session.errorReason)?.[1]
      : undefined;
  // EUDIPLO (since 8.x) keeps an issuance session at "fetched" after the credential was
  // issued and only moves it to "completed" once the wallet posts a
  // credential_accepted notification. Wallets with DPoP-bound tokens currently
  // send that notification without a DPoP proof and EUDIPLO rejects it, so the
  // session would never complete. A notification entry exists only after EUDIPLO
  // issued the credential, so delivery counts as completion of the issuance step;
  // the UI test asserts storage on the wallet side. A failure notification that
  // did get through still fails the step.
  let status = session.status as SessionEvidence['status'];
  const notifications = Array.isArray(session.notifications)
    ? (session.notifications as Record<string, unknown>[])
    : [];
  if (status === 'fetched' && notifications.length) {
    status = notifications.some((n) =>
      ['credential_failure', 'credential_deleted'].includes(String(n?.event)),
    )
      ? 'failed'
      : 'completed';
  }
  // Deliberately exclude tokens, request objects, encryption keys and tenant credentials.
  return {
    status,
    failureCode:
      typeof session.failureCode === 'string' ? session.failureCode : undefined,
    walletErrorCode,
    credentials: credentials as SessionEvidence['credentials'],
  };
}
export class EudiploBackend implements Backend {
  private client: ReturnType<typeof createClient>;
  private token?: string;
  private expiresAt = 0;
  private authenticating?: Promise<string>;
  constructor(
    private config: {
      id: string;
      baseUrl: string;
      publicUrl: string;
      clientId: string;
      clientSecret: string;
      tenantId?: string;
      origin: string;
      redirectUri: string;
    },
  ) {
    this.client = createClient({
      baseUrl: config.baseUrl,
      throwOnError: true,
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
    });
  }
  private async authenticate(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt) return this.token;
    if (this.authenticating) return this.authenticating;
    this.authenticating = this.fetchToken();
    try {
      return await this.authenticating;
    } finally {
      this.authenticating = undefined;
    }
  }
  private async fetchToken() {
    const destination = `${this.config.baseUrl}/api/oauth2/token`;
    // A hosted EUDIPLO on a sleeping free tier needs up to a minute to wake and
    // answers with gateway errors or hangs meanwhile. The token request is the
    // first contact of every run, so it absorbs that wake-up with a bounded retry.
    const attempts = 5;
    let response: Response;
    for (let attempt = 1; ; attempt++) {
      try {
        response = await fetch(destination, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(20000),
          body: JSON.stringify({
            grant_type: 'client_credentials',
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
          }),
        });
      } catch (error) {
        const timedOut = error instanceof Error && error.name === 'TimeoutError';
        if (timedOut && attempt < attempts) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }
        console.error(
          `EUDIPLO authentication request failed (profile ${this.config.id}, tenant ${this.config.tenantId}, client ${this.config.clientId}, destination ${destination}): ${error instanceof Error ? error.name : 'unknown error'}`,
        );
        throw error;
      }
      if ([502, 503, 504].includes(response.status) && attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }
      break;
    }
    if (!response.ok) {
      console.error(
        `EUDIPLO authentication failed (profile ${this.config.id}, tenant ${this.config.tenantId}, client ${this.config.clientId}, destination ${destination}, HTTP ${response.status})`,
      );
      throw new Error('EUDIPLO authentication failed');
    }
    const data = (await response.json()) as {
      access_token?: unknown;
      expires_in?: unknown;
    };
    if (
      typeof data.access_token !== 'string' ||
      typeof data.expires_in !== 'number' ||
      !Number.isFinite(data.expires_in) ||
      data.expires_in <= 0
    )
      throw new Error('Invalid EUDIPLO token response');
    if (this.config.tenantId) {
      // The token came from this profile's authenticated backend. Check its tenant
      // claim to detect accidentally configured root or other-tenant credentials.
      const payload = JSON.parse(
        Buffer.from(data.access_token.split('.')[1], 'base64url').toString(),
      );
      if (payload.tenant_id !== this.config.tenantId)
        throw new Error('EUDIPLO client belongs to a different tenant');
    }
    this.token = data.access_token;
    this.expiresAt = Date.now() + Math.max(0, data.expires_in - 30) * 1000;
    return this.token;
  }
  async start(step: StepDefinition) {
    const headers = { Authorization: `Bearer ${await this.authenticate()}` };
    if (step.kind === 'issuance') {
      const credentialClaims =
        step.claims &&
        Object.fromEntries(
          Object.entries(step.claims).map(([id, claims]) => [
            id,
            { type: 'inline' as const, claims },
          ]),
        );
      // authorization_server selects a tenant authorization server (e.g. an oid4vp
      // PID check); the pinned SDK type predates the field, hence the cast.
      const body = {
        credentialConfigurationIds: step.credentialConfigurationIds!,
        credentialClaims,
        flow: step.flow ?? 'pre_authorized_code',
        tx_code: step.txCode,
        response_type: 'uri' as const,
        ...(step.authorizationServer
          ? { authorization_server: step.authorizationServer }
          : {}),
      };
      const response = await credentialOfferControllerGetOffer({
        client: this.client,
        headers,
        body: body as Parameters<
          typeof credentialOfferControllerGetOffer
        >[0]['body'],
      });
      if (!response.data)
        throw new Error('EUDIPLO did not create an issuance offer');
      return { sessionId: response.data.session, uri: response.data.uri! };
    }
    const dcApi = step.channel === 'dc-api';
    const response = await verifierOfferControllerGetOffer({
      client: this.client,
      headers,
      // The wallet checks the calling page's origin against expected_origins, so a
      // dc-api request is bound to the Wallet QA page that will hand it over.
      body: dcApi
        ? {
            requestId: step.configId!,
            response_type: 'dc-api',
            expected_origin: this.config.origin,
          }
        : {
            requestId: step.configId!,
            response_type: 'uri',
            redirectUri: this.config.redirectUri,
          },
    });
    if (!response.data)
      throw new Error('EUDIPLO did not create a presentation request');
    if (dcApi) {
      const session = await sessionControllerGetSession({
        client: this.client,
        path: { id: response.data.session },
        headers,
      });
      const request = (session.data as { requestObject?: unknown } | undefined)
        ?.requestObject;
      if (typeof request !== 'string' || request.split('.').length !== 3)
        throw new Error('EUDIPLO did not return a signed DC API request');
      return {
        sessionId: response.data.session,
        uri: response.data.uri!,
        dcApi: { request },
      };
    }
    return {
      sessionId: response.data.session,
      uri: response.data.uri!,
      crossDeviceUri: response.data.crossDeviceUri ?? response.data.uri,
    };
  }
  async session(id: string) {
    const response = await sessionControllerGetSession({
      client: this.client,
      path: { id },
      headers: { Authorization: `Bearer ${await this.authenticate()}` },
    });
    return normalizeSession(response.data);
  }
  async deleteSession(id: string) {
    const response = await fetch(
      `${this.config.baseUrl}/api/session/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${await this.authenticate()}` },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok && response.status !== 404)
      throw new Error('EUDIPLO session cleanup failed');
  }
  async setStatus(sessionId: string, status: 0 | 1 | 2) {
    const response = await fetch(`${this.config.baseUrl}/api/session/revoke`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.authenticate()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionId, status }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new Error(`EUDIPLO status update failed (HTTP ${response.status})`);
  }
  private async admin(route: string, init: RequestInit = {}) {
    return fetch(`${this.config.baseUrl}/api/${route}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${await this.authenticate()}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      signal: AbortSignal.timeout(30000),
    });
  }
  async accessCertificate(keyId: string) {
    const response = await this.admin(`key-chain/${encodeURIComponent(keyId)}`);
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(`Reading key chain ${keyId} failed (HTTP ${response.status})`);
    // EUDIPLO 8.1 and later: { activeCertificate: { pem, subject, issuer, notAfter, ... } }
    const data = (await response.json()) as { activeCertificate?: { pem?: unknown } | null };
    const pem = data.activeCertificate?.pem;
    return typeof pem === 'string' ? pem : null;
  }
  async health() {
    if (!this.config.clientId || !this.config.clientSecret)
      throw new Error('EUDIPLO credentials are missing');
    const response = await fetch(`${this.config.baseUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error('EUDIPLO is unavailable');
    await this.authenticate();
  }
  /** Maps a wallet-facing EUDIPLO URI to the internal address; refuses any other origin. */
  private internalUrl(uri: string, what: string) {
    const publicUri = new URL(uri);
    const allowed = new URL(this.config.publicUrl);
    if (
      publicUri.origin !== allowed.origin ||
      publicUri.username ||
      publicUri.password
    )
      throw new Error(`Unexpected ${what} origin`);
    const internal = new URL(this.config.baseUrl);
    // Only an EUDIPLO-issued URI can enter this method. No arbitrary URL input API exists.
    internal.pathname = publicUri.pathname;
    internal.search = publicUri.search;
    return internal;
  }
  async dcApiResponse(responseUri: string, body: DcApiResponse) {
    const response = await fetch(this.internalUrl(responseUri, 'response'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // sendResponse: false keeps the verified claims out of the reply; the
      // engine reads them from the session like for every other presentation.
      body: JSON.stringify({ ...body, sendResponse: false }),
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    return response.status;
  }
  async requestObject(uri: string, method: string, body?: string) {
    const internal = this.internalUrl(uri, 'request-object');
    const response = await fetch(internal, {
      method,
      body: method === 'POST' ? body : undefined,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new Error('Could not fetch the EUDIPLO request object');
    const jwt = await response.text();
    if (jwt.length > 262144) throw new Error('Request object is too large');
    return jwt;
  }
}
export function corruptSignature(jwt: string) {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Expected a signed compact JWT');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  if (header.alg !== 'ES256')
    throw new Error('Signature fixture currently requires ES256');
  let key;
  if (Array.isArray(header.x5c) && typeof header.x5c[0] === 'string') {
    const cert = new X509Certificate(Buffer.from(header.x5c[0], 'base64'));
    if (
      Date.now() < Date.parse(cert.validFrom) ||
      Date.now() >= Date.parse(cert.validTo)
    )
      throw new Error(
        'Baseline signing certificate is outside its validity period',
      );
    key = cert.publicKey;
  } else if (header.jwk && typeof header.jwk === 'object' && !header.jwk.d) {
    key = createPublicKey({ key: header.jwk, format: 'jwk' });
  } else throw new Error('Request has no embedded verification key');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (typeof payload.exp === 'number' && payload.exp <= Date.now() / 1000)
    throw new Error('Baseline request is expired');
  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2], 'base64url');
  const options = { key, dsaEncoding: 'ieee-p1363' as const };
  if (
    signature.length !== 64 ||
    !verify('sha256', signingInput, options, signature)
  )
    throw new Error('Baseline request signature is invalid');
  signature[0] ^= 1;
  if (verify('sha256', signingInput, options, signature))
    throw new Error('Signature mutation did not activate');
  const mutated = `${parts[0]}.${parts[1]}.${signature.toString('base64url')}`;
  return {
    jwt: mutated,
    originalSha256: digest(jwt),
    mutatedSha256: digest(mutated),
  };
}
