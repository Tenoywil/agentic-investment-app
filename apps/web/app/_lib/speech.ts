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
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
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
  /**
   * What has been heard so far, live — interims included, updated on every
   * engine result while listening and empty otherwise. Dictating into a void
   * was the complaint this answers: the words appear as they are spoken, so
   * the speaker can see the engine keeping up (or mishearing) before the
   * final transcript lands in the input.
   */
  preview: string;
  start: () => void;
  stop: () => void;
}

/**
 * How long a silence ends the question, in milliseconds.
 *
 * The engine's own endpointing is far more eager than this — it treats the
 * first breath as the end of the utterance. Somebody asking about their money
 * pauses to think in the middle of the sentence ("can I put… maybe four
 * thousand… into the GOJ bond"), and each of those pauses used to end the
 * dictation and send whatever fragment had been captured.
 */
const SILENCE_MS = 2500;

/** A whole session cap, so a microphone can never be left open indefinitely. */
const MAX_SESSION_MS = 120_000;

/**
 * Collapse a recogniser's result list into one utterance.
 *
 * Desktop Chrome reports SEGMENTS — ["find me a bond", "under five hundred"] —
 * which join in order. Android Chrome instead reports the GROWING PHRASE —
 * ["how", "how can", "how can I find"] — and appending those stacked every
 * prefix into the composer: "how how can how can I find…", once per engine
 * tick, which is the wall of repeated words a spoken question arrived as.
 * Dropping any entry that the next entry starts with keeps exactly the words
 * spoken under both reporting styles: growing phrases collapse to their final
 * form, and genuine segments (which do not prefix each other) all survive.
 */
export function collapseTranscripts(parts: string[]): string {
  const trimmed = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  return trimmed
    .filter((p, i) => {
      const next = trimmed[i + 1];
      return !next?.toLowerCase().startsWith(p.toLowerCase());
    })
    .join(' ')
    .trim();
}

/**
 * Dictate a question. `onTranscript` receives the finished text once, when the
 * speaker stops.
 *
 * `continuous` is on and the session is restarted when the engine ends it by
 * itself, because the engine's idea of "finished" is a pause of a few hundred
 * milliseconds. With `continuous = false` the recogniser fired `onend` at the
 * first hesitation and the question was cut off mid-sentence — the reported
 * bug, and the reason a spoken question so often arrived as three words.
 *
 * Interim results are requested but never surfaced. They are what tells us
 * somebody is still talking, so the silence timer can be the thing that decides
 * the question is over; a composer that rewrites itself while you speak is
 * harder to trust than one that fills in when you stop.
 */
export function useDictation(onTranscript: (text: string) => void): Dictation {
  const [supported, setSupported] = React.useState(false);
  const [listening, setListening] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState('');
  const ref = React.useRef<SpeechRecognitionLike | null>(null);
  /** Text carried across engine restarts — earlier sessions, already folded. */
  const finalRef = React.useRef('');
  /** The CURRENT engine session's transcript, rebuilt whole on every result
   *  event rather than appended to — see collapseTranscripts for why. */
  const sessionRef = React.useRef('');
  /** Whether the user still wants to be heard. Distinguishes "the engine gave
   *  up" (restart) from "they pressed stop" (deliver and finish). */
  const wantRef = React.useRef(false);
  const silenceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const capRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Kept in a ref so restarting recognition does not depend on the caller
  // memoising its callback.
  const onTranscriptRef = React.useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const clearTimers = React.useCallback(() => {
    if (silenceRef.current) clearTimeout(silenceRef.current);
    if (capRef.current) clearTimeout(capRef.current);
    silenceRef.current = null;
    capRef.current = null;
  }, []);

  // Detection runs in an effect, not during render: the server has no window,
  // and a hook that returned a different answer on the client would hydrate
  // mismatched.
  React.useEffect(() => {
    setSupported(recognitionCtor() !== null);
    return () => {
      wantRef.current = false;
      clearTimers();
      ref.current?.abort();
    };
  }, [clearTimers]);

  /** Hand over whatever was heard and end the session. */
  const finish = React.useCallback(() => {
    clearTimers();
    wantRef.current = false;
    setListening(false);
    setPreview('');
    const text = `${finalRef.current} ${sessionRef.current}`.trim();
    finalRef.current = '';
    sessionRef.current = '';
    if (text) onTranscriptRef.current(text);
  }, [clearTimers]);

  const stop = React.useCallback(() => {
    wantRef.current = false;
    // stop() asks the engine to finalise what it has; `onend` then delivers.
    // A recogniser that has already ended will not fire again, so deliver here
    // too — `finish` clears the buffer, so it cannot double-send.
    try {
      ref.current?.stop();
    } catch {
      /* already stopped */
    }
    finish();
  }, [finish]);

  const start = React.useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    setError(null);
    finalRef.current = '';
    sessionRef.current = '';
    wantRef.current = true;

    const begin = () => {
      const rec = new Ctor();
      ref.current = rec;
      rec.lang = navigator.language || 'en-US';
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onresult = (event) => {
        // REBUILT from the whole list, never appended. `results` is cumulative
        // for the session, and on Android each entry is itself the growing
        // phrase ("how", "how can", "how can I…") with isFinal set — appending
        // finals stacked every prefix into the question, once per engine tick.
        // Interims are included so a session Android never finalises before
        // the engine restarts still keeps its words.
        const parts: string[] = [];
        for (let i = 0; i < event.results.length; i++) {
          const alt = event.results[i]?.[0];
          if (alt?.transcript) parts.push(alt.transcript);
        }
        sessionRef.current = collapseTranscripts(parts);
        setPreview(`${finalRef.current} ${sessionRef.current}`.trim());
        // Any result at all — interim included — means they are still talking,
        // so the silence window restarts from here rather than from the last
        // finalised phrase.
        if (silenceRef.current) clearTimeout(silenceRef.current);
        silenceRef.current = setTimeout(() => {
          if (wantRef.current) stop();
        }, SILENCE_MS);
      };

      rec.onerror = (event) => {
        // "no-speech" and "aborted" are ordinary outcomes of a pause or a stop
        // and must not end the session — ending on them is the cut-off bug.
        // Only a refused microphone is worth a message, and worth stopping for.
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setError('Microphone access is blocked. Allow it in your browser settings to dictate.');
          wantRef.current = false;
          clearTimers();
          setListening(false);
          setPreview('');
          finalRef.current = '';
          sessionRef.current = '';
        }
      };

      rec.onend = () => {
        // The engine ends the session on its own after a short silence, even
        // with `continuous` set. Fold this session's words into the carry —
        // the next engine session's `results` starts empty, so anything left
        // in sessionRef would otherwise be overwritten by the first new event.
        finalRef.current = `${finalRef.current} ${sessionRef.current}`.trim();
        sessionRef.current = '';
        // If the user has not pressed stop, that is not the end of their
        // question: start listening again and keep what has been said so far.
        if (wantRef.current) {
          try {
            begin();
          } catch {
            finish();
          }
        }
      };

      try {
        rec.start();
      } catch {
        // start() throws if called while the previous session is still
        // finishing; the next `onend` restarts it.
      }
    };

    begin();
    setListening(true);
    setPreview('');
    clearTimers();
    // Nothing here can leave the microphone open forever, whatever the engine
    // does or does not report.
    capRef.current = setTimeout(() => {
      if (wantRef.current) stop();
    }, MAX_SESSION_MS);
  }, [clearTimers, finish, stop]);

  return { supported, listening, error, preview, start, stop };
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
      const synth = window.speechSynthesis;
      synth.cancel();

      /**
       * One utterance per chunk, not one for the whole reply.
       *
       * Chromium stops speaking a long utterance after roughly fifteen seconds
       * — a watchdog in the engine, not an error, so nothing fires `onerror`
       * and the voice simply stops mid-sentence. An agent's answer runs well
       * past that, which is why the spoken reply was being cut off. Queued
       * short utterances each finish inside the window, and the queue plays
       * them back to back.
       */
      const chunks = chunkForSpeech(trimmed);
      if (chunks.length === 0) return;

      setSpeaking(true);
      chunks.forEach((chunk, i) => {
        const utterance = new SpeechSynthesisUtterance(chunk);
        utterance.lang = navigator.language || 'en-US';
        if (i === chunks.length - 1) {
          utterance.onend = () => setSpeaking(false);
        }
        // An error anywhere abandons the rest: continuing would speak the
        // second half of an answer whose first half was never heard.
        utterance.onerror = () => {
          setSpeaking(false);
          synth.cancel();
        };
        synth.speak(utterance);
      });
    },
    [enabled],
  );

  /**
   * Chromium's other long-speech bug: a queue left alone eventually stalls in
   * `paused`. Nudging it while speaking keeps it moving, and the interval only
   * exists while there is something to say.
   */
  React.useEffect(() => {
    if (!speaking || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    const tick = setInterval(() => {
      if (!synth.speaking) return;
      if (synth.paused) synth.resume();
    }, 5000);
    return () => clearInterval(tick);
  }, [speaking]);

  return { supported, enabled, speaking, setEnabled, speak, stop };
}

/**
 * Split a reply into utterances short enough for the engine to finish.
 *
 * Sentence boundaries first, so the voice breaks where a reader would; a
 * sentence longer than the budget is split on clause punctuation, and failing
 * that on whitespace, because a hard cut mid-word is audible. The 180-character
 * budget is well inside Chromium's watchdog at ordinary speaking rates.
 */
const SPEECH_CHUNK = 180;

export function chunkForSpeech(text: string, budget = SPEECH_CHUNK): string[] {
  const pieces: string[] = [];

  const flushLong = (piece: string) => {
    let rest = piece;
    while (rest.length > budget) {
      // Prefer a clause break, then any space, then give up and cut.
      const window = rest.slice(0, budget);
      const at = Math.max(
        window.lastIndexOf(', '),
        window.lastIndexOf('; '),
        window.lastIndexOf(' — '),
      );
      const cut = at > budget * 0.4 ? at + 1 : window.lastIndexOf(' ');
      const end = cut > 0 ? cut : budget;
      pieces.push(rest.slice(0, end).trim());
      rest = rest.slice(end).trim();
    }
    if (rest) pieces.push(rest);
  };

  let current = '';
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const s = sentence.trim();
    if (!s) continue;
    if (s.length > budget) {
      if (current) {
        pieces.push(current);
        current = '';
      }
      flushLong(s);
      continue;
    }
    if (`${current} ${s}`.trim().length > budget) {
      if (current) pieces.push(current);
      current = s;
    } else {
      current = `${current} ${s}`.trim();
    }
  }
  if (current) pieces.push(current);
  return pieces.filter((p) => p.length > 0);
}
