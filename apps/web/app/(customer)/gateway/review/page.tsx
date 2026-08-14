'use client';

import { AppScreen, PageHead } from '@/app/_components/AppScreen';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { EmptyState } from '@/app/_components/ui/empty';
import { Skeleton, SkeletonRegion } from '@/app/_components/ui/skeleton';
import { useMe } from '@/app/_lib/session';
import {
  type ReviewQueue,
  approveIntroduction,
  getReviewQueue,
  rejectIntroduction,
} from '@/lib/gateway-api';
import { CircleAlert, HandHeart, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

/**
 * The analyst's desk.
 *
 * `analyst` and `compliance` have been assignable roles on the administration
 * surface for as long as it has existed, and they granted access to no screen in
 * the product. The consequence was not an empty menu — it was a dead end with a
 * person waiting at the other side of it. An investor who requested an
 * introduction saw "Awaiting analyst review" and would have seen it forever: the
 * review queue and both decision endpoints existed, were tested, were guarded by
 * exactly those roles, and had no caller anywhere in the web app. The Gateway's
 * three nav links led into a loop nothing could complete.
 *
 * Deliberately narrow. This reviews what investors are waiting on; it is not a
 * deal-origination surface, and listing a private deal still has no screen (see
 * the note in apps/web/test/api-coverage.test.ts). Reviewing something nobody is
 * blocked by can wait; unblocking a person cannot.
 */

const REVIEW_ROLES = ['analyst', 'compliance', 'admin'];

function when(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function GatewayReviewPage() {
  const me = useMe();
  const canReview = (me?.roles ?? []).some((r) => REVIEW_ROLES.includes(r));

  const [queue, setQueue] = useState<ReviewQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!canReview) return;
    try {
      setQueue(await getReviewQueue());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the review queue.');
    }
  }, [canReview]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, approve: boolean) {
    const reason = (reasons[id] ?? '').trim();
    // A decline reaches the investor as the explanation for a "no". Sending an
    // empty one would put them back where they started, which is the state this
    // whole screen exists to end.
    if (!approve && reason === '') {
      setActionError('Give a reason — the investor sees it.');
      return;
    }
    setBusyId(id);
    setActionError(null);
    try {
      if (approve) await approveIntroduction(id);
      else await rejectIntroduction(id, reason);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not record that decision.');
    } finally {
      setBusyId(null);
    }
  }

  if (!canReview) {
    return (
      <AppScreen active="gatewayIntroductions">
        <PageHead
          eyebrow="Caribbean Capital Gateway · private-deal matching"
          title="Review queue"
        />
        <EmptyState
          icon={ShieldCheck}
          title="This desk is for analysts"
          body="Introduction requests and deals awaiting review appear here for accounts holding the analyst or compliance role."
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen active="gatewayIntroductions">
      <PageHead
        eyebrow="Caribbean Capital Gateway · private-deal matching"
        title="Review queue"
        right={
          queue ? (
            <div className="rounded-xl border border-solid border-border bg-card px-4 py-2.5 text-[13.5px] text-dim">
              <b className="font-display text-lg text-foreground">{queue.introductions.length}</b>{' '}
              waiting
            </div>
          ) : undefined
        }
      />

      {error ? (
        <p className="mb-4 flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra">
          <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
          {error}
        </p>
      ) : null}

      {!queue && !error ? (
        <SkeletonRegion label="Loading the review queue">
          <div className="flex flex-col gap-3">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="rounded-lg border border-solid border-border bg-card p-[18px]"
              >
                <Skeleton className="mb-2 h-4 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            ))}
          </div>
        </SkeletonRegion>
      ) : null}

      {actionError ? (
        <p className="mb-3 flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra">
          <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
          {actionError}
        </p>
      ) : null}

      {queue && queue.introductions.length === 0 ? (
        <EmptyState
          icon={HandHeart}
          title="Nobody is waiting"
          body="An investor asking to be introduced to a deal's counterparty appears here for a decision."
        />
      ) : null}

      {queue && queue.introductions.length > 0 ? (
        <Card className="overflow-hidden">
          <ul className="m-0 list-none p-0">
            {queue.introductions.map((intro) => (
              <li
                key={intro.id}
                className="border-0 border-b border-solid border-border px-[22px] py-4 last:border-b-0"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <b className="text-[15px]">Introduction request</b>
                  <span className="text-[12.5px] text-faint">Asked {when(intro.createdAt)}</span>
                </div>
                <div className="mt-0.5 font-mono text-[12.5px] text-faint">
                  Deal {intro.opportunityId}
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busyId === intro.id}
                    onClick={() => void decide(intro.id, true)}
                  >
                    {busyId === intro.id ? 'Recording…' : 'Approve'}
                  </Button>
                  <input
                    value={reasons[intro.id] ?? ''}
                    onChange={(e) => setReasons((r) => ({ ...r, [intro.id]: e.target.value }))}
                    placeholder="Reason, if declining"
                    aria-label="Reason for declining"
                    className="min-w-[200px] flex-1 rounded-lg border border-solid border-border bg-card px-3 py-1.5 text-[13.5px]"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busyId === intro.id}
                    onClick={() => void decide(intro.id, false)}
                  >
                    Decline
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {queue && queue.opportunities.length > 0 ? (
        <Card className="mt-4 p-[22px]">
          <b className="font-display text-lg">Deals awaiting review</b>
          <p className="mb-3 mt-1 text-[13px] text-faint">
            Submitted for approval by their originator. Deciding these needs the origination
            surface, which does not exist yet — they are listed so the queue is not silently
            partial.
          </p>
          <ul className="m-0 list-none p-0">
            {queue.opportunities.map((o) => (
              <li key={o.id} className="border-t border-solid border-border py-2.5 text-sm">
                <b>{o.title ?? 'Untitled deal'}</b>
                <span className="text-faint">
                  {o.sector ? ` · ${o.sector}` : ''}
                  {o.jurisdiction ? ` · ${o.jurisdiction}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </AppScreen>
  );
}
