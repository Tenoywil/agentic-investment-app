'use client';

import {
  AppScreen,
  DEFAULT_DEMO_ACCOUNT_STATE,
  DEFAULT_DEMO_PROFILE,
  DEMO_JOURNEY_STORAGE_KEY,
  type DemoProfile,
  PageHead,
  demoIdentityEvidence,
  demoIdentityFingerprint,
  writeDemoAccountState,
  writeDemoProfile,
} from '@/app/_components/AppScreen';
import { Badge, type BadgeProps } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { Input } from '@/app/_components/ui/input';
import { Label } from '@/app/_components/ui/label';
import { cn } from '@/app/_lib/utils';
import { Check, CircleAlert, FileCheck2, ShieldCheck, Sparkles, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  Recommended: 'success',
  Available: 'secondary',
  Explore: 'terra',
};

const PRODUCTS = [
  {
    code: 'LI',
    title: 'Life insurance',
    provider: 'Sagicor · Guardian Life',
    status: 'Recommended',
    desc: 'Term or whole-life cover priced for diaspora residents, protecting your family across borders.',
  },
  {
    code: 'RA',
    title: 'Retirement annuity',
    provider: 'NCB · JMMB',
    status: 'Recommended',
    desc: 'Tax-efficient retirement income, whether you retire abroad or return home to the region.',
  },
  {
    code: 'CI',
    title: 'Health & critical illness',
    provider: 'Sagicor',
    status: 'Available',
    desc: 'Cover medical costs at home and abroad, with critical-illness lump-sum protection.',
  },
  {
    code: 'ES',
    title: 'Estate planning',
    provider: 'CCN Legal Network',
    status: 'Explore',
    desc: 'Wills, trusts and cross-border succession so wealth transfers smoothly to the next generation.',
  },
  {
    code: 'MG',
    title: 'Diaspora mortgage',
    provider: 'NCB · Republic Bank',
    status: 'Available',
    desc: 'Finance property in the region with income earned abroad fully recognized.',
  },
  {
    code: 'ED',
    title: 'Education savings',
    provider: 'Sagicor',
    status: 'Available',
    desc: 'Ring-fenced, goal-linked savings that grow toward tuition with automated top-ups.',
  },
];

const GOALS = [
  {
    name: 'University fund',
    from: 'NCB · Sagicor',
    pct: 82,
    of: 'US$41,000 of US$50,000',
    eta: 'On track · mid-2028',
    color: '#17786e',
    etaClass: 'text-teal2',
  },
  {
    name: 'Retirement',
    from: 'Sagicor · Proven',
    pct: 24,
    of: 'US$118,000 of US$500,000',
    eta: 'Projected 2044',
    color: '#c56a3e',
    etaClass: 'text-terra',
  },
  {
    name: 'Emergency fund',
    from: 'JMMB',
    pct: 100,
    of: 'US$15,000 of US$15,000',
    eta: 'Complete',
    color: '#0a8f5b',
    etaClass: 'text-success',
  },
];

const STATS: { label: string; val: string; valClass: string; sub: string }[] = [
  {
    label: 'Protection gap',
    val: 'US$120,000',
    valClass: 'text-terra',
    sub: 'Recommended life cover',
  },
  {
    label: 'Est. legacy value',
    val: 'US$310,000',
    valClass: 'text-foreground',
    sub: 'Projected at retirement',
  },
];

const SETUP_STEPS = ['Profile', 'Goals', 'Compliance', 'Documents'] as const;
const RESIDENCE_OPTIONS = ['United States', 'Jamaica', 'Canada', 'United Kingdom', 'Other'];
const AGE_OPTIONS = ['18–24', '25–34', '35–44', '45–54', '55+'];
const CITIZENSHIP_OPTIONS = ['Jamaica', 'United States', 'Canada', 'United Kingdom'];
const OBJECTIVE_OPTIONS = [
  'Income and long-term growth',
  'Capital preservation',
  'Growth',
  'Retirement income',
];
const HORIZON_OPTIONS = ['Under 3 years', '3–5 years', '5–10 years', '10+ years'];
const RISK_OPTIONS = ['Conservative', 'Balanced', 'Growth'];
const LIQUIDITY_OPTIONS = ['Weekly access', 'Monthly access', 'Can lock for 3 years'];
const FINANCIAL_OPTIONS = [
  'Stable income; six-month cash reserve',
  'Stable income; building a cash reserve',
  'Variable income; established savings',
];
const PEP_OPTIONS = ['Not a PEP', 'I am a PEP', 'Family member or close associate of a PEP'];
const FATCA_OPTIONS = ['U.S. person', 'Not a U.S. person'];
const SOURCE_OPTIONS = ['Salary', 'Business income', 'Savings', 'Investments'];
const TAX_ID_OPTIONS = ['SSN', 'TRN', 'TIN'];

const EMPTY_DEMO_PROFILE: DemoProfile = {
  ...DEFAULT_DEMO_PROFILE,
  name: '',
  residence: '',
  age: '',
  objective: '',
  horizon: '',
  risk: '',
  liquidity: '',
  financialSituation: '',
  jamaicanCitizen: false,
  usCitizen: false,
  citizenships: [],
  pepStatus: '',
  fatcaStatus: '',
  sourceOfFunds: [],
  taxIdType: '',
  taxIdLastFour: '',
};

type PassportState = 'idle' | 'uploading' | 'invalid' | 'resolved';

function Ring({ pct, color }: { pct: number; color: string }) {
  const r = 26;
  const cir = 2 * Math.PI * r;
  const on = (pct / 100) * cir;
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true">
      <circle cx="36" cy="36" r={r} fill="none" stroke="hsl(var(--border))" strokeWidth="7" />
      <circle
        cx="36"
        cy="36"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${on} ${cir - on}`}
        transform="rotate(-90 36 36)"
      />
      <text
        x="36"
        y="40"
        textAnchor="middle"
        fontSize="15"
        fontWeight="700"
        fill="hsl(var(--foreground))"
        fontFamily="'Hanken Grotesk', sans-serif"
      >
        {pct}%
      </text>
    </svg>
  );
}

export default function PlanningPage() {
  return (
    <Suspense fallback={<PlanningRouteLoading />}>
      <PlanningRoute />
    </Suspense>
  );
}

function PlanningRoute() {
  const searchParams = useSearchParams();
  return searchParams.get('setup') === '1' ? <DemoInvestorSetup /> : <PlanningDashboard />;
}

function PlanningRouteLoading() {
  return (
    <section className="grid min-h-screen place-items-center bg-background px-6 text-center text-foreground">
      <div>
        <span className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-primary font-display text-lg font-bold text-primary-foreground">
          C
        </span>
        <p className="mt-4 text-sm text-dim">Preparing your profile…</p>
      </div>
    </section>
  );
}

function DemoInvestorSetup() {
  const router = useRouter();
  const passportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<DemoProfile>(EMPTY_DEMO_PROFILE);
  const [citizenships, setCitizenships] = useState<string[]>([]);
  const [pepStatus, setPepStatus] = useState('');
  const [fatcaStatus, setFatcaStatus] = useState('');
  const [sources, setSources] = useState<string[]>([]);
  const [taxIdType, setTaxIdType] = useState('');
  const [taxIdLastFour, setTaxIdLastFour] = useState('');
  const [passportState, setPassportState] = useState<PassportState>('idle');
  const [proofAddressAdded, setProofAddressAdded] = useState(false);

  useEffect(
    () => () => {
      if (passportTimerRef.current) clearTimeout(passportTimerRef.current);
    },
    [],
  );

  const stepComplete = [
    profile.residence !== '' &&
      profile.name.trim() !== '' &&
      profile.age !== '' &&
      citizenships.length > 0,
    profile.objective !== '' &&
      profile.horizon !== '' &&
      profile.risk !== '' &&
      profile.liquidity !== '' &&
      profile.financialSituation !== '',
    pepStatus !== '' &&
      fatcaStatus !== '' &&
      sources.length > 0 &&
      taxIdType !== '' &&
      /^\d{4}$/.test(taxIdLastFour),
    passportState === 'resolved' && proofAddressAdded,
  ][step];

  const stepTitles = [
    'Create your investor profile',
    "Let's get to know you better",
    'Confirm your compliance details',
    'Add your identity documents',
  ];
  const stepDescriptions = [
    'Start with where you live and the personal details used to tailor your experience.',
    'Your answers guide suitability screening and the opportunities your agent can prepare.',
    'These declarations help licensed partners perform their KYC and AML review.',
    'Your agent checks the evidence before it is prepared for a licensed partner.',
  ];
  const preparedProfile: DemoProfile = {
    ...profile,
    name: profile.name.trim(),
    jamaicanCitizen: citizenships.includes('Jamaica'),
    usCitizen: citizenships.includes('United States'),
    citizenships,
    pepStatus,
    fatcaStatus,
    sourceOfFunds: sources,
    taxIdType,
    taxIdLastFour,
  };
  const identityEvidence = demoIdentityEvidence(preparedProfile);

  function toggleValue(value: string, values: string[], update: (next: string[]) => void) {
    update(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  function uploadPassport() {
    if (passportTimerRef.current) clearTimeout(passportTimerRef.current);
    setPassportState('uploading');
    passportTimerRef.current = setTimeout(() => {
      setPassportState('invalid');
      passportTimerRef.current = null;
    }, 650);
  }

  function finishSetup() {
    writeDemoProfile(preparedProfile);
    writeDemoAccountState({
      ...DEFAULT_DEMO_ACCOUNT_STATE,
      ncbEvidenceFingerprint: demoIdentityFingerprint(preparedProfile),
      ncbClientStatus: 'evidence_ready',
    });
    try {
      window.sessionStorage.setItem(DEMO_JOURNEY_STORAGE_KEY, 'complete');
    } catch {
      // In-memory state still carries the completed profile to the next screen.
    }
    router.push('/demo/home');
  }

  function continueSetup() {
    if (!stepComplete) return;
    if (step === SETUP_STEPS.length - 1) {
      finishSetup();
      return;
    }
    setStep((current) => current + 1);
  }

  return (
    <section className="min-h-screen bg-background font-sans text-foreground">
      <div className="mx-auto w-full max-w-[760px] px-5 pb-24 pt-8 sm:pt-10">
        <div className="mb-8 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 no-underline">
            <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-primary font-display text-[17px] font-bold text-primary-foreground">
              C
            </span>
            <span className="font-display text-base font-bold">Caribbean Capital Network</span>
          </Link>
          <Button variant="outline" asChild className="h-10">
            <Link href="/">Exit</Link>
          </Button>
        </div>

        <div className="mb-6 text-center">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-mint px-4 py-2 text-sm font-bold text-primary dark:text-teal2">
            <ShieldCheck className="h-4 w-4" aria-hidden />
            Investor setup
          </p>
          <h1 className="font-display text-[30px] font-bold leading-tight tracking-tight">
            {stepTitles[step]}
          </h1>
          <p className="mx-auto mt-2 max-w-[600px] text-base leading-relaxed text-dim">
            {stepDescriptions[step]}
          </p>
        </div>

        <SetupProgress step={step} />

        <Card className="rounded-[22px] p-5 sm:p-7">
          {step === 0 ? (
            <div className="grid gap-6">
              <ChoiceGroup
                legend="Where do you live?"
                name="residence"
                value={profile.residence}
                options={RESIDENCE_OPTIONS}
                onChange={(residence) => setProfile((current) => ({ ...current, residence }))}
              />

              <div className="grid gap-2">
                <Label htmlFor="demo-full-name">Full legal name</Label>
                <Input
                  id="demo-full-name"
                  value={profile.name}
                  onChange={(event) =>
                    setProfile((current) => ({ ...current, name: event.target.value }))
                  }
                  autoComplete="name"
                  placeholder="As it appears on your ID"
                />
              </div>

              <ChoiceGroup
                legend="What is your age group?"
                name="age"
                value={profile.age}
                options={AGE_OPTIONS}
                onChange={(age) => setProfile((current) => ({ ...current, age }))}
              />

              <fieldset className="m-0 min-w-0 border-0 p-0">
                <legend className="mb-3 p-0 text-sm font-bold">Citizenship(s)</legend>
                <p className="mb-3 text-sm text-dim">Select every citizenship that applies.</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {CITIZENSHIP_OPTIONS.map((citizenship) => (
                    <CheckChoice
                      key={citizenship}
                      label={citizenship}
                      checked={citizenships.includes(citizenship)}
                      onChange={() => toggleValue(citizenship, citizenships, setCitizenships)}
                    />
                  ))}
                </div>
              </fieldset>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="grid gap-6">
              <ChoiceGroup
                legend="What is your main investment objective?"
                name="objective"
                value={profile.objective}
                options={OBJECTIVE_OPTIONS}
                onChange={(objective) => setProfile((current) => ({ ...current, objective }))}
                singleColumn
              />
              <ChoiceGroup
                legend="What is your time horizon?"
                name="horizon"
                value={profile.horizon}
                options={HORIZON_OPTIONS}
                onChange={(horizon) => setProfile((current) => ({ ...current, horizon }))}
              />
              <ChoiceGroup
                legend="How much investment risk are you comfortable with?"
                name="risk"
                value={profile.risk}
                options={RISK_OPTIONS}
                onChange={(risk) => setProfile((current) => ({ ...current, risk }))}
              />
              <ChoiceGroup
                legend="How quickly might you need access to this money?"
                name="liquidity"
                value={profile.liquidity}
                options={LIQUIDITY_OPTIONS}
                onChange={(liquidity) => setProfile((current) => ({ ...current, liquidity }))}
                singleColumn
              />
              <ChoiceGroup
                legend="Which best describes your current financial situation?"
                name="financial-situation"
                value={profile.financialSituation}
                options={FINANCIAL_OPTIONS}
                onChange={(financialSituation) =>
                  setProfile((current) => ({ ...current, financialSituation }))
                }
                singleColumn
              />
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid gap-6">
              <ChoiceGroup
                legend="Politically exposed person status"
                name="pep-status"
                value={pepStatus}
                options={PEP_OPTIONS}
                onChange={setPepStatus}
                singleColumn
              />
              <ChoiceGroup
                legend="FATCA status"
                name="fatca-status"
                value={fatcaStatus}
                options={FATCA_OPTIONS}
                onChange={setFatcaStatus}
              />
              <fieldset className="m-0 min-w-0 border-0 p-0">
                <legend className="mb-3 p-0 text-sm font-bold">
                  Source of funds (select all that apply)
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SOURCE_OPTIONS.map((source) => (
                    <CheckChoice
                      key={source}
                      label={source}
                      checked={sources.includes(source)}
                      onChange={() => toggleValue(source, sources, setSources)}
                    />
                  ))}
                </div>
              </fieldset>
              <ChoiceGroup
                legend="Tax identifier type"
                name="tax-id-type"
                value={taxIdType}
                options={TAX_ID_OPTIONS}
                onChange={setTaxIdType}
              />
              <div className="grid gap-2">
                <Label htmlFor="demo-tax-id">Last four digits of your tax identifier</Label>
                <Input
                  id="demo-tax-id"
                  value={taxIdLastFour}
                  onChange={(event) =>
                    setTaxIdLastFour(event.target.value.replace(/\D/g, '').slice(0, 4))
                  }
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="0000"
                />
                <span className="text-xs text-faint">
                  Only the last four digits are used on this screen.
                </span>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="grid gap-4">
              <Card className="p-4 shadow-none sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h2 className="font-display text-lg font-bold">Government-issued ID</h2>
                    <p className="mt-1 text-sm leading-relaxed text-dim">
                      Passport or national identity card. The licensed partner makes the final KYC
                      decision.
                    </p>
                  </div>
                  {passportState === 'resolved' ? (
                    <FileCheck2 className="h-6 w-6 flex-none text-success" aria-label="Added" />
                  ) : null}
                </div>

                {passportState === 'idle' ? (
                  <Button type="button" variant="outline" className="mt-4" onClick={uploadPassport}>
                    <Upload className="h-4 w-4" aria-hidden />
                    Upload passport
                  </Button>
                ) : null}
                {passportState === 'uploading' ? (
                  <Button type="button" variant="outline" className="mt-4" disabled aria-busy>
                    Checking passport…
                  </Button>
                ) : null}
                {passportState === 'invalid' ? (
                  <div className="mt-4 rounded-xl border border-solid border-terra/40 bg-[#f7e9e2] p-4 dark:bg-terra/10">
                    <p
                      role="alert"
                      className="flex items-start gap-2 text-sm text-[#8b431f] dark:text-terra"
                    >
                      <CircleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
                      {identityEvidence.currentDocument} cannot be prepared for partner review.
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-3"
                      onClick={() => setPassportState('resolved')}
                    >
                      <Sparkles className="h-4 w-4" aria-hidden />
                      Use my agent’s correction
                    </Button>
                  </div>
                ) : null}
                {passportState === 'resolved' ? (
                  <output className="mt-4 flex items-start gap-2 rounded-xl bg-mint p-4 text-sm leading-relaxed">
                    <Check className="mt-0.5 h-4 w-4 flex-none text-success" aria-hidden />
                    Your agent replaced the expired document with{' '}
                    {identityEvidence.replacementDocument}.
                  </output>
                ) : null}
              </Card>

              <Card className="p-4 shadow-none sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h2 className="font-display text-lg font-bold">Proof of address</h2>
                    <p className="mt-1 text-sm leading-relaxed text-dim">
                      A recent utility statement or bank statement showing your residential address.
                    </p>
                  </div>
                  {proofAddressAdded ? (
                    <FileCheck2 className="h-6 w-6 flex-none text-success" aria-label="Added" />
                  ) : null}
                </div>
                {proofAddressAdded ? (
                  <output className="mt-4 flex items-start gap-2 rounded-xl bg-mint p-4 text-sm">
                    <Check className="h-4 w-4 flex-none text-success" aria-hidden />
                    {identityEvidence.addressEvidence} · added
                  </output>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-4"
                    onClick={() => setProofAddressAdded(true)}
                  >
                    <Upload className="h-4 w-4" aria-hidden />
                    Upload proof of address
                  </Button>
                )}
              </Card>

              <p className="text-sm leading-relaxed text-dim">
                Nothing is sent automatically. You review the prepared evidence before a licensed
                partner receives it.
              </p>
            </div>
          ) : null}

          <div className="mt-7 flex gap-3 border-t border-border pt-5">
            {step > 0 ? (
              <Button
                type="button"
                variant="outline"
                className="h-12"
                onClick={() => setStep((current) => current - 1)}
              >
                Back
              </Button>
            ) : null}
            <Button
              type="button"
              className="h-12 flex-1 text-base"
              disabled={!stepComplete}
              onClick={continueSetup}
            >
              {step === SETUP_STEPS.length - 1 ? 'Open my dashboard' : 'Continue'}
            </Button>
          </div>
        </Card>
      </div>
    </section>
  );
}

function SetupProgress({ step }: { step: number }) {
  return (
    <ol className="mb-6 flex list-none gap-2 p-0" aria-label="Investor setup progress">
      {SETUP_STEPS.map((label, index) => (
        <li
          key={label}
          className="min-w-0 flex-1"
          aria-current={index === step ? 'step' : undefined}
        >
          <span
            className={cn(
              'block h-1.5 rounded-full',
              index < step ? 'bg-primary' : index === step ? 'bg-peach' : 'bg-border',
            )}
          />
          <span
            className={cn(
              'mt-2 block truncate text-center text-xs font-semibold',
              index <= step ? 'text-foreground' : 'text-faint',
            )}
          >
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ChoiceGroup({
  legend,
  name,
  value,
  options,
  onChange,
  singleColumn = false,
}: {
  legend: string;
  name: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  singleColumn?: boolean;
}) {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-3 p-0 text-sm font-bold">{legend}</legend>
      <div className={cn('grid gap-2', !singleColumn && 'sm:grid-cols-2')}>
        {options.map((option) => {
          const selected = value === option;
          return (
            <label key={option} className="block cursor-pointer">
              <input
                type="radio"
                name={name}
                value={option}
                checked={selected}
                onChange={() => onChange(option)}
                className="peer sr-only"
              />
              <span
                className={cn(
                  'flex min-h-12 items-center gap-3 rounded-xl border border-solid px-4 py-3 text-sm font-semibold transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2',
                  selected
                    ? 'border-primary bg-mint text-foreground'
                    : 'border-border bg-card text-foreground hover:border-primary/50 hover:bg-muted/40',
                )}
              >
                <span
                  className={cn(
                    'grid h-5 w-5 flex-none place-items-center rounded-full border-2 border-solid',
                    selected ? 'border-primary' : 'border-dim',
                  )}
                  aria-hidden
                >
                  {selected ? <span className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
                </span>
                {option}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function CheckChoice({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="block cursor-pointer">
      <input type="checkbox" checked={checked} onChange={onChange} className="peer sr-only" />
      <span
        className={cn(
          'flex min-h-12 items-center gap-3 rounded-xl border border-solid px-4 py-3 text-sm font-semibold transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2',
          checked
            ? 'border-primary bg-mint text-foreground'
            : 'border-border bg-card text-foreground hover:border-primary/50 hover:bg-muted/40',
        )}
      >
        <span
          className={cn(
            'grid h-5 w-5 flex-none place-items-center rounded-md border-2 border-solid',
            checked ? 'border-primary bg-primary' : 'border-dim bg-background',
          )}
          aria-hidden
        >
          {checked ? <Check className="h-3.5 w-3.5 text-primary-foreground" /> : null}
        </span>
        {label}
      </span>
    </label>
  );
}

function PlanningDashboard() {
  return (
    <AppScreen active="planning" basePath="/demo">
      <PageHead
        eyebrow="Cover, retirement, property and legacy planning across borders"
        title="Planning"
      />

      <div data-tour="customer-planning">
        <div className="g3">
          <div className="rounded-2xl bg-primary p-5 text-[#eafaf5]">
            <div className="text-[13.5px] opacity-80">Financial health</div>
            <div className="my-1 font-display text-3xl font-bold">72 / 100</div>
            <div className="text-[13.5px] font-bold text-[#9fe6c6]">Good · on track</div>
          </div>
          {STATS.map((s) => (
            <Card key={s.label} className="p-5">
              <div className="text-[13.5px] text-dim">{s.label}</div>
              <div className={cn('my-1 font-display text-3xl font-bold', s.valClass)}>{s.val}</div>
              <div className="text-[13.5px] text-faint">{s.sub}</div>
            </Card>
          ))}
        </div>

        <h2 className="mb-3.5 mt-7 font-display text-[22px] font-bold">Recommended for you</h2>
        <div className="g2">
          {PRODUCTS.map((p) => (
            <Card key={p.code} className="p-[22px]">
              <div className="mb-3 flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-mint font-mono text-xs font-bold text-teal2">
                  {p.code}
                </span>
                <div className="flex-1">
                  <div className="text-base font-bold">{p.title}</div>
                  <div className="text-[13px] text-faint">{p.provider}</div>
                </div>
                <Badge variant={STATUS_VARIANT[p.status] ?? 'secondary'}>{p.status}</Badge>
              </div>
              <p className="mb-4 text-sm leading-relaxed text-dim">{p.desc}</p>
              {/* A door, not a dead control: the demo agent answers planning
                questions from its script, which is the feel this preview owes. */}
              <Button variant="secondary" className="w-full" asChild>
                <Link href="/demo/agent">Explore with agent</Link>
              </Button>
            </Card>
          ))}
        </div>

        <h2 className="mb-3.5 mt-7 font-display text-[22px] font-bold">Your goals</h2>
        <div className="g3">
          {GOALS.map((g) => (
            <Card key={g.name} className="p-[22px]">
              <div className="mb-4 flex items-center gap-4">
                <Ring pct={g.pct} color={g.color} />
                <div>
                  <div className="text-base font-bold">{g.name}</div>
                  <div className="text-[13px] text-faint">{g.from}</div>
                </div>
              </div>
              <div className="border-t border-border pt-3">
                <div className="font-mono text-sm">{g.of}</div>
                <div className={cn('mt-1 text-[13.5px] font-bold', g.etaClass)}>{g.eta}</div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </AppScreen>
  );
}
