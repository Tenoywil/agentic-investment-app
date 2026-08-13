'use client';

import { Card } from '@/app/_components/ui/card';
import { EmptyState } from '@/app/_components/ui/empty';
import type { ConsoleAuditEntry } from '@/lib/console-api';
import type { MePartner } from '@/lib/me-api';
import { ScrollText, ShieldCheck } from 'lucide-react';
import {
  AUDIT_ACTOR_DOT,
  AUDIT_ACTOR_LABEL,
  ROW_DIVIDER,
  agreementLabel,
  auditActionLabel,
  auditReason,
  regulatorLabel,
  timeAgo,
} from './lib';
import { ErrorNote } from './notice';

/**
 * Agreement facts and the real audit trail.
 *
 * Both halves of this tab used to be invented. The left card asserted
 * "Regulator: FSC Jamaica", "Partner agreement: Active" and "Last audit: Jun
 * 12, 2026" to whoever was signed in; the right card listed five fictional
 * events — order refs, client numbers, a settlement — under the heading "Live
 * audit trail". Every row here now comes from the operator's own partner row
 * or from GET /api/console/audit, and a fact the partner row does not carry
 * simply has no row. "Last audit" has no column anywhere and is gone.
 */
export function ComplianceTab({
  partner,
  audit,
  auditError,
}: {
  partner: MePartner | null;
  audit: ConsoleAuditEntry[];
  auditError: string | null;
}) {
  const rows: { label: string; value: string }[] = [];
  if (partner) {
    rows.push({ label: 'Partner code', value: partner.code });
    if (partner.kind) rows.push({ label: 'Business', value: partner.kind });
    const regulator = regulatorLabel(partner.regulator);
    if (regulator) rows.push({ label: 'Regulator', value: regulator });
    const agreement = agreementLabel(partner.agreementStatus);
    if (agreement) rows.push({ label: 'Partner agreement', value: agreement });
    if (partner.residency) rows.push({ label: 'Data residency', value: partner.residency });
  }

  return (
    <div className="g-agent g-agent--flip">
      {/* Pure white, not a softened off-white: in the dark theme --primary
          resolves to a mid teal against which nothing dimmer than white clears
          4.5:1 for 14px text. Label vs. value is carried by weight instead. */}
      <Card className="h-fit border-none bg-primary p-6 text-white">
        <div className="mb-4 flex items-center gap-2.5">
          <ShieldCheck className="h-[18px] w-[18px] text-[#8fe3c0]" aria-hidden />
          <b className="font-display text-base">Agreement &amp; residency</b>
        </div>
        {rows.length > 0 ? (
          <dl className="m-0">
            {rows.map((r) => (
              // gap-x only, and both sides allowed to shrink: a long business
              // description used to push its own value past the card's right
              // edge rather than wrap inside it.
              <div key={r.label} className="flex flex-wrap justify-between gap-x-4 py-1.5 text-sm">
                <dt className="min-w-0">{r.label}</dt>
                <dd className="m-0 min-w-0 text-right font-bold">{r.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="m-0 text-sm leading-relaxed">
            No agreement details are recorded against this account yet.
          </p>
        )}
      </Card>

      <Card className="p-6" data-tour="institution-audit">
        <b className="font-display text-[17px]">Audit trail</b>
        <p className="mb-3 mt-1 text-[13px] leading-snug text-faint">
          Append-only and hash-chained in the database — orders, reconciliation and listing changes
          for {partner?.name ?? 'this partner'}, newest first.
        </p>

        {auditError ? <ErrorNote message={auditError} className="mb-3" /> : null}

        {!auditError && audit.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No audited activity yet"
            body="Accepting an order, matching a statement line or pausing a listing writes an entry here that nobody — including CCN — can edit or delete."
          />
        ) : null}

        {audit.map((a) => {
          const reason = auditReason(a.detail);
          return (
            <div key={a.id} className={`flex gap-2.5 py-2.5 ${ROW_DIVIDER} last:border-b-0`}>
              <span
                className={`mt-[5px] h-[9px] w-[9px] flex-none rounded-full ${AUDIT_ACTOR_DOT[a.actorType]}`}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-foreground">{auditActionLabel(a.action)}</div>
                <div className="mt-0.5 text-[12.5px] text-faint">
                  {AUDIT_ACTOR_LABEL[a.actorType]}
                  {a.entityType ? ` · ${a.entityType}` : ''} · {timeAgo(a.createdAt)}
                </div>
                {reason ? (
                  <div className="mt-0.5 text-[12.5px] italic text-dim">{reason}</div>
                ) : null}
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
