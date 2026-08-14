'use client';

import { Button } from '@/app/_components/ui/button';
import { useSheetDismiss } from '@/app/_lib/sheet';
import { type ConsoleProduct, type ProductInput, saveProduct } from '@/lib/console-api';
import { CircleAlert, X } from 'lucide-react';
import * as React from 'react';

/**
 * Listing a product, and amending one already listed.
 *
 * This dialog used to ask for a name and a free-text type, and wrote them to
 * `product_listings` — a table the marketplace has no relationship to in either
 * direction. The listing appeared on the firm's own Products tab and nowhere
 * else, and the pause switch beside it changed nothing an investor could see.
 *
 * It now writes `instruments`, the table the marketplace reads, so the fields
 * are the ones a deal card renders. Asking for two of them and defaulting the
 * rest would put "US$0", a blank metric and "Not rated" in front of every
 * investor who opened the product, which is worse than not appearing at all —
 * it is appearing wrong.
 *
 * Type is now the closed `instrument_type` enum rather than free text: the
 * marketplace filters and the suitability rules both branch on it, so a value
 * outside the five is not a description CCN can act on. Slug and regulator are
 * not asked for — the database derives the first (holdings and reconciliation
 * join on it, so it must not change when a product is renamed) and copies the
 * second from the firm's own record, because a regulator is a compliance claim
 * and not a field an operator types.
 *
 * Same dialog as the rest of the product: centred on a desktop, a bottom sheet
 * with a swipe on a phone (.app-modal in globals.css).
 */

const LABEL = 'text-[12px] font-bold uppercase tracking-[.6px] text-dim';
const FIELD =
  'mt-1.5 block w-full rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-[15px] text-foreground';
const HINT = 'mt-1 block text-[12.5px] text-faint';

const TYPES: { value: string; label: string }[] = [
  { value: 'bond', label: 'Bond' },
  { value: 'fund', label: 'Fund' },
  { value: 'equity', label: 'Equity' },
  { value: 'real_estate', label: 'Real estate' },
  { value: 'private', label: 'Private' },
];

const CURRENCIES = ['USD', 'JMD', 'TTD'];

const RISKS: { value: '' | 'low' | 'medium' | 'high'; label: string }[] = [
  { value: '', label: 'Not rated' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

/**
 * Major units off the form → minor units on the wire.
 *
 * Operators type "5,000" and "5000.50"; the API takes an integer of cents. The
 * rounding is on the whole cent value rather than on a scaled float, so
 * 5000.005 does not land a fraction of a cent short.
 */
function toMinor(major: string): string {
  const cleaned = major.replace(/[,\s]/g, '');
  if (cleaned === '') return '0';
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return '0';
  return String(Math.round(n * 100));
}

function toMajor(minor: string): string {
  const n = Number(minor);
  if (!Number.isFinite(n) || n === 0) return '';
  return String(n / 100);
}

export function ListProductDialog({
  product,
  onClose,
  onSaved,
}: {
  /** The listing being amended, or undefined to create a new one. */
  product?: ConsoleProduct;
  onClose: () => void;
  /** Hands the saved listing back so the catalogue shows it without a refetch. */
  onSaved: (product: ConsoleProduct) => void;
}) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const openerRef = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();
  const editing = Boolean(product);

  const [name, setName] = React.useState(product?.name ?? '');
  const [type, setType] = React.useState(product?.type ?? 'fund');
  const [abbr, setAbbr] = React.useState(product?.abbr ?? '');
  const [currency, setCurrency] = React.useState(product?.currency ?? 'USD');
  const [minimum, setMinimum] = React.useState(toMajor(product?.minInvestmentMinor ?? '0'));
  const [term, setTerm] = React.useState(product?.term ?? '');
  const [metric, setMetric] = React.useState(product?.metric ?? '');
  const [metricLabel, setMetricLabel] = React.useState(product?.metricLabel ?? '');
  const [risk, setRisk] = React.useState<string>(product?.risk ?? '');
  const [description, setDescription] = React.useState(product?.description ?? '');
  const [region, setRegion] = React.useState(product?.region ?? '');
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
    // Empty optional strings are dropped rather than sent as '': the schema
    // bounds them, and a blank stored where nothing was meant reads downstream
    // as a value the firm supplied.
    const input: ProductInput = {
      ...(product ? { id: product.id } : {}),
      name: name.trim(),
      type,
      currency,
      minInvestmentMinor: toMinor(minimum),
      ...(abbr.trim() ? { abbr: abbr.trim() } : {}),
      ...(term.trim() ? { term: term.trim() } : {}),
      ...(metric.trim() ? { metric: metric.trim() } : {}),
      ...(metricLabel.trim() ? { metricLabel: metricLabel.trim() } : {}),
      ...(risk ? { risk: risk as 'low' | 'medium' | 'high' } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(region.trim() ? { region: region.trim() } : {}),
    };
    saveProduct(input)
      .then(({ product: saved }) => {
        onSaved(saved);
        close();
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not save this product.');
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
            {editing ? 'Edit listing' : 'List a product'}
          </h2>
          <div className="text-[13.5px] text-dim">
            {editing
              ? 'Changes show on every client’s marketplace card straight away.'
              : 'It appears in the marketplace immediately and the agent can match it to suitable clients.'}
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

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-[13.5px]">
            <span className={LABEL}>Type</span>
            <select value={type} onChange={(e) => setType(e.target.value)} className={FIELD}>
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-[13.5px]">
            <span className={LABEL}>Short code</span>
            <input
              value={abbr}
              onChange={(e) => setAbbr(e.target.value)}
              className={FIELD}
              maxLength={12}
              placeholder="SREF"
            />
            <span className={HINT}>
              The badge on the card. Taken from the name if you leave it.
            </span>
          </label>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-[13.5px]">
            <span className={LABEL}>Currency</span>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className={FIELD}
            >
              {CURRENCIES.map((cur) => (
                <option key={cur} value={cur}>
                  {cur}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-[13.5px]">
            <span className={LABEL}>Minimum investment</span>
            <input
              value={minimum}
              onChange={(e) => setMinimum(e.target.value)}
              className={FIELD}
              inputMode="decimal"
              placeholder="5000"
            />
            <span className={HINT}>Leave blank for no minimum.</span>
          </label>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-[13.5px]">
            <span className={LABEL}>Headline figure</span>
            <input
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
              className={FIELD}
              maxLength={60}
              placeholder="8.25%"
            />
          </label>

          <label className="block text-[13.5px]">
            <span className={LABEL}>What it is</span>
            <input
              value={metricLabel}
              onChange={(e) => setMetricLabel(e.target.value)}
              className={FIELD}
              maxLength={60}
              placeholder="Coupon"
            />
            <span className={HINT}>
              Printed under the figure — Coupon, Target return, Distribution.
            </span>
          </label>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-[13.5px]">
            <span className={LABEL}>Term</span>
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              className={FIELD}
              maxLength={60}
              placeholder="5 years"
            />
          </label>

          <label className="block text-[13.5px]">
            <span className={LABEL}>Risk</span>
            <select value={risk} onChange={(e) => setRisk(e.target.value)} className={FIELD}>
              {RISKS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <span className={HINT}>Matched against each client’s suitability band.</span>
          </label>
        </div>

        <label className="mt-4 block text-[13.5px]">
          <span className={LABEL}>Region</span>
          <input
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className={FIELD}
            maxLength={100}
            placeholder="Jamaica"
          />
        </label>

        <label className="mt-4 block text-[13.5px]">
          <span className={LABEL}>Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={`${FIELD} min-h-[88px] resize-y`}
            maxLength={2000}
            placeholder="What it invests in, how it pays out, and who it suits."
          />
        </label>

        {/* Said rather than silently omitted, because an operator will look for
            these fields and their absence is a decision, not an oversight. */}
        <p className="mt-4 text-[12.5px] leading-relaxed text-faint">
          Client counts and AUM are not asked for. CCN does not measure them, and a figure typed
          here would read on the network as one that had been. Your regulator is taken from your
          firm’s record rather than typed here.
        </p>

        <div className="mt-5 flex items-center gap-3">
          <Button type="submit" disabled={saving || name.trim().length < 2}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'List it'}
          </Button>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
        </div>
      </form>
    </dialog>
  );
}
