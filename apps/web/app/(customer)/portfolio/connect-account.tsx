'use client';

import { Button } from '@/app/_components/ui/button';
import { useSheetDismiss } from '@/app/_lib/sheet';
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
 */

const LABEL = 'text-[12px] font-bold uppercase tracking-[.6px] text-dim';

export function ConnectAccountDialog({
  onClose,
  onConnected,
}: {
  onClose: () => void;
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
  const [partners, setPartners] = React.useState<{ code: string; name: string }[]>([]);
  const [code, setCode] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    getNetworkPartners()
      .then((rows) => {
        if (cancelled) return;
        setPartners(rows);
        setCode((current) => current || (rows[0]?.code ?? ''));
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

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    connectAccount(code)
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

      <form
        onSubmit={submit}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[22px] py-[18px] pb-[max(22px,env(safe-area-inset-bottom))]"
      >
        {error ? (
          <p className="mb-3 flex items-start gap-2 text-sm text-[#a44e20] dark:text-terra">
            <CircleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
            {error}
          </p>
        ) : null}

        {partners.length === 0 ? (
          <p className="text-[14.5px] leading-relaxed text-dim">
            There are no institutions on the network yet, so there is nothing to connect to. An
            administrator loads the catalogue.
          </p>
        ) : (
          <>
            <label className="block text-[13.5px]">
              <span className={LABEL}>Institution</span>
              <select
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="mt-1.5 block w-full rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-[15px] text-foreground"
              >
                {partners.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            {/* Said plainly: what is shared, who decides, and who holds the
                money. None of it is CCN. */}
            <p className="mt-4 text-[12.5px] leading-relaxed text-faint">
              They receive the identity and compliance checks you have already completed, so you are
              not asked for them twice, and their compliance desk decides. Once they accept, CCN
              reads what you hold so your whole position is in one place — it never moves your
              money. Your institution executes, custodies and settles everything.
            </p>

            <div className="mt-5 flex items-center gap-3">
              <Button type="submit" disabled={busy || !code}>
                {busy ? 'Sending…' : 'Request an account'}
              </Button>
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </form>
    </dialog>
  );
}
