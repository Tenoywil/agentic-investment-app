export type CorridorPhase = 'launch' | 'future';

export interface JurisdictionPolicy {
  key: string;
  country: string;
  region?: string;
  phase: CorridorPhase;
  securitiesRegulators: readonly string[];
  amlAuthorities: readonly string[];
  sanctionsAuthorities: readonly string[];
  taxAuthorities: readonly string[];
  recordRetentionYears: number;
  effectiveFrom: string;
  sources: readonly string[];
}

/**
 * Effective regulatory ownership for CCN's launch and retained future
 * corridors. This is routing metadata, not legal advice and not a substitute
 * for product-by-product offerability or partner counsel approval.
 */
export const JURISDICTION_POLICIES = [
  {
    key: 'JM',
    country: 'Jamaica',
    phase: 'launch',
    securitiesRegulators: ['Financial Services Commission (FSC Jamaica)'],
    amlAuthorities: ['FSC Jamaica', 'Financial Investigations Division (FID)'],
    sanctionsAuthorities: ['Jamaica designated authority'],
    taxAuthorities: ['Tax Administration Jamaica (TAJ)'],
    recordRetentionYears: 7,
    effectiveFrom: '2023-02-28',
    sources: [
      'https://www.fscjamaica.org/aml-cft-cfp/guidelines/',
      'https://www.fscjamaica.org/wp-content/uploads/2023/05/Gazetted-AML-Guidelines-updated.pdf',
    ],
  },
  {
    key: 'GY',
    country: 'Guyana',
    phase: 'launch',
    securitiesRegulators: ['Guyana Securities Council (GSC)'],
    amlAuthorities: ['Guyana Securities Council (GSC)', 'Financial Intelligence Unit (FIU Guyana)'],
    sanctionsAuthorities: ['Financial Intelligence Unit (FIU Guyana)'],
    taxAuthorities: ['Guyana Revenue Authority (GRA)'],
    recordRetentionYears: 7,
    effectiveFrom: '2023-06-30',
    sources: [
      'https://www.guyanasecuritiescouncil.com/about.html',
      'https://fiu.gov.gy/aml-cft-guidelines/',
      'https://fiu.gov.gy/wp-content/uploads/2023/07/AMLCFT-Handbook-for-REs-Updated-June-30-2023.pdf',
    ],
  },
  {
    key: 'TT',
    country: 'Trinidad and Tobago',
    phase: 'launch',
    securitiesRegulators: ['Trinidad and Tobago Securities and Exchange Commission (TTSEC)'],
    amlAuthorities: ['TTSEC', 'Financial Intelligence Unit of Trinidad and Tobago (FIUTT)'],
    sanctionsAuthorities: ['FIUTT'],
    taxAuthorities: ['Board of Inland Revenue (BIR)'],
    recordRetentionYears: 6,
    effectiveFrom: '2026-02-01',
    sources: [
      'https://www.ttsec.org.tt/anti-money-laundering-combating-the-financing-of-terrorism-and-countering-proliferation-financing-aml-cft-cpf-guidelines-for-the-securities-sector/',
      'https://www.ttsec.org.tt/wp-content/uploads/2026/02/TTSEC-AMLCFTCPF-Guidelines-for-the-Securities-Sector-2026.pdf',
    ],
  },
  {
    key: 'US-NY',
    country: 'United States',
    region: 'New York',
    phase: 'launch',
    securitiesRegulators: ['SEC', 'FINRA', 'New York Office of the Attorney General'],
    amlAuthorities: ['FinCEN', 'FINRA'],
    sanctionsAuthorities: ['Office of Foreign Assets Control (OFAC)'],
    taxAuthorities: ['Internal Revenue Service (IRS)'],
    recordRetentionYears: 5,
    effectiveFrom: '2026-08-25',
    sources: [
      'https://www.finra.org/rules-guidance/rulebooks/finra-rules/2090',
      'https://www.finra.org/rules-guidance/rulebooks/finra-rules/3310',
      'https://www.sec.gov/files/rules/final/34-47752.htm',
      'https://ofac.treasury.gov/sanctions-list-service',
      'https://www.irs.gov/businesses/corporations/foreign-account-tax-compliance-act-fatca',
    ],
  },
  {
    key: 'US-FL',
    country: 'United States',
    region: 'Florida',
    phase: 'launch',
    securitiesRegulators: ['SEC', 'FINRA', 'Florida Office of Financial Regulation'],
    amlAuthorities: ['FinCEN', 'FINRA'],
    sanctionsAuthorities: ['Office of Foreign Assets Control (OFAC)'],
    taxAuthorities: ['Internal Revenue Service (IRS)'],
    recordRetentionYears: 5,
    effectiveFrom: '2026-08-25',
    sources: [
      'https://www.finra.org/rules-guidance/rulebooks/finra-rules/2090',
      'https://www.finra.org/rules-guidance/rulebooks/finra-rules/3310',
      'https://www.sec.gov/files/rules/final/34-47752.htm',
      'https://flofr.gov/divisions-offices/division-of-securities/1000',
      'https://ofac.treasury.gov/sanctions-list-service',
    ],
  },
  {
    key: 'BB',
    country: 'Barbados',
    phase: 'future',
    securitiesRegulators: ['Financial Services Commission Barbados'],
    amlAuthorities: [
      'Financial Services Commission Barbados',
      'Financial Intelligence Unit Barbados',
    ],
    sanctionsAuthorities: ['Barbados competent authority'],
    taxAuthorities: ['Barbados Revenue Authority'],
    recordRetentionYears: 5,
    effectiveFrom: '2026-08-25',
    sources: [
      'https://www.fsc.gov.bb/aml-cft',
      'https://www.fsc.gov.bb/viewPDF/documents/2023-05-16-19-31-31-financialservicescommissionamlcftguidelines-revisedoctober2021.pdf',
      'https://bra.gov.bb/About/Global-Relations/Contact-Us',
    ],
  },
  {
    key: 'GB',
    country: 'United Kingdom',
    phase: 'future',
    securitiesRegulators: ['Financial Conduct Authority (FCA)'],
    amlAuthorities: ['Financial Conduct Authority (FCA)', 'UK Financial Intelligence Unit (UKFIU)'],
    sanctionsAuthorities: ['Office of Financial Sanctions Implementation (OFSI)'],
    taxAuthorities: ['HM Revenue & Customs (HMRC)'],
    recordRetentionYears: 5,
    effectiveFrom: '2026-08-25',
    sources: [
      'https://www.fca.org.uk/firms/financial-crime/money-laundering-terrorist-financing',
      'https://handbook.fca.org.uk/handbook/fcg3',
      'https://www.gov.uk/guidance/money-laundering-regulations-your-responsibilities',
    ],
  },
  {
    key: 'CA',
    country: 'Canada',
    phase: 'future',
    securitiesRegulators: [
      'Applicable provincial or territorial securities regulator',
      'Canadian Securities Administrators (CSA)',
    ],
    amlAuthorities: ['Financial Transactions and Reports Analysis Centre of Canada (FINTRAC)'],
    sanctionsAuthorities: ['Global Affairs Canada', 'Royal Canadian Mounted Police'],
    taxAuthorities: ['Canada Revenue Agency (CRA)'],
    recordRetentionYears: 5,
    effectiveFrom: '2026-08-25',
    sources: [
      'https://fintrac-canafe.canada.ca/re-ed/sec-eng',
      'https://fintrac-canafe.canada.ca/guidance-directives/client-clientele/client/sec-eng.php',
      'https://fintrac-canafe.canada.ca/guidance-directives/recordkeeping-document/record/sec-eng',
    ],
  },
] as const satisfies readonly JurisdictionPolicy[];

export const LAUNCH_CORRIDOR_COUNTRIES = [
  'Jamaica',
  'Guyana',
  'Trinidad and Tobago',
  'United States',
] as const;

export const LAUNCH_INVESTMENT_MARKETS = ['Jamaica', 'Guyana', 'Trinidad and Tobago'] as const;

export const FUTURE_CORRIDOR_COUNTRIES = ['Barbados', 'United Kingdom', 'Canada'] as const;
