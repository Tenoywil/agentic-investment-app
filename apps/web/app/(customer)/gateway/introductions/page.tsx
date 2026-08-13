'use client';

import { AppScreen, PageHead } from '@/app/_components/AppScreen';
import { Badge, type BadgeProps } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { type Introduction, type IntroductionStatus, getIntroductions } from '@/lib/gateway-api';
import { CircleAlert, HandHeart } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const STATUS_VARIANT: Record<IntroductionStatus, BadgeProps['variant']> = {
  requested: 'warning',
  approved: 'success',
  completed: 'success',
  rejected: 'terra',
};

const STATUS_LABEL: Record<IntroductionStatus, string> = {
  requested: 'Awaiting analyst review',
  approved: 'Approved',
  completed: 'Completed',
  rejected: 'Not approved',
};

function IntroductionRow({ intro }: { intro: Introduction }) {
  return (
    <Card className="flex flex-wrap items-center gap-4 p-[18px]">
      <HandHeart className="h-6 w-6 flex-none text-teal2" aria-hidden />
      <div className="min-w-[220px] flex-1">
        <div className="mb-1 flex items-center gap-2">
          <Badge variant={STATUS_VARIANT[intro.status]}>{STATUS_LABEL[intro.status]}</Badge>
        </div>
        {intro.note && <p className="text-sm text-dim">"{intro.note}"</p>}
        {intro.decisionReason && (
          <p className="mt-1 text-sm text-dim">Analyst note: {intro.decisionReason}</p>
        )}
        <p className="mt-1 text-[12.5px] text-faint">
          Requested {new Date(intro.createdAt).toLocaleDateString('en-US')}
          {intro.decidedAt
            ? ` · decided ${new Date(intro.decidedAt).toLocaleDateString('en-US')}`
            : ''}
        </p>
      </div>
      <Button asChild variant="outline" className="flex-none">
        <Link href={`/gateway/opportunities/detail?id=${intro.opportunityId}`}>View deal</Link>
      </Button>
    </Card>
  );
}

export default function GatewayIntroductionsPage() {
  const [introductions, setIntroductions] = useState<Introduction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getIntroductions()
      .then(({ introductions }) => setIntroductions(introductions))
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Could not load your introductions.'),
      );
  }, []);

  return (
    <AppScreen active="gatewayIntroductions">
      <PageHead
        eyebrow="Caribbean Capital Gateway · private-deal matching"
        title="Your introductions"
      />

      {error && (
        <p className="flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra">
          <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
          {error}
        </p>
      )}

      {introductions && introductions.length === 0 && (
        <Card className="flex flex-wrap items-center gap-4 border-[#cde0d8] bg-mint p-[22px] dark:border-white/10">
          <HandHeart className="h-8 w-8 flex-none text-teal2" aria-hidden />
          <div className="min-w-[240px] flex-1">
            <div className="mb-1 font-display text-lg font-bold">No introductions yet</div>
            <p className="text-sm leading-snug text-dim">
              Request an introduction from a matched opportunity's page and it'll show up here.
            </p>
          </div>
          <Button asChild className="flex-none">
            <Link href="/gateway/opportunities">Browse matches</Link>
          </Button>
        </Card>
      )}

      {introductions && introductions.length > 0 && (
        <div className="flex flex-col gap-3">
          {introductions.map((intro) => (
            <IntroductionRow key={intro.id} intro={intro} />
          ))}
        </div>
      )}
    </AppScreen>
  );
}
