'use client';

import { AppScreen, PageHead } from '@/app/_components/AppScreen';
import { Card } from '@/app/_components/ui/card';
import { cn } from '@/app/_lib/utils';
import { ShieldCheck } from 'lucide-react';

const INSTITUTIONS = [
  {
    code: 'NCB',
    name: 'National Commercial Bank',
    kind: 'Bank · Capital Markets',
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
    name: 'Proven Wealth',
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

export default function PortfolioPage() {
  return (
    <AppScreen active="portfolio" basePath="/demo">
      <PageHead
        eyebrow="Every holding, unified · custodied by licensed partners"
        title="Your portfolio"
        right={
          <div className="flex items-baseline gap-2 rounded-xl border border-border bg-mint px-4 py-2.5">
            <b className="font-display text-xl">US$31,350</b>
            <span className="text-[12.5px] text-dim">
              total
              <br />
              net worth
            </span>
          </div>
        }
      />

      <div className="g2">
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
                <div className="text-[11.5px] text-success">· FSC-regulated</div>
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
          </Card>
        ))}
      </div>

      <div className="mt-[18px] flex items-start gap-3.5 rounded-2xl border border-border bg-mint px-[22px] py-[18px]">
        <ShieldCheck className="mt-0.5 h-[22px] w-[22px] flex-none text-teal2" aria-hidden />
        <p className="m-0 text-[14.5px] leading-relaxed text-dim">
          <b className="text-foreground">Held at licensed, FSC-regulated partners.</b> Every
          instrument is custodied and executed by a regulated institution. Your agent coordinates
          and monitors; you approve every move.
        </p>
      </div>
    </AppScreen>
  );
}
