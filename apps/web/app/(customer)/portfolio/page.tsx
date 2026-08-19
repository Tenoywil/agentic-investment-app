'use client';

import { AppScreen, PageHead } from '@/app/_components/AppScreen';
import { EquityChart } from '@/app/_components/EquityChart';
import { PartnerMark, markFor, usePartnerMarks } from '@/app/_components/PartnerMark';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { EmptyState } from '@/app/_components/ui/empty';
import { Skeleton, SkeletonCard, SkeletonRegion } from '@/app/_components/ui/skeleton';
import { useRealtime } from '@/app/_lib/use-realtime';
import { cn } from '@/app/_lib/utils';
import {
  type AllocationSlice,
  type Currency,
  type EquityHistoryPoint,
  type Portfolio,
  PortfolioApiError,
  type PortfolioPartner,
  getEquityHistory,
  getPortfolio,
  pullStatements,
  regulatorLabel,
  requestWithdrawal,
  sendFundingNotice,
} from '@/lib/portfolio-api';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleAlert,
  Link2,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ConnectAccountDialog } from './connect-account';

const CURRENCY_OPTIONS: Currency[] = ['USD', 'JMD', 'TTD', 'GYD', 'BBD', 'XCD', 'BSD'];
const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
type ReceiptType = (typeof RECEIPT_TYPES)[number];

function receiptAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that receipt.'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const separator = result.indexOf(',');
      if (separator < 0) reject(new Error('Could not read that receipt.'));
      else resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** Symbol prefixes for the withdraw dialog's charge estimate, which is
 *  computed client-side as the person types. Everything the server sends
 *  arrives pre-formatted; this is the one figure that must react per keypress. */
const CCY_PREFIX: Record<Currency, string> = {
  USD: 'US$',
  JMD: 'J$',
  TTD: 'TT$',
  GYD: 'G$',
  BBD: 'Bds$',
  XCD: 'EC$',
  BSD: 'B$',
};

function fmtEstimate(minor: number, ccy: Currency): string {
  return `${CCY_PREFIX[ccy]}${(minor / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** USD, whole units, for the equity chart. Snapshots are recorded in USD and
 *  never restated, whatever display currency the header is currently in. */
function fmtUsdMinor(minor: string): string {
  return `${CCY_PREFIX.USD}${(Number(minor) / 100).toLocaleString('en-US', {
    maximumFractionDigits: 0,
  })}`;
}

// Slice colours per instrument_type; the percentages come from the API, which
// derives them from real holdings joined to their instrument.
const ASSET_COLOR: Record<string, string> = {
  bond: '#17786e',
  real_estate: '#f0b98d',
  fund: '#7fb5ad',
  equity: '#c56a3e',
  private: '#9a6a1e',
  other: '#e6dccb',
};

function assetColor(type: string): string {
  return ASSET_COLOR[type] ?? '#e6dccb';
}

/** Horizontal share bar — the allocation the prototype's portfolio view had and
 *  the live screen was missing entirely. Percentages may not total exactly 100
 *  (server-side rounding), so no remainder slice is drawn. */
function AllocationBreakdown({ slices }: { slices: AllocationSlice[] }) {
  return (
    <Card className="mb-4 p-[22px]">
      <b className="font-display text-lg">Allocation</b>
      <div className="mb-3 text-[13px] text-faint">By asset class</div>
      <div className="mb-4 flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {slices.map((a) => (
          <span
            key={a.type}
            style={{ width: `${a.pct}%`, background: assetColor(a.type) }}
            className="h-full"
          />
        ))}
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0">
        {slices.map((a) => (
          <li key={a.type} className="flex items-center gap-2 text-[13.5px]">
            <span
              className="h-2.5 w-2.5 flex-none rounded-[3px]"
              style={{ background: assetColor(a.type) }}
            />
            <span className="text-dim">{a.label}</span>
            <b className="font-mono text-[13px] text-foreground">{a.pct}%</b>
            <span className="text-faint">{a.value}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Money in, money out — one dialog, two modes.
 *
 * Funding: shows the firm's own instructions (or says the firm has not
 * provided them), then takes an "I've sent it" declaration that lands in the
 * firm's reconciliation queue — the screen says plainly that nothing is
 * credited until the firm confirms.
 *
 * Withdrawing: an amount in a currency the account holds cash in. The firm
 * decides; the request is visible on this screen until it does.
 */
function MoneyDialog({
  partner,
  mode,
  onClose,
  onDone,
}: {
  partner: PortfolioPartner;
  mode: 'fund' | 'withdraw';
  onClose: () => void;
  /** A sentence for the page's status line, and a refresh behind it. */
  onDone: (note: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [amt, setAmt] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [reference, setReference] = useState('');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The charge estimate, recomputed per keypress with the same integer
   * arithmetic the database uses (truncating division, GCT on the fee). An
   * estimate because the server freezes the authoritative figures when the
   * request is recorded — but computed identically, so they only differ if the
   * firm changes its rates in the seconds in between.
   */
  const amtMajor = Number.parseFloat(amt.replace(/[^0-9.]/g, ''));
  const estAmtMinor = Number.isFinite(amtMajor) && amtMajor > 0 ? Math.round(amtMajor * 100) : 0;
  const estFeeMinor =
    mode === 'withdraw' && estAmtMinor > 0
      ? Number(partner.withdrawalFeeFlatMinor) +
        Math.floor((estAmtMinor * partner.withdrawalFeeBps) / 10000)
      : 0;
  const estGctMinor = Math.floor((estFeeMinor * partner.gctBps) / 10000);
  const estNetMinor = estAmtMinor - estFeeMinor - estGctMinor;

  useEffect(() => {
    const el = dialogRef.current;
    if (el && !el.open) el.showModal();
    const onBackdrop = (e: MouseEvent) => {
      if (e.target === el) el?.close();
    };
    el?.addEventListener('click', onBackdrop);
    return () => el?.removeEventListener('click', onBackdrop);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const major = Number.parseFloat(amt.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(major) || major <= 0) {
      setError('Enter the amount.');
      return;
    }
    setError(null);
    if (mode === 'fund' && reference.trim() && reference.trim().length < 3) {
      setError('Enter at least 3 characters for the transaction reference.');
      return;
    }
    if (mode === 'fund' && receipt) {
      if (!RECEIPT_TYPES.includes(receipt.type as ReceiptType)) {
        setError('Upload a PDF, JPEG, PNG or WebP receipt.');
        return;
      }
      if (receipt.size > 2 * 1024 * 1024) {
        setError('The receipt must be 2MB or smaller.');
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === 'fund') {
        await sendFundingNotice({
          partnerCode: partner.code,
          amountMinor: String(Math.round(major * 100)),
          currency,
          reference: reference.trim() || undefined,
          receipt: receipt
            ? {
                name: receipt.name,
                mime: receipt.type as ReceiptType,
                data: await receiptAsBase64(receipt),
              }
            : undefined,
        });
        onDone(
          `Told ${partner.name} you've sent money. It appears in your balance once their desk confirms it settled. Nothing is credited before that.`,
        );
      } else {
        await requestWithdrawal({
          partnerCode: partner.code,
          amountMinor: String(Math.round(major * 100)),
          currency,
        });
        onDone(
          `Asked ${partner.name} to pay out. The request stays here until they decide, and your balance changes only when they confirm it's paid.`,
        );
      }
      dialogRef.current?.close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="app-modal" aria-labelledby={titleId} onClose={onClose}>
      <div className="flex flex-none items-start justify-between gap-3 border-0 border-b border-solid border-border px-[22px] py-4">
        <div className="min-w-0">
          <h2 id={titleId} className="font-display text-lg font-bold">
            {mode === 'fund' ? `Add money at ${partner.name}` : `Withdraw from ${partner.name}`}
          </h2>
          <div className="text-[13.5px] text-dim">
            {mode === 'fund'
              ? 'The transfer happens between you and the firm. CCN never holds your money.'
              : `The firm pays you directly${partner.cash ? ` · ${partner.cash} cash available` : ''}.`}
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close"
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <div className="min-h-0 overflow-y-auto overscroll-contain px-[22px] py-[18px]">
        {mode === 'fund' ? (
          <div className="mb-4 rounded-xl bg-[#f4f0e7] px-4 py-3.5 dark:bg-white/[0.04]">
            <div className="mb-1 text-[12px] font-bold uppercase tracking-[.5px] text-dim">
              How to send it
            </div>
            {partner.fundingInstructions ? (
              <p className="m-0 whitespace-pre-line text-sm leading-relaxed">
                {partner.fundingInstructions}
              </p>
            ) : (
              <p className="m-0 text-sm leading-relaxed text-dim">
                {partner.name} hasn't published transfer instructions here yet. Use the account
                details they gave you directly. Once the money settles with them, their desk
                confirms it and it appears in your balance.
              </p>
            )}
          </div>
        ) : null}

        <form
          className="rounded-xl border border-solid border-border bg-muted/20 p-4"
          onSubmit={submit}
        >
          <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-[minmax(0,1fr)_110px]">
            <label className="flex min-w-0 flex-col gap-1 text-[12.5px] font-semibold">
              {mode === 'fund' ? 'Amount you sent' : 'Amount'}
              <input
                value={amt}
                onChange={(e) => setAmt(e.target.value)}
                inputMode="decimal"
                placeholder="1,000"
                disabled={busy}
                className="block w-full rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-left font-mono text-[14px] font-bold text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-[12.5px] font-semibold">
              Currency
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
                disabled={busy}
                className="block h-[38px] w-full rounded-[10px] border border-solid border-border bg-card px-2 text-[13.5px] font-semibold text-foreground"
              >
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {mode === 'fund' ? (
            <div className="mt-3 grid grid-cols-1 gap-3 min-[620px]:grid-cols-2">
              <label className="flex min-w-0 flex-col gap-1 text-[12.5px] font-semibold">
                Transaction reference <span className="font-normal text-faint">Optional</span>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  maxLength={120}
                  placeholder="Bank or wire reference"
                  disabled={busy}
                  className="block w-full rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-[14px] text-foreground"
                />
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-[12.5px] font-semibold">
                Receipt <span className="font-normal text-faint">Optional, up to 2MB</span>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  disabled={busy}
                  onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
                  className="block w-full rounded-[10px] border border-solid border-border bg-card px-2 py-[7px] text-[12.5px] text-dim file:mr-2 file:rounded-md file:border-0 file:bg-mint file:px-2 file:py-1 file:font-semibold file:text-primary"
                />
              </label>
            </div>
          ) : null}

          <div className="mt-4 flex justify-end">
            <Button type="submit" disabled={busy} className="max-[440px]:w-full">
              {busy
                ? 'Sending…'
                : mode === 'fund'
                  ? 'Submit transfer evidence'
                  : 'Request withdrawal'}
            </Button>
          </div>
        </form>
        {/* What the firm's charges do to this amount, before the person asks.
            Shown only when the firm charges anything — a "US$0.00 fee" line
            would be noise dressed as disclosure. */}
        {mode === 'withdraw' && estAmtMinor > 0 && estFeeMinor + estGctMinor > 0 ? (
          <div className="mt-3 rounded-xl bg-[#f4f0e7] px-4 py-3 text-[13px] leading-relaxed dark:bg-white/[0.04]">
            {estNetMinor > 0 ? (
              <>
                <div className="flex justify-between">
                  <span className="text-dim">{partner.name}&rsquo;s fee</span>
                  <span className="font-mono">{fmtEstimate(estFeeMinor, currency)}</span>
                </div>
                {estGctMinor > 0 ? (
                  <div className="flex justify-between">
                    <span className="text-dim">GCT on the fee</span>
                    <span className="font-mono">{fmtEstimate(estGctMinor, currency)}</span>
                  </div>
                ) : null}
                <div className="mt-1 flex justify-between border-0 border-t border-solid border-border pt-1 font-bold">
                  <span>You receive about</span>
                  <span className="font-mono">{fmtEstimate(estNetMinor, currency)}</span>
                </div>
              </>
            ) : (
              <span className="text-[#a44e20] dark:text-terra">
                The firm&rsquo;s charges ({fmtEstimate(estFeeMinor + estGctMinor, currency)}) would
                consume this amount. Ask for more, or contact {partner.name}.
              </span>
            )}
          </div>
        ) : null}
        {error ? (
          <p className="mt-2.5 flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra">
            <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
            {error}
          </p>
        ) : null}
        <p className="mb-0 mt-3 text-[12.5px] leading-relaxed text-faint">
          {mode === 'fund'
            ? 'This tells the firm to look out for your transfer. Their desk confirms it settled; nothing is credited on your say-so.'
            : 'One request at a time per account. If the firm declines, it tells you why here. Charges are fixed when you ask, and a rate change later never changes a request already made.'}
        </p>
      </div>
    </dialog>
  );
}

export default function PortfolioPage() {
  const [data, setData] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Brand marks for the connected firms — one cached read, decorative only. */
  const marks = usePartnerMarks();
  /**
   * The recorded equity curve, one point per day. Null until it arrives — a
   * failed read stays null and the section simply does not render, because a
   * chart is a nice-to-have and an error banner about it is not.
   */
  const [equity, setEquity] = useState<EquityHistoryPoint[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    getEquityHistory()
      .then(({ points }) => {
        if (!cancelled) setEquity(points);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  // Display currency is a server concern: @ccn/money does the conversion so the
  // client never re-implements FX. Changing it refetches rather than converting
  // the numbers we already hold.
  const [currency, setCurrency] = useState<Currency>('USD');

  /**
   * Connecting an account is how anything gets into this screen. Without it an
   * investor finished onboarding, arrived here, and had no way to put anything
   * in — and with no cash, every order they tried was refused by their own cash
   * floor.
   */
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState<string | null>(null);
  /**
   * The load, callable rather than only an effect, because connecting an
   * account has to ask for it directly — the holdings it just pulled are the
   * whole point of the screen, and a counter in a dependency array is a
   * roundabout way of saying "fetch again".
   */
  const load = useCallback(
    (signal?: { cancelled: boolean }) => {
      setLoading(true);
      setError(null);
      return getPortfolio(currency)
        .then((portfolio) => {
          if (!signal?.cancelled) setData(portfolio);
        })
        .catch((err) => {
          if (signal?.cancelled) return;
          if (err instanceof PortfolioApiError && err.status === 401) {
            setError('Your session has expired. Please sign in again to view your portfolio.');
          } else {
            setError(err instanceof Error ? err.message : 'Could not load your portfolio.');
          }
        })
        .finally(() => {
          if (!signal?.cancelled) setLoading(false);
        });
    },
    [currency],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [load]);

  /**
   * The realtime refresh is deliberately not `load`: that one raises the
   * skeleton, and replacing a screen somebody is reading with grey boxes
   * because a partner settled an order elsewhere is a worse experience than the
   * staleness it fixes. This swaps the numbers underneath them instead.
   *
   * Both events matter here. A settled order changes what they hold; a
   * connection decision is the thing a new investor is actually waiting on, and
   * until now the only way to discover the firm had accepted them was to reload
   * a screen that gave them no reason to think anything had changed.
   */
  const refresh = useCallback(() => {
    void getPortfolio(currency)
      .then(setData)
      .catch(() => {});
  }, [currency]);

  // `withdrawal` too: the firm deciding one is exactly the moment this screen
  // is being watched for.
  useRealtime(['order', 'connection', 'withdrawal'], refresh);

  /** The money dialog — funding instructions or a withdrawal request. */
  const [money, setMoney] = useState<{
    partner: PortfolioPartner;
    mode: 'fund' | 'withdraw';
  } | null>(null);

  /**
   * Pull the latest statements from one firm.
   *
   * The ingestion pipeline — statement in, holdings updated, anything unmatched
   * queued for the firm to resolve — has existed since it was written and had no
   * caller anywhere, so the console's reconciliation queue and its Match and
   * Reject buttons were unreachable through the product. This is the button that
   * feeds it, on the screen where the balances it corrects are shown.
   */
  const [pulling, setPulling] = useState<string | null>(null);
  const [pullNote, setPullNote] = useState<string | null>(null);

  async function handlePull(code: string) {
    setPulling(code);
    setPullNote(null);
    try {
      const { queued } = await pullStatements(code);
      setPullNote(
        queued === 0
          ? 'Statements checked. Nothing new to reconcile.'
          : `Statements checked. ${queued} line${queued === 1 ? '' : 's'} sent to the firm to reconcile.`,
      );
      refresh();
    } catch (err) {
      setPullNote(err instanceof Error ? err.message : 'Could not check for statements.');
    } finally {
      setPulling(null);
    }
  }

  const pendingOrDeclined = (data?.connections ?? []).filter((c) => c.status !== 'active');

  return (
    <AppScreen active="portfolio">
      <PageHead
        eyebrow="Every holding, unified · custodied by licensed partners"
        title="Your portfolio"
        right={
          // Wraps, because three controls do not fit across a phone. PageHead
          // wraps its own two children but this cluster did not wrap inside
          // itself, so adding the Connect button here pushed the document to
          // 610px in a 390px viewport and the whole screen scrolled sideways.
          <div
            className="flex flex-wrap items-center justify-end gap-3"
            data-tour="customer-portfolio-page"
          >
            {/* Also in the empty state, but it cannot only live there: an
                investor with one account still needs to add the second. */}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setConnecting(true)}
              data-tour="customer-portfolio-connect"
            >
              <Link2 className="mr-1.5 h-4 w-4" aria-hidden />
              Connect an account
            </Button>
            {/* A dropdown, not a chip-per-currency row: at seven supported
                currencies the chips outgrew the header, on a phone especially. */}
            <label className="flex items-center gap-1.5">
              <span className="sr-only">Display currency</span>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
                className="h-9 rounded-xl border border-solid border-border bg-card px-2.5 font-sans text-[13px] font-bold text-foreground"
              >
                {CURRENCY_OPTIONS.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            {data ? (
              <div className="flex items-baseline gap-2 rounded-xl border border-solid border-border bg-mint px-4 py-2.5">
                <b className="font-display text-xl">{data.netWorth}</b>
                <span className="text-[12.5px] text-dim">
                  total
                  <br />
                  net worth
                </span>
              </div>
            ) : null}
          </div>
        }
      />

      {/*
        Where a converted figure's rate came from.

        Everything above is stated in the chosen currency, and until the rates
        moved into the database that conversion ran on three constants compiled
        into @ccn/money from the prototype — so a portfolio read in JMD was
        restated at a rate nobody had checked in months, with no more hedging
        than the balance itself. CCN routes orders and holds no money; it has no
        rate of its own to quote, and the honest thing to show is the central
        bank's, dated. When the rate is old, or when it is the seeded fallback
        that no bank published, the line says so rather than quietly rounding.
      */}
      {pullNote ? <output className="mb-3 block text-[13px] text-dim">{pullNote}</output> : null}

      {/*
        The currency asked for could not be converted to, so these figures are in
        USD. Saying so matters more than it looks: without it the screen silently
        changes units under somebody comparing two numbers, which is a worse
        failure than the 500 this replaced.
      */}
      {data?.requestedCurrency ? (
        <p className="-mt-1 mb-4 flex items-center gap-2 text-[13px] text-[#a44e20] dark:text-terra">
          <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
          Showing {data.currency}. No published rate for {data.requestedCurrency} could be read just
          now, and converting at an unpublished one would be a guess.
        </p>
      ) : null}

      {data?.fx?.source ? (
        <p className="-mt-1 mb-4 text-[12.5px] text-faint">
          {data.fx.source === 'seed' ? (
            <>Converted at a fallback rate. No published rate has been loaded for {currency} yet.</>
          ) : (
            <>
              Converted at the {data.fx.source} rate {data.fx.asOf ? `of ${data.fx.asOf}` : ''}
              {data.fx.stale ? ' · this rate is out of date' : ''}
            </>
          )}
        </p>
      ) : null}

      {/* Directly under the head, because it answers a button the reader just
          pressed. It used to render below the empty state, a screen's height
          from where they were looking. */}
      {connected ? (
        <output className="mb-4 block rounded-xl border border-solid border-border bg-mint px-4 py-3 text-[14px] leading-relaxed text-success-ink">
          {connected}
        </output>
      ) : null}

      {loading && !data && (
        // Mirrors the real shape: the allocation bar, then one row per partner.
        // Only before the FIRST load: switching currency or refetching must not
        // blank a screen somebody is reading into grey boxes — the numbers swap
        // in place when the new read lands.
        <SkeletonRegion label="Loading your portfolio">
          <SkeletonCard lines={2} className="mb-4" />
          <div className="flex flex-col gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg border border-solid border-border bg-card p-[18px]"
              >
                <Skeleton className="h-10 w-10 flex-none rounded-[10px]" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="mb-1.5 h-3.5 w-2/5" />
                  <Skeleton className="h-3 w-3/5" />
                </div>
                <Skeleton className="h-4 w-20 flex-none" />
              </div>
            ))}
          </div>
        </SkeletonRegion>
      )}

      {error && (
        <p className="mb-4 flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra">
          <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
          {error}
        </p>
      )}

      {/* Links that hold nothing yet: waiting on the firm, or refused by it.
          Both are states an investor actively looks for, and neither produces a
          holding, so neither appears in the section below. */}
      {data && pendingOrDeclined.length > 0 && (
        <Card className="mb-4 p-[22px]">
          <b className="font-display text-lg">Requested</b>
          <div className="mb-3 text-[13px] text-faint">
            An institution decides whether to take you on as a client. CCN passes them the
            verification you have already done; nothing is read from them until they accept.
          </div>
          <ul className="m-0 list-none p-0">
            {pendingOrDeclined.map((c) => (
              <li
                key={c.code}
                className="flex items-center justify-between gap-3 border-0 border-t border-solid border-border py-[11px] first:border-t-0"
              >
                <div className="min-w-0">
                  <div className="text-[14.5px] font-bold">{c.name}</div>
                  <div className="text-[12.5px] text-faint">
                    {c.status === 'pending'
                      ? 'Waiting on their compliance desk'
                      : (c.declineReason ?? 'They did not take this on')}
                  </div>
                </div>
                <span
                  className={cn(
                    'flex-none rounded-full px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-[.4px]',
                    c.status === 'pending'
                      ? 'bg-muted text-dim'
                      : 'bg-[#f7e9e2] text-[#a44e20] dark:bg-terra/15 dark:text-terra',
                  )}
                >
                  {c.status === 'pending' ? 'Pending' : 'Declined'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data && data.partners.length === 0 && !error && (
        <EmptyState
          icon={Wallet}
          title="No holdings yet"
          body="Link an account and, once that institution accepts you as a client, every position you hold there appears here. CCN reads your balances; your institution keeps executing, custodying and settling."
          action={
            <Button type="button" size="sm" onClick={() => setConnecting(true)}>
              <Link2 className="mr-1.5 h-4 w-4" aria-hidden />
              Connect an account
            </Button>
          }
        />
      )}

      {money ? (
        <MoneyDialog
          partner={money.partner}
          mode={money.mode}
          onClose={() => setMoney(null)}
          onDone={(note) => {
            setPullNote(note);
            refresh();
          }}
        />
      ) : null}

      {/* What happened to money on its way out. Decided requests carry the
          firm's reference or its reason — the investor's record. */}
      {data?.withdrawals.some((w) => w.status !== 'pending') ? (
        <Card className="mb-4 p-[18px]">
          <b className="font-display text-[15px]">Recent withdrawals</b>
          <ul className="m-0 mt-2 list-none p-0">
            {(data?.withdrawals ?? [])
              .filter((w) => w.status !== 'pending')
              .slice(0, 3)
              .map((w) => (
                <li
                  key={w.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 border-0 border-t border-solid border-border py-2 first:border-t-0"
                >
                  <span className="text-sm">
                    <b className="font-mono">{w.amount}</b> from {w.partnerCode}
                  </span>
                  <span
                    className={cn(
                      'text-[13px]',
                      w.status === 'paid' ? 'text-success-ink' : 'text-[#a44e20] dark:text-terra',
                    )}
                  >
                    {w.status === 'paid'
                      ? // The net is the money that actually arrived; naming it
                        // beside the gross is the fee disclosure, after the fact.
                        `Paid ${w.fee || w.gct ? `${w.net} after charges` : ''}${w.reference ? ` · ref ${w.reference}` : ''}`.trim()
                      : `Declined${w.reason ? `: ${w.reason}` : ''}`}
                  </span>
                </li>
              ))}
          </ul>
        </Card>
      ) : null}

      {connecting ? (
        <ConnectAccountDialog
          excludedPartnerCodes={(data?.connections ?? [])
            .filter(
              (connection) => connection.status === 'active' || connection.status === 'pending',
            )
            .map((connection) => connection.code)}
          onClose={() => setConnecting(false)}
          onConnected={(summary) => {
            setConnected(
              summary.status === 'pending'
                ? `Asked ${summary.partner} to take you on. They review the verification CCN passes them, and your positions appear here once they accept.`
                : `${summary.refreshed ? 'Refreshed' : 'Connected'} ${summary.partner}: ${summary.holdings} position${summary.holdings === 1 ? '' : 's'}.`,
            );
            void load();
          }}
        />
      ) : null}

      {data && data.allocation.length > 0 && <AllocationBreakdown slices={data.allocation} />}

      {data && data.partners.length > 0 && (
        <div className="g2" data-tour="customer-portfolio-accounts">
          {data.partners.map((inst) => {
            const mark = markFor(marks, { code: inst.code, name: inst.name });
            return (
              <Card key={inst.code} className="p-[22px]">
                <div className="mb-3 flex items-center gap-3">
                  {/* The firm's own mark: its uploaded logo when it has one,
                      its monogram tile otherwise. */}
                  <PartnerMark
                    name={inst.name}
                    code={inst.code}
                    id={mark?.id}
                    hasLogo={mark?.hasLogo}
                    color={mark?.color}
                    tint={mark?.tint}
                    size="md"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-bold">{inst.name}</div>
                    {inst.kind && <div className="text-[12.5px] text-faint">{inst.kind}</div>}
                    {/*
                      When these balances were last pulled from the firm.

                      `holdings.updated_at` has been written on every refresh
                      since the table existed and read by nothing, so a figure
                      pulled at signup and one pulled a minute ago looked
                      identical. A balance is a claim about a moment, and the
                      moment was the missing half.
                    */}
                    {inst.asOf && (
                      <div className="text-[12.5px] text-faint">
                        Balances as of{' '}
                        {new Date(inst.asOf).toLocaleDateString('en-US', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[15px] font-bold">{inst.total}</div>
                    {/* The balance at this firm, as distinct from the header's
                        net worth: cash settled with one partner is not spendable
                        at another, so it is stated per card. */}
                    {inst.cash && (
                      <div className="text-[12px] font-semibold text-teal2">
                        {inst.cash} cash available
                      </div>
                    )}
                    {/* This partner's regulator, from the partners table.
                        Previously every institution carried a static
                        "· FSC-regulated", true of the seeded Jamaican partners
                        and an unverifiable claim for anyone else. Nothing is
                        rendered when the record names no regulator. */}
                    {inst.regulator && (
                      <div className="text-[11.5px] text-success-ink">
                        {regulatorLabel(inst.regulator)}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => void handlePull(inst.code)}
                      disabled={pulling === inst.code}
                      className="mt-1 text-[12px] font-semibold text-primary underline disabled:opacity-60"
                    >
                      {pulling === inst.code ? 'Checking…' : 'Check for statements'}
                    </button>
                  </div>
                </div>

                {/* Money moves here, per firm — funding and withdrawal are
                    relationships with THIS institution, not with CCN. */}
                <div className="mb-1 flex flex-wrap items-center gap-2 border-0 border-t border-solid border-border pt-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-tour="customer-portfolio-funding"
                    onClick={() => setMoney({ partner: inst, mode: 'fund' })}
                  >
                    <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                    Add money
                  </Button>
                  {(() => {
                    const pendingHere = (data?.withdrawals ?? []).find(
                      (w) => w.partnerCode === inst.code && w.status === 'pending',
                    );
                    return pendingHere ? (
                      <span className="text-[12.5px] text-dim">
                        Withdrawal of {pendingHere.amount} pending with the firm
                      </span>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!inst.cash}
                        onClick={() => setMoney({ partner: inst, mode: 'withdraw' })}
                      >
                        <ArrowUpFromLine className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                        Withdraw
                      </Button>
                    );
                  })()}
                </div>
                {inst.holdings.map((h, i) => (
                  <div
                    // Name is not unique: two accounts at one firm can hold
                    // instruments with the same name, and React collapsed them
                    // onto one row.
                    key={`${h.name}-${i}`}
                    className="flex items-center justify-between gap-3 border-t border-border py-[11px]"
                  >
                    <span className="text-sm">{h.name}</span>
                    <span className="flex items-baseline gap-2.5">
                      <b className="font-mono text-[13.5px]">{h.value}</b>
                      {/* No return label on this holding means the partner
                          statement carried none — nothing is printed, rather
                          than a dash that reads like a measured zero.
                          Coloured by sign: this was success green whatever the
                          figure said, so a statement reporting "-4.2%" was
                          rendered in the colour the product uses for a gain. */}
                      {h.ret !== null && (
                        <span
                          className={cn(
                            'min-w-[42px] text-right text-[13px]',
                            h.ret.trim().startsWith('-')
                              ? 'text-[#a44e20] dark:text-terra'
                              : 'text-success-ink',
                          )}
                        >
                          {h.ret}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </Card>
            );
          })}
        </div>
      )}

      {/*
        Your money over time: the recorded curve, after the holdings it
        summarises. Every point is a day the recorder actually measured;
        nothing is projected or back-filled. Today's live total (the same
        netWorthMinor the header shows) is appended as a "now" point so day
        one still shows something — but only when the last recorded day isn't
        today, and only while the display currency is USD: snapshots are
        recorded in USD, and a JMD-restated total appended to a USD series
        would be two units on one line.
      */}
      {equity !== null &&
        (() => {
          const todayIso = new Date().toISOString().slice(0, 10);
          const series: { label: string; valueMinor: string }[] = equity.map((p) => ({
            label: p.takenOn,
            valueMinor: p.netWorthMinor,
          }));
          const lastRecorded = series[series.length - 1];
          if (data && data.currency === 'USD' && lastRecorded?.label !== todayIso) {
            series.push({ label: 'now', valueMinor: data.netWorthMinor });
          }
          const firstPoint = series[0];
          const lastPoint = series[series.length - 1];
          const change =
            series.length >= 2 && firstPoint && lastPoint
              ? Number(lastPoint.valueMinor) - Number(firstPoint.valueMinor)
              : null;
          const firstMinor = firstPoint ? Number(firstPoint.valueMinor) : 0;
          const changePct =
            change !== null && firstMinor > 0 ? Math.abs((change / firstMinor) * 100) : null;
          return (
            <Card className="mt-[18px] p-[22px]">
              <b className="font-display text-lg">Your money over time</b>
              <div className="mb-3 text-[13px] text-faint">
                Recorded once a day, in USD, never projected
              </div>
              <EquityChart
                points={series}
                fmt={fmtUsdMinor}
                emptyNote="Your history starts today. The first point lands tonight."
              />
              {change !== null && firstPoint && (
                <p className="mb-0 mt-3 text-[13px] text-dim">
                  <b
                    className={change >= 0 ? 'text-success-ink' : 'text-[#a44e20] dark:text-terra'}
                  >
                    {change >= 0 ? '+' : '−'}
                    {fmtUsdMinor(String(Math.abs(change)))}
                    {changePct !== null && (
                      <>
                        {' '}
                        ({change >= 0 ? '+' : '−'}
                        {changePct.toFixed(1)}%)
                      </>
                    )}
                  </b>{' '}
                  since {firstPoint.label}
                </p>
              )}
            </Card>
          );
        })()}

      {/* One line, not a paragraph: the full custody explanation lives on
          /how-it-works, and repeating it here cost a phone half a screen. */}
      <div className="mt-[18px] flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border bg-mint px-4 py-2.5 text-[13.5px] text-dim">
        <ShieldCheck className="h-4 w-4 flex-none text-teal2" aria-hidden />
        <span className="min-w-0">Held and executed by licensed partners, never by CCN.</span>
        <Link
          href="/how-it-works"
          className="font-bold text-teal2 no-underline underline-offset-4 hover:underline"
        >
          How it works →
        </Link>
      </div>
    </AppScreen>
  );
}
