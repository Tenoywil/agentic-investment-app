'use client';

import { Badge } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import {
  type AdminAuditEntry,
  type AdminInvestorDetail,
  type AdminPartner,
  getAdminInvestor,
  getAdminInvestorActivity,
  setAdminInvestorRoles,
} from '@/lib/admin-api';
import { CircleAlert, X } from 'lucide-react';
import * as React from 'react';

/**
 * One person, in full: what they hold, where they are in onboarding, every
 * audited thing that has happened to them, and the one control that changes
 * anything on this surface — their roles.
 *
 * Roles are edited as a whole set rather than added and removed one at a time.
 * They decide which product someone sees, so "make this person an operator for
 * JMMB" is a single intention, and stepping through it as two edits would leave
 * a window where they hold both surfaces or neither.
 *
 * `admin` is not offered. It is granted by the ADMIN_EMAILS environment
 * variable alone, and the API and the database both refuse it here — so a
 * compromised administrator cannot promote a second one, or quietly remove a
 * colleague. Showing a checkbox that the server would reject would be worse
 * than showing none, so the reason is stated instead.
 */

const ASSIGNABLE = ['customer', 'partner_operator', 'compliance', 'analyst'] as const;
const LABEL = 'text-[12px] font-bold uppercase tracking-[.6px] text-dim';

function money(minor: string, currency: string): string {
  return `${currency} ${(Number(minor) / 100).toLocaleString()}`;
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

  const isAdmin = detail?.roles.some((r) => r.role === 'admin') ?? false;

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
    <Card className="mb-[18px] p-[22px]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display text-lg font-bold">{detail?.user.name || 'This person'}</div>
          <div className="text-[13.5px] text-dim">{detail?.user.email ?? ''}</div>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

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
            <div className={LABEL}>Roles</div>
            {isAdmin ? (
              <p className="mt-2 text-[13.5px] leading-relaxed text-dim">
                This account is an administrator. Administrator access is granted by the
                ADMIN_EMAILS environment variable and cannot be changed from here — so no one who
                reaches this screen can create another administrator, or remove one.
              </p>
            ) : (
              <>
                <div className="mt-2 flex flex-col gap-2">
                  {ASSIGNABLE.map((role) => (
                    <label key={role} className="flex items-center gap-2.5 text-[14.5px]">
                      <input
                        type="checkbox"
                        checked={roles.includes(role)}
                        onChange={() => toggle(role)}
                        className="h-4 w-4"
                      />
                      {role.replace('_', ' ')}
                    </label>
                  ))}
                </div>

                {roles.includes('partner_operator') ? (
                  <label className="mt-3 block text-[13.5px]">
                    <span className={LABEL}>Partner</span>
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
                      An operator must be bound to a partner, or they see the investor app.
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
                      <span className="flex-none font-semibold">
                        {money(h.valueMinor, h.currency)}
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
              <ul className="mt-2 max-h-[420px] space-y-2 overflow-y-auto pr-1 text-[13.5px]">
                {activity.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-0 border-b border-solid border-border pb-1.5"
                  >
                    <span className="font-semibold">{a.action}</span>
                    <span className="text-faint">{new Date(a.createdAt).toLocaleString()}</span>
                    <Badge variant="secondary">{a.actorType ?? '—'}</Badge>
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
    </Card>
  );
}
