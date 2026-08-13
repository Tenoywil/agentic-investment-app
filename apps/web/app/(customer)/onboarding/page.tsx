'use client';

import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { Input } from '@/app/_components/ui/input';
import { Label } from '@/app/_components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/app/_components/ui/select';
import { cn } from '@/app/_lib/utils';
import { authClient } from '@/lib/auth-client';
import { CORRIDOR_COUNTRIES, OTHER_COUNTRIES } from '@/lib/countries';
import {
  type KycStatus,
  type SourceOfFunds,
  formatRiskBand,
  getOnboardingStatus,
  submitCompliance,
  submitFunds,
  submitIdentity,
  submitRisk,
} from '@/lib/onboarding-api';
import { ArrowRight, Check, CircleAlert, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import type * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
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

/**
 * Per-step lead-in copy from the prototype, kept only where it says something
 * the step's own subtitle (ONB_SUBS) doesn't. The prototype repeated its
 * subtitle verbatim inside the card on the risk step — a duplicate heading for
 * a screen reader and dead weight for everyone else.
 */
const STEP_INTROS: (string | null)[] = [
  'Verification is performed by the licensed partners, who already carry the regulatory duty. CCN links your verified status and shares your details only with the partner executing each trade, with your consent.',
  'Cross-border rules require a few declarations. Your agent screens these automatically against every opportunity.',
  null,
  'Regulators require your occupation and the origin of the capital you invest.',
];

/** Resume point once /status comes back: the Done step if funds are already
 *  confirmed, otherwise the first step that hasn't been saved yet. */
function resumeStep(status: KycStatus | null): number {
  if (!status) return 0;
  if (status.fundsConfirmed) return DONE;
  if (status.riskCompleted) return LAST;
  if (status.complianceConfirmed) return 2;
  if (status.identityVerified) return 1;
  return 0;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export default function OnboardingPage() {
  const [initializing, setInitializing] = useState(true);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [country, setCountry] = useState('');
  const [occupation, setOccupation] = useState('');
  const [declared, setDeclared] = useState<boolean[]>(DECLARATIONS.map(() => false));
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [sources, setSources] = useState<Record<string, boolean>>({ salary: true });
  // Source of truth for the Done step — set from /status on resume, or from
  // submitRisk()'s response when the step is completed live in this session.
  const [serverBand, setServerBand] = useState<string | null>(null);
  // Whether identity is ALREADY verified server-side. The prototype showed the
  // "documents verified" badge unconditionally; live it has to reflect real
  // state rather than assert a verification that hasn't happened yet.
  const [identityVerified, setIdentityVerified] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [session, { status, profile, riskBand: savedBand }] = await Promise.all([
          authClient.getSession(),
          getOnboardingStatus(),
        ]);
        if (cancelled) return;
        const user = session.data?.user;
        setFullName(user?.name || user?.email || '');
        if (profile?.residencyCountry) setCountry(profile.residencyCountry);
        if (profile?.occupation) setOccupation(profile.occupation);
        if (status?.sources && status.sources.length > 0) {
          setSources(Object.fromEntries(status.sources.map((id) => [id, true])));
        }
        if (status?.identityVerified) setIdentityVerified(true);
        if (savedBand) setServerBand(formatRiskBand(savedBand));
        setStep(resumeStep(status));
      } catch (err) {
        if (!cancelled) {
          setError(errorMessage(err, 'Could not load your onboarding status.'));
        }
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const scores = useMemo(
    () => RISK_QUESTIONS.map((_, i) => answers[i]).filter((s): s is number => s !== undefined),
    [answers],
  );
  const band = riskBand(scores);
  const riskTotal = scores.reduce((a, b) => a + b, 0);

  const allDeclared = declared.every(Boolean);
  const riskComplete = scores.length === RISK_QUESTIONS.length;
  const hasSource = Object.values(sources).some(Boolean);
  const identityComplete =
    fullName.trim() !== '' && country.trim() !== '' && occupation.trim() !== '';

  const canContinue = !(
    (step === 0 && !identityComplete) ||
    (step === 1 && !allDeclared) ||
    (step === 2 && !riskComplete) ||
    (step === LAST && !hasSource)
  );

  const continueLabel = ['Start verification', 'Continue', 'Continue', 'Confirm & finish'][step];

  async function handleContinue() {
    setError(null);
    if (step === 0) {
      const name = fullName.trim();
      const residencyCountry = country.trim();
      const occ = occupation.trim();
      if (!name || !residencyCountry || !occ) {
        setError('Enter your full name, country of residence, and occupation.');
        return;
      }
      setBusy(true);
      try {
        await submitIdentity({ fullName: name, residencyCountry, occupation: occ });
        setStep((s) => s + 1);
      } catch (err) {
        setError(errorMessage(err, 'Could not save your details.'));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (step === 1) {
      setBusy(true);
      try {
        await submitCompliance();
        setStep((s) => s + 1);
      } catch (err) {
        setError(errorMessage(err, 'Could not save your declarations.'));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (step === 2) {
      if (!riskComplete) return;
      setBusy(true);
      try {
        const [s0, s1, s2] = scores;
        const { band: savedBand } = await submitRisk([s0, s1, s2] as [number, number, number]);
        setServerBand(formatRiskBand(savedBand));
        setStep((s) => s + 1);
      } catch (err) {
        setError(errorMessage(err, 'Could not save your risk profile.'));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (step === LAST) {
      const chosen = Object.entries(sources)
        .filter(([, checked]) => checked)
        .map(([id]) => id as SourceOfFunds);
      if (chosen.length === 0) return;
      setBusy(true);
      try {
        await submitFunds(chosen);
        setStep((s) => s + 1);
      } catch (err) {
        setError(errorMessage(err, 'Could not save your source of funds.'));
      } finally {
        setBusy(false);
      }
    }
  }

  const intro = step < DONE ? STEP_INTROS[step] : null;

  return (
    <section className="min-h-screen bg-background font-sans text-foreground">
      <div className="mx-auto w-full max-w-[720px] px-5 py-10">
        <BrandHeader showSkip={step < DONE} />

        {initializing ? (
          <Card className="rounded-[22px] p-7">
            <p className="text-[15px] text-dim">Loading your progress…</p>
          </Card>
        ) : step < DONE ? (
          <>
            <div className="mb-[22px] text-center">
              <p className="mb-3.5 inline-flex items-center gap-2 rounded-[20px] bg-mint px-[15px] py-[7px] text-sm font-bold text-primary dark:text-teal2">
                <ShieldCheck className="h-3.5 w-3.5 flex-none" aria-hidden />
                Regulated onboarding · your agent handles the screening
              </p>
              <h1 className="font-display text-[30px] font-bold leading-tight tracking-[-0.3px]">
                {ONB_TITLES[step]}
              </h1>
              <p className="mt-2 text-base leading-relaxed text-dim">{ONB_SUBS[step]}</p>
            </div>

            <StepBars step={step} />

            <Card className="rounded-[22px] p-7">
              {intro ? (
                <p className="mb-5 text-[14.5px] leading-relaxed text-dim">{intro}</p>
              ) : null}

              {step === 0 ? (
                <IdentityStep
                  fullName={fullName}
                  onFullNameChange={setFullName}
                  country={country}
                  onCountryChange={setCountry}
                  occupation={occupation}
                  onOccupationChange={setOccupation}
                  verified={identityVerified}
                />
              ) : null}
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
                  total={riskTotal}
                  complete={riskComplete}
                />
              ) : null}
              {step === LAST ? (
                <FundsStep
                  sources={sources}
                  onToggle={(id, v) => setSources((s) => ({ ...s, [id]: v }))}
                />
              ) : null}

              {error && (
                <p className="mt-4 flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra">
                  <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
                  {error}
                </p>
              )}

              <div className="mt-[22px] flex gap-2.5">
                {step > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => setStep((s) => s - 1)}
                    disabled={busy}
                    className="h-[52px] px-[18px]"
                  >
                    Back
                  </Button>
                )}
                <Button
                  onClick={handleContinue}
                  disabled={!canContinue || busy}
                  className="h-[52px] flex-1 text-[17px]"
                >
                  {busy ? 'Saving…' : continueLabel}
                </Button>
              </div>
            </Card>
          </>
        ) : (
          <Card className="rounded-[22px] p-7">
            <DoneStep band={serverBand ?? band} />
          </Card>
        )}
      </div>
    </section>
  );
}

/** `showSkip` is false on the final step — "Skip for now" is meaningless once
 *  verification is already complete. */
function BrandHeader({ showSkip }: { showSkip: boolean }) {
  return (
    <div className="mb-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2.5">
        <span
          className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-primary font-display text-[17px] font-bold text-primary-foreground"
          aria-hidden
        >
          C
        </span>
        <span className="font-display text-base font-bold">Caribbean Capital Network</span>
      </div>
      {showSkip ? (
        <Button variant="outline" asChild className="h-auto gap-1.5 px-[15px] py-[9px] text-sm">
          <Link href="/home">
            Skip for now
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

/** Segmented progress: a filled bar per step — teal behind you, peach for where
 *  you are, muted ahead — with the step name under it. */
function StepBars({ step }: { step: number }) {
  return (
    <ol className="mb-6 flex list-none gap-2 p-0">
      {ONB_LABELS.map((label, i) => (
        <li key={label} className="flex-1" aria-current={i === step ? 'step' : undefined}>
          <div
            className={cn(
              'h-1.5 rounded-full',
              i < step ? 'bg-primary' : i === step ? 'bg-peach' : 'bg-border',
            )}
          />
          <div
            className={cn(
              'mt-[7px] text-center text-[13px] font-semibold',
              i <= step ? 'text-foreground' : 'text-faint',
            )}
          >
            {label}
          </div>
        </li>
      ))}
    </ol>
  );
}

function IdentityStep({
  fullName,
  onFullNameChange,
  country,
  onCountryChange,
  occupation,
  onOccupationChange,
  verified,
}: {
  fullName: string;
  onFullNameChange: (v: string) => void;
  country: string;
  onCountryChange: (v: string) => void;
  occupation: string;
  onOccupationChange: (v: string) => void;
  verified: boolean;
}) {
  return (
    <div>
      <div className="mb-4 flex flex-col gap-1.5">
        <Label htmlFor="fullname">Full legal name</Label>
        <Input
          id="fullname"
          type="text"
          value={fullName}
          onChange={(e) => onFullNameChange(e.target.value)}
          autoComplete="name"
          placeholder="As it appears on your ID"
        />
      </div>
      <div className="mb-4 flex flex-col gap-4 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="country">Country of residence</Label>
          <Select value={country} onValueChange={onCountryChange}>
            <SelectTrigger id="country" aria-label="Country of residence">
              <SelectValue placeholder="Select a country" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Corridor countries</SelectLabel>
                {CORRIDOR_COUNTRIES.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>All countries</SelectLabel>
                {OTHER_COUNTRIES.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="occupation">Occupation</Label>
          <Input
            id="occupation"
            type="text"
            value={occupation}
            onChange={(e) => onOccupationChange(e.target.value)}
            autoComplete="organization-title"
            placeholder="e.g. Software engineer"
          />
        </div>
      </div>
      {verified ? <Callout>Identity documents verified · KYC Tier 2 unlocked</Callout> : null}
    </div>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 flex items-center gap-[11px] rounded-xl border border-solid border-border bg-mint px-[15px] py-[13px]">
      <Check className="h-[18px] w-[18px] flex-none text-success" aria-hidden />
      <span className="text-sm leading-snug text-foreground">{children}</span>
    </div>
  );
}

/**
 * Declarations as bordered rows. The visible control is the styled box; the real
 * checkbox is present but visually hidden, so keyboard operation, form semantics
 * and screen-reader state all come from the native element instead of being
 * re-implemented with ARIA.
 */
function ComplianceStep({
  declared,
  onToggle,
}: {
  declared: boolean[];
  onToggle: (i: number, v: boolean) => void;
}) {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="sr-only">Declarations</legend>
      <div className="flex flex-col gap-[11px]">
        {DECLARATIONS.map((text, i) => (
          <ToggleRow
            key={text}
            checked={declared[i] ?? false}
            onChange={(v) => onToggle(i, v)}
            label={text}
          />
        ))}
      </div>
    </fieldset>
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
      <legend className="mb-2.5 p-0 text-[13.5px] font-semibold text-foreground">
        Source of funds (select all that apply)
      </legend>
      <div className="flex flex-col gap-2.5">
        {SOURCES.map((s) => (
          <ToggleRow
            key={s.id}
            checked={sources[s.id] ?? false}
            onChange={(v) => onToggle(s.id, v)}
            label={s.label}
          />
        ))}
      </div>
    </fieldset>
  );
}

function ToggleRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="block cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        className={cn(
          'flex items-center gap-3 rounded-[13px] border border-solid px-4 py-3.5 text-[15px] leading-snug transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2',
          checked ? 'border-primary bg-mint' : 'border-border bg-card hover:border-primary/50',
        )}
      >
        <span
          className={cn(
            // Explicit 6px radius, not `rounded-md`: the theme maps that to
            // ~10px (var(--radius) - 4px), which fully rounds a 22px box and
            // makes the checkbox read as a dot. Border is `dim`, not `input` —
            // `input` is barely 1.3:1 on the card, so an unchecked box was
            // invisible, well under the 3:1 WCAG 1.4.11 asks for a control
            // boundary that identifies the control.
            'grid h-[22px] w-[22px] flex-none place-items-center rounded-[6px] border-2 border-solid transition-colors',
            checked ? 'border-primary bg-primary' : 'border-dim bg-background',
          )}
          aria-hidden
        >
          {checked ? <Check className="h-3.5 w-3.5 text-primary-foreground" /> : null}
        </span>
        <span className="flex-1 text-foreground">{label}</span>
      </span>
    </label>
  );
}

/**
 * The fact-find. Options are lettered A-E as in the prototype, but each is a
 * real radio input behind the styling, so a keyboard user gets arrow-key
 * navigation within a question and a screen reader hears a grouped choice
 * rather than a row of unrelated buttons.
 */
function RiskStep({
  answers,
  onPick,
  band,
  total,
  complete,
}: {
  answers: Record<number, number>;
  onPick: (q: number, score: number) => void;
  band: string;
  total: number;
  complete: boolean;
}) {
  return (
    <div className="flex flex-col gap-5">
      {RISK_QUESTIONS.map((question, qi) => (
        <fieldset className="m-0 min-w-0 border-0 p-0" key={question.q}>
          <legend className="mb-2.5 p-0 text-[15.5px] font-semibold text-foreground">
            {question.q}
          </legend>
          <div className="flex flex-col gap-2">
            {question.opts.map((opt) => {
              const selected = answers[qi] === opt.score;
              return (
                <label key={opt.key} className="block cursor-pointer">
                  <input
                    type="radio"
                    name={`q${qi}`}
                    checked={selected}
                    onChange={() => onPick(qi, opt.score)}
                    className="peer sr-only"
                  />
                  <span
                    className={cn(
                      'flex items-center gap-3 rounded-xl border border-solid px-3.5 py-3 text-[15px] leading-snug transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2',
                      selected
                        ? 'border-primary bg-mint'
                        : 'border-input bg-card hover:border-primary/50',
                    )}
                  >
                    <span
                      className={cn(
                        'grid h-7 w-7 flex-none place-items-center rounded-lg text-[13px] font-bold transition-colors',
                        selected
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground',
                      )}
                      aria-hidden
                    >
                      {opt.key}
                    </span>
                    <span className="flex-1 text-foreground">{opt.label}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
      <output
        aria-live="polite"
        className="flex items-center justify-between gap-3 rounded-xl border border-solid border-border bg-muted px-4 py-3.5"
      >
        <span className="text-[13.5px] font-bold uppercase tracking-wide text-dim">
          Derived risk profile
        </span>
        {complete ? (
          <span className="font-display text-[17px] font-bold text-foreground">
            {band} · score {total}
          </span>
        ) : (
          <span className="text-sm font-semibold text-dim">Answer all three</span>
        )}
      </output>
    </div>
  );
}

function DoneStep({ band }: { band: string }) {
  return (
    <div className="py-3.5 text-center">
      <span className="mx-auto mb-[18px] grid h-[72px] w-[72px] place-items-center rounded-full bg-mint">
        <Check className="h-[38px] w-[38px] text-success" aria-hidden />
      </span>
      <h1 className="font-display text-[23px] font-bold tracking-tight">
        You're verified · Tier 2
      </h1>
      <p className="mx-auto mt-2.5 max-w-[400px] text-[15px] leading-relaxed text-dim">
        Your agent can now discover, screen and coordinate execution across every licensed partner
        in the network, always on your approval.
      </p>
      <ul className="mx-auto mt-5 flex max-w-[360px] list-none flex-col gap-2 p-0 text-left">
        {[
          'Identity verified (KYC · Tier 2)',
          `Suitability: ${band || 'High Moderate'} profile`,
          'Source of funds confirmed',
        ].map((item) => (
          <li key={item} className="flex items-center gap-2.5 text-[14.5px] text-foreground">
            <Check className="h-4 w-4 flex-none text-success" aria-hidden />
            {item}
          </li>
        ))}
      </ul>
      <Button asChild className="mt-6">
        <Link href="/home">Explore opportunities</Link>
      </Button>
    </div>
  );
}
