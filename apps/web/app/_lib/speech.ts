'use client';

import * as React from 'react';

/**
 * Voice for the agent: dictating a question, and hearing the answer.
 *
 * Both halves are the browser's own, not a service. Speech recognition and
 * speech synthesis are Web APIs, so this adds no gateway call, no audio upload,
 * no cost per minute, and nothing leaves the device that was not already going
 * to the API as text. That matters for a product handling someone's portfolio:
 * a voice feature that streamed microphone audio to a third party would be a
 * disclosure question, and this one is not.
 *
 * Support is genuinely partial — SpeechRecognition is prefixed in Chrome and
 * Safari and absent in Firefox — so both hooks report whether they work, and
 * the screen renders nothing when they do not. A microphone button that does
 * nothing has already shipped here once and was deleted for it; this is the
 * same rule enforced by capability rather than by intention.
 */

/** The prefixed constructor, absent in browsers that do not support it. */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface Dictation {
  /** False when the browser has no SpeechRecognition; render no control. */
  supported: boolean;
  listening: boolean;
  /** Null unless the attempt failed in a way worth telling the user about. */
  error: string | null;
  start: () => void;
  stop: () => void;
}

/**
 * Dictate a question. `onTranscript` receives the final text once; interim
 * results are deliberately not surfaced, because a composer that rewrites
 * itself while you speak is harder to trust than one that fills in when you
 * stop.
 */
export function useDictation(onTranscript: (text: string) => void): Dictation {
  const [supported, setSupported] = React.useState(false);
  const [listening, setListening] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ref = React.useRef<SpeechRecognitionLike | null>(null);
  // Kept in a ref so restarting recognition does not depend on the caller
  // memoising its callback.
  const onTranscriptRef = React.useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  // Detection runs in an effect, not during render: the server has no window,
  // and a hook that returned a different answer on the client would hydrate
  // mismatched.
  React.useEffect(() => {
    setSupported(recognitionCtor() !== null);
    return () => ref.current?.abort();
  }, []);

  const stop = React.useCallback(() => {
    ref.current?.stop();
    setListening(false);
  }, []);

  const start = React.useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    setError(null);
    const rec = new Ctor();
    ref.current = rec;
    rec.lang = navigator.language || 'en-US';
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (event) => {
      const text = Array.from({ length: event.results.length }, (_, i) => {
        const alt = event.results[i]?.[0];
        return alt ? alt.transcript : '';
      })
        .join(' ')
        .trim();
      if (text) onTranscriptRef.current(text);
    };
    rec.onerror = (event) => {
      // "aborted" and "no-speech" are ordinary outcomes of stopping or saying
      // nothing; only a refused microphone is worth a message.
      setError(
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'Microphone access is blocked. Allow it in your browser settings to dictate.'
          : null,
      );
      setListening(false);
    };
    rec.onend = () => setListening(false);
    try {
      rec.start();
      setListening(true);
    } catch {
      // start() throws if called while already running; treat as already on.
      setListening(true);
    }
  }, []);

  return { supported, listening, error, start, stop };
}

export interface Narration {
  /** False when the browser has no speechSynthesis; render no control. */
  supported: boolean;
  enabled: boolean;
  speaking: boolean;
  setEnabled: (on: boolean) => void;
  /** Speak `text` if narration is on. No-op otherwise. */
  speak: (text: string) => void;
  stop: () => void;
}

const NARRATION_KEY = 'ccn.agent.narrate';

/**
 * Read the agent's replies aloud, when the user has asked for it.
 *
 * Off by default and remembered per browser. Never triggered by the page
 * loading — only by a reply arriving after the user turned it on — so nothing
 * speaks unbidden, and the toggle is always present as the stop control while
 * it does (WCAG 1.4.2, which wants any audio over three seconds to be
 * stoppable).
 */
export function useNarration(): Narration {
  const [supported, setSupported] = React.useState(false);
  const [enabled, setEnabledState] = React.useState(false);
  const [speaking, setSpeaking] = React.useState(false);

  React.useEffect(() => {
    const ok = typeof window !== 'undefined' && 'speechSynthesis' in window;
    setSupported(ok);
    if (!ok) return;
    try {
      setEnabledState(localStorage.getItem(NARRATION_KEY) === 'on');
    } catch {
      // Blocked storage: the preference simply is not remembered.
    }
    // Leaving the screen mid-sentence must not leave a voice running.
    return () => window.speechSynthesis.cancel();
  }, []);

  const stop = React.useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const setEnabled = React.useCallback(
    (on: boolean) => {
      setEnabledState(on);
      try {
        localStorage.setItem(NARRATION_KEY, on ? 'on' : 'off');
      } catch {
        /* not remembered */
      }
      if (!on) stop();
    },
    [stop],
  );

  const speak = React.useCallback(
    (text: string) => {
      if (!enabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(trimmed);
      utterance.lang = navigator.language || 'en-US';
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      setSpeaking(true);
      window.speechSynthesis.speak(utterance);
    },
    [enabled],
  );

  return { supported, enabled, speaking, setEnabled, speak, stop };
}
