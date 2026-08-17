'use client';

import { Button } from '@/app/_components/ui/button';
import { useSheetDismiss } from '@/app/_lib/sheet';
import { type AdminPartner, createAdminPartner, updateAdminPartner } from '@/lib/admin-api';
import { CircleAlert, X } from 'lucide-react';
import * as React from 'react';

/**
 * Onboarding a partner, and correcting one afterwards.
 *
 * The list of licensed institutions CCN routes to is the business, and until
 * the code column stopped being a database enum, adding to it took a migration
 * and a deploy. This is the form that replaced that.
 *
 * Two fields are closed sets and stay dropdowns, because both are load-bearing.
 * The regulator is the three CCN is licensed under. The agreement is the gate on
 * live order routing — the adapter registry refuses to place an order unless a
 * partner is `live` with trade scope — so it is stated in those terms here
 * rather than as a status nobody can act on.
 *
 * The code is set once. It is written into audit rows and read back by
 * operators, so editing it would rewrite the identity of everything already
 * recorded against it; on an existing partner it is shown and not editable.
 *
 * Same dialog as the person panel — centred on a desktop, a bottom sheet with a
 * swipe on a phone (.app-modal in globals.css).
 */

const REGULATORS = [
  { value: 'FSC_JAMAICA', label: 'FSC Jamaica' },
  { value: 'FSC_BARBADOS', label: 'FSC Barbados' },
  { value: 'FSC_TRINIDAD_TOBAGO', label: 'FSC Trinidad & Tobago' },
];

const AGREEMENTS = [
  { value: 'prospect', label: 'Prospect: talking, nothing signed' },
  { value: 'dpa_pending', label: 'DPA pending: agreement in progress' },
  { value: 'sandbox', label: 'Sandbox: connected, not routing real orders' },
  { value: 'live', label: 'Live: real orders route to this partner' },
  { value: 'suspended', label: 'Suspended: routing stopped' },
];

const LABEL = 'text-[12px] font-bold uppercase tracking-[.6px] text-dim';
const FIELD =
  'mt-1.5 block w-full rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-[15px] text-foreground';

export function PartnerForm({
  partner,
  onClose,
  onSaved,
}: {
  /** The partner being corrected, or null to onboard a new one. */
  partner: AdminPartner | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const openerRef = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();

  const [code, setCode] = React.useState(partner?.code ?? '');
  const [name, setName] = React.useState(partner?.name ?? '');
  const [kind, setKind] = React.useState(partner?.kind ?? '');
  const [regulator, setRegulator] = React.useState(partner?.regulator ?? '');
  const [agreementStatus, setAgreement] = React.useState(partner?.agreementStatus ?? 'prospect');
  const [residency, setResidency] = React.useState(partner?.residency ?? '');

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
    const draft = { name, kind, regulator, agreementStatus, residency };
    const request = partner
      ? updateAdminPartner(partner.id, draft)
      : createAdminPartner({ code, ...draft });
    request
      .then(() => {
        onSaved();
        close();
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not save this partner.');
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
            {partner ? partner.name : 'Onboard a partner'}
          </h2>
          <div className="text-[13.5px] text-dim">
            {partner
              ? 'Correct this partner’s record. Its code cannot change.'
              : 'A licensed institution CCN can route orders to.'}
          </div>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={close} aria-label="Close">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <form
        onSubmit={submit}
        className="min-h-0 overflow-y-auto overscroll-contain px-[22px] py-[18px] pb-[max(22px,env(safe-area-inset-bottom))]"
      >
        {error ? (
          <p className="mb-3 flex items-start gap-2 text-sm text-[#a44e20] dark:text-terra">
            <CircleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
            {error}
          </p>
        ) : null}

        <div className="g2">
          {/* On an existing partner the code is a fact, not a field — so it is
              not wrapped in a <label>, which would promise a control that isn't
              there. */}
          {partner ? (
            <div className="block text-[13.5px]">
              <span className={LABEL}>Code</span>
              <div className="mt-1.5 font-display text-lg font-bold">{partner.code}</div>
              <span className="mt-1 block text-[12.5px] text-faint">
                Set once at onboarding — it is written into every audited row.
              </span>
            </div>
          ) : (
            <label className="block text-[13.5px]">
              <span className={LABEL}>Code</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className={FIELD}
                placeholder="SAG"
                autoComplete="off"
                spellCheck={false}
                required
              />
              <span className="mt-1 block text-[12.5px] text-faint">
                2–12 characters, letters and digits, uppercase. Cannot be changed later.
              </span>
            </label>
          )}

          <label className="block text-[13.5px]">
            <span className={LABEL}>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={FIELD}
              placeholder="Sagicor Investments"
              required
            />
          </label>

          <label className="block text-[13.5px]">
            <span className={LABEL}>Line of business</span>
            <input
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className={FIELD}
              placeholder="Brokerage · Asset Management"
            />
          </label>

          <label className="block text-[13.5px]">
            <span className={LABEL}>Residency</span>
            <input
              value={residency}
              onChange={(e) => setResidency(e.target.value)}
              className={FIELD}
              placeholder="Jamaica"
            />
          </label>

          <label className="block text-[13.5px]">
            <span className={LABEL}>Regulator</span>
            <select
              value={regulator}
              onChange={(e) => setRegulator(e.target.value)}
              className={FIELD}
            >
              <option value="">Not stated</option>
              {REGULATORS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-[13.5px]">
            <span className={LABEL}>Agreement</span>
            <select
              value={agreementStatus}
              onChange={(e) => setAgreement(e.target.value)}
              className={FIELD}
            >
              {AGREEMENTS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
            {/* Not a status badge: this is the switch that decides whether a
                real order can reach this institution. */}
            <span className="mt-1 block text-[12.5px] text-faint">
              Only a live partner receives real orders. Everything else can be connected and
              browsed.
            </span>
          </label>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <Button type="submit" disabled={saving || name.trim().length < 2 || !code.trim()}>
            {saving ? 'Saving…' : partner ? 'Save changes' : 'Onboard partner'}
          </Button>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
        </div>
      </form>
    </dialog>
  );
}
