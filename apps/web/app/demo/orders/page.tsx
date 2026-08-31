'use client';

import {
  AppScreen,
  DEFAULT_DEMO_PROFILE,
  DemoJourney,
  type DemoProfile,
  PageHead,
  demoIdentityEvidence,
  readDemoProfile,
} from '@/app/_components/AppScreen';
import { Badge } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/_components/ui/dialog';
import { cn } from '@/app/_lib/utils';
import { CheckCircle2, CircleAlert, FileText, ScanLine, Send, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

/**
 * Orders, in the signed-out preview.
 *
 * The rail has always offered this destination — `navGroupsFor('/demo')` strips
 * the Gateway group and Onboarding, but never Orders — and the route did not
 * exist, so a visitor evaluating the product clicked a primary nav item and got
 * a 404. The preview is the first thing anyone sees; a dead link in it is the
 * worst placed one in the app.
 *
 * Fixtures, like every other screen under `/demo`. They exist to show the shape
 * of the real screen: what an order looks like at each stage of its life, and
 * that the investor is told in plain words who holds it and what happens next.
 * The live version at `app/(customer)/orders` reads `GET /api/orders`.
 */

type Status = 'created' | 'accepted' | 'settled' | 'rejected';

const STATE: Record<Status, { label: string; tone: string }> = {
  created: { label: 'Routed', tone: 'bg-muted text-dim' },
  accepted: {
    label: 'Accepted',
    tone: 'bg-[#e7edf8] text-[#1a4aa0] dark:bg-white/10 dark:text-foreground',
  },
  settled: { label: 'Settled', tone: 'bg-mint text-success-ink' },
  rejected: {
    label: 'Declined',
    tone: 'bg-[#f7e9e2] text-[#a44e20] dark:bg-terra/15 dark:text-terra',
  },
};

const ORDERS: {
  id: string;
  name: string;
  status: Status;
  says: string;
  authorised: string;
  amount: string;
  byAgent?: boolean;
}[] = [
  {
    id: '1',
    name: 'NCB USD Money Market Fund',
    status: 'created',
    says: 'Sent to NCB Capital Markets to accept.',
    authorised: 'Authorised 12 Aug 2026',
    amount: 'US$400',
    byAgent: true,
  },
  {
    id: '2',
    name: "Gov't of Jamaica USD Global Bond 2032",
    status: 'accepted',
    says: 'NCB Capital Markets is executing it. Settlement expected 14 Aug 2026.',
    authorised: 'Authorised 10 Aug 2026',
    amount: 'US$2,500',
  },
  {
    id: '3',
    name: 'Sagicor Real Estate X Fund',
    status: 'settled',
    says: 'Settled on 4 Aug 2026. It is in your portfolio.',
    authorised: 'Authorised 1 Aug 2026',
    amount: 'US$5,000',
  },
  {
    id: '4',
    name: 'Sygnus Private Credit Note III',
    status: 'rejected',
    says: 'Minimum subscription not met for this tranche.',
    authorised: 'Authorised 28 Jul 2026',
    amount: 'US$10,000',
  },
];

const MARCUS_PROFILE: DemoProfile = { ...DEFAULT_DEMO_PROFILE, name: 'Marcus Bailey' };

export default function DemoOrdersPage() {
  const [passportCorrected, setPassportCorrected] = useState(false);
  const [packOpen, setPackOpen] = useState(false);
  const [packReviewed, setPackReviewed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [status, setStatus] = useState('');
  const [profile, setProfile] = useState<DemoProfile>(MARCUS_PROFILE);
  const open = ORDERS.filter((o) => o.status === 'created' || o.status === 'accepted');

  useEffect(() => {
    setProfile(readDemoProfile(MARCUS_PROFILE));
  }, []);

  const citizenship = [
    profile.jamaicanCitizen ? 'Jamaica' : '',
    profile.usCitizen ? 'United States' : '',
  ].filter(Boolean);
  const citizenshipText =
    citizenship.length > 0 ? `${citizenship.join(' + ')} citizen` : 'Citizenship not selected';
  const profileName = profile.name.trim() || 'Sample investor';
  const identityEvidence = demoIdentityEvidence(profile);

  function sendPack() {
    if (!passportCorrected) {
      setStatus('Replace the expired identity evidence before sending the pack.');
      return;
    }
    if (!packReviewed) {
      setStatus('Review and confirm the client pack before sending it to the partner.');
      setPackOpen(true);
      return;
    }
    setSubmitted(true);
    setStatus(`${profileName}’s review pack was sent to NCB Capital Markets.`);
  }

  return (
    <AppScreen active="orders" basePath="/demo">
      <PageHead
        eyebrow="Compliance agent prepares the evidence; the licensed partner makes the decision"
        title="Compliance & orders"
        right={
          <div className="rounded-xl border border-solid border-border bg-card px-4 py-2.5 text-[13.5px] text-dim">
            <b className="font-display text-lg text-foreground">{open.length}</b> in progress
          </div>
        }
      />

      <DemoJourney current="compliance" />

      <section aria-labelledby="compliance-heading" className="mb-7">
        <div className="mb-3">
          <h2 id="compliance-heading" className="font-display text-xl font-bold">
            {profileName}’s client review pack
          </h2>
          <p className="mb-0 mt-1 text-sm text-dim">
            Sample OCR and declarations are structured for human review. No automated result is
            represented as a licensed firm’s KYC or AML decision.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
          <Card className="p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-mint text-teal2">
                  <ScanLine className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <b className="font-display text-lg">Identity scan</b>
                  <p className="mb-0 mt-1 text-sm text-dim">
                    OCR confidence 98% · manual review required
                  </p>
                </div>
              </div>
              <Badge variant={passportCorrected ? 'success' : 'warning'}>
                {passportCorrected ? 'Evidence ready' : 'Action required'}
              </Badge>
            </div>

            <div
              className={cn(
                'mt-4 rounded-xl border p-4',
                passportCorrected
                  ? 'border-[#cde0d8] bg-mint'
                  : 'border-[#ecd2c2] bg-[#fbeee7] dark:border-[#5a3f2e] dark:bg-[#2c1f17]',
              )}
            >
              <div className="flex items-start gap-3">
                {passportCorrected ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-success" aria-hidden />
                ) : (
                  <CircleAlert className="mt-0.5 h-5 w-5 flex-none text-terra" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-bold">
                    {passportCorrected && identityEvidence.replacementDocument
                      ? identityEvidence.replacementDocument
                      : identityEvidence.currentDocument}
                  </div>
                  <p className="mb-0 mt-1 text-sm leading-snug text-dim">
                    {passportCorrected
                      ? 'Replacement identity evidence is ready to include in the partner pack.'
                      : 'The compliance agent stopped the handoff and requested current identity evidence.'}
                  </p>
                </div>
              </div>
              {!passportCorrected ? (
                <Button
                  type="button"
                  className="mt-4 w-full sm:w-auto"
                  onClick={() => {
                    if (!identityEvidence.replacementDocument) {
                      setStatus(
                        'Select at least one citizenship in the profile before replacing the passport.',
                      );
                      return;
                    }
                    setPassportCorrected(true);
                    setPackReviewed(false);
                    setStatus(
                      `${identityEvidence.replacementSummary}. Review the updated pack before sending.`,
                    );
                  }}
                  disabled={!identityEvidence.replacementDocument}
                >
                  {identityEvidence.replacementButtonLabel}
                </Button>
              ) : null}
            </div>

            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                ['Residency', profile.residence],
                ['Citizenship', citizenshipText],
                ['Politically exposed person', 'No · declaration recorded'],
                ['FATF jurisdiction screen', 'No policy flag in sample evidence'],
                ['Source of funds', 'Employment income + savings'],
                ['Proof of address', identityEvidence.addressEvidence],
                ['Tax identifiers', identityEvidence.taxIdentifiers],
                [
                  'Identity document',
                  passportCorrected && identityEvidence.replacementDocument
                    ? identityEvidence.replacementDocument
                    : identityEvidence.currentDocument,
                ],
              ].map(([term, value]) => (
                <div key={term} className="rounded-xl bg-muted/50 p-3">
                  <dt className="text-xs font-bold uppercase tracking-[.4px] text-faint">{term}</dt>
                  <dd className="mb-0 ml-0 mt-1 text-sm font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card className="h-fit p-5 sm:p-6">
            <ShieldCheck className="h-6 w-6 text-teal2" aria-hidden />
            <h3 className="mb-0 mt-3 font-display text-lg font-bold">Human-in-the-loop handoff</h3>
            <p className="mb-0 mt-2 text-sm leading-relaxed text-dim">
              CCN organises the consented evidence and flags issues. NCB Capital Markets—not CCN—
              performs its screening and makes the final KYC, AML and client-acceptance decision.
            </p>
            <div className="mt-4 rounded-xl bg-[#f4f0e7] p-4 dark:bg-white/[0.04]">
              <div className="text-xs font-bold uppercase tracking-[.5px] text-faint">
                Response target
              </div>
              <div className="mt-1 font-display text-xl font-bold">Within 3 business days</div>
              <p className="mb-0 mt-1 text-xs text-dim">
                Actual timing may change if the partner requests more evidence.
              </p>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <Button variant="outline" onClick={() => setPackOpen(true)}>
                <FileText className="h-4 w-4" aria-hidden /> Review client PDF
              </Button>
              <Button onClick={sendPack}>
                <Send className="h-4 w-4" aria-hidden /> Send to NCB
              </Button>
            </div>
            <output
              className={cn('mb-0 mt-3 text-sm', submitted ? 'text-success-ink' : 'text-terra-ink')}
            >
              {status ||
                'Resolve the identity warning, review the pack, then send it to the partner.'}
            </output>
            {submitted ? (
              <Button asChild variant="secondary" className="mt-4 w-full">
                <Link href="/demo/institutions">Open NCB partner review</Link>
              </Button>
            ) : null}
          </Card>
        </div>
      </section>

      <Dialog open={packOpen} onOpenChange={setPackOpen}>
        <DialogContent className="max-w-[680px]">
          <DialogHeader>
            <DialogTitle>{profileName} · client review pack</DialogTitle>
            <DialogDescription>
              Editable review preview · generated from consented sample declarations and evidence.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1 text-sm">
            <ReviewSection title="Profile">
              {profile.residence} resident · {citizenshipText} · {profile.risk} risk ·{' '}
              {profile.horizon} horizon
            </ReviewSection>
            <ReviewSection title="Identity evidence">
              {passportCorrected
                ? `${identityEvidence.replacementDocument}.`
                : `${identityEvidence.currentDocument}. Replacement required before handoff.`}
            </ReviewSection>
            <ReviewSection title="Tax and address evidence">
              {identityEvidence.taxIdentifiers} · {identityEvidence.addressEvidence}.
            </ReviewSection>
            <ReviewSection title="Declarations">
              PEP: No · source of funds: employment income and savings · FATF jurisdiction screen:
              no sample policy flag.
            </ReviewSection>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" asChild>
              <Link href="/demo/planning#profile">Edit profile details</Link>
            </Button>
            <Button
              disabled={!passportCorrected}
              onClick={() => {
                if (!passportCorrected) return;
                setPackReviewed(true);
                setStatus('Client pack reviewed and ready to send.');
                setPackOpen(false);
              }}
            >
              Confirm review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <h2 className="mb-3 font-display text-xl font-bold">Order activity</h2>

      <Card className="overflow-hidden" data-tour="customer-order-flow">
        <ul className="m-0 list-none p-0">
          {ORDERS.map((o) => (
            <li
              key={o.id}
              className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 border-0 border-b border-solid border-border px-[22px] py-4 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-[15px]">{o.name}</b>
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-[.4px]',
                      STATE[o.status].tone,
                    )}
                  >
                    {STATE[o.status].label}
                  </span>
                </div>
                <div className="mt-0.5 text-[13px] text-dim">{o.says}</div>
                <div className="mt-0.5 text-[12.5px] text-faint">
                  {o.authorised}
                  {o.byAgent ? ' · proposed by your agent' : ''}
                </div>
              </div>
              <b className="flex-none font-mono text-[15px]">{o.amount}</b>
            </li>
          ))}
        </ul>
      </Card>

      <p className="mt-4 text-[13px] text-faint">
        Sample data. Nothing here is executed by CCN — an order belongs to the licensed institution
        that holds it from the moment it is routed.
      </p>
    </AppScreen>
  );
}

function ReviewSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border p-4">
      <h3 className="mb-1 font-bold">{title}</h3>
      <p className="m-0 leading-relaxed text-dim">{children}</p>
    </section>
  );
}
