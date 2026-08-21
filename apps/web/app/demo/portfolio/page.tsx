'use client';

import { AppScreen, PageHead } from '@/app/_components/AppScreen';
import { EquityChart } from '@/app/_components/EquityChart';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/app/_components/ui/dialog';
import { Input } from '@/app/_components/ui/input';
import { cn } from '@/app/_lib/utils';
import { Check, ShieldCheck, Upload } from 'lucide-react';
import { useState } from 'react';

const INSTITUTIONS = [
  {
    code: 'NCB',
    name: 'NCB Capital Markets',
    kind: 'Securities · Capital Markets',
    total: 'US$13,400',
    tint: '#e7edf8',
    color: '#1a4aa0',
    holdings: [
      { name: 'GOJ USD Global Bond 2029', value: 'US$12,400', ret: '+6.8%' },
      { name: 'USD Chequing', value: 'US$1,000', ret: '—' },
    ],
  },
  {
    code: 'SAG',
    name: 'Sagicor Investments',
    kind: 'Funds · Insurance',
    total: 'US$8,200',
    tint: '#e6f2ea',
    color: '#1f7a44',
    holdings: [{ name: 'Sagicor Sigma Global Fund', value: 'US$8,200', ret: '+4.1%' }],
  },
  {
    code: 'PRV',
    name: 'PROVEN Wealth',
    kind: 'Wealth Management',
    total: 'US$5,600',
    tint: '#f6efe0',
    color: '#9a6a1e',
    holdings: [{ name: 'Proven USD Income Fund', value: 'US$5,600', ret: '+5.9%' }],
  },
  {
    code: 'JMMB',
    name: 'JMMB Group',
    kind: 'Bank · Money Market',
    total: 'US$4,150',
    tint: '#fae8e6',
    color: '#c4362b',
    holdings: [
      { name: 'JMMB Money Market Fund', value: 'US$3,000', ret: '+2.0%' },
      { name: 'USD Savings', value: 'US$1,150', ret: '—' },
    ],
  },
];

/**
 * Fixture equity curve for the demo: thirty days of gentle growth ending at
 * the page's US$31,350 net worth, minor units. Dated backwards from today so
 * the chart always reads as a live month, like the rest of the demo's data.
 */
const EQUITY_SERIES_MINOR = [
  '2940000',
  '2943500',
  '2947200',
  '2945100',
  '2951800',
  '2958400',
  '2962000',
  '2960300',
  '2967900',
  '2975600',
  '2981200',
  '2979500',
  '2986800',
  '2994300',
  '3001100',
  '2999400',
  '3006700',
  '3014200',
  '3021600',
  '3019800',
  '3027300',
  '3035100',
  '3042800',
  '3040900',
  '3058500',
  '3072200',
  '3086800',
  '3101500',
  '3118900',
  '3135000',
];

const EQUITY_POINTS = EQUITY_SERIES_MINOR.map((valueMinor, i) => ({
  label: new Date(Date.now() - (EQUITY_SERIES_MINOR.length - 1 - i) * 86_400_000)
    .toISOString()
    .slice(0, 10),
  valueMinor,
}));

function fmtUsdMinor(minor: string): string {
  return `US$${(Number(minor) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export default function PortfolioPage() {
  const [fundingPartner, setFundingPartner] = useState<(typeof INSTITUTIONS)[number] | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function closeFunding() {
    setFundingPartner(null);
    setSubmitted(false);
  }

  return (
    <AppScreen active="portfolio" basePath="/demo">
      <PageHead
        eyebrow="Every holding, unified · custodied by licensed partners"
        title="Your portfolio"
        right={
          <div
            className="flex items-baseline gap-2 rounded-xl border border-border bg-mint px-4 py-2.5"
            data-tour="customer-portfolio-page"
          >
            <b className="font-display text-xl">US$31,350</b>
            <span className="text-[12.5px] text-dim">
              total
              <br />
              net worth
            </span>
          </div>
        }
      />

      <div className="g2" data-tour="customer-portfolio-accounts">
        {INSTITUTIONS.map((inst) => (
          <Card key={inst.code} className="p-[22px]">
            <div className="mb-3 flex items-center gap-3">
              <span
                className="grid h-10 w-10 flex-none place-items-center rounded-[10px] font-mono text-xs font-bold"
                style={{ background: inst.tint, color: inst.color }}
              >
                {inst.code}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold">{inst.name}</div>
                <div className="text-[12.5px] text-faint">{inst.kind}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[15px] font-bold">{inst.total}</div>
                <div className="text-[11.5px] text-success-ink">· Licensed partner</div>
              </div>
            </div>
            {inst.holdings.map((h) => (
              <div
                key={h.name}
                className="flex items-center justify-between gap-3 border-t border-border py-[11px]"
              >
                <span className="text-sm">{h.name}</span>
                <span className="flex items-baseline gap-2.5">
                  <b className="font-mono text-[13.5px]">{h.value}</b>
                  <span
                    className={cn(
                      'min-w-[42px] text-right text-[13px]',
                      h.ret === '—' ? 'text-faint' : 'text-success',
                    )}
                  >
                    {h.ret}
                  </span>
                </span>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 w-full"
              data-tour="customer-portfolio-funding"
              onClick={() => setFundingPartner(inst)}
            >
              Add money
            </Button>
          </Card>
        ))}
      </div>

      <Card className="mt-[18px] p-[22px]">
        <b className="font-display text-lg">Your money over time</b>
        <div className="mb-3 text-[13px] text-faint">
          Recorded once a day, in USD — never projected
        </div>
        <EquityChart
          points={EQUITY_POINTS}
          fmt={fmtUsdMinor}
          emptyNote="Your history starts today. The first point lands tonight."
        />
      </Card>

      <div className="mt-[18px] flex items-start gap-3.5 rounded-2xl border border-border bg-mint px-[22px] py-[18px]">
        <ShieldCheck className="mt-0.5 h-[22px] w-[22px] flex-none text-teal2" aria-hidden />
        <p className="m-0 text-[14.5px] leading-relaxed text-dim">
          <b className="text-foreground">Held at licensed executing firms.</b> Every instrument is
          custodied and executed by the institution shown on the product. Your agent coordinates and
          monitors; you approve every move.
        </p>
      </div>

      <Dialog open={fundingPartner !== null} onOpenChange={(open) => !open && closeFunding()}>
        <DialogContent className="max-w-[620px] p-0">
          <DialogHeader className="border-b border-border px-6 py-5 pr-14">
            <DialogTitle>Add money at {fundingPartner?.name}</DialogTitle>
            <DialogDescription>
              Fixture walkthrough only. No transfer evidence leaves this browser.
            </DialogDescription>
          </DialogHeader>
          {submitted ? (
            <div className="p-6">
              <div className="flex items-start gap-3 rounded-xl border border-border bg-mint p-4">
                <Check className="mt-0.5 h-5 w-5 text-success" aria-hidden />
                <div>
                  <b>Evidence ready for partner review</b>
                  <p className="mb-0 mt-1 text-sm text-dim">
                    In live use, the institution verifies the receipt or transaction reference
                    before crediting cash. This demo did not upload or submit anything.
                  </p>
                </div>
              </div>
              <Button type="button" className="mt-4 w-full" onClick={closeFunding}>
                Finish walkthrough
              </Button>
            </div>
          ) : (
            <form
              className="grid gap-4 p-6"
              onSubmit={(event) => {
                event.preventDefault();
                setSubmitted(true);
              }}
            >
              <div className="grid grid-cols-2 gap-3 max-[540px]:grid-cols-1">
                <label htmlFor="demo-funding-amount" className="grid gap-1.5 text-sm font-semibold">
                  Amount sent
                  <Input
                    id="demo-funding-amount"
                    required
                    inputMode="decimal"
                    placeholder="1,000"
                  />
                </label>
                <label className="grid gap-1.5 text-sm font-semibold">
                  Currency
                  <select
                    className="h-10 rounded-lg border border-border bg-card px-3"
                    defaultValue="USD"
                  >
                    <option>USD</option>
                    <option>JMD</option>
                  </select>
                </label>
              </div>
              <label
                htmlFor="demo-funding-reference"
                className="grid gap-1.5 text-sm font-semibold"
              >
                Transaction reference
                <Input
                  id="demo-funding-reference"
                  minLength={3}
                  maxLength={120}
                  placeholder="TRD-88214"
                />
                <span className="font-normal text-faint">Optional when you attach a receipt.</span>
              </label>
              <label
                htmlFor="demo-funding-receipt"
                className="grid gap-2 rounded-xl border border-dashed border-border p-4 text-sm font-semibold"
              >
                <span className="flex items-center gap-2">
                  <Upload className="h-4 w-4" aria-hidden />
                  Receipt or transfer confirmation
                </span>
                <Input
                  id="demo-funding-receipt"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  type="file"
                />
                <span className="font-normal text-faint">Optional PDF or image, up to 2 MB.</span>
              </label>
              <Button type="submit">Submit fixture evidence</Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </AppScreen>
  );
}
