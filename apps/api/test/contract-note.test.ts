import { describe, expect, test } from 'bun:test';
import { renderContractNote } from '../src/services/contract-note';

/**
 * The renderer both parties' copies come from. What matters: reported figures
 * appear to the cent, unreported ones are absent rather than zero, and text
 * that came from people (names, references) cannot break out of the HTML.
 */
describe('contract note renderer', () => {
  const base = {
    orderId: '0b8e2c4a-1111-2222-3333-444455556666',
    clientName: 'Keisha Grant',
    clientEmail: 'keisha@example.com',
    partnerName: 'Sagicor Investments',
    partnerCode: 'SAG',
    regulator: 'FSC_JAMAICA',
    instrumentName: 'GOJ USD Global Bond 2032',
    instrumentAbbr: 'GOJ32',
    amountMinor: 500_000n,
    currency: 'USD',
    unitPriceMinor: 10_025n,
    units: '49.875',
    feeMinor: 1_250n,
    externalRef: 'TRD-88214',
    clientRef: 'Client ••7134',
    createdAt: new Date('2026-08-01T10:00:00Z'),
    acceptedAt: new Date('2026-08-02T10:00:00Z'),
    settledAt: new Date('2026-08-05T10:00:00Z'),
  };

  test('reported figures render to the cent, with both references', () => {
    const html = renderContractNote(base);
    expect(html).toContain('US$5,000.00'); // gross
    expect(html).toContain('US$100.25'); // unit price
    expect(html).toContain('US$12.50'); // fee
    expect(html).toContain('49.875');
    expect(html).toContain('TRD-88214');
    expect(html).toContain(base.orderId);
    expect(html).toContain('FSC Jamaica');
    expect(html).toContain('August 5, 2026');
  });

  test('unreported figures are absent, not zero', () => {
    const html = renderContractNote({
      ...base,
      unitPriceMinor: null,
      units: null,
      feeMinor: null,
      externalRef: null,
    });
    expect(html).not.toContain('Unit price');
    expect(html).not.toContain('Execution fee');
    expect(html).not.toContain('US$0.00');
    expect(html).not.toContain('execution reference');
  });

  test('person-supplied text cannot break out of the document', () => {
    const html = renderContractNote({
      ...base,
      clientName: '<script>alert(1)</script>',
      externalRef: '"><img src=x>',
    });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('"><img');
  });
});
