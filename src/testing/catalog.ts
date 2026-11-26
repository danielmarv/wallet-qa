import type {
  ClaimPath,
  ManualCheck,
  Scenario,
  StepDefinition,
} from './types.js';

// Test catalog. IDs follow docs/design.md section 1. Each entry says
// what EUDIPLO is asked to do (steps), what the server checks on its own
// (expected, disclosures), and what the tester confirms (manual).
export const CATALOG_VERSION = '3.1.0';

const PID_NS = 'eu.europa.ec.eudi.pid.1';
const P = (...path: string[]): ClaimPath => path;

/** Every top-level claim of the QA PID (dc+sd-jwt), see issuance/credentials/pid.json. */
const QA_PID_SDJWT_CLAIMS = [
  'family_name',
  'given_name',
  'birthdate',
  'address',
  'place_of_birth',
  'nationalities',
  'age_equal_or_over',
  'age_in_years',
  'age_birth_year',
  'issuing_authority',
  'issuing_country',
  'source_document_type',
];
/** Every data element of the QA PID (mso_mdoc), see issuance/credentials/pid-mdoc.json. */
const QA_PID_MDOC_ELEMENTS = [
  'family_name',
  'given_name',
  'birth_date',
  'age_over_12',
  'age_over_14',
  'age_over_16',
  'age_over_18',
  'age_over_21',
  'age_over_65',
  'age_in_years',
  'age_birth_year',
  'family_name_birth',
  'birth_place',
  'nationality',
  'resident_street',
  'resident_postal_code',
  'resident_city',
  'resident_country',
  'issuing_authority',
  'issuing_country',
];

// Reusable checklist questions.
const cardShown: ManualCheck = {
  id: 'card-shown',
  ask: 'Is the new credential shown in the wallet with its name and card image?',
  expect: 'yes',
};
const claimsShown: ManualCheck = {
  id: 'claims-shown',
  ask: 'Does the credential detail view show every attribute with a readable label?',
  expect: 'yes',
  blocking: false,
};
const verifierShown: ManualCheck = {
  id: 'verifier-shown',
  ask: 'Did the consent screen name the verifier and list exactly the requested attributes?',
  expect: 'yes',
};
const refusedWithReason: ManualCheck = {
  id: 'refused',
  ask: 'Did the wallet refuse the request and tell you why?',
  expect: 'yes',
};
const noDataOffered: ManualCheck = {
  id: 'no-data',
  ask: 'Did the wallet offer to share any of your data?',
  expect: 'no',
  blocking: false,
};
const errorShown: ManualCheck = {
  id: 'error-shown',
  ask: 'Did the wallet show an understandable error and return to a usable state?',
  expect: 'yes',
};
const noCrash: ManualCheck = {
  id: 'no-crash',
  ask: 'Did the wallet crash, freeze or need a restart?',
  expect: 'no',
};

const LOYALTY_CLAIMS = {
  issuing_country: 'DE',
  member_id: 'generated-per-run',
  membership_tier: 'Silver',
  organization_name: 'Wallet QA Test Club',
};
const issueLoyalty = (
  id = 'issue',
  credential = 'loyalty-card',
  backendProfile = 'default',
): StepDefinition => ({
  id,
  kind: 'issuance',
  backendProfile,
  credentialConfigurationIds: [credential],
  flow: 'pre_authorized_code',
  expected: 'completed',
  claims: { [credential]: { ...LOYALTY_CLAIMS } },
  instruction:
    'Scan the QR code or open the link with the wallet and accept the credential.',
});
const issueEvent = (id = 'issue'): StepDefinition => ({
  id,
  kind: 'issuance',
  backendProfile: 'default',
  credentialConfigurationIds: ['event-access-attestation'],
  flow: 'pre_authorized_code',
  txCode: '1234',
  expected: 'completed',
  claims: {
    'event-access-attestation': {
      event_name: 'Wallet QA Conference',
      event_date: 'generated-per-run',
      event_location: 'Berlin Convention Center',
      access_type: 'full_access',
      verified_at: 'generated-per-run',
      valid_until: 'generated-per-run',
    },
  },
  instruction:
    'Open the offer in the wallet and enter the transaction code shown here.',
});
const issue = (
  credentialConfigurationIds: string[],
  extra: Partial<StepDefinition> = {},
): StepDefinition => ({
  id: 'issue',
  kind: 'issuance',
  backendProfile: 'default',
  credentialConfigurationIds,
  flow: 'pre_authorized_code',
  expected: 'completed',
  instruction: 'Open the offer in the wallet and accept the credential.',
  ...extra,
});
const present = (
  configId: string,
  extra: Partial<StepDefinition> = {},
): StepDefinition => ({
  id: 'present',
  kind: 'presentation',
  backendProfile: 'default',
  configId,
  expected: 'completed',
  instruction:
    'Scan the QR code or open the link with the wallet and share the requested data.',
  ...extra,
});
const reject = (
  configId: string,
  codes: string[],
  instruction: string,
): StepDefinition => ({
  id: 'reject',
  kind: 'presentation',
  backendProfile: 'default',
  configId,
  expected: 'rejected',
  backendErrorCodes: codes,
  rejectionReason: codes[0],
  instruction,
});
/** The same request as present(), handed over by the browser's Digital Credentials API. */
const presentDcApi = (
  configId: string,
  extra: Partial<StepDefinition> = {},
): StepDefinition =>
  present(configId, {
    channel: 'dc-api',
    instruction:
      'Press "Request with Digital Credentials API", pick the wallet in the browser\'s dialog and share the requested data.',
    ...extra,
  });
const DC_API_PREREQS = [
  'Wallet QA is open in a browser with the Digital Credentials API: on the phone with the wallet, or on a desktop browser that reaches the phone cross-device.',
  'The wallet is registered with the operating system as a provider of digital credentials.',
];
const dcApiDialog: ManualCheck = {
  id: 'dc-api-dialog',
  ask: 'Did the browser or operating system offer the wallet for this request, without a QR code or link?',
  expect: 'yes',
};
const QA_PID_PREREQ =
  'The wallet build accepts a PID from the Wallet QA issuer (dev trust anchor installed).';

type Entry = Omit<Scenario, 'version' | 'availability'> &
  Partial<Pick<Scenario, 'availability'>>;
const entries: Entry[] = [
  // ---------------------------------------------------------------- Issuance
  {
    id: 'I-PID-SDJWT',
    section: 'Issuance',
    label: 'Issue QA PID (dc+sd-jwt), all attributes',
    description:
      'Issues the Wallet QA test PID with every claim, including nested address, place of birth and age claims.',
    profile: 'oid4vci-1.0',
    tags: ['pid', 'dc+sd-jwt', 'positive', 'regression'],
    prerequisites: [QA_PID_PREREQ],
    steps: [issue(['pid'])],
    manual: [cardShown, claimsShown],
  },
  {
    id: 'I-PID-MDOC',
    section: 'Issuance',
    label: 'Issue QA PID (mso_mdoc), all attributes',
    description:
      'Issues the Wallet QA test PID as an mDOC (eu.europa.ec.eudi.pid.1) with every data element.',
    profile: 'oid4vci-1.0',
    tags: ['pid', 'mso_mdoc', 'positive', 'regression'],
    prerequisites: [QA_PID_PREREQ],
    steps: [issue(['pid-mdoc'])],
    manual: [cardShown, claimsShown],
  },
  {
    id: 'I-MIXED',
    section: 'Issuance',
    label: 'Issue QA PID as dc+sd-jwt and mso_mdoc in one offer',
    description: 'One offer containing both PID formats.',
    profile: 'oid4vci-1.0',
    tags: ['pid', 'dc+sd-jwt', 'mso_mdoc', 'positive'],
    prerequisites: [QA_PID_PREREQ],
    steps: [
      issue(['pid', 'pid-mdoc'], {
        instruction: 'Open the offer and accept both credentials.',
      }),
    ],
    manual: [
      {
        id: 'both-shown',
        ask: 'Does the wallet show both PID credentials (or one PID holding both formats)?',
        expect: 'yes',
      },
    ],
  },
  {
    id: 'I-EAA-TX',
    section: 'Issuance',
    label: 'Pre-authorized code with transaction code',
    description:
      'Event access attestation through the pre-authorized code flow; the wallet must ask for the transaction code.',
    profile: 'oid4vci-1.0',
    tags: ['eaa', 'dc+sd-jwt', 'positive', 'regression'],
    prerequisites: [],
    steps: [issueEvent()],
    manual: [
      {
        id: 'tx-asked',
        ask: 'Did the wallet ask for a transaction code before issuing?',
        expect: 'yes',
      },
      cardShown,
    ],
  },
  {
    id: 'I-EAA-TX-WRONG',
    section: 'Issuance',
    label: 'Wrong transaction code, then the right one',
    description:
      'Enter 0000 first. The wallet must report the wrong code and let you retry; then enter the right code.',
    profile: 'oid4vci-1.0',
    tags: ['eaa', 'dc+sd-jwt', 'negative'],
    prerequisites: [],
    steps: [
      {
        ...issueEvent(),
        instruction:
          'Open the offer, enter 0000 first, then the transaction code shown here.',
      },
    ],
    manual: [
      {
        id: 'wrong-reported',
        ask: 'After entering 0000, did the wallet say the code was wrong?',
        expect: 'yes',
      },
      {
        id: 'retry-possible',
        ask: 'Could you enter the right code without restarting the flow?',
        expect: 'yes',
        blocking: false,
      },
      cardShown,
    ],
  },
  {
    id: 'I-EAA-NOTX',
    section: 'Issuance',
    label: 'Pre-authorized code without transaction code',
    description:
      'Loyalty card through the pre-authorized code flow, no transaction code.',
    profile: 'oid4vci-1.0',
    tags: ['eaa', 'dc+sd-jwt', 'positive', 'regression'],
    prerequisites: [],
    steps: [issueLoyalty()],
    manual: [cardShown],
  },
  {
    id: 'I-AUTH-PID',
    section: 'Issuance',
    label: 'Authorization code flow gated by a PID presentation (mDL)',
    description:
      'The driving licence authority first asks for given name, family name and birthdate from the PID, then issues an ISO 18013-5 mDL.',
    profile: 'oid4vci-1.0+oid4vp-1.0',
    tags: ['mdl', 'mso_mdoc', 'authorization-code', 'positive'],
    prerequisites: ['A PID (dc+sd-jwt) is in the wallet.'],
    requires: ['I-PID-SDJWT'],
    steps: [
      issue(['mdl'], {
        flow: 'authorization_code',
        authorizationServer: 'mdl-pid-check',
        claims: {
          mdl: {
            family_name: 'MUSTERMANN',
            given_name: 'ERIKA',
            birth_date: '1964-08-12',
            issue_date: '2026-01-15',
            expiry_date: '2041-01-14',
            issuing_country: 'DE',
            issuing_authority: 'Wallet QA Driving Licence Authority',
            document_number: 'D1234567X',
            un_distinguishing_sign: 'D',
            driving_privileges: [
              {
                vehicle_category_code: 'B',
                issue_date: '2020-05-01',
                expiry_date: '2035-05-01',
              },
            ],
          },
        },
        instruction:
          'Open the offer, share your PID when asked, then accept the driving licence.',
      }),
    ],
    manual: [
      {
        id: 'pid-asked',
        ask: 'Did the wallet ask you to share PID data before issuing the licence?',
        expect: 'yes',
      },
      cardShown,
    ],
  },
  {
    id: 'I-DPOP',
    section: 'Issuance',
    label: 'Issuer requires DPoP',
    description:
      'Loyalty card from a second issuer tenant that requires DPoP-bound tokens.',
    profile: 'oid4vci-1.0',
    tags: ['eaa', 'dc+sd-jwt', 'dpop', 'positive'],
    prerequisites: [],
    steps: [issueLoyalty('issue', 'loyalty-card', 'dpop-v1')],
    manual: [cardShown],
  },
  {
    id: 'I-NOKB',
    section: 'Issuance',
    label: 'Credential without key binding',
    description:
      'The issuer offers a card without a cnf claim. Expected: the wallet refuses it, because it requires holder binding. Change the checklist if the wallet spec says otherwise.',
    profile: 'oid4vci-1.0',
    tags: ['eaa', 'dc+sd-jwt', 'negative'],
    prerequisites: [],
    // A refusing wallet usually sends nothing EUDIPLO could judge.
    fallback: 'attest',
    steps: [
      {
        ...issueLoyalty('issue', 'loyalty-nokb'),
        expected: 'rejected',
        backendErrorCodes: [],
      },
    ],
    manual: [
      {
        id: 'not-stored',
        ask: 'Is the card without key binding missing from the wallet?',
        expect: 'yes',
      },
      errorShown,
    ],
  },
  {
    id: 'I-SHORT-LIFE',
    section: 'Issuance',
    label: 'Credential with 5-minute lifetime',
    description:
      'Issues a loyalty card that expires 5 minutes after issuance. Wait 5 minutes, then check how the wallet shows it.',
    profile: 'oid4vci-1.0',
    tags: ['eaa', 'dc+sd-jwt', 'lifecycle'],
    prerequisites: [],
    steps: [issueLoyalty('issue', 'loyalty-short')],
    manual: [
      cardShown,
      {
        id: 'expired-marked',
        ask: 'After 5 minutes, does the wallet mark the card as expired?',
        expect: 'yes',
      },
    ],
  },
  {
    id: 'I-DISPLAY',
    section: 'Issuance',
    label: 'Display metadata in English and German',
    description:
      'Issue the WD team manual, then switch the phone language between English and German.',
    profile: 'oid4vci-1.0',
    tags: ['eaa', 'dc+sd-jwt', 'display'],
    prerequisites: [],
    steps: [issue(['wd-team-manual'])],
    manual: [
      {
        id: 'logo-background',
        ask: 'Are the issuer logo and the card background image shown?',
        expect: 'yes',
      },
      {
        id: 'labels-en',
        ask: 'With the phone in English, are the credential name and attribute labels English?',
        expect: 'yes',
      },
      {
        id: 'labels-de',
        ask: 'With the phone in German, are the credential name and attribute labels German?',
        expect: 'yes',
      },
    ],
  },
  {
    id: 'I-WIA',
    section: 'Issuance',
    label: 'Issuer requires wallet attestation',
    description: 'Issuer tenant with walletAttestationRequired.',
    profile: 'oid4vci-1.0',
    tags: ['eaa', 'wallet-attestation'],
    prerequisites: [],
    availability: 'unsupported',
    unavailableReason:
      'Needs a tenant that trusts the wallet provider’s attestation keys (qa-issuer-wia).',
    steps: [issueLoyalty()],
  },
  {
    id: 'I-DEFERRED',
    section: 'Issuance',
    label: 'Deferred issuance completed by the tester',
    description:
      'EUDIPLO defers issuance; the tester completes or fails it from the tool.',
    profile: 'oid4vci-1.0',
    tags: ['eaa', 'deferred'],
    prerequisites: [],
    availability: 'unsupported',
    unavailableReason:
      'Deferred issuance needs an issuance webhook in Wallet QA, which it does not provide yet.',
    steps: [issueLoyalty()],
  },

  // ------------------------------------------------------------ Presentation
  {
    id: 'P-PID-ALL-SDJWT',
    section: 'Presentation',
    label: 'QA PID (dc+sd-jwt): all attributes',
    description:
      'Requests every claim of the QA PID, including nested objects. Passes only if all of them came back with the issued values, and nothing else.',
    profile: 'oid4vp-1.0',
    tags: ['pid', 'dc+sd-jwt', 'positive', 'regression'],
    prerequisites: ['The QA PID (dc+sd-jwt) is in the wallet.'],
    requires: ['I-PID-SDJWT'],
    steps: [
      present('qa-pid-all-sd-jwt-vc', {
        disclosures: [
          {
            credentialId: 'pid-sd-jwt',
            present: QA_PID_SDJWT_CLAIMS.map((c) => P(c)),
            equals: [
              { path: P('given_name'), value: 'ERIKA' },
              { path: P('family_name'), value: 'MUSTERMANN' },
              { path: P('address', 'locality'), value: 'KÖLN' },
              { path: P('age_equal_or_over', '18'), value: true },
            ],
            allowedOnly: QA_PID_SDJWT_CLAIMS,
          },
        ],
      }),
    ],
    manual: [verifierShown],
  },
  {
    id: 'P-PID-ALL-MDOC',
    section: 'Presentation',
    label: 'QA PID (mso_mdoc): all attributes',
    description:
      'Requests every data element of the QA PID mDOC. Passes only if all of them came back, and nothing else.',
    profile: 'oid4vp-1.0',
    tags: ['pid', 'mso_mdoc', 'positive', 'regression'],
    prerequisites: ['The QA PID (mso_mdoc) is in the wallet.'],
    requires: ['I-PID-MDOC'],
    steps: [
      present('qa-pid-all-mdoc', {
        disclosures: [
          {
            credentialId: 'pid-mso-mdoc',
            present: QA_PID_MDOC_ELEMENTS.map((e) => P(PID_NS, e)),
            equals: [
              { path: P(PID_NS, 'given_name'), value: 'ERIKA' },
              { path: P(PID_NS, 'age_over_18'), value: true },
            ],
            allowedOnly: QA_PID_MDOC_ELEMENTS,
          },
        ],
      }),
    ],
    manual: [verifierShown],
  },
  {
    id: 'P-PID-ONE-SDJWT',
    section: 'Presentation',
    label: 'QA PID (dc+sd-jwt): given_name only',
    description: 'Selective disclosure of a single claim.',
    profile: 'oid4vp-1.0',
    tags: ['pid', 'dc+sd-jwt', 'positive', 'selective-disclosure'],
    prerequisites: ['The QA PID (dc+sd-jwt) is in the wallet.'],
    requires: ['I-PID-SDJWT'],
    steps: [
      present('qa-pid-one-sd-jwt-vc', {
        disclosures: [
          {
            credentialId: 'pid-sd-jwt',
            equals: [{ path: P('given_name'), value: 'ERIKA' }],
            allowedOnly: ['given_name'],
          },
        ],
      }),
    ],
    manual: [verifierShown],
  },
  {
    id: 'P-PID-ONE-MDOC',
    section: 'Presentation',
    label: 'QA PID (mso_mdoc): given_name only',
    description: 'Selective disclosure of a single data element.',
    profile: 'oid4vp-1.0',
    tags: ['pid', 'mso_mdoc', 'positive', 'selective-disclosure'],
    prerequisites: ['The QA PID (mso_mdoc) is in the wallet.'],
    requires: ['I-PID-MDOC'],
    steps: [
      present('qa-pid-one-mdoc', {
        disclosures: [
          {
            credentialId: 'pid-mso-mdoc',
            equals: [{ path: P(PID_NS, 'given_name'), value: 'ERIKA' }],
            allowedOnly: ['given_name'],
          },
        ],
      }),
    ],
    manual: [verifierShown],
  },
  {
    id: 'P-PID-AGE-SDJWT',
    section: 'Presentation',
    label: 'PID (dc+sd-jwt): age over 18 only',
    description:
      'Only age_equal_or_over.18 may be disclosed; birthdate must stay hidden. Works with the QA PID and the PID provider’s PID.',
    profile: 'oid4vp-1.0',
    tags: ['pid', 'dc+sd-jwt', 'positive', 'selective-disclosure', 'regression'],
    prerequisites: ['A PID (dc+sd-jwt) is in the wallet.'],
    steps: [
      present('pid-age-over-sd-jwt-vc', {
        disclosures: [
          {
            credentialId: 'pid-sd-jwt',
            equals: [{ path: P('age_equal_or_over', '18'), value: true }],
            absent: [P('birthdate'), P('age_in_years'), P('age_birth_year')],
            allowedOnly: ['age_equal_or_over'],
          },
        ],
      }),
    ],
    manual: [verifierShown],
  },
  {
    id: 'P-PID-AGE-MDOC',
    section: 'Presentation',
    label: 'QA PID (mso_mdoc): age over 18 only',
    description: 'Only age_over_18 may be disclosed; birth_date must stay hidden.',
    profile: 'oid4vp-1.0',
    tags: ['pid', 'mso_mdoc', 'positive', 'selective-disclosure', 'regression'],
    prerequisites: ['The QA PID (mso_mdoc) is in the wallet.'],
    requires: ['I-PID-MDOC'],
    steps: [
      present('qa-pid-age-over-mdoc', {
        disclosures: [
          {
            credentialId: 'pid-mso-mdoc',
            equals: [{ path: P(PID_NS, 'age_over_18'), value: true }],
            absent: [P(PID_NS, 'birth_date')],
            allowedOnly: ['age_over_18'],
          },
        ],
      }),
    ],
    manual: [verifierShown],
  },
  {
    id: 'P-PID-EITHER',
    section: 'Presentation',
    label: 'QA PID as dc+sd-jwt or mso_mdoc, wallet picks',
    description: 'credential_sets with one option per format.',
    profile: 'oid4vp-1.0',
    tags: ['pid', 'dc+sd-jwt', 'mso_mdoc', 'positive', 'credential-sets'],
    prerequisites: ['A QA PID in at least one format is in the wallet.'],
    steps: [present('qa-pid-either')],
    manual: [verifierShown],
  },
  {
    id: 'P-PID-PROVIDER-SDJWT',
    section: 'Presentation',
    label: 'PID provider PID (dc+sd-jwt): primary attributes',
    description:
      'Name, birthdate, address, nationality and age claims of a PID from the PID provider test environment. Values are not checked.',
    profile: 'oid4vp-1.0',
    tags: ['pid', 'dc+sd-jwt', 'positive', 'pid-provider'],
    prerequisites: [
      'A PID from the PID provider test environment is in the wallet.',
    ],
    steps: [present('pid-disclose-all-sd-jwt-vc')],
    manual: [verifierShown],
  },
  {
    id: 'P-PID-PROVIDER-MDOC',
    section: 'Presentation',
    label: 'PID provider PID (mso_mdoc): primary attributes',
    description:
      'Name, birth date, residence and nationality of an mDOC PID trusted through the PID provider’s test trust list.',
    profile: 'oid4vp-1.0',
    tags: ['pid', 'mso_mdoc', 'positive', 'pid-provider'],
    prerequisites: [
      'A PID from the PID provider test environment is in the wallet.',
    ],
    steps: [present('pid-disclose-all-mdoc')],
    manual: [verifierShown],
  },
  {
    id: 'P-EAA-ONE',
    section: 'Presentation',
    label: 'One EAA',
    description: 'Presentation of a loyalty card.',
    profile: 'oid4vp-1.0',
    tags: ['eaa', 'dc+sd-jwt', 'positive'],
    prerequisites: ['A loyalty card is in the wallet.'],
    requires: ['I-EAA-NOTX'],
    steps: [present('eaa-present')],
    manual: [verifierShown],
  },
  {
    id: 'P-EAA-PID',
    section: 'Presentation',
    label: 'EAA plus PID',
    description: 'Loyalty card together with a PID in either format.',
    profile: 'oid4vp-1.0',
    tags: ['eaa', 'pid', 'positive'],
    prerequisites: ['A loyalty card and a PID are in the wallet.'],
    steps: [present('eaa-present-plus-pid')],
    manual: [verifierShown],
  },
  {
    id: 'P-EAA-TWO',
    section: 'Presentation',
    label: 'Two different EAAs',
    description: 'Loyalty card and event access attestation in one response.',
    profile: 'oid4vp-1.0',
    tags: ['eaa', 'dc+sd-jwt', 'positive'],
    prerequisites: [
      'A loyalty card and an event access attestation are in the wallet.',
    ],
    steps: [present('eaa-present-two')],
    manual: [verifierShown],
  },
  {
    id: 'P-OR',
    section: 'Presentation',
    label: 'One of two credentials (credential_sets OR)',
    description:
      'Either the loyalty card or the event access attestation satisfies the request.',
    profile: 'oid4vp-1.0',
    tags: ['eaa', 'dc+sd-jwt', 'positive', 'credential-sets'],
    prerequisites: [
      'A loyalty card or an event access attestation is in the wallet.',
    ],
    steps: [present('eaa-present-or')],
    manual: [
      {
        id: 'one-only',
        ask: 'Did the wallet ask for only one of the two credentials?',
        expect: 'yes',
      },
    ],
  },
  {
    id: 'P-AND',
    section: 'Presentation',
    label: 'Both credentials required (credential_sets AND)',
    description:
      'The loyalty card and the event access attestation are both required.',
    profile: 'oid4vp-1.0',
    tags: ['eaa', 'dc+sd-jwt', 'positive', 'credential-sets'],
    prerequisites: [
      'A loyalty card and an event access attestation are in the wallet.',
    ],
    steps: [present('eaa-present-and')],
    manual: [verifierShown],
  },
  {
    id: 'P-VALUES',
    section: 'Presentation',
    label: 'DCQL value filter that matches',
    description: 'Requests a loyalty card whose issuing_country is DE.',
    profile: 'oid4vp-1.0',
    tags: ['eaa', 'dc+sd-jwt', 'positive', 'dcql-values'],
    prerequisites: ['A loyalty card is in the wallet.'],
    steps: [
      present('qa-loyalty-values-match', {
        disclosures: [
          {
            credentialId: 'card',
            equals: [{ path: P('issuing_country'), value: 'DE' }],
            present: [P('member_id')],
          },
        ],
      }),
    ],
    manual: [verifierShown],
  },
  {
    id: 'P-SELECTIVE',
    section: 'Presentation',
    label: 'Issue a loyalty card, then disclose only its member ID',
    description:
      'Issues a card with a run-specific member ID, then accepts only a presentation of exactly that ID and nothing else.',
    profile: 'oid4vci-1.0+oid4vp-1.0',
    tags: ['eaa', 'dc+sd-jwt', 'positive', 'selective-disclosure', 'regression'],
    prerequisites: ['Select the card issued in this run when the wallet asks.'],
    steps: [
      issueLoyalty(),
      present('qa-loyalty-member', {
        disclosures: [
          {
            credentialId: 'card',
            equals: [{ path: P('member_id'), value: 'generated-per-run' }],
            allowedOnly: ['member_id'],
          },
        ],
      }),
    ],
  },
  {
    id: 'P-REVOKED',
    section: 'Presentation',
    label: 'Revoked credential is refused by the verifier',
    description:
      'Issues an event access attestation, lets you revoke it here, then requests it with a strict status check. EUDIPLO must reject the presentation.',
    profile: 'oid4vci-1.0+oid4vp-1.0',
    tags: ['eaa', 'dc+sd-jwt', 'status-list', 'negative', 'regression'],
    prerequisites: [
      'Select the attestation issued in this run when the wallet asks.',
    ],
    fallback: 'attest',
    controls: [
      {
        id: 'revoke',
        label: 'Revoke the issued credential',
        stepId: 'issue',
        action: 'set_status',
        status: 1,
        availableFromStep: 'present',
      },
    ],
    steps: [
      issueEvent(),
      present('qa-eaa-strict-status', {
        expected: 'verifier_rejects',
        instruction:
          'Press “Revoke the issued credential” first. Then open the request; the wallet may refuse on its own or present and be rejected.',
      }),
    ],
    manual: [
      {
        id: 'revoked-shown',
        ask: 'After revocation, does the wallet show the credential as revoked or invalid?',
        expect: 'yes',
        blocking: false,
      },
      {
        id: 'informed',
        ask: 'Were you told the presentation did not succeed?',
        expect: 'yes',
      },
    ],
  },
  {
    id: 'P-SUSPENDED',
    section: 'Presentation',
    label: 'Suspended credential is refused, then accepted again',
    description:
      'Issues an event access attestation, suspends it and expects the verifier to reject it, then makes it valid again and expects a successful presentation.',
    profile: 'oid4vci-1.0+oid4vp-1.0',
    tags: ['eaa', 'dc+sd-jwt', 'status-list', 'lifecycle'],
    prerequisites: [
      'Select the attestation issued in this run when the wallet asks.',
    ],
    controls: [
      {
        id: 'suspend',
        label: 'Suspend the issued credential',
        stepId: 'issue',
        action: 'set_status',
        status: 2,
        availableFromStep: 'present-suspended',
      },
      {
        id: 'unsuspend',
        label: 'Make the credential valid again',
        stepId: 'issue',
        action: 'set_status',
        status: 0,
        availableFromStep: 'present-valid',
      },
    ],
    steps: [
      issueEvent(),
      present('qa-eaa-strict-status', {
        id: 'present-suspended',
        expected: 'verifier_rejects',
        instruction: 'Press “Suspend” first, then open the request and share.',
      }),
      present('qa-eaa-strict-status', {
        id: 'present-valid',
        instruction:
          'Press “Make the credential valid again”, then open the request and share.',
      }),
    ],
  },
  {
    id: 'P-EXPIRED',
    section: 'Presentation',
    label: 'Expired credential is refused',
    description:
      'Issues a 5-minute loyalty card. After 5 minutes, request it: either the wallet refuses or EUDIPLO rejects the expired credential.',
    profile: 'oid4vci-1.0+oid4vp-1.0',
    tags: ['eaa', 'dc+sd-jwt', 'negative', 'lifecycle'],
    prerequisites: [
      'Select the 5-minute card issued in this run when the wallet asks.',
    ],
    fallback: 'attest',
    steps: [
      issueLoyalty('issue', 'loyalty-short'),
      present('qa-loyalty-member', {
        expected: 'verifier_rejects',
        instruction:
          'Wait until 5 minutes have passed since issuance, then open the request.',
      }),
    ],
    manual: [
      {
        id: 'informed',
        ask: 'Were you told the card is expired or the presentation did not succeed?',
        expect: 'yes',
      },
    ],
  },
  {
    id: 'P-DECLINE',
    section: 'Presentation',
    label: 'Tester declines the request',
    description:
      'Open the request and decline it in the wallet. The wallet must send access_denied.',
    profile: 'oid4vp-1.0',
    tags: ['eaa', 'negative', 'consent'],
    prerequisites: ['A loyalty card is in the wallet.'],
    fallback: 'attest',
    steps: [
      reject(
        'qa-loyalty-member',
        ['access_denied'],
        'Open the request and press decline / cancel in the wallet.',
      ),
    ],
    manual: [
      {
        id: 'back-to-start',
        ask: 'Did the wallet return to a usable state without sharing anything?',
        expect: 'yes',
      },
    ],
  },
  {
    id: 'P-DCAPI-SDJWT',
    section: 'Presentation',
    label: 'Digital Credentials API: PID (dc+sd-jwt) age over 18',
    description:
      'The browser asks the wallet for the PID\'s age over 18, without a QR code or link. The wallet may share only that attribute. Works with the QA PID and the PID provider’s PID. (Signed OpenID4VP request over navigator.credentials.get, response mode dc_api.jwt, bound to this page\'s origin.)',
    profile: 'oid4vp-1.0',
    tags: ['pid', 'dc+sd-jwt', 'dc-api', 'positive', 'selective-disclosure'],
    prerequisites: [...DC_API_PREREQS, 'A PID (dc+sd-jwt) is in the wallet.'],
    steps: [
      presentDcApi('pid-age-over-sd-jwt-vc', {
        disclosures: [
          {
            credentialId: 'pid-sd-jwt',
            equals: [{ path: P('age_equal_or_over', '18'), value: true }],
            absent: [P('birthdate'), P('age_in_years'), P('age_birth_year')],
            allowedOnly: ['age_equal_or_over'],
          },
        ],
      }),
    ],
    manual: [dcApiDialog, verifierShown],
  },
  {
    id: 'P-DCAPI-MDOC',
    section: 'Presentation',
    label: 'Digital Credentials API: QA PID (mso_mdoc) age over 18',
    description:
      'The browser asks the wallet for the QA PID\'s age over 18, without a QR code or link. The wallet may share only that attribute; the birth date must stay hidden. (Signed OpenID4VP request over navigator.credentials.get, response mode dc_api.jwt, bound to this page\'s origin.)',
    profile: 'oid4vp-1.0',
    tags: ['pid', 'mso_mdoc', 'dc-api', 'positive', 'selective-disclosure'],
    prerequisites: [...DC_API_PREREQS, 'The QA PID (mso_mdoc) is in the wallet.'],
    requires: ['I-PID-MDOC'],
    steps: [
      presentDcApi('qa-pid-age-over-mdoc', {
        disclosures: [
          {
            credentialId: 'pid-mso-mdoc',
            equals: [{ path: P(PID_NS, 'age_over_18'), value: true }],
            absent: [P(PID_NS, 'birth_date')],
            allowedOnly: ['age_over_18'],
          },
        ],
      }),
    ],
    manual: [dcApiDialog, verifierShown],
  },

  // -------------------------------------------------------------- Rejection
  {
    id: 'R-NOT-AVAIL',
    section: 'Rejection',
    label: 'Requested credential not in the wallet',
    description: 'Requests a diploma the wallet does not hold.',
    profile: 'oid4vp-1.0',
    tags: ['negative', 'presentation'],
    prerequisites: ['The wallet holds no diploma credential.'],
    fallback: 'attest',
    steps: [
      reject(
        'eaa-reject-not-available',
        ['credential_unavailable', 'no_credentials', 'access_denied'],
        'Open the request. The wallet should say it has no matching credential.',
      ),
    ],
    manual: [refusedWithReason],
  },
  {
    id: 'R-NO-MATCH',
    section: 'Rejection',
    label: 'Credential present, but the DCQL value filter excludes it',
    description:
      'Requests a loyalty card issued in FR; the wallet only holds DE cards.',
    profile: 'oid4vp-1.0',
    tags: ['negative', 'presentation', 'dcql-values'],
    prerequisites: ['A loyalty card (issuing country DE) is in the wallet.'],
    fallback: 'attest',
    steps: [
      reject(
        'qa-loyalty-values-nomatch',
        ['credential_unavailable', 'no_credentials', 'access_denied'],
        'Open the request. The wallet should not offer the DE card.',
      ),
    ],
    manual: [refusedWithReason, noDataOffered],
  },
  {
    id: 'R-SIG',
    section: 'Rejection',
    label: 'Request object signature corrupted',
    description:
      'Wallet QA fetches a valid request, verifies its signature and flips one signature byte before handing it to the wallet.',
    profile: 'oid4vp-1.0',
    tags: ['negative', 'presentation', 'signature', 'regression'],
    prerequisites: ['The wallet trusts the Wallet QA verifier certificate.'],
    fallback: 'attest',
    steps: [
      {
        id: 'reject',
        kind: 'fault',
        backendProfile: 'default',
        configId: 'qa-loyalty-member',
        expected: 'rejected',
        backendErrorCodes: [
          'invalid_signature',
          'invalid_request',
          'invalid_request_uri',
        ],
        rejectionReason: 'invalid_signature',
        instruction: 'Open the request. The wallet must refuse it.',
      },
    ],
    manual: [refusedWithReason, noDataOffered],
  },
  ...(
    [
      ['R-ACCESS-EXPIRED', 'expired', 'qa-reject-access-untrusted'],
      ['R-ACCESS-UNTRUSTED', 'issued by an untrusted root', 'qa-reject-access-untrusted'],
      ['R-ACCESS-REVOKED', 'revoked', 'qa-reject-access-untrusted'],
    ] as const
  ).map(
    ([id, what, configId]): Entry => ({
      id,
      section: 'Rejection',
      label: `Access certificate ${what}`,
      description: `The presentation request is signed with an access certificate that is ${what}. The wallet must refuse it.`,
      profile: 'oid4vp-1.0',
      tags: ['negative', 'presentation', 'access-certificate'],
      prerequisites: ['A loyalty card is in the wallet.'],
      ...(id === 'R-ACCESS-UNTRUSTED'
        ? {}
        : {
            availability: 'unsupported' as const,
            unavailableReason:
              'EUDIPLO checks expiry and revocation of its own access certificate and refuses to sign the request, so it cannot send one to the wallet.',
          }),
      fallback: 'attest',
      steps: [
        reject(
          configId,
          ['invalid_request', 'invalid_request_object', 'invalid_client', 'access_denied'],
          'Open the request. The wallet must refuse it before showing any consent screen.',
        ),
      ],
      manual: [refusedWithReason, noDataOffered],
    }),
  ),
  ...(
    [
      ['R-REG-INVALID', 'Registration certificate with an invalid signature'],
      ['R-REG-REVOKED', 'Revoked registration certificate'],
      ['R-REG-OVERASK', 'Request asks for more than the registration certificate allows'],
    ] as const
  ).map(
    ([id, label]): Entry => ({
      id,
      section: 'Rejection',
      label,
      description:
        'Needs a pre-built registration certificate passed as registration_cert.jwt.',
      profile: 'oid4vp-1.0',
      tags: ['negative', 'presentation', 'registration-certificate'],
      prerequisites: [],
      availability: 'unsupported',
      unavailableReason:
        'Registration certificate fixtures are not generated yet (see docs/design.md).',
      steps: [reject('qa-loyalty-member', ['access_denied'], '')],
    }),
  ),
  ...([408, 429, 504] as const).map(
    (httpStatus): Entry => ({
      id: `R-HTTP-${httpStatus}`,
      section: 'Rejection',
      label: `HTTP ${httpStatus} when fetching the presentation request`,
      description: `Wallet QA answers the wallet’s request_uri fetch with HTTP ${httpStatus}. Only the tester can judge the wallet’s reaction.`,
      profile: 'oid4vp-1.0',
      tags: ['negative', 'presentation', 'http'],
      prerequisites: ['A loyalty card is in the wallet.'],
      fallback: 'attest',
      steps: [
        {
          id: 'request-http-error',
          kind: 'fault',
          backendProfile: 'default',
          configId: 'qa-loyalty-member',
          expected: 'rejected',
          httpStatus,
          instruction: 'Open the request and watch how the wallet handles the error.',
        },
      ],
      manual: [errorShown, noCrash],
    }),
  ),
];

export const SCENARIOS: Scenario[] = entries.map((entry) => ({
  ...entry,
  version: CATALOG_VERSION,
  availability: entry.availability ?? 'ready',
}));

export const SECTIONS = [...new Set(SCENARIOS.map((s) => s.section))];

/** Fills per-run values (member IDs, dates) into a copy of the scenario. */
export function scenarioForRun(
  scenario: Scenario,
  runId: string,
  now: Date,
): Scenario {
  const copy = structuredClone(scenario);
  const memberId = `QA-${runId}`;
  for (const step of copy.steps) {
    for (const claims of Object.values(step.claims ?? {}))
      if (claims.member_id === 'generated-per-run') claims.member_id = memberId;
    for (const policy of step.disclosures ?? [])
      for (const rule of policy.equals ?? [])
        if (rule.value === 'generated-per-run') rule.value = memberId;
    const event = step.claims?.['event-access-attestation'];
    if (event) {
      event.verified_at = now.toISOString();
      event.valid_until = new Date(now.getTime() + 86400000).toISOString();
      event.event_date = now.toISOString().slice(0, 10);
    }
  }
  return copy;
}
