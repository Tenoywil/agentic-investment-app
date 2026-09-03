'use client';

import {
  AppScreen,
  PageHead,
  readDemoAccountState,
  writeDemoAccountState,
} from '@/app/_components/AppScreen';
import { EquityChart } from '@/app/_components/EquityChart';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/_components/ui/dialog';
import { Input } from '@/app/_components/ui/input';
import { cn } from '@/app/_lib/utils';
import { Check, Link2, ShieldCheck, Upload } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';

const INSTITUTIONS = [
  {
    code: 'NCB',
    regulator: 'FSC-regulated',
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
    regulator: 'FSC-regulated',
    name: 'Sagicor Investments',
    kind: 'Funds · Insurance',
    total: 'US$8,200',
    tint: '#e6f2ea',
    color: '#1f7a44',
    holdings: [{ name: 'Sagicor Sigma Global Fund', value: 'US$8,200', ret: '+4.1%' }],
  },
  {
    code: 'PRV',
    regulator: 'FSC-regulated',
    name: 'PROVEN Wealth',
    kind: 'Wealth Management',
    total: 'US$5,600',
    tint: '#f6efe0',
    color: '#9a6a1e',
    holdings: [{ name: 'Proven USD Income Fund', value: 'US$5,600', ret: '+5.9%' }],
  },
  {
    code: 'JMMB',
    regulator: 'BOJ-regulated',
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

/** Partners in the network that are not already represented in Marcus's
 * consolidated holdings. The live flow never offers an active relationship a
 * second time; the demo follows that same rule and keeps the other corridors
 * available for a first connection. */
const CONNECTABLE_INSTITUTIONS = [
  {
    code: 'BAR',
    name: 'Barita Investments',
    kind: 'Broker · Investments',
    regulator: 'FSC-regulated',
  },
  { code: 'REP', name: 'Republic Bank', kind: 'Bank · Treasury', regulator: 'BOJ-regulated' },
  { code: 'SYG', name: 'Sygnus Capital', kind: 'Private credit', regulator: 'FSC-regulated' },
];

/** The neutral chip a freshly linked partner is drawn with until it reports a
 *  position — the four seeded partners carry the brand tints they were given
 *  in the fixture, and inventing one for an arbitrary partner would be worse
 *  than a plain, legible chip. */
const NEW_CONNECTION_STYLE = { tint: '#e7edf8', color: '#1a4aa0' };

const DEFAULT_CONNECT_PARTNER = CONNECTABLE_INSTITUTIONS[0]?.code ?? '';

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
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectPartner, setConnectPartner] = useState(DEFAULT_CONNECT_PARTNER);
  const [connectMode, setConnectMode] = useState<'existing' | 'new' | null>(null);
  const [connectSubmitted, setConnectSubmitted] = useState(false);
  const [connectedPartners, setConnectedPartners] = useState<string[]>([]);
  const [requestedPartners, setRequestedPartners] = useState<string[]>([]);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);

  const availableToConnect = CONNECTABLE_INSTITUTIONS.filter(
    (partner) =>
      !connectedPartners.includes(partner.code) && !requestedPartners.includes(partner.code),
  );
  /* Linking a partner set state that nothing on the page read, so the one
     outcome the "Connect an account" journey exists to show — the account
     appearing in the portfolio — never appeared. Both surfaces now render it
     the way the live screen does: a linked partner joins the accounts grid,
     and one waiting on a compliance desk sits in "Requested" above it. */
  const linkedPartners = CONNECTABLE_INSTITUTIONS.filter((partner) =>
    connectedPartners.includes(partner.code),
  );
  const pendingPartners = CONNECTABLE_INSTITUTIONS.filter((partner) =>
    requestedPartners.includes(partner.code),
  );

  function closeFunding() {
    setFundingPartner(null);
    setSubmitted(false);
  }

  function openFunding(partner: (typeof INSTITUTIONS)[number]) {
    setFundingPartner(partner);
    setSubmitted(false);
  }

  function submitFunding() {
    if (!fundingPartner) return;
    const accountState = readDemoAccountState();
    writeDemoAccountState({
      ...accountState,
      fundedPartners: [...accountState.fundedPartners, fundingPartner.code],
    });
    setSubmitted(true);
  }

  function openConnect() {
    setConnectPartner(availableToConnect[0]?.code ?? '');
    setConnectMode(null);
    setConnectSubmitted(false);
    setConnectOpen(true);
  }

  function closeConnect() {
    setConnectOpen(false);
    setConnectMode(null);
    setConnectSubmitted(false);
  }

  function submitConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!connectMode || !availableToConnect.some((partner) => partner.code === connectPartner)) {
      return;
    }
    const partnerName =
      CONNECTABLE_INSTITUTIONS.find((partner) => partner.code === connectPartner)?.name ??
      'That institution';
    if (connectMode === 'existing') {
      setConnectedPartners((current) =>
        current.includes(connectPartner) ? current : [...current, connectPartner],
      );
      setConnectionNotice(
        `${partnerName} is now linked. Its positions will appear here when the institution reports them.`,
      );
    } else {
      setRequestedPartners((current) =>
        current.includes(connectPartner) ? current : [...current, connectPartner],
      );
      setConnectionNotice(
        `Request sent to ${partnerName}. Their compliance desk will confirm the relationship.`,
      );
    }
    setConnectSubmitted(true);
  }

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('connect') !== '1') return;
    setConnectOpen(true);
    setConnectMode(null);
    setConnectSubmitted(false);
  }, []);

  return (
    <AppScreen active="portfolio" basePath="/demo">
      <PageHead
        eyebrow="Every holding, unified · custodied by licensed partners"
        title="Your portfolio"
        right={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={openConnect}
              data-tour="customer-portfolio-connect"
            >
              <Link2 className="mr-1.5 h-4 w-4" aria-hidden />
              Connect an account
            </Button>
            {/* `border-solid` is load-bearing: preflight is off, so a bare
                `border` sets a width against a `border-style` of none and the
                pill renders with no outline at all — the live header's does. */}
            <div
              className="flex items-baseline gap-2 rounded-xl border border-solid border-border bg-mint px-4 py-2.5"
              data-tour="customer-portfolio-page"
            >
              <b className="font-display text-xl">US$31,350</b>
              <span className="text-[12.5px] text-dim">
                total
                <br />
                net worth
              </span>
            </div>
          </div>
        }
      />

      {connectionNotice ? (
        <output className="mb-4 block rounded-xl border border-solid border-border bg-mint px-4 py-3 text-[14px] leading-relaxed text-success-ink">
          {connectionNotice}
        </output>
      ) : null}

      {pendingPartners.length > 0 ? (
        <Card className="mb-4 p-[22px]">
          <b className="font-display text-lg">Requested</b>
          <div className="mb-3 text-[13px] text-faint">
            An institution decides whether to take you on as a client. With your consent, CCN passes
            the intake details and declarations you recorded; nothing is read from them until they
            accept.
          </div>
          <ul className="m-0 list-none p-0">
            {pendingPartners.map((partner) => (
              <li
                key={partner.code}
                className="flex items-center justify-between gap-3 border-0 border-t border-solid border-border py-[11px] first:border-t-0"
              >
                <div className="min-w-0">
                  <div className="text-[14.5px] font-bold">{partner.name}</div>
                  <div className="text-[12.5px] text-faint">Waiting on their compliance desk</div>
                </div>
                <span className="flex-none rounded-full bg-muted px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-[.4px] text-dim">
                  Pending
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="g2" data-tour="customer-portfolio-accounts">
        {linkedPartners.map((partner) => (
          <Card key={partner.code} className="p-[22px]">
            <div className="mb-3 flex items-center gap-3">
              <span
                className="grid h-10 w-10 flex-none place-items-center rounded-[10px] font-mono text-xs font-bold"
                style={{ background: NEW_CONNECTION_STYLE.tint, color: NEW_CONNECTION_STYLE.color }}
              >
                {partner.code}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold">{partner.name}</div>
                <div className="text-[12.5px] text-faint">{partner.kind}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[15px] font-bold">—</div>
                <div className="text-[11.5px] text-success-ink">{partner.regulator}</div>
              </div>
            </div>
            <p className="m-0 border-t border-solid border-border pt-[11px] text-[13px] leading-relaxed text-dim">
              Linked. Positions appear here once {partner.name} next reports them.
            </p>
          </Card>
        ))}
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
                {/* The partner's own regulator, and no orphaned leading middot
                    — the live row prints the regulator alone. */}
                <div className="text-[11.5px] text-success-ink">{inst.regulator}</div>
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
                  {/* `text-success` is tuned for fills and large numerals; at
                      13px it measures under the 4.5:1 floor, which is why the
                      live row uses the -ink variant. */}
                  <span
                    className={cn(
                      'min-w-[42px] text-right text-[13px]',
                      h.ret === '—' ? 'text-faint' : 'text-success-ink',
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
              onClick={() => openFunding(inst)}
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

      <Dialog open={connectOpen} onOpenChange={(open) => !open && closeConnect()}>
        <DialogContent className="app-modal max-w-none flex flex-col gap-0 p-0 max-[900px]:bottom-0 max-[900px]:top-auto max-[900px]:translate-y-0">
          <DialogHeader className="border-0 border-b border-solid border-border px-[22px] py-4 pr-14">
            <DialogTitle>Connect an account</DialogTitle>
            <DialogDescription>
              The institution decides whether to take you on, then your positions and cash come
              straight from them.
            </DialogDescription>
          </DialogHeader>
          {connectSubmitted ? (
            <div className="grid min-h-0 gap-4 overflow-y-auto overscroll-contain px-[22px] py-[18px] pb-[calc(22px+env(safe-area-inset-bottom))]">
              <div className="flex items-start gap-3 rounded-xl border border-border bg-mint p-4">
                <Check className="mt-0.5 h-5 w-5 flex-none text-success" aria-hidden />
                <div>
                  <b>{connectMode === 'existing' ? 'Account linked' : 'Account request sent'}</b>
                  <p className="mb-0 mt-1 text-sm text-dim">
                    {connectMode === 'existing'
                      ? 'The account is now available to this portfolio. Positions appear as the institution reports them.'
                      : 'The institution received your intake details and will confirm whether to take you on as a client.'}
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" className="w-full" onClick={closeConnect}>
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form
              className="min-h-0 overflow-y-auto overscroll-contain px-[22px] py-[18px] pb-[calc(22px+env(safe-area-inset-bottom))]"
              onSubmit={submitConnect}
            >
              {availableToConnect.length === 0 ? (
                <div className="grid gap-4">
                  <p className="m-0 text-[14.5px] leading-relaxed text-dim">
                    Every available partner is already connected or has a request waiting with its
                    compliance desk.
                  </p>
                  <DialogFooter>
                    <Button type="button" className="w-full" onClick={closeConnect}>
                      Done
                    </Button>
                  </DialogFooter>
                </div>
              ) : (
                <div className="grid gap-4">
                  <label className="grid gap-1.5 text-[13.5px]" htmlFor="demo-connect-partner">
                    <span className="text-[12px] font-bold uppercase tracking-[.6px] text-dim">
                      Institution
                    </span>
                    <select
                      id="demo-connect-partner"
                      value={connectPartner}
                      onChange={(event) => {
                        setConnectPartner(event.target.value);
                        setConnectMode(null);
                      }}
                      className="block h-10 w-full rounded-[10px] border border-solid border-border bg-card px-3 text-[15px] text-foreground"
                    >
                      {availableToConnect.map((inst) => (
                        <option key={inst.code} value={inst.code}>
                          {inst.name} · {inst.kind}
                        </option>
                      ))}
                    </select>
                  </label>

                  <fieldset className="m-0 mt-1 border-0 p-0">
                    <legend className="p-0 text-[12px] font-bold uppercase tracking-[.6px] text-dim">
                      Do you already have an account with this institution?
                    </legend>
                    <div className="mt-2 grid grid-cols-2 gap-2 max-[440px]:grid-cols-1">
                      {(
                        [
                          {
                            value: 'existing',
                            title: 'Yes, connect it',
                            sub: 'Link what I already hold',
                          },
                          { value: 'new', title: "No, I'm new", sub: 'Ask them to open one' },
                        ] as const
                      ).map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={connectMode === option.value}
                          onClick={() => setConnectMode(option.value)}
                          className={cn(
                            'rounded-xl border border-solid px-3.5 py-3 text-left',
                            connectMode === option.value
                              ? 'border-primary bg-mint'
                              : 'border-border bg-card',
                          )}
                        >
                          <span className="block text-[14.5px] font-bold">{option.title}</span>
                          <span className="mt-0.5 block text-[12.5px] text-dim">{option.sub}</span>
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <p className="m-0 text-[12.5px] leading-relaxed text-faint">
                    They receive the identity details and declarations you recorded. Their
                    compliance desk decides what evidence it needs; they execute, custody and settle
                    the investments.
                  </p>
                  <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                    <Button type="button" variant="ghost" onClick={closeConnect}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={!connectMode}>
                      {connectMode === 'existing' ? 'Request the connection' : 'Request an account'}
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={fundingPartner !== null} onOpenChange={(open) => !open && closeFunding()}>
        <DialogContent className="app-modal max-w-none flex flex-col gap-0 p-0 max-[900px]:bottom-0 max-[900px]:top-auto max-[900px]:translate-y-0">
          <DialogHeader className="border-0 border-b border-solid border-border px-[22px] py-4 pr-14">
            <DialogTitle>Add money at {fundingPartner?.name}</DialogTitle>
            <DialogDescription>
              The transfer happens between you and the firm. CCN never holds your money.
            </DialogDescription>
          </DialogHeader>
          {submitted ? (
            <div className="min-h-0 overflow-y-auto overscroll-contain px-[22px] py-[18px] pb-[calc(22px+env(safe-area-inset-bottom))]">
              <div className="flex items-start gap-3 rounded-xl border border-border bg-mint p-4">
                <Check className="mt-0.5 h-5 w-5 text-success" aria-hidden />
                <div>
                  <b>Funding notice sent</b>
                  <p className="mb-0 mt-1 text-sm text-dim">
                    {fundingPartner?.name} will verify the receipt or transaction reference before
                    crediting cash to your account.
                  </p>
                </div>
              </div>
              <Button type="button" className="mt-4 w-full" onClick={closeFunding}>
                Done
              </Button>
            </div>
          ) : (
            <form
              className="grid min-h-0 gap-4 overflow-y-auto overscroll-contain px-[22px] py-[18px] pb-[calc(22px+env(safe-area-inset-bottom))]"
              onSubmit={(event) => {
                event.preventDefault();
                submitFunding();
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
              <Button type="submit">Submit transfer evidence</Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </AppScreen>
  );
}
