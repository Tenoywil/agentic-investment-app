'use client';

import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { EmptyState } from '@/app/_components/ui/empty';
import type { ConsoleAuditEntry } from '@/lib/console-api';
import type { MePartner } from '@/lib/me-api';
import { Pencil, ScrollText, ShieldCheck } from 'lucide-react';
import * as React from 'react';
import { datedFilename, downloadCsv, toCsv } from './export-csv';
import {
  AUDIT_ACTOR_DOT,
  AUDIT_ACTOR_LABEL,
  ROW_DIVIDER,
  agreementLabel,
  auditActionLabel,
  auditEntityLabel,
  auditReason,
  regulatorLabel,
  timeAgo,
} from './lib';
import { RowsSkeleton } from './loading';
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
/** On the navy card, so the label sits at the same contrast as the dl above. */
const PROFILE_LABEL = 'text-[12px] font-bold uppercase tracking-[.5px] text-white/70';
const PROFILE_FIELD =
  'mt-1 block w-full rounded-[10px] border border-solid border-white/25 bg-white/10 px-3 py-2 text-[15px] text-white placeholder:text-white/40';

export function ComplianceTab({
  partner,
  audit,
  auditError,
  loading,
  onSaveProfile,
  profileSaving,
  profileError,
}: {
  partner: MePartner | null;
  audit: ConsoleAuditEntry[];
  auditError: string | null;
  loading: boolean;
  onSaveProfile: (input: { name: string; kind?: string; residency?: string }) => void;
  profileSaving: boolean;
  profileError: string | null;
}) {
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(partner?.name ?? '');
  const [kind, setKind] = React.useState(partner?.kind ?? '');
  const [residency, setResidency] = React.useState(partner?.residency ?? '');

  // `partner` arrives after the first render, so the form has to pick it up
  // when it does rather than staying empty for whoever opens the editor first.
  React.useEffect(() => {
    setName(partner?.name ?? '');
    setKind(partner?.kind ?? '');
    setResidency(partner?.residency ?? '');
  }, [partner]);

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
        {editing ? (
          /*
           * The three fields a firm owns about itself.
           *
           * `partners` had an UPDATE grant and one admin-only policy, so a firm
           * could not fix a typo in its own name — the name that appears beside
           * every product it lists. Code, regulator and agreement status stay
           * out: the first resolves the executing adapter, the second is a
           * compliance claim made to investors, the third gates live routing.
           * They are shown above and are CCN's to set.
           */
          <form
            className="m-0"
            onSubmit={(e) => {
              e.preventDefault();
              onSaveProfile({
                name: name.trim(),
                kind: kind.trim() || undefined,
                residency: residency.trim() || undefined,
              });
              setEditing(false);
            }}
          >
            <label className="block text-sm">
              <span className={PROFILE_LABEL}>Firm name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={PROFILE_FIELD}
                required
                minLength={2}
              />
            </label>
            <label className="mt-3 block text-sm">
              <span className={PROFILE_LABEL}>Business</span>
              <input
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className={PROFILE_FIELD}
                placeholder="Funds · Insurance"
              />
            </label>
            <label className="mt-3 block text-sm">
              <span className={PROFILE_LABEL}>Data residency</span>
              <input
                value={residency}
                onChange={(e) => setResidency(e.target.value)}
                className={PROFILE_FIELD}
                placeholder="Jamaica"
              />
            </label>
            <p className="mb-0 mt-3 text-[12.5px] leading-relaxed text-white/70">
              Your partner code, regulator and agreement status are set by CCN. The regulator is
              shown to investors on every product you list, so it is not a field a console can
              write.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <Button type="submit" size="sm" variant="secondary" disabled={profileSaving}>
                {profileSaving ? 'Saving…' : 'Save'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-white hover:bg-white/10 hover:text-white"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : rows.length > 0 ? (
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

        {profileError ? <p className="mb-0 mt-3 text-sm text-[#ffcbb0]">{profileError}</p> : null}

        {partner && !editing ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mt-3 px-0 text-white hover:bg-white/10 hover:text-white"
            onClick={() => setEditing(true)}
          >
            <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Edit firm details
          </Button>
        ) : null}
      </Card>

      <Card className="p-6" data-tour="institution-audit">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <b className="font-display text-[17px]">Audit trail</b>
          {/* The record a regulated desk is asked to produce. Exported from the
              rows on screen, worded exactly as the screen words them. */}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={audit.length === 0}
            onClick={() =>
              downloadCsv(
                datedFilename('ccn-audit'),
                toCsv(audit, [
                  { header: 'Sequence', value: (a) => a.seq },
                  { header: 'When', value: (a) => a.createdAt },
                  { header: 'Action', value: (a) => auditActionLabel(a.action) },
                  { header: 'Action key', value: (a) => a.action },
                  { header: 'Concerning', value: (a) => auditEntityLabel(a.entityType) ?? '' },
                  { header: 'Actor', value: (a) => AUDIT_ACTOR_LABEL[a.actorType] },
                  { header: 'Reason', value: (a) => auditReason(a.detail) ?? '' },
                ]),
              )
            }
          >
            Export CSV
          </Button>
        </div>
        <p className="mb-3 mt-1 text-[13px] leading-snug text-faint">
          Append-only and hash-chained in the database — orders, reconciliation and listing changes
          for {partner?.name ?? 'this partner'}, newest first.
        </p>

        {auditError ? <ErrorNote message={auditError} className="mb-3" /> : null}

        {loading && !auditError ? <RowsSkeleton rows={4} label="Loading the audit trail" /> : null}

        {!loading && !auditError && audit.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No audited activity yet"
            body="Accepting an order, matching a statement line or pausing a listing writes an entry here that nobody — including CCN — can edit or delete."
          />
        ) : null}

        {audit.map((a) => {
          const reason = auditReason(a.detail);
          const entity = auditEntityLabel(a.entityType);
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
                  {entity ? ` · ${entity}` : ''} · {timeAgo(a.createdAt)}
                </div>
                {reason ? (
                  <div className="mt-0.5 text-[12.5px] italic text-dim">{reason}</div>
                ) : null}
              </div>
            </div>
          );
        })}
      </Card>

      {/* CCN's standing terms with a firm, in one place. These paragraphs used
          to sit as cards on the Overview and Clients tabs — informational copy
          spread across working surfaces. They are reference material, and this
          tab is the console's reference shelf. */}
      <Card className="p-6 min-[901px]:col-span-2">
        <b className="font-display text-[17px]">How CCN works with your firm</b>
        <div className="mt-3 grid gap-5 md:grid-cols-3">
          <div>
            <div className="mb-1.5 text-[13.5px] font-bold">What the flow brings you</div>
            <ul className="m-0 list-none p-0 text-sm leading-relaxed text-dim">
              <li>Qualified, KYC-cleared demand into products you already run.</li>
              <li>Diaspora reach without building cross-border onboarding.</li>
              <li>Your name and regulator on every deal card, no channel conflict.</li>
            </ul>
          </div>
          <div>
            <div className="mb-1.5 text-[13.5px] font-bold">The line CCN never crosses</div>
            <p className="m-0 text-sm leading-relaxed text-dim">
              CCN holds no client money, executes nothing and never becomes custodian. The regulated
              duties stay with you; CCN routes signed instructions and keeps the audit trail.
            </p>
          </div>
          <div>
            <div className="mb-1.5 text-[13.5px] font-bold">KYC stays yours</div>
            <p className="m-0 text-sm leading-relaxed text-dim">
              You already verified these clients. CCN links that status with their consent rather
              than re-collecting it. You remain the regulated owner of KYC and AML.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
