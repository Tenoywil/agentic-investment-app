'use client';

import {
  AUDIT_ACTOR_LABEL,
  auditActionLabel,
  fmtMinor,
  timeAgo,
} from '@/app/_components/console/lib';
import { Badge } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
import { useMe } from '@/app/_lib/session';
import { useSheetDismiss } from '@/app/_lib/sheet';
import {
  type AdminAuditEntry,
  type AdminInvestorDetail,
  type AdminPartner,
  getAdminInvestor,
  getAdminInvestorActivity,
  setAdminInvestorRoles,
} from '@/lib/admin-api';
import type { ConsoleActorType, ConsoleCurrency } from '@/lib/console-api';
import { CircleAlert, X } from 'lucide-react';
import * as React from 'react';

/**
 * One person, in full: who they are on the network right now, what they hold,
 * where they are in onboarding, everything audited against them, and the one
 * control that changes anything on this surface — their roles.
 *
 * Current roles are ALWAYS stated, first, as badges — administrators included.
 * The previous version replaced an administrator's whole roles section with a
 * paragraph about ADMIN_EMAILS, so opening the one account most admins look at
 * first (their own) showed no roles at all: the panel about roles was the one
 * place you could not read them.
 *
 * Editing follows what the server actually enforces, no tighter:
 *  - your own roles cannot be changed (the server refuses; the panel says so
 *    instead of offering a Save that fails)
 *  - the `admin` grant itself is never offered — ADMIN_EMAILS alone grants it,
 *    and the API filters it out of every edit in both directions — but an
 *    administrator's OTHER roles are editable like anyone else's, because the
 *    server explicitly preserves the admin row through such an edit.
 *
 * Presented in a dialog rather than inline above the table, so opening a
 * person does not scroll the list you were working through off the screen.
 * <dialog>.showModal() supplies the top layer, backdrop, Escape and focus
 * containment; on a phone it becomes a bottom sheet (.app-modal).
 *
 * Roles are edited as a whole set rather than added and removed one at a time:
 * "make this person an operator for JMMB" is a single intention, and two edits
 * would leave a window where they hold both surfaces or neither.
 */

/** What each role opens, in words a person granting it can act on. */
const ASSIGNABLE: { role: string; label: string; note: string }[] = [
  { role: 'customer', label: 'Customer', note: 'The investor app: portfolio, marketplace, agent' },
  {
    role: 'partner_operator',
    label: 'Partner operator',
    note: "A firm's console: orders, clients, listings. Must be bound to the firm",
  },
  { role: 'compliance', label: 'Compliance', note: 'Oversight surfaces, read-only' },
  { role: 'analyst', label: 'Analyst', note: 'The private-markets review queue' },
];

const LABEL = 'text-[12px] font-bold uppercase tracking-[.6px] text-dim';

/** "partner operator · SAG" — the binding is the fact, not the role alone. */
function roleBadgeText(
  r: { role: string; partnerId: string | null },
  partners: AdminPartner[],
): string {
  const base = r.role.replace(/_/g, ' ');
  if (r.role !== 'partner_operator' || !r.partnerId) return base;
  const code = partners.find((p) => p.id === r.partnerId)?.code;
  return code ? `${base} · ${code}` : base;
}

export function PersonPanel({
  id,
  partners,
  onClose,
  onChanged,
}: {
  id: string;
  partners: AdminPartner[];
  onClose: () => void;
  /** Lets the list behind this refresh the roles column after a change. */
  onChanged: () => void;
}) {
  const me = useMe();
  const [detail, setDetail] = React.useState<AdminInvestorDetail | null>(null);
  const [activity, setActivity] = React.useState<AdminAuditEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [roles, setRoles] = React.useState<string[]>([]);
  const [partnerCode, setPartnerCode] = React.useState<string>('');
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  /**
   * The partner list, read inside the effect without being a dependency of it.
   *
   * Saving bumps the parent's reload key, which hands this component a freshly
   * built `partners` array — a new identity every time, even when the contents
   * are unchanged. With that array in the dependency list the effect re-ran on
   * every save, refetching and resetting the panel, and the "Saved and audited"
   * confirmation vanished in the same frame it appeared. The person's id is the
   * only thing that should reload this.
   */
  const partnersRef = React.useRef(partners);
  partnersRef.current = partners;

  React.useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setActivity(null);
    setError(null);
    setSaved(false);
    Promise.all([getAdminInvestor(id), getAdminInvestorActivity(id)])
      .then(([d, a]) => {
        if (cancelled) return;
        setDetail(d);
        setActivity(a.entries);
        setRoles(d.roles.map((r) => r.role).filter((r) => r !== 'admin'));
        const bound = d.roles.find((r) => r.role === 'partner_operator')?.partnerId;
        setPartnerCode(partnersRef.current.find((p) => p.id === bound)?.code ?? '');
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Could not load this person.');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();

  /**
   * Where focus came from, so it can go back.
   *
   * <dialog> restores focus itself when it closes, but this panel is unmounted
   * by its parent in the same tick, and a removed element cannot be focused —
   * the keyboard user would land back at the top of the document with the list
   * they were working through somewhere below them. Captured before showModal()
   * moves focus into the dialog.
   */
  const openerRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const el = dialogRef.current;
    if (!el) return;
    if (!el.open) el.showModal();

    // Dismiss on a backdrop click: a click on the backdrop lands on the dialog
    // element itself, a click inside lands on a descendant. Bound here rather
    // than as an onClick prop because a backdrop has no keyboard equivalent —
    // Escape already closes a modal dialog natively.
    const onBackdrop = (e: MouseEvent) => {
      if (e.target === el) el.close();
    };
    el.addEventListener('click', onBackdrop);
    return () => el.removeEventListener('click', onBackdrop);
  }, []);

  const close = React.useCallback(() => {
    dialogRef.current?.close();
  }, []);

  useSheetDismiss(dialogRef, close);

  /** Fires for Escape and for close(), so both routes out behave the same. */
  const dismissed = React.useCallback(() => {
    openerRef.current?.focus();
    onClose();
  }, [onClose]);

  const isAdmin = detail?.roles.some((r) => r.role === 'admin') ?? false;
  const isSelf = me !== null && me.user.id === id;

  function toggle(role: string) {
    setSaved(false);
    setRoles((r) => (r.includes(role) ? r.filter((x) => x !== role) : [...r, role]));
  }

  function save() {
    setSaving(true);
    setError(null);
    setAdminInvestorRoles(id, roles, roles.includes('partner_operator') ? partnerCode : undefined)
      .then((res) => {
        setRoles(res.roles.map((r) => r.role).filter((r) => r !== 'admin'));
        setDetail((d) => (d ? { ...d, roles: res.roles } : d));
        setSaved(true);
        onChanged();
        return getAdminInvestorActivity(id).then((a) => setActivity(a.entries));
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not save.');
      })
      .finally(() => setSaving(false));
  }

  return (
    <dialog ref={dialogRef} className="app-modal" aria-labelledby={titleId} onClose={dismissed}>
      {/* Phone-only, and a real button as well as the target for the swipe: a
          gesture must never be the only way out. */}
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
            {detail?.user.name || 'This person'}
          </h2>
          <div className="truncate text-[13.5px] text-dim">{detail?.user.email ?? ''}</div>
          {/* What this person IS, before any control that changes it. */}
          {detail ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {detail.roles.length === 0 ? (
                <span className="text-[12.5px] text-faint">No roles yet. Investor by default</span>
              ) : (
                detail.roles.map((r) => (
                  <Badge key={r.role} variant={r.role === 'admin' ? 'default' : 'secondary'}>
                    {roleBadgeText(r, partners)}
                  </Badge>
                ))
              )}
            </div>
          ) : null}
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={close} aria-label="Close">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <div className="min-h-0 overflow-y-auto overscroll-contain px-[22px] py-[18px] pb-[max(22px,env(safe-area-inset-bottom))]">
        {error ? (
          <p className="mb-3 flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra">
            <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
            {error}
          </p>
        ) : null}

        {!detail && !error ? <p className="text-sm text-dim">Loading…</p> : null}

        {detail ? (
          <div className="g2">
            <div>
              <div className={LABEL}>Change roles</div>
              {isSelf ? (
                <p className="mt-2 text-[13.5px] leading-relaxed text-dim">
                  These are your own roles, and no administrator can change their own — the server
                  refuses it, so a compromised account cannot widen its reach. Another administrator
                  can change them for you.
                </p>
              ) : (
                <>
                  {isAdmin ? (
                    <p className="mt-2 text-[13px] leading-relaxed text-faint">
                      The administrator grant itself is set by the ADMIN_EMAILS environment variable
                      and cannot be granted or removed here. Their other roles can be changed as
                      usual — the admin grant survives the edit.
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-col gap-2.5">
                    {ASSIGNABLE.map(({ role, label, note }) => (
                      <label key={role} className="flex items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={roles.includes(role)}
                          onChange={() => toggle(role)}
                          className="mt-0.5 h-4 w-4"
                        />
                        <span className="min-w-0">
                          <span className="block text-[14.5px] font-semibold">{label}</span>
                          <span className="block text-[12.5px] text-faint">{note}</span>
                        </span>
                      </label>
                    ))}
                  </div>

                  {/* No partners on the network at all. An empty dropdown reads
                    as a loading bug, and the Save button beside it would refuse
                    without ever saying why — the server rejects an operator
                    with no partner, because an unbound one silently resolves to
                    the investor app. Say what is actually missing instead. */}
                  {roles.includes('partner_operator') && partners.length === 0 ? (
                    <p className="mt-3 rounded-[10px] border border-solid border-border bg-muted/40 px-3 py-2.5 text-[13.5px] leading-relaxed text-dim">
                      There are no partners on the network yet, so there is nobody to bind an
                      operator to. Partners are reference data — load them before granting this
                      role, and this list will fill in.
                    </p>
                  ) : null}

                  {roles.includes('partner_operator') && partners.length > 0 ? (
                    <label className="mt-3 block text-[13.5px]">
                      <span className={LABEL}>Their firm</span>
                      <select
                        value={partnerCode}
                        onChange={(e) => {
                          setPartnerCode(e.target.value);
                          setSaved(false);
                        }}
                        className="mt-1.5 block w-full rounded-[10px] border border-solid border-border bg-card px-3 py-2 text-[14.5px] text-foreground"
                      >
                        <option value="">Choose a partner…</option>
                        {partners.map((p) => (
                          <option key={p.id} value={p.code}>
                            {p.name} ({p.code})
                          </option>
                        ))}
                      </select>
                      {/* An operator with no partner resolves to the customer
                        surface, so this would look like the grant silently
                        failed. The server refuses it; saying so here is kinder. */}
                      <span className="mt-1 block text-[12.5px] text-faint">
                        An operator must be bound to a firm, or they see the investor app.
                      </span>
                    </label>
                  ) : null}

                  <div className="mt-3.5 flex items-center gap-3">
                    <Button
                      type="button"
                      size="sm"
                      onClick={save}
                      disabled={saving || (roles.includes('partner_operator') && !partnerCode)}
                    >
                      {saving ? 'Saving…' : 'Save roles'}
                    </Button>
                    {saved ? (
                      <output className="text-[13.5px] text-success">Saved and audited.</output>
                    ) : null}
                  </div>
                </>
              )}

              <div className={`${LABEL} mt-6`}>Onboarding</div>
              <dl className="mt-2 space-y-1.5 text-[14px]">
                {(
                  [
                    ['Tier', String(detail.kyc?.tier ?? '—')],
                    ['Identity verified', detail.kyc?.identityVerified ? 'yes' : 'no'],
                    ['Compliance confirmed', detail.kyc?.complianceConfirmed ? 'yes' : 'no'],
                    ['Risk completed', detail.kyc?.riskCompleted ? 'yes' : 'no'],
                    ['Funds confirmed', detail.kyc?.fundsConfirmed ? 'yes' : 'no'],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4">
                    <dt className="text-dim">{k}</dt>
                    <dd className="font-semibold">{v}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-4">
                  <dt className="text-dim">Holdings</dt>
                  <dd className="font-semibold">{detail.holdings.length}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-dim">Approvals waiting</dt>
                  <dd className="font-semibold">
                    {detail.approvals.filter((a) => a.status === 'pending').length}
                  </dd>
                </div>
              </dl>

              {detail.holdings.length > 0 ? (
                <>
                  <div className={`${LABEL} mt-5`}>What they hold</div>
                  <ul className="mt-2 space-y-1 text-[14px]">
                    {detail.holdings.map((h) => (
                      <li key={h.id} className="flex justify-between gap-4">
                        <span className="min-w-0 truncate text-dim">{h.name}</span>
                        <span className="flex-none font-mono font-semibold">
                          {fmtMinor(h.valueMinor, h.currency as ConsoleCurrency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>

            <div>
              <div className={LABEL}>Activity</div>
              <p className="mt-1 text-[12.5px] text-faint">
                Appended by the database and never rewritten.
              </p>
              {activity && activity.length > 0 ? (
                <ul className="mt-2 max-h-[420px] space-y-2.5 overflow-y-auto pr-1 text-[13.5px]">
                  {activity.map((a) => (
                    <li
                      key={a.id}
                      className="border-0 border-b border-solid border-border pb-2 last:border-b-0"
                    >
                      {/* English, not the raw audit key: "Console access
                          changed", never "user_roles.changed" — this reads to
                          the same person the console's own audit trail was
                          de-jargoned for. */}
                      <div className="font-semibold">{auditActionLabel(a.action)}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-faint">
                        <span>
                          {a.actorType
                            ? (AUDIT_ACTOR_LABEL[a.actorType as ConsoleActorType] ?? a.actorType)
                            : '—'}
                        </span>
                        <span>· {timeAgo(a.createdAt)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[14px] text-dim">
                  {activity ? 'Nothing recorded against this account yet.' : 'Loading…'}
                </p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
