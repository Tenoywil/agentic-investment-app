// Onboarding content, ported verbatim from the prototype (index.html).

export interface RiskOption {
  key: string;
  label: string;
  score: number;
}
export interface RiskQuestion {
  q: string;
  opts: RiskOption[];
}

export const ONB_TITLES = [
  'Get verified',
  'Compliance & suitability',
  'Your risk tolerance',
  'Source of funds',
  "You're all set",
];

export const ONB_SUBS = [
  'A one-time setup so your agent can prepare work for your approval.',
  'Declarations required across Caribbean jurisdictions.',
  'Three questions from the Sagicor Life fact-find set your risk profile.',
  'Required by regulators before you invest.',
  'Verification complete.',
];

export const ONB_LABELS = ['Identity', 'Compliance', 'Risk', 'Funds'];

/**
 * The declarations, and whether each one has to be true to continue.
 *
 * The PEP item used to read "I am not a Politically Exposed Person" and was
 * required — so the only way through onboarding was to declare you were not one,
 * and `is_pep` was written as `false` for every person on the network. A PEP had
 * no way to say so, and the partner console's "Politically exposed" chip could
 * never appear on any client. That is not a screening control; it is a control
 * that cannot fail.
 *
 * Turned around, it is answerable: checking it declares that you ARE one, and it
 * does not block. Being a PEP is not disqualifying — it is something the firm
 * that carries the KYC obligation needs told, which is exactly what CCN is for.
 */
export interface Declaration {
  id: 'pep' | 'taxResidency' | 'risk';
  text: string;
  /** False for a disclosure: it is recorded either way and blocks nothing. */
  mustBeTrue: boolean;
}

export const DECLARATIONS: Declaration[] = [
  {
    id: 'taxResidency',
    text: 'I confirm my tax residency and will report income where required',
    mustBeTrue: true,
  },
  {
    id: 'risk',
    text: 'I understand investments carry risk and may lose value',
    mustBeTrue: true,
  },
  {
    id: 'pep',
    text: 'I am a Politically Exposed Person (PEP), or a close associate or family member of one',
    mustBeTrue: false,
  },
];

export const SOURCES: { id: string; label: string }[] = [
  { id: 'investment', label: 'Investment' },
  { id: 'salary', label: 'Salary' },
  { id: 'business', label: 'Business' },
  { id: 'other', label: 'Other' },
];

export const RISK_QUESTIONS: RiskQuestion[] = [
  {
    q: 'What is your investment goal?',
    opts: [
      { key: 'A', label: 'To grow aggressively', score: 5 },
      { key: 'B', label: 'To grow significantly', score: 4 },
      { key: 'C', label: 'To grow moderately', score: 3 },
      { key: 'D', label: 'To grow with caution', score: 2 },
      { key: 'E', label: 'To avoid losing money', score: 1 },
    ],
  },
  {
    q: 'Which statement best describes your attitude toward investing over three (3) years?',
    opts: [
      { key: 'A', label: "I don't mind if I lose money", score: 5 },
      { key: 'B', label: 'I can tolerate a loss', score: 4 },
      { key: 'C', label: 'I can tolerate a small loss', score: 3 },
      { key: 'D', label: 'I need to see at least a little return', score: 2 },
      { key: 'E', label: "I'd have a hard time tolerating any losses", score: 1 },
    ],
  },
  {
    q: 'Which statement best describes your attitude toward investing over three (3) months?',
    opts: [
      { key: 'A', label: 'Who cares? One calendar quarter means nothing', score: 5 },
      { key: 'B', label: "I wouldn't worry about losses in that time frame", score: 4 },
      { key: 'C', label: "If I suffered a loss of greater than 10%, I'd be concerned", score: 3 },
      { key: 'D', label: 'I can only tolerate small short-term losses', score: 2 },
      { key: 'E', label: "I'd have a hard time accepting any losses", score: 1 },
    ],
  },
];

const BANDS: Record<number, string> = {
  1: 'Low',
  2: 'Low Moderate',
  3: 'High Moderate',
  4: 'Low High',
  5: 'High',
};

/** Average the three answer scores → risk band (matches the prototype). */
export function riskBand(scores: number[]): string {
  if (scores.length < RISK_QUESTIONS.length) return '';
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  return BANDS[avg] ?? 'High Moderate';
}
