'use client';

import { Button } from '@/app/_components/ui/button';
import { useDictation } from '@/app/_lib/speech';
import { Mic, Sparkles, Square } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/**
 * The control fixed to the bottom-right corner: ask the agent, by voice.
 *
 * It has been three things. It started as a microphone with no handler at all
 * and no speech capture anywhere in the product behind it. That was deleted for
 * being a dead control, and it became a link to /agent wearing a sparkle — which
 * was honest, but a microphone that navigates somewhere is not what a
 * microphone means. Speech capture exists now, so it can be the thing it looks
 * like.
 *
 * Pressing it starts listening **here**, on whatever screen the user is on.
 * That matters for a reason that is easy to miss: `SpeechRecognition.start()`
 * needs a user gesture, and a gesture does not survive a navigation. A button
 * that routed to /agent and tried to start listening on arrival would be
 * refused by the browser on the first use of every session, which is the use
 * that decides whether anyone tries it twice.
 *
 * So the order is: tap, speak, and only then move. The finished transcript is
 * handed to /agent through sessionStorage rather than the URL — a question about
 * someone's money should not sit in browser history, be read over a shoulder in
 * the address bar, or be truncated by a length limit.
 *
 * Where the browser has no SpeechRecognition — Firefox, and anything older —
 * this renders the link it used to be, with the sparkle rather than a
 * microphone. A voice button that cannot hear is the dead control all over
 * again.
 */

/** Where a spoken question waits while the router moves to /agent. */
export const PENDING_QUESTION_KEY = 'ccn.agent.pending';

export function VoiceAsk({ basePath = '' }: { basePath?: string }) {
  const router = useRouter();
  const [heard, setHeard] = React.useState<string | null>(null);

  const dictation = useDictation((text) => {
    const t = text.trim();
    if (!t) return;
    setHeard(t);
    try {
      sessionStorage.setItem(PENDING_QUESTION_KEY, t);
      router.push(`${basePath}/agent`);
    } catch {
      // Storage blocked (private mode). Still take them to the agent — the
      // question is lost, but landing on a dead button is worse.
      router.push(`${basePath}/agent`);
    }
  });

  const FIXED =
    'fixed bottom-[26px] right-[30px] shadow-[0_12px_30px_rgba(18,78,72,0.4)] max-[900px]:bottom-4 max-[900px]:right-4 max-[900px]:h-14 max-[900px]:w-14 max-[900px]:justify-center max-[900px]:rounded-full max-[900px]:p-0';

  // The demo track makes no API call and holds no session, and the agent it
  // would be talking to is a fixture. It keeps the link.
  if (basePath || !dictation.supported) {
    return (
      <Button size="pill" asChild className={FIXED}>
        <Link href={`${basePath}/agent`}>
          <Sparkles className="h-[18px] w-[18px] max-[900px]:h-6 max-[900px]:w-6" aria-hidden />
          <span className="max-[900px]:sr-only">Ask CCN</span>
        </Link>
      </Button>
    );
  }

  const listening = dictation.listening;

  return (
    <>
      <Button
        size="pill"
        className={FIXED}
        aria-label={listening ? 'Stop listening' : 'Ask CCN by voice'}
        aria-pressed={listening}
        onClick={() => (listening ? dictation.stop() : dictation.start())}
      >
        {listening ? (
          <Square className="h-[18px] w-[18px] max-[900px]:h-6 max-[900px]:w-6" aria-hidden />
        ) : (
          <Mic className="h-[18px] w-[18px] max-[900px]:h-6 max-[900px]:w-6" aria-hidden />
        )}
        <span className="max-[900px]:sr-only">{listening ? 'Listening…' : 'Ask CCN'}</span>
      </Button>

      {/* Sits above the button rather than beside it, so it does not widen the
          control or move anything on the page. */}
      {(listening || dictation.error || heard) && (
        <output className="fixed bottom-[86px] right-[30px] z-10 max-w-[min(78vw,320px)] rounded-xl bg-card px-3.5 py-2.5 text-[13.5px] text-foreground shadow-[0_10px_30px_rgba(30,20,10,0.18)] max-[900px]:bottom-[76px] max-[900px]:right-4">
          {dictation.error ? (
            <span className="text-[#a44e20] dark:text-terra">{dictation.error}</span>
          ) : listening ? (
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-success" aria-hidden />
              Listening — ask your question, then pause.
            </span>
          ) : (
            <span className="text-dim">Sending “{heard}”…</span>
          )}
        </output>
      )}
    </>
  );
}
