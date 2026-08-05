'use client';

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
    <section className="section">
      <div className="panel">
        {step < DONE ? (
          <>
            <ol className="stepbar">
              {ONB_LABELS.map((label, i) => (
                <li key={label} data-state={i < step ? 'done' : i === step ? 'current' : 'todo'}>
                  {label}
                </li>
              ))}
            </ol>
            <h1>{ONB_TITLES[step]}</h1>
            <p className="lead" style={{ marginBottom: 'var(--sp-5)' }}>
              {ONB_SUBS[step]}
            </p>

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

            <div className="cta-row" style={{ justifyContent: 'space-between' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setStep((s) => s + 1)}
                disabled={!canContinue}
              >
                {continueLabel}
              </button>
            </div>
          </>
        ) : (
          <DoneStep band={band} />
        )}
      </div>
    </section>
  );
}

function IdentityStep() {
  return (
    <div>
      <div className="field">
        <label htmlFor="fullname">Full legal name</label>
        <input id="fullname" type="text" defaultValue="Marcus A. Bailey" autoComplete="name" />
      </div>
      <div className="field">
        <label htmlFor="country">Country of residence</label>
        <input id="country" type="text" defaultValue="United Kingdom" autoComplete="country-name" />
      </div>
      <div className="field">
        <label htmlFor="occupation">Occupation</label>
        <input
          id="occupation"
          type="text"
          defaultValue="Software Engineer"
          autoComplete="organization-title"
        />
      </div>
      <p className="partner-chip" style={{ display: 'inline-block' }}>
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
    <fieldset className="ccn-field">
      <legend className="ccn-legend">Declarations</legend>
      {DECLARATIONS.map((text, i) => (
        <label key={text} className="ccn-switch" style={{ marginBottom: 'var(--sp-3)' }}>
          <input
            type="checkbox"
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
        <fieldset className="ccn-field" key={question.q} style={{ marginBottom: 'var(--sp-5)' }}>
          <legend className="ccn-legend">{question.q}</legend>
          {question.opts.map((opt) => (
            <label key={opt.key} className="ccn-switch" style={{ marginBottom: 'var(--sp-2)' }}>
              <input
                type="radio"
                name={`q${qi}`}
                checked={answers[qi] === opt.score}
                onChange={() => onPick(qi, opt.score)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </fieldset>
      ))}
      <output aria-live="polite" style={{ display: 'block' }}>
        {band ? (
          <>
            Your risk profile: <strong>{band}</strong>
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
    <fieldset className="ccn-field">
      <legend className="ccn-legend">Source of funds (select all that apply)</legend>
      {SOURCES.map((s) => (
        <label key={s.id} className="ccn-switch" style={{ marginBottom: 'var(--sp-3)' }}>
          <input
            type="checkbox"
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
      <span className="step-index" aria-hidden="true">
        ✓
      </span>
      <h1>You're verified · Tier 2</h1>
      <p className="lead">Your agent can now act within the limits you set.</p>
      <ul style={{ lineHeight: 'var(--lh-long)', margin: 'var(--sp-4) 0' }}>
        <li>Identity — KYC Tier 2</li>
        <li>Suitability — {band || 'High Moderate'} profile</li>
        <li>Source of funds — confirmed</li>
      </ul>
      <Link className="btn btn-primary" href="/">
        Explore opportunities
      </Link>
    </div>
  );
}
