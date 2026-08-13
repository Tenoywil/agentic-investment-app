'use client';

import { AppScreen, PageHead } from '@/app/_components/AppScreen';
import { Skeleton, SkeletonCard, SkeletonRegion } from '@/app/_components/ui/skeleton';
import { usePathname } from 'next/navigation';
import * as React from 'react';

/**
 * What a customer screen looks like while the session is still resolving.
 *
 * The guard used to replace the whole application with a centred logo for the
 * length of the `/api/me` round trip, and only then render anything. Measured
 * with 400ms of API latency, every customer screen held zero characters of
 * content at 150ms and then arrived at once — /planning recorded a cumulative
 * layout shift of 1.024 against a 0.1 "good" threshold, most of it from that
 * single swap rather than from the data.
 *
 * Rendering the shell instead costs nothing in safety. The navigation depends
 * on no session data — the account menu hides itself until it has an identity —
 * and this draws placeholders, never data, so a partner operator who lands here
 * by typing /home sees furniture for a moment and is then redirected, having
 * been shown nothing that belongs to anyone.
 *
 * The shapes are per route rather than one generic layout, and that is not
 * fussiness. A single shape was measured first: it fixed the blank screen and
 * halved /planning, but it made /agent worse than before (0.245 to 0.538),
 * because a skeleton of the wrong shape does not remove the settle, it just
 * moves it later. A placeholder is only worth drawing where it stands in the
 * same place its content will.
 */

type Key = Parameters<typeof AppScreen>[0]['active'];
type Shape = 'home' | 'agent' | 'planning' | 'portfolio' | 'list';

const ROUTES: { prefix: string; key: Key; title: string; shape: Shape }[] = [
  { prefix: '/portfolio', key: 'portfolio', title: 'Your portfolio', shape: 'portfolio' },
  { prefix: '/opportunities', key: 'opportunities', title: 'Opportunities', shape: 'list' },
  { prefix: '/agent', key: 'agent', title: 'Your Capital Agent', shape: 'agent' },
  { prefix: '/planning', key: 'planning', title: 'Planning', shape: 'planning' },
  { prefix: '/onboarding', key: 'onboarding', title: 'Onboarding', shape: 'list' },
  { prefix: '/gateway/mandate', key: 'gatewayMandate', title: 'Your mandate', shape: 'list' },
  {
    prefix: '/gateway/opportunities',
    key: 'gatewayOpportunities',
    title: 'Private deals',
    shape: 'list',
  },
  {
    prefix: '/gateway/introductions',
    key: 'gatewayIntroductions',
    title: 'Introductions',
    shape: 'list',
  },
  { prefix: '/home', key: 'home', title: 'Home', shape: 'home' },
];

const FALLBACK = { key: 'home' as Key, title: 'Home', shape: 'home' as Shape };

/** A tall block standing in for one dark hero card. */
function Hero() {
  return <Skeleton className="mb-[18px] h-[196px] w-full rounded-[20px]" />;
}

function Body({ shape }: { shape: Shape }) {
  if (shape === 'agent') {
    // Two columns: the conversation, and approvals over limits. The chat card
    // carries the same min-height the real one does.
    return (
      <div className="g-agent">
        <Skeleton className="h-[420px] w-full rounded-lg" />
        <div className="flex flex-col gap-[18px]">
          <SkeletonCard lines={4} />
          <SkeletonCard lines={5} />
        </div>
      </div>
    );
  }
  if (shape === 'planning') {
    return (
      <>
        <Skeleton className="mb-3.5 h-6 w-52" />
        <div className="g2 mb-7">
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </div>
        <Skeleton className="mb-3.5 h-6 w-40" />
        <div className="g3">
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </div>
      </>
    );
  }
  if (shape === 'portfolio') {
    return (
      <>
        <SkeletonCard lines={2} className="mb-4" />
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[76px] w-full rounded-lg" />
          ))}
        </div>
      </>
    );
  }
  if (shape === 'home') {
    return (
      <>
        <Skeleton className="mb-[18px] h-[132px] w-full rounded-lg" />
        <div className="g2 mb-[18px]">
          <SkeletonCard lines={4} />
          <SkeletonCard lines={4} />
        </div>
        <div className="g2">
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </div>
      </>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2, 3, 4].map((i) => (
        <SkeletonCard key={i} lines={3} />
      ))}
    </div>
  );
}

export function CustomerShellSkeleton() {
  const pathname = usePathname() ?? '/home';
  const match =
    ROUTES.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`)) ?? FALLBACK;

  // Placeholders that pulse for half a second read as "nearly there"; the same
  // placeholders still pulsing after six read as an application stuck doing
  // something. The API is on a plan that sleeps when idle and can take most of
  // a minute to answer the first request, so past a few seconds the honest
  // thing is to say which of the two is happening.
  const [slow, setSlow] = React.useState(false);
  React.useEffect(() => {
    const id = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(id);
  }, []);

  return (
    <AppScreen active={match.key}>
      <PageHead eyebrow="Loading" title={match.title} />
      {/* <output> carries role="status" implicitly. No aria-busy on it — the
          tour reads that attribute to decide the screen is still loading, and
          this line is a fact about the screen, not a part of it that is. */}
      {slow ? (
        <output className="mb-[18px] block text-[13.5px] text-dim">
          Still connecting — the server may be waking up.
        </output>
      ) : null}
      <SkeletonRegion label={`Loading ${match.title}`}>
        {match.shape === 'home' || match.shape === 'agent' ? <Hero /> : null}
        <Body shape={match.shape} />
      </SkeletonRegion>
    </AppScreen>
  );
}
