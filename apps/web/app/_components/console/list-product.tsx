'use client';

import { Button } from '@/app/_components/ui/button';
import { useSheetDismiss } from '@/app/_lib/sheet';
import { type ConsoleProduct, createProduct } from '@/lib/console-api';
import { CircleAlert, X } from 'lucide-react';
import * as React from 'react';

/**
 * Listing a product.
 *
 * The console could read its catalogue and pause a listing, and never create
 * one — every product on the network came from the seed. A partner who had just
 * been onboarded signed in to an empty screen with no control that could change
 * it, which is the missing half of the institution side of this product.
 *
 * Two fields, because two are all CCN actually knows about a listing. The
 * per-product `clients`, `aum_minor` and `trend` columns exist and are
 * deliberately not offered: CCN measures none of them, and a number an operator
 * types about their own product is not a measurement — it is the same invented
 * figure this console already had removed once.
 *
 * The type is free text rather than a dropdown. `instruments` has a closed
 * `instrument_type` enum, but a product listing is the partner's own description
 * of what they are offering, and constraining it to five words CCN chose would
 * make an operator misfile their own fund.
 *
 * Same dialog as the rest of the product: centred on a desktop, a bottom sheet
 * with a swipe on a phone (.app-modal in globals.css).
 */

const LABEL = 'text-[12px] font-bold uppercase tracking-[.6px] text-dim';
const FIELD =
  'mt-1.5 block w-full rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-[15px] text-foreground';

export function ListProductDialog({
  onClose,
  onListed,
}: {
  onClose: () => void;
  /** Hands the created listing back so the catalogue shows it without a refetch. */
  onListed: (product: ConsoleProduct) => void;
}) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const openerRef = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();

  const [name, setName] = React.useState('');
  const [type, setType] = React.useState('');
  const [saving, setSaving] = React.useState(false);
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
    setSaving(true);
    setError(null);
    createProduct({ name: name.trim(), type: type.trim() || undefined })
      .then(({ product }) => {
        onListed(product);
        close();
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not list this product.');
      })
      .finally(() => setSaving(false));
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
            List a product
          </h2>
          <div className="text-[13.5px] text-dim">
            It goes live immediately and the agent can match it to suitable clients.
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

        <label className="block text-[13.5px]">
          <span className={LABEL}>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={FIELD}
            placeholder="Sagicor Real Estate X Fund"
            required
          />
        </label>

        <label className="mt-4 block text-[13.5px]">
          <span className={LABEL}>Type</span>
          <input
            value={type}
            onChange={(e) => setType(e.target.value)}
            className={FIELD}
            placeholder="Real Estate"
          />
          <span className="mt-1 block text-[12.5px] text-faint">
            How you describe it — Bond, Fund, Money Market, Private Credit.
          </span>
        </label>

        {/* Said rather than silently omitted, because an operator will look for
            these fields and their absence is a decision, not an oversight. */}
        <p className="mt-4 text-[12.5px] leading-relaxed text-faint">
          Client counts and AUM are not asked for. CCN does not measure them, and a figure typed
          here would read on the network as one that had been.
        </p>

        <div className="mt-5 flex items-center gap-3">
          <Button type="submit" disabled={saving || name.trim().length < 2}>
            {saving ? 'Listing…' : 'List it'}
          </Button>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
        </div>
      </form>
    </dialog>
  );
}
