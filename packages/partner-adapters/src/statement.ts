import { type Currency, fromMajor } from '@ccn/money';

/**
 * Statement ingestion — the parse half. A `StatementExtractor` (OCR/vision seam)
 * turns a stored document into lines; `parseStatement` turns those lines into
 * structured holdings. The extracted text is DATA, never instructions: it flows
 * to the reconciliation queue for a human to confirm before it becomes a holding.
 * That human-in-the-loop step is the prompt-injection firebreak for anything a
 * malicious statement might contain.
 */

export interface ExtractInput {
  storagePath: string;
  /** Bytes of the stored document, when the extractor works from the file. */
  bytes?: Uint8Array;
}

export interface Extraction {
  source: string;
  lines: string[];
}

/** The OCR/vision port. Real impls: a gateway vision model or tesseract.js. */
export interface StatementExtractor {
  extract(input: ExtractInput): Promise<Extraction>;
}

export interface ParsedHolding {
  name: string;
  valueMinor: bigint;
  currency: Currency;
  returnLabel?: string;
}

const SYMBOL_TO_CURRENCY: Record<string, Currency> = {
  US$: 'USD',
  J$: 'JMD',
  TT$: 'TTD',
  G$: 'GYD',
  Bds$: 'BBD',
  EC$: 'XCD',
  B$: 'BSD',
};

// Amount like "US$12,400" / "J$1,000.50" / "TT$3,500". Longer symbols first so
// "Bds$" is not read as "B$" plus stray letters.
const AMOUNT_RE = /(Bds\$|US\$|EC\$|TT\$|J\$|G\$|B\$)\s?([\d,]+(?:\.\d{1,2})?)/;

/**
 * Parse statement lines into holdings. A line contributes a holding only if it
 * carries a recognizable currency amount; the text before the amount is the
 * name, an optional trailing token (e.g. "+6.8%") is kept as the return label.
 * Lines without an amount are ignored. Pure and deterministic.
 */
export function parseStatement(lines: readonly string[]): ParsedHolding[] {
  const out: ParsedHolding[] = [];
  for (const raw of lines) {
    const match = AMOUNT_RE.exec(raw);
    if (!match) continue;
    const symbol = match[1] as keyof typeof SYMBOL_TO_CURRENCY;
    const currency = SYMBOL_TO_CURRENCY[symbol];
    if (!currency) continue;
    const major = Number.parseFloat((match[2] ?? '').replace(/,/g, ''));
    if (!Number.isFinite(major)) continue;

    const name = raw
      .slice(0, match.index)
      .replace(/[.\s]+$/, '')
      .trim();
    if (name.length === 0) continue;

    const after = raw.slice(match.index + match[0].length).trim();
    const returnLabel = /^[+\-]?\d|—/.test(after) ? after.split(/\s{2,}/)[0]?.trim() : undefined;

    out.push({
      name,
      valueMinor: fromMajor(major, currency).minor,
      currency,
      ...(returnLabel && returnLabel !== '—' ? { returnLabel } : {}),
    });
  }
  return out;
}
