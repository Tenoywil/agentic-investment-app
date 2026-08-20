'use client';

import { Button } from '@/app/_components/ui/button';
import { useSheetDismiss } from '@/app/_lib/sheet';
import type { ConsoleProduct, ProductInput } from '@/lib/console-api';
import { ArrowLeft, ArrowRight, CircleAlert, X } from 'lucide-react';
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
 * Same dialog as the rest of the product: centred on desktop and a safe-area
 * aware, full-height workflow on phones (.app-modal in globals.css).
 */

const LABEL = 'text-[12px] font-bold uppercase tracking-[.6px] text-dim';
const FIELD =
  'mt-1.5 block min-h-12 w-full rounded-xl border border-solid border-border bg-card px-3 py-2 text-[15px] text-foreground';
const HINT = 'mt-1 block text-[12.5px] text-faint';

const TYPES: { value: string; label: string }[] = [
  { value: 'bond', label: 'Bond' },
  { value: 'fund', label: 'Fund' },
  { value: 'equity', label: 'Equity' },
  { value: 'real_estate', label: 'Real estate' },
  { value: 'private', label: 'Private' },
];

const CURRENCIES = ['USD', 'JMD', 'TTD', 'GYD', 'BBD', 'XCD', 'BSD'];

const RISKS: { value: '' | 'low' | 'medium' | 'high'; label: string }[] = [
  { value: '', label: 'Select risk' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const STEPS = [
  { label: 'Essentials', description: 'Identity and access' },
  { label: 'Terms', description: 'Economics and suitability' },
  { label: 'Presentation', description: 'Client-facing context' },
] as const;

/**
 * Major units off the form → minor units on the wire.
 *
 * Operators type "5,000" and "5000.50"; the API takes an integer of cents.
 * Splitting whole and fractional digits avoids floating-point drift and rejects
 * sub-cent amounts instead of silently changing an operator's entry.
 */
function toMinor(major: string): { value?: string; error?: string } {
  const cleaned = major.replace(/[,\s]/g, '');
  if (cleaned === '') return { value: '0' };
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) {
    return { error: 'Minimum investment must be a valid amount with up to 2 decimal places.' };
  }
  const [whole = '0', fraction = ''] = cleaned.split('.');
  const value = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (value > 9_223_372_036_854_775_807n) {
    return { error: 'Minimum investment exceeds the supported amount range.' };
  }
  return { value: String(value) };
}

function toMajor(minor: string): string {
  if (!/^\d+$/.test(minor)) return '';
  const value = BigInt(minor);
  if (value === 0n) return '';
  const whole = value / 100n;
  const fraction = String(value % 100n)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function ListProductDialog({
  product,
  onClose,
  onSaved,
  onSave,
}: {
  /** The listing being amended, or undefined to create a new one. */
  product?: ConsoleProduct;
  onClose: () => void;
  /** Hands the saved listing back so the catalogue shows it without a refetch. */
  onSaved: (product: ConsoleProduct) => void;
  /** Injected persistence keeps this form reusable without granting previews API access. */
  onSave: (input: ProductInput) => Promise<{ product: ConsoleProduct }>;
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
  const [step, setStep] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const savingRef = React.useRef(saving);
  savingRef.current = saving;

  React.useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const el = dialogRef.current;
    if (!el) return;
    if (!el.open) el.showModal();
    const onBackdrop = (e: MouseEvent) => {
      if (e.target === el && !savingRef.current) el.close();
    };
    el.addEventListener('click', onBackdrop);
    return () => el.removeEventListener('click', onBackdrop);
  }, []);

  const close = React.useCallback(() => {
    if (!savingRef.current) dialogRef.current?.close();
  }, []);
  useSheetDismiss(dialogRef, close);

  const dismissed = React.useCallback(() => {
    openerRef.current?.focus();
    onClose();
  }, [onClose]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsedMinimum = toMinor(minimum);
    if (parsedMinimum.error || parsedMinimum.value === undefined) {
      setStep(0);
      setError(parsedMinimum.error ?? 'Enter a valid minimum investment.');
      return;
    }
    if (Boolean(metric.trim()) !== Boolean(metricLabel.trim())) {
      setStep(1);
      setError('Add both the headline figure and its label, or leave both empty.');
      return;
    }
    if (!risk) {
      setStep(1);
      setError('Select the product risk before listing it for suitability matching.');
      return;
    }
    setSaving(true);
    // Empty optional strings are dropped rather than sent as '': the schema
    // bounds them, and a blank stored where nothing was meant reads downstream
    // as a value the firm supplied.
    const input: ProductInput = {
      ...(product ? { id: product.id } : {}),
      name: name.trim(),
      type,
      currency,
      minInvestmentMinor: parsedMinimum.value,
      ...(abbr.trim() ? { abbr: abbr.trim() } : {}),
      ...(term.trim() ? { term: term.trim() } : {}),
      ...(metric.trim() ? { metric: metric.trim() } : {}),
      ...(metricLabel.trim() ? { metricLabel: metricLabel.trim() } : {}),
      risk: risk as 'low' | 'medium' | 'high',
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(region.trim() ? { region: region.trim() } : {}),
    };
    onSave(input)
      .then(({ product: saved }) => {
        onSaved(saved);
        dialogRef.current?.close();
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not save this product.');
      })
      .finally(() => setSaving(false));
  }

  return (
    <dialog
      ref={dialogRef}
      className="app-modal product-listing-modal"
      aria-labelledby={titleId}
      onClose={dismissed}
      onCancel={(event) => {
        if (saving) event.preventDefault();
      }}
    >
      <button
        type="button"
        data-sheet-handle
        onClick={close}
        aria-label="Close"
        className="app-sheet__handle app-modal__handle"
        disabled={saving}
      />

      <div className="flex flex-none items-start justify-between gap-3 border-0 border-b border-solid border-border px-[22px] py-4">
        <div className="min-w-0">
          <h2 id={titleId} className="m-0 font-display text-lg font-bold">
            {editing ? 'Edit listing' : 'List a product'}
          </h2>
          <div className="text-[13.5px] text-dim">
            Step {step + 1} of {STEPS.length} · {STEPS[step]?.description}
          </div>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="min-h-12 min-w-12"
          onClick={close}
          aria-label="Close"
          disabled={saving}
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <form
        onSubmit={submit}
        className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain px-5 pb-0 pt-5 sm:px-6"
      >
        <ol className="mb-6 grid list-none grid-cols-3 gap-2 p-0" aria-label="Listing progress">
          {STEPS.map((item, index) => (
            <li key={item.label}>
              <button
                type="button"
                onClick={() => setStep(index)}
                disabled={saving}
                aria-current={index === step ? 'step' : undefined}
                className={`min-h-12 w-full rounded-xl border border-solid px-2 py-2 text-left transition-colors ${
                  index === step
                    ? 'border-teal2 bg-mint text-teal2'
                    : 'border-border bg-transparent text-faint'
                }`}
              >
                <span className="block font-mono text-[10px] font-bold uppercase tracking-wide">
                  {index + 1 < 10 ? `0${index + 1}` : index + 1}
                </span>
                <span className="mt-0.5 block truncate text-[12px] font-bold sm:text-[13px]">
                  {item.label}
                </span>
              </button>
            </li>
          ))}
        </ol>

        {error ? (
          <p className="mb-3 flex items-start gap-2 text-sm text-[#a44e20] dark:text-terra">
            <CircleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
            {error}
          </p>
        ) : null}

        {step === 0 ? (
          <section aria-labelledby={`${titleId}-essentials`}>
            <div className="mb-5">
              <h3 id={`${titleId}-essentials`} className="m-0 font-display text-xl font-bold">
                Product essentials
              </h3>
              <p className="mb-0 mt-1 text-sm leading-relaxed text-dim">
                Start with the fields clients use to recognise and access the product.
              </p>
            </div>
            <label className="block text-[13.5px]">
              <span className={LABEL}>Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={FIELD}
                placeholder="Sagicor Real Estate X Fund"
                maxLength={140}
                required
              />
            </label>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
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
                <span className={HINT}>Used as the compact badge on client cards.</span>
              </label>
            </div>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
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
          </section>
        ) : null}

        {step === 1 ? (
          <section aria-labelledby={`${titleId}-terms`}>
            <div className="mb-5">
              <h3 id={`${titleId}-terms`} className="m-0 font-display text-xl font-bold">
                Terms and suitability
              </h3>
              <p className="mb-0 mt-1 text-sm leading-relaxed text-dim">
                These fields drive comparison, suitability matching and the client’s decision.
              </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
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
                <span className={HINT}>Coupon, target return or distribution.</span>
              </label>
            </div>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
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

            <label className="mt-5 block text-[13.5px]">
              <span className={LABEL}>Region</span>
              <input
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className={FIELD}
                maxLength={100}
                placeholder="Jamaica"
              />
            </label>
          </section>
        ) : null}

        {step === 2 ? (
          <section aria-labelledby={`${titleId}-presentation`}>
            <div className="mb-5">
              <h3 id={`${titleId}-presentation`} className="m-0 font-display text-xl font-bold">
                Client presentation
              </h3>
              <p className="mb-0 mt-1 text-sm leading-relaxed text-dim">
                Add the context a client or adviser needs before requesting the full disclosures.
              </p>
            </div>

            <label className="block text-[13.5px]">
              <span className={LABEL}>Description</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={`${FIELD} min-h-36 resize-y leading-relaxed`}
                maxLength={2000}
                placeholder="What it invests in, how it pays out, the principal risks and who it suits."
              />
              <span className={HINT}>{description.length.toLocaleString()} / 2,000 characters</span>
            </label>

            <div className="mt-5 rounded-xl border border-solid border-border bg-muted/30 p-4">
              <b className="text-sm">Published data stays attributable</b>
              <p className="mb-0 mt-1 text-sm leading-relaxed text-dim">
                CCN uses the firm name and regulator on record. Client counts and AUM are not
                requested because CCN does not independently measure them.
              </p>
            </div>

            <div className="mt-5 rounded-xl border border-solid border-teal2/25 bg-mint p-4">
              <b className="text-sm text-teal2">What happens next</b>
              <p className="mb-0 mt-1 text-sm leading-relaxed text-dim">
                {editing
                  ? 'Saving updates the client-facing marketplace record and the agent’s matching data.'
                  : 'Listing makes the product available to suitability-screened clients and records the change in your audit trail.'}
              </p>
            </div>
          </section>
        ) : null}

        <div className="sticky bottom-0 -mx-5 mt-auto flex flex-col-reverse gap-3 border-0 border-t border-solid border-border bg-card px-5 pb-[max(4px,env(safe-area-inset-bottom))] pt-4 sm:-mx-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Button
            type="button"
            variant="ghost"
            className="min-h-12 w-full sm:w-auto"
            onClick={close}
            disabled={saving}
          >
            Cancel
          </Button>
          <div className="flex gap-3">
            {step > 0 ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-12 flex-1 sm:flex-none"
                onClick={() => setStep((current) => Math.max(0, current - 1))}
                disabled={saving}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Back
              </Button>
            ) : null}
            {step < STEPS.length - 1 ? (
              <Button
                type="button"
                className="min-h-12 flex-1 sm:flex-none"
                disabled={saving || (step === 0 && name.trim().length < 2)}
                onClick={() => setStep((current) => Math.min(STEPS.length - 1, current + 1))}
              >
                Continue
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            ) : (
              <Button
                type="submit"
                className="min-h-12 flex-1 sm:flex-none"
                disabled={saving || name.trim().length < 2}
              >
                {saving ? 'Saving…' : editing ? 'Save changes' : 'List product'}
              </Button>
            )}
          </div>
        </div>
      </form>
    </dialog>
  );
}
