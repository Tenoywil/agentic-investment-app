'use client';

import { PartnerMark, markFor, usePartnerMarks } from '@/app/_components/PartnerMark';
import { Button } from '@/app/_components/ui/button';
import { useSheetDismiss } from '@/app/_lib/sheet';
import { cn } from '@/app/_lib/utils';
import { connectAccount, getNetworkPartners } from '@/lib/portfolio-api';
import { CircleAlert, X } from 'lucide-react';
import * as React from 'react';

/**
 * Connecting an account at a partner.
 *
 * This is the step the customer side was missing entirely. An investor could
 * sign up, finish onboarding and reach a portfolio with nothing in it — and
 * because they had no cash, every order they tried drew them below their cash
 * floor and the guardrail refused it. Correct behaviour, terminal experience:
 * the product had no way for anyone to put anything into it.
 *
 * What appears afterwards is not invented. The partner's own adapter reports
 * what the client holds, through the same registry the ingestion pipeline uses
 * and gated on the partner's agreement status — today that resolves to the
 * sandbox adapter, and a real one for that partner code changes nothing here.
 *
 * Connecting the same partner twice refreshes that account rather than adding a
 * second one, so a second press cannot double someone's net worth.
 *
 * The dialog now forks on one question first — "do you already have an account
 * there?" — because the two answers are different workflows on the firm's
 * desk: linking an existing client is a lookup, opening an account is
 * onboarding. Both submit the same request; a new client's request carries a
 * " · new client" label suffix so the desk can tell them apart.
 *
 * Layout note (iPhone Safari): the panel is the shared `.app-modal` sheet —
 * bounded with `max-height` in dvh so Safari's collapsing toolbar is accounted
 * for — and everything below the header lives in ONE scrollable column whose
 * bottom padding adds the home-indicator inset on top of its own spacing.
 * The submit button sits inside that column, above the padding, so it can
 * never be clipped behind the browser's bottom bar.
 */

const LABEL = 'text-[12px] font-bold uppercase tracking-[.6px] text-dim';

type HasAccount = 'yes' | 'new' | null;

export function ConnectAccountDialog({
  onClose,
  onConnected,
  excludedPartnerCodes,
}: {
  onClose: () => void;
  /** Active and pending relationships are not valid choices for another request. */
  excludedPartnerCodes: string[];
  onConnected: (summary: {
    partner: string;
    status: 'pending' | 'active';
    holdings: number;
    refreshed: boolean;
  }) => void;
}) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const openerRef = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();

  /**
   * The catalogue, fetched here rather than passed in. The portfolio screen
   * knows the partners this investor has already connected — which is nobody,
   * for the account that most needs this dialog.
   */
  const [networkPartners, setNetworkPartners] = React.useState<
    { code: string; name: string; kind: string | null; regulator: string | null }[]
  >([]);
  const [code, setCode] = React.useState('');
  /** The fork: an existing client links, a new one asks to be taken on. */
  const [hasAccount, setHasAccount] = React.useState<HasAccount>(null);
  const marks = usePartnerMarks();

  React.useEffect(() => {
    let cancelled = false;
    getNetworkPartners()
      .then((rows) => {
        if (cancelled) return;
        setNetworkPartners(rows);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the institutions on the network.');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const excluded = React.useMemo(
    () => new Set(excludedPartnerCodes.map((value) => value.trim().toUpperCase())),
    [excludedPartnerCodes],
  );
  const partners = React.useMemo(
    () => networkPartners.filter((row) => !excluded.has(row.code.trim().toUpperCase())),
    [excluded, networkPartners],
  );

  React.useEffect(() => {
    if (partners.some((row) => row.code === code)) return;
    setCode(partners[0]?.code ?? '');
    setHasAccount(null);
  }, [code, partners]);

  React.useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const el = dialogRef.current;
    if (!el) return;
    if (!el.open) el.showModal();
    const onBackdrop = (e: MouseEvent) => {
      if (e.target === el) el.close();
    };
    el.addEventListener('click', onBackdrop);
    return () => el.removeEventListener('click', onBackdrop);
  }, []);

  const close = React.useCallback(() => dialogRef.current?.close(), []);
  useSheetDismiss(dialogRef, close);

  const dismissed = React.useCallback(() => {
    openerRef.current?.focus();
    onClose();
  }, [onClose]);

  const partner = partners.find((p) => p.code === code) ?? null;
  const mark = partner ? markFor(marks, { code: partner.code, name: partner.name }) : undefined;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!hasAccount) return;
    setBusy(true);
    setError(null);
    // Same request either way; the label suffix is what lets the firm's desk
    // route "open an account for this person" differently from "link the
    // account they already hold".
    const label = hasAccount === 'new' && partner ? `${partner.name} · new client` : undefined;
    connectAccount(code, label)
      .then((summary) => {
        onConnected(summary);
        close();
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not connect that account.');
      })
      .finally(() => setBusy(false));
  }

  return (
    <dialog ref={dialogRef} className="app-modal" aria-labelledby={titleId} onClose={dismissed}>
      <button
        type="button"
        data-sheet-handle
        onClick={close}
        aria-label="Close"
        className="app-sheet__handle app-modal__handle"
      />

      <div className="flex flex-none items-start justify-between gap-3 border-0 border-b border-solid border-border px-[22px] py-4">
        <div className="min-w-0">
          <h2 id={titleId} className="font-display text-lg font-bold">
            Connect an account
          </h2>
          <div className="text-[13.5px] text-dim">
            The institution decides whether to take you on, then your positions and cash come
            straight from them.
          </div>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={close} aria-label="Close">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {/* ONE scrolling column for everything below the header. `pb` is the
          panel's own spacing PLUS the safe-area inset, so the last control
          clears the iPhone's home indicator and Safari's bottom toolbar. */}
      <form
        onSubmit={submit}
        className="min-h-0 overflow-y-auto overscroll-contain px-[22px] py-[18px] pb-[calc(22px+env(safe-area-inset-bottom))]"
      >
        {error ? (
          <p className="mb-3 flex items-start gap-2 text-sm text-[#a44e20] dark:text-terra">
            <CircleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
            {error}
          </p>
        ) : null}

        {partners.length === 0 ? (
          <p className="text-[14.5px] leading-relaxed text-dim">
            You have already connected to, or requested access from, every institution currently
            available on the network.
          </p>
        ) : (
          <>
            <label className="block text-[13.5px]">
              <span className={LABEL}>Institution</span>
              <div className="mt-1.5 flex items-center gap-2.5">
                {partner ? (
                  <PartnerMark
                    name={partner.name}
                    code={partner.code}
                    id={mark?.id}
                    hasLogo={mark?.hasLogo}
                    color={mark?.color}
                    tint={mark?.tint}
                    size="md"
                  />
                ) : null}
                <select
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="block w-full min-w-0 flex-1 rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-[15px] text-foreground"
                >
                  {partners.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </label>

            {/* The fork. Two different desk workflows, one honest question. */}
            <fieldset className="m-0 mt-4 border-0 p-0">
              <legend className={`${LABEL} p-0`}>
                Do you already have an account with {partner?.name ?? 'this institution'}?
              </legend>
              <div className="mt-2 grid grid-cols-2 gap-2 max-[440px]:grid-cols-1">
                {(
                  [
                    { value: 'yes', title: 'Yes, connect it', sub: 'Link what I already hold' },
                    { value: 'new', title: "No, I'm new", sub: 'Ask them to open one' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={hasAccount === opt.value}
                    onClick={() => setHasAccount(opt.value)}
                    className={cn(
                      'rounded-xl border border-solid px-3.5 py-3 text-left',
                      hasAccount === opt.value ? 'border-primary bg-mint' : 'border-border bg-card',
                    )}
                  >
                    <span className="block text-[14.5px] font-bold text-foreground">
                      {opt.title}
                    </span>
                    <span className="mt-0.5 block text-[12.5px] text-dim">{opt.sub}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            {hasAccount === 'new' && partner ? (
              <p className="mt-3 rounded-xl bg-mint px-4 py-3 text-[13.5px] leading-relaxed text-dim">
                {partner.name} opens your account first — request the introduction and their desk
                takes it from there. Nothing to bring: they receive the verification you have
                already completed here.
              </p>
            ) : null}

            {/* Said plainly: what is shared, who decides, and who holds the
                money. None of it is CCN. */}
            <p className="mt-4 text-[12.5px] leading-relaxed text-faint">
              They receive the identity and compliance checks you have already completed, so you are
              not asked for them twice, and their compliance desk decides. Once they accept, CCN
              reads what you hold so your whole position is in one place — it never moves your
              money. Your institution executes, custodies and settles everything.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={busy || !code || !hasAccount}>
                {busy
                  ? 'Sending…'
                  : hasAccount === 'new'
                    ? 'Request the introduction'
                    : 'Request an account'}
              </Button>
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
            </div>
            {!hasAccount ? (
              <p className="mb-0 mt-2 text-[12.5px] text-faint">
                Choose one of the two options above first.
              </p>
            ) : null}
          </>
        )}
      </form>
    </dialog>
  );
}
