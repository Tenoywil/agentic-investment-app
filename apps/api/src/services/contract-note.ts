import { type Currency, formatMoney, money } from '@ccn/money';

/**
 * The contract note: the document a settled order leaves behind.
 *
 * A regulated execution ends in paper — the client's record of what was
 * executed, by whom, at what price and for what fee, referenced well enough
 * that the firm's own back office can find the trade. CCN had the facts
 * (0019's settlement detail) and no document, so "can I have the contract
 * note?" — the first thing an auditor or a beneficiary's lawyer asks — had no
 * answer either side could produce.
 *
 * One renderer serves both sides: the investor's copy and the desk's copy are
 * THE SAME DOCUMENT, because two templates for one trade is how the two
 * parties end up holding different accounts of it. Self-contained HTML with
 * inline styles and a print rule — no scripts, no external fetches — so it
 * prints to PDF from any browser and can be attached to an email whole.
 */

export interface ContractNoteData {
  orderId: string;
  clientName: string;
  clientEmail: string;
  partnerName: string;
  partnerCode: string;
  regulator: string | null;
  instrumentName: string | null;
  instrumentAbbr: string | null;
  amountMinor: bigint;
  currency: string;
  unitPriceMinor: bigint | null;
  units: string | null;
  feeMinor: bigint | null;
  externalRef: string | null;
  clientRef: string | null;
  createdAt: Date;
  acceptedAt: Date | null;
  settledAt: Date | null;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmtDate = (d: Date | null) =>
  d
    ? d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      })
    : '—';

const REGULATOR_LABELS: Record<string, string> = {
  FSC_JAMAICA: 'FSC Jamaica',
  FSC_BARBADOS: 'FSC Barbados',
  FSC_TRINIDAD_TOBAGO: 'FSC Trinidad & Tobago',
};

export function renderContractNote(d: ContractNoteData): string {
  const ccy = d.currency as Currency;
  const exact = { minorDigits: 2 as const };
  const rows: [string, string][] = [
    ['Client', `${esc(d.clientName)} · ${esc(d.clientEmail)}`],
    [
      'Executing firm',
      `${esc(d.partnerName)} (${esc(d.partnerCode)})${
        d.regulator ? ` · ${esc(REGULATOR_LABELS[d.regulator] ?? d.regulator)}` : ''
      }`,
    ],
    [
      'Instrument',
      d.instrumentName
        ? `${esc(d.instrumentName)}${d.instrumentAbbr ? ` (${esc(d.instrumentAbbr)})` : ''}`
        : 'As instructed',
    ],
    ['Gross consideration', formatMoney(money(d.amountMinor, ccy), exact)],
  ];
  // The execution figures appear only when the firm reported them. A dash is
  // "not reported"; a zero would be the firm asserting there was none.
  if (d.unitPriceMinor !== null)
    rows.push(['Unit price', formatMoney(money(d.unitPriceMinor, ccy), exact)]);
  if (d.units !== null) rows.push(['Units', esc(d.units)]);
  if (d.feeMinor !== null) rows.push(['Execution fee', formatMoney(money(d.feeMinor, ccy), exact)]);
  rows.push(
    ['Order placed', fmtDate(d.createdAt)],
    ['Accepted by the firm', fmtDate(d.acceptedAt)],
    ['Settled', fmtDate(d.settledAt)],
    ['Order reference', esc(d.orderId)],
  );
  if (d.externalRef) rows.push(["Firm's execution reference", esc(d.externalRef)]);
  if (d.clientRef) rows.push(['Client account reference', esc(d.clientRef)]);

  const table = rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('\n      ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Contract note · ${esc(d.orderId.slice(0, 8))}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1d1a14; margin: 0; background: #f4f0e7; }
  .sheet { max-width: 720px; margin: 32px auto; background: #fff; padding: 48px 56px; border: 1px solid #d8d2c4; }
  header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 3px double #124e48; padding-bottom: 14px; }
  .brand { font-size: 20px; font-weight: 700; letter-spacing: .02em; color: #124e48; }
  .doc { font-size: 13px; text-transform: uppercase; letter-spacing: .14em; color: #6b6459; }
  h1 { font-size: 22px; margin: 26px 0 4px; }
  .sub { color: #6b6459; font-size: 14px; margin: 0 0 22px; }
  table { width: 100%; border-collapse: collapse; font-size: 14.5px; }
  th { text-align: left; font-weight: 400; color: #6b6459; padding: 9px 16px 9px 0; width: 220px; vertical-align: top; border-bottom: 1px solid #ece6da; }
  td { padding: 9px 0; border-bottom: 1px solid #ece6da; font-weight: 600; }
  footer { margin-top: 30px; font-size: 12px; line-height: 1.6; color: #6b6459; }
  @media print { body { background: #fff; } .sheet { border: 0; margin: 0; max-width: none; padding: 24px 8px; } }
</style>
</head>
<body>
  <div class="sheet">
    <header>
      <span class="brand">Caribbean Capital Network</span>
      <span class="doc">Contract note</span>
    </header>
    <h1>Confirmation of execution</h1>
    <p class="sub">Issued from CCN's append-only order record. The executing firm is the
    regulated counterparty; CCN routed the signed instruction and holds the audit trail.</p>
    <table>
      ${table}
    </table>
    <footer>
      This note reflects the executing firm's own settlement report as recorded on CCN's
      hash-chained audit log. Figures the firm did not report are omitted rather than estimated.
      Queries quote the order reference above to either party.
    </footer>
  </div>
</body>
</html>`;
}
