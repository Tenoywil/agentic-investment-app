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
 * **The shapes are measured, not guessed.** They were guessed first, and the
 * guessing showed: a single generic layout fixed the blank screen and halved
 * /planning but made /agent worse than before (0.245 to 0.538), and three
 * rounds of reshaping by eye moved the problem between screens without removing
 * it. The heights below come from reading the real geometry of each screen at
 * 1280px and at 390px — the numbers in each comment are what was measured — and
 * a placeholder is only drawn where its content will stand.
 *
 * Two honest limits. The heights match a populated account, so a brand-new one,
 * which renders empty states of different heights, still settles a little. And
 * a card's height follows its data, so a longer partner name or an extra
 * holding moves it. Both are bounded — tens of pixels, not the hundreds that a
 * missing section costs — and neither is fixable by a skeleton, only by the
 * screens rendering their own structure before their data arrives.
 */

type Key = Parameters<typeof AppScreen>[0]['active'];
type Shape = 'home' | 'agent' | 'planning' | 'portfolio' | 'list';

/**
 * `eyebrow` is the screen's own static copy, not a placeholder. It is not data
 * — it is the same string the page hardcodes — and using it keeps the header
 * one height across the swap. On a phone /planning's real eyebrow wraps to two
 * lines where the word "Loading" took one, and the 16px difference pushed the
 * entire screen down at the moment the session resolved. /home is the exception
 * and keeps a placeholder, because its eyebrow is the current date.
 */
const ROUTES: { prefix: string; key: Key; title: string; shape: Shape; eyebrow: string }[] = [
  {
    prefix: '/portfolio',
    key: 'portfolio',
    title: 'Your portfolio',
    shape: 'portfolio',
    eyebrow: 'Every holding, unified · custodied by licensed partners',
  },
  {
    prefix: '/opportunities',
    key: 'opportunities',
    title: 'Opportunities',
    shape: 'list',
    eyebrow: 'Regional investments across jurisdictions · executed by licensed partners',
  },
  {
    prefix: '/agent',
    key: 'agent',
    title: 'Your Capital Agent',
    shape: 'agent',
    eyebrow: 'Discovers, screens and coordinates execution, always on your approval',
  },
  {
    prefix: '/planning',
    key: 'planning',
    title: 'Planning',
    shape: 'planning',
    eyebrow: 'Cover, retirement, property and legacy planning across borders',
  },
  {
    prefix: '/orders',
    key: 'orders',
    title: 'Your orders',
    shape: 'list',
    eyebrow: 'Executed and settled by the institution that holds them',
  },
  {
    prefix: '/onboarding',
    key: 'onboarding',
    title: 'Onboarding',
    shape: 'list',
    eyebrow: 'Loading',
  },
  {
    prefix: '/gateway/mandate',
    key: 'gatewayMandate',
    title: 'Your mandate',
    shape: 'list',
    eyebrow: 'Caribbean Capital Gateway · private-deal matching',
  },
  {
    prefix: '/gateway/opportunities',
    key: 'gatewayOpportunities',
    title: 'Private deals',
    shape: 'list',
    eyebrow: 'Caribbean Capital Gateway · private-deal matching',
  },
  {
    prefix: '/gateway/introductions',
    key: 'gatewayIntroductions',
    title: 'Introductions',
    shape: 'list',
    eyebrow: 'Caribbean Capital Gateway · private-deal matching',
  },
  { prefix: '/home', key: 'home', title: 'Home', shape: 'home', eyebrow: 'Loading' },
];

const FALLBACK = {
  key: 'home' as Key,
  title: 'Home',
  shape: 'home' as Shape,
  eyebrow: 'Loading',
};

/** A block standing in for one card, at its measured height on each screen. */
function Block({ h, phone }: { h: number; phone?: number }) {
  return (
    <Skeleton
      className="w-full rounded-lg"
      style={{
        height: h,
        ...(phone ? ({ '--phone-h': `${phone}px` } as React.CSSProperties) : {}),
      }}
      data-phone-h={phone ? '' : undefined}
    />
  );
}

function Body({ shape }: { shape: Shape }) {
  if (shape === 'agent') {
    // Two columns: the conversation, and approvals over limits. The chat card
    // carries the same fixed height the real one does.
    return (
      <div className="g-agent">
        <Skeleton className="h-[440px] w-full rounded-lg max-[900px]:h-[58vh]" />
        <div className="flex flex-col gap-[18px]">
          <SkeletonCard lines={4} />
          <SkeletonCard lines={5} />
        </div>
      </div>
    );
  }
  if (shape === 'planning') {
    // Measured: heading 26 · six product cards 204 (218 on a phone, where they
    // stack and the longer names wrap) · the goals bar 63, which carries a
    // heading and the Add a goal button · three goal cards 184.
    return (
      <>
        <Skeleton className="mb-3.5 h-[26px] w-52" />
        <div className="g2 mb-7">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Block key={i} h={204} phone={218} />
          ))}
        </div>
        <div className="mb-3.5 flex h-[63px] items-center justify-between gap-4">
          <Skeleton className="h-[26px] w-40" />
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
        <div className="g3">
          {[0, 1, 2].map((i) => (
            <Block key={i} h={184} />
          ))}
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
    // Measured: the dark hero 263 (511 on a phone, where its two columns stack)
    // · the static "How your agent works" explainer 206 (603) · activity and
    // approvals 371 each (362 and 389) · two stat cards 142 · the two holdings
    // cards 326 (335 and 227).
    return (
      <>
        <Block h={206} phone={603} />
        <div className="g2 mt-[18px]">
          <Block h={371} phone={362} />
          <Block h={371} phone={389} />
        </div>
        <div className="g2 mt-[18px]">
          <Block h={142} />
          <Block h={142} />
        </div>
        <div className="g-held mt-[18px]">
          <Block h={326} phone={335} />
          <Block h={326} phone={227} />
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
      <PageHead eyebrow={match.eyebrow} title={match.title} />
      {/* <output> carries role="status" implicitly. No aria-busy on it — the
          tour reads that attribute to decide the screen is still loading, and
          this line is a fact about the screen, not a part of it that is. */}
      {slow ? (
        <output className="mb-[18px] block text-[13.5px] text-dim">
          Still connecting — the server may be waking up.
        </output>
      ) : null}
      <SkeletonRegion label={`Loading ${match.title}`}>
        {match.shape === 'home' ? (
          <div className="mb-[18px]">
            <Block h={263} phone={511} />
          </div>
        ) : null}
        {match.shape === 'agent' ? (
          <Skeleton className="mb-[18px] h-[196px] w-full rounded-[20px]" />
        ) : null}
        <Body shape={match.shape} />
      </SkeletonRegion>
    </AppScreen>
  );
}
