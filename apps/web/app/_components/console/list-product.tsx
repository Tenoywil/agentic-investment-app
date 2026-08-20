'use client';

import { Button } from '@/app/_components/ui/button';
import { useSheetDismiss } from '@/app/_lib/sheet';
import type { ConsoleProduct, ProductInput } from '@/lib/console-api';
import {
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  Download,
  FileSpreadsheet,
  Upload,
  X,
} from 'lucide-react';
import * as React from 'react';
import {
  PRODUCT_CSV_TEMPLATE,
  PRODUCT_IMPORT_MAX_ROWS,
  majorAmountToMinor,
  parseProductImport,
} from './lib';

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
    const parsedMinimum = majorAmountToMinor(minimum);
    if (parsedMinimum.error || parsedMinimum.value === undefined) {
      setStep(0);
      setError(
        parsedMinimum.error
          ? `Minimum investment ${parsedMinimum.error}.`
          : 'Enter a valid minimum investment.',
      );
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

/**
 * Bulk listing from a CSV file or rows pasted out of a spreadsheet.
 *
 * The browser reads text only, enforces the same row and field vocabulary as
 * the form, and sends normalized JSON through an injected save function. The
 * server validates the full batch again and owns the atomic transaction.
 */
export function BulkProductDialog({
  onClose,
  onSaved,
  onSave,
}: {
  onClose: () => void;
  onSaved: (products: ConsoleProduct[]) => void;
  onSave: (products: ProductInput[]) => Promise<{ products: ConsoleProduct[] }>;
}) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const openerRef = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();
  const [source, setSource] = React.useState('');
  const [sourceName, setSourceName] = React.useState<string | null>(null);
  const [sourceError, setSourceError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const savingRef = React.useRef(saving);
  savingRef.current = saving;
  const result = React.useMemo(() => parseProductImport(source), [source]);
  const showAnalysis = source.trim().length > 0;

  React.useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const el = dialogRef.current;
    if (!el) return;
    if (!el.open) el.showModal();
    const onBackdrop = (event: MouseEvent) => {
      if (event.target === el && !savingRef.current) el.close();
    };
    el.addEventListener('click', onBackdrop);
    return () => el.removeEventListener('click', onBackdrop);
  }, []);

  const close = React.useCallback(() => {
    if (!savingRef.current) dialogRef.current?.close();
  }, []);
  useSheetDismiss(dialogRef, close);

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([PRODUCT_CSV_TEMPLATE], { type: 'text/csv' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'ccn-product-import-template.csv';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function readFile(file: File | undefined) {
    setSourceError(null);
    setSaveError(null);
    if (!file) return;
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
      setSourceError('Choose a CSV, TSV or plain-text spreadsheet export.');
      return;
    }
    if (file.size > 256_000) {
      setSourceError('The import must be 256 KB or smaller.');
      return;
    }
    try {
      const text = await file.text();
      setSource(text);
      setSourceName(file.name);
    } catch {
      setSourceError('Could not read that file. Export it as CSV and try again.');
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaveError(null);
    if (result.errors.length > 0 || result.products.length === 0) return;
    setSaving(true);
    onSave(result.products)
      .then(({ products }) => {
        onSaved(products);
        dialogRef.current?.close();
      })
      .catch((error: unknown) => {
        setSaveError(error instanceof Error ? error.message : 'Could not import these products.');
      })
      .finally(() => setSaving(false));
  }

  return (
    <dialog
      ref={dialogRef}
      className="app-modal product-listing-modal"
      aria-labelledby={titleId}
      onClose={() => {
        openerRef.current?.focus();
        onClose();
      }}
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

      <div className="flex flex-none items-start justify-between gap-4 border-0 border-b border-solid border-border px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 id={titleId} className="m-0 font-display text-xl font-bold">
            Add products in bulk
          </h2>
          <p className="mb-0 mt-1 text-sm leading-relaxed text-dim">
            Upload CSV, paste spreadsheet rows, or start from the CCN template.
          </p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="min-h-12 min-w-12 flex-none"
          onClick={close}
          aria-label="Close"
          disabled={saving}
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <form
        onSubmit={submit}
        className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain"
      >
        <div className="space-y-6 px-5 py-5 sm:px-6">
          <section aria-labelledby={`${titleId}-source`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 id={`${titleId}-source`} className="m-0 font-display text-lg font-bold">
                  Choose your source
                </h3>
                <p className="mb-0 mt-1 max-w-[620px] text-sm leading-relaxed text-dim">
                  Required columns are name, type and risk. Imports are capped at{' '}
                  {PRODUCT_IMPORT_MAX_ROWS} rows and arrive paused for review.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="min-h-12 w-full sm:w-auto"
                onClick={downloadTemplate}
              >
                <Download className="h-4 w-4" aria-hidden />
                Download template
              </Button>
            </div>

            <label className="mt-5 block text-[13.5px]">
              <span className={LABEL}>Upload CSV or TSV</span>
              <span className="relative mt-2 flex min-h-24 cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-teal2/50 bg-mint/40 px-4 py-4 transition-colors hover:bg-mint focus-within:ring-2 focus-within:ring-teal2 focus-within:ring-offset-2">
                <span className="grid h-12 w-12 flex-none place-items-center rounded-xl bg-card text-teal2">
                  <Upload className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <b className="block text-sm text-foreground">
                    {sourceName ?? 'Choose a spreadsheet export'}
                  </b>
                  <span className="mt-1 block text-sm leading-snug text-dim">
                    CSV, TSV or TXT · 256 KB maximum · raw file stays in this browser
                  </span>
                </span>
                <input
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  onChange={(event) => {
                    void readFile(event.currentTarget.files?.[0]);
                    event.currentTarget.value = '';
                  }}
                  disabled={saving}
                />
              </span>
            </label>

            <div className="my-4 flex items-center gap-3" aria-hidden>
              <span className="h-px flex-1 bg-border" />
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-faint">
                or paste rows
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <label className="block text-[13.5px]">
              <span className={LABEL}>CSV or spreadsheet rows</span>
              <textarea
                value={source}
                onChange={(event) => {
                  setSource(event.target.value);
                  setSourceName(null);
                  setSourceError(null);
                  setSaveError(null);
                }}
                className={`${FIELD} min-h-40 resize-y font-mono text-[13px] leading-relaxed`}
                placeholder="name,type,currency,minimum_investment,risk&#10;Caribbean Income Fund,fund,USD,5000,medium"
                spellCheck={false}
                disabled={saving}
              />
            </label>
          </section>

          {sourceError ? (
            <div
              className="flex items-start gap-2 rounded-xl border border-solid border-terra/35 bg-terra/10 p-3 text-sm text-[#a44e20] dark:text-terra"
              role="alert"
            >
              <CircleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
              {sourceError}
            </div>
          ) : null}

          {showAnalysis ? (
            <section aria-labelledby={`${titleId}-preview`} aria-live="polite">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id={`${titleId}-preview`} className="m-0 font-display text-lg font-bold">
                  Review before import
                </h3>
                <span className="font-mono text-[13px] font-bold text-dim">
                  {result.products.length} valid · {result.errors.length} errors
                </span>
              </div>

              {result.errors.length > 0 ? (
                <div
                  className="mt-3 rounded-xl border border-solid border-terra/35 bg-terra/10 p-4"
                  role="alert"
                >
                  <div className="flex items-center gap-2 text-sm font-bold text-[#a44e20] dark:text-terra">
                    <CircleAlert className="h-4 w-4" aria-hidden />
                    Fix every row before importing
                  </div>
                  <ul className="mb-0 mt-2 space-y-1 pl-5 text-sm leading-relaxed text-dim">
                    {result.errors.slice(0, 12).map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                  {result.errors.length > 12 ? (
                    <p className="mb-0 mt-2 text-sm text-dim">
                      Plus {result.errors.length - 12} more errors.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {result.products.length > 0 ? (
                <div className="mt-3 overflow-hidden rounded-2xl border border-solid border-border">
                  {result.products.slice(0, 5).map((product, index) => (
                    <div
                      key={`${product.name}-${product.abbr ?? ''}-${index}`}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-x-0 border-t-0 border-b border-solid border-border px-4 py-3 last:border-b-0"
                    >
                      <FileSpreadsheet className="h-4 w-4 flex-none text-teal2" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold">{product.name}</div>
                        <div className="text-[12.5px] capitalize text-faint">
                          {product.type.replace('_', ' ')} · {product.currency} · {product.risk}{' '}
                          risk
                        </div>
                      </div>
                    </div>
                  ))}
                  {result.products.length > 5 ? (
                    <div className="px-4 py-3 text-center text-[13px] font-bold text-dim">
                      + {result.products.length - 5} more products in this import
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          {saveError ? (
            <div
              className="flex items-start gap-2 rounded-xl border border-solid border-terra/35 bg-terra/10 p-3 text-sm text-[#a44e20] dark:text-terra"
              role="alert"
            >
              <CircleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
              {saveError}
            </div>
          ) : null}
        </div>

        <div className="sticky bottom-0 mt-auto flex flex-col-reverse gap-3 border-0 border-t border-solid border-border bg-card px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Button
            type="button"
            variant="ghost"
            className="min-h-12 w-full sm:w-auto"
            onClick={close}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="min-h-12 w-full sm:w-auto"
            disabled={saving || result.errors.length > 0 || result.products.length === 0}
          >
            <Upload className="h-4 w-4" aria-hidden />
            {saving
              ? 'Importing…'
              : result.products.length > 0
                ? `Import ${result.products.length} ${result.products.length === 1 ? 'product' : 'products'}`
                : 'Import products'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
