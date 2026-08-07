'use client';

import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { Input } from '@/app/_components/ui/input';
import { Label } from '@/app/_components/ui/label';
import { cn } from '@/app/_lib/utils';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  DECLARATIONS,
  ONB_LABELS,
  ONB_SUBS,
  ONB_TITLES,
  RISK_QUESTIONS,
  SOURCES,
  riskBand,
} from './data';

const LAST = ONB_LABELS.length - 1; // index of the final input step (Funds)
const DONE = ONB_LABELS.length; // the "all set" step

const LEGEND = 'mb-2.5 p-0 text-[13px] font-bold text-[#2c2925]';
const SWITCH_ROW = 'mb-3 flex cursor-pointer items-center gap-2.5 text-[14.5px] text-[#2c2925]';
const CHECK = 'h-[18px] w-[18px] accent-primary';

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [declared, setDeclared] = useState<boolean[]>(DECLARATIONS.map(() => false));
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [sources, setSources] = useState<Record<string, boolean>>({ salary: true });

  const scores = useMemo(
    () => RISK_QUESTIONS.map((_, i) => answers[i]).filter((s): s is number => s !== undefined),
    [answers],
  );
  const band = riskBand(scores);

  const allDeclared = declared.every(Boolean);
  const riskComplete = scores.length === RISK_QUESTIONS.length;
  const hasSource = Object.values(sources).some(Boolean);

  const canContinue = !(
    (step === 1 && !allDeclared) ||
    (step === 2 && !riskComplete) ||
    (step === LAST && !hasSource)
  );

  const continueLabel = ['Start verification', 'Continue', 'Continue', 'Confirm & finish'][step];

  return (
    <section className="min-h-screen bg-background font-sans text-foreground">
      <Card className="mx-auto my-10 max-w-[480px] p-8 shadow-[0_12px_44px_rgba(40,34,22,0.09)]">
        {step < DONE ? (
          <>
            <ol className="mb-[22px] flex list-none flex-wrap gap-2 p-0">
              {ONB_LABELS.map((label, i) => {
                const state = i < step ? 'done' : i === step ? 'current' : 'todo';
                return (
                  <li
                    key={label}
                    className={cn(
                      'flex-[1_1_6rem] border-t-[3px] pt-2 text-[12.5px] font-bold',
                      state === 'todo'
                        ? 'border-border text-faint'
                        : 'border-primary text-foreground',
                    )}
                  >
                    {label}
                  </li>
                );
              })}
            </ol>
            <h1 className="mb-2 font-display text-[26px] font-bold tracking-tight">
              {ONB_TITLES[step]}
            </h1>
            <p className="mb-6 text-[15px] leading-relaxed text-dim">{ONB_SUBS[step]}</p>

            {step === 0 ? <IdentityStep /> : null}
            {step === 1 ? (
              <ComplianceStep
                declared={declared}
                onToggle={(i, v) => setDeclared((d) => d.map((x, j) => (j === i ? v : x)))}
              />
            ) : null}
            {step === 2 ? (
              <RiskStep
                answers={answers}
                onPick={(q, s) => setAnswers((a) => ({ ...a, [q]: s }))}
                band={band}
              />
            ) : null}
            {step === LAST ? (
              <FundsStep
                sources={sources}
                onToggle={(id, v) => setSources((s) => ({ ...s, [id]: v }))}
              />
            ) : null}

            <div className="mt-6 flex justify-between gap-3">
              <Button
                variant="outline"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0}
              >
                Back
              </Button>
              <Button onClick={() => setStep((s) => s + 1)} disabled={!canContinue}>
                {continueLabel}
              </Button>
            </div>
          </>
        ) : (
          <DoneStep band={band} />
        )}
      </Card>
    </section>
  );
}

function IdentityStep() {
  return (
    <div>
      <div className="mb-4 flex flex-col gap-1.5">
        <Label htmlFor="fullname">Full legal name</Label>
        <Input id="fullname" type="text" defaultValue="Marcus A. Bailey" autoComplete="name" />
      </div>
      <div className="mb-4 flex flex-col gap-1.5">
        <Label htmlFor="country">Country of residence</Label>
        <Input id="country" type="text" defaultValue="United Kingdom" autoComplete="country-name" />
      </div>
      <div className="mb-4 flex flex-col gap-1.5">
        <Label htmlFor="occupation">Occupation</Label>
        <Input
          id="occupation"
          type="text"
          defaultValue="Software Engineer"
          autoComplete="organization-title"
        />
      </div>
      <p className="inline-block rounded-[22px] border border-[#cfe3d8] bg-[#e8f1ec] px-3.5 py-2 text-[13px] font-bold text-[#0e5952]">
        ✓ Identity documents verified · KYC Tier 2 unlocked
      </p>
    </div>
  );
}

function ComplianceStep({
  declared,
  onToggle,
}: {
  declared: boolean[];
  onToggle: (i: number, v: boolean) => void;
}) {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className={LEGEND}>Declarations</legend>
      {DECLARATIONS.map((text, i) => (
        <label key={text} className={SWITCH_ROW}>
          <input
            type="checkbox"
            className={CHECK}
            checked={declared[i] ?? false}
            onChange={(e) => onToggle(i, e.target.checked)}
          />
          <span>{text}</span>
        </label>
      ))}
    </fieldset>
  );
}

function RiskStep({
  answers,
  onPick,
  band,
}: {
  answers: Record<number, number>;
  onPick: (q: number, score: number) => void;
  band: string;
}) {
  return (
    <div>
      {RISK_QUESTIONS.map((question, qi) => (
        <fieldset className="m-0 mb-6 min-w-0 border-0 p-0" key={question.q}>
          <legend className={LEGEND}>{question.q}</legend>
          {question.opts.map((opt) => (
            <label key={opt.key} className={cn(SWITCH_ROW, 'mb-2')}>
              <input
                type="radio"
                className={CHECK}
                name={`q${qi}`}
                checked={answers[qi] === opt.score}
                onChange={() => onPick(qi, opt.score)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </fieldset>
      ))}
      <output aria-live="polite" className="block text-[14.5px] text-dim">
        {band ? (
          <>
            Your risk profile: <strong className="text-foreground">{band}</strong>
          </>
        ) : (
          'Answer all three to see your risk profile.'
        )}
      </output>
    </div>
  );
}

function FundsStep({
  sources,
  onToggle,
}: {
  sources: Record<string, boolean>;
  onToggle: (id: string, v: boolean) => void;
}) {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className={LEGEND}>Source of funds (select all that apply)</legend>
      {SOURCES.map((s) => (
        <label key={s.id} className={SWITCH_ROW}>
          <input
            type="checkbox"
            className={CHECK}
            checked={sources[s.id] ?? false}
            onChange={(e) => onToggle(s.id, e.target.checked)}
          />
          <span>{s.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

function DoneStep({ band }: { band: string }) {
  return (
    <div>
      <span className="mb-3 inline-grid h-[34px] w-[34px] place-items-center rounded-full bg-primary text-white">
        <Check className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <h1 className="mb-2 font-display text-[26px] font-bold tracking-tight">
        You're verified · Tier 2
      </h1>
      <p className="text-[15px] leading-relaxed text-dim">
        Your agent can now act within the limits you set.
      </p>
      <ul className="my-4 list-disc pl-5 leading-loose">
        <li>Identity — KYC Tier 2</li>
        <li>Suitability — {band || 'High Moderate'} profile</li>
        <li>Source of funds — confirmed</li>
      </ul>
      <Button asChild>
        <Link href="/">Explore opportunities</Link>
      </Button>
    </div>
  );
}
