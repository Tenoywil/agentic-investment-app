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
  readDemoAccountState,
  readDemoProfile,
  writeDemoAccountState,
  writeDemoProfile,
} from '@/app/_components/AppScreen';
import { Badge, type BadgeProps } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/app/_components/ui/dialog';
import { Input } from '@/app/_components/ui/input';
import { Label } from '@/app/_components/ui/label';
import { cn } from '@/app/_lib/utils';
import { CORRIDOR_COUNTRIES, OTHER_COUNTRIES } from '@/lib/countries';
import { Check, CircleAlert, FileCheck2, Plus, ShieldCheck, Sparkles, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useId, useRef, useState } from 'react';

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

type DemoGoal = {
  id: string;
  name: string;
  from: string;
  pct: number;
  of: string;
  eta: string;
  color: string;
  etaClass: string;
};

const GOALS: DemoGoal[] = [
  {
    id: 'university-fund',
    name: 'University fund',
    from: 'NCB · Sagicor',
    pct: 82,
    of: 'US$41,000 of US$50,000',
    eta: 'On track · mid-2028',
    color: '#17786e',
    etaClass: 'text-teal2',
  },
  {
    id: 'retirement',
    name: 'Retirement',
    from: 'Sagicor · Proven',
    pct: 24,
    of: 'US$118,000 of US$500,000',
    eta: 'Projected 2044',
    color: '#c56a3e',
    etaClass: 'text-terra',
  },
  {
    id: 'emergency-fund',
    name: 'Emergency fund',
    from: 'JMMB',
    pct: 100,
    of: 'US$15,000 of US$15,000',
    eta: 'Complete',
    color: '#0a8f5b',
    etaClass: 'text-success-ink',
  },
];

/** The ring colour a goal created in the preview gets — the same default the
 *  live screen falls back to when a goal carries none. */
const NEW_GOAL_COLOR = '#17786e';

const SETUP_STEPS = ['Profile', 'Goals', 'Compliance', 'Documents', 'Review'] as const;
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
const LIQUIDITY_OPTIONS = [
  'Quarterly access',
  'Semiannual access',
  'Annual access',
  'Can lock for 3 years',
  'Can lock for 5 years',
];
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
  targetReturn: '',
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
  const searchParams = useSearchParams();
  const passportInputRef = useRef<HTMLInputElement>(null);
  const [passportPreview, setPassportPreview] = useState<string | null>(null);
  const [passportName, setPassportName] = useState('');
  const [passportError, setPassportError] = useState('');
  const passportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [step, setStep] = useState(0);
  const [returnToReview, setReturnToReview] = useState(false);
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

  useEffect(() => {
    if (searchParams.get('edit') !== '1') return;
    const saved = readDemoProfile();
    setProfile(saved);
    setCitizenships(saved.citizenships);
    setPepStatus(saved.pepStatus);
    setFatcaStatus(saved.fatcaStatus);
    setSources(saved.sourceOfFunds);
    setTaxIdType(saved.taxIdType);
    setTaxIdLastFour(saved.taxIdLastFour);
    const hasEvidence =
      readDemoAccountState().ncbEvidenceFingerprint === demoIdentityFingerprint(saved);
    setPassportState(hasEvidence ? 'resolved' : 'idle');
    setProofAddressAdded(hasEvidence);
    setPassportName(hasEvidence ? 'Previously selected identity evidence' : '');
    setStep(4);
  }, [searchParams]);

  useEffect(
    () => () => {
      if (passportPreview) URL.revokeObjectURL(passportPreview);
    },
    [passportPreview],
  );

  function selectPassport(file: File | undefined) {
    if (!file) return;
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setPassportError('Choose a JPEG, PNG or WebP image under 10 MB.');
      return;
    }
    if (passportTimerRef.current) clearTimeout(passportTimerRef.current);
    setPassportError('');
    setPassportPreview(URL.createObjectURL(file));
    setPassportName(file.name);
    setPassportState('resolved');
  }

  const stepComplete = [
    profile.residence !== '' &&
      profile.name.trim() !== '' &&
      profile.age !== '' &&
      citizenships.length > 0,
    profile.objective !== '' &&
      profile.targetReturn !== '' &&
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
    passportState === 'resolved' &&
      proofAddressAdded &&
      profile.name.trim() !== '' &&
      citizenships.length > 0,
  ][step];

  const stepTitles = [
    'Create your investor profile',
    "Let's get to know you better",
    'Confirm your compliance details',
    'Add your identity documents',
    'Review your investor profile',
  ];
  const stepDescriptions = [
    'Start with where you live and the personal details used to tailor your experience.',
    'Your answers guide suitability screening and the opportunities your agent can prepare.',
    'These declarations help licensed partners perform their KYC and AML review.',
    'Choose the evidence you want a licensed partner to review.',
    'Check your one-page summary. Edit any section before your agent finds matches.',
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
    setPassportPreview(null);
    setPassportName('Sample passport · expired 12 Jun 2025');
    setPassportState('uploading');
    passportTimerRef.current = setTimeout(() => {
      setPassportState('invalid');
      passportTimerRef.current = null;
    }, 650);
  }

  function finishSetup() {
    writeDemoProfile(preparedProfile);
    writeDemoAccountState({
      ...(searchParams.get('edit') === '1' ? readDemoAccountState() : DEFAULT_DEMO_ACCOUNT_STATE),
      ncbEvidenceFingerprint: demoIdentityFingerprint(preparedProfile),
      ncbClientStatus: 'evidence_ready',
    });
    try {
      window.sessionStorage.setItem(DEMO_JOURNEY_STORAGE_KEY, 'complete');
    } catch {
      // In-memory state still carries the completed profile to the next screen.
    }
    router.push('/demo/opportunities?research=1');
  }

  function continueSetup() {
    if (!stepComplete) return;
    if (returnToReview) {
      setReturnToReview(false);
      setStep(SETUP_STEPS.length - 1);
      return;
    }
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
                <Label htmlFor="other-citizenship" className="mt-4 block">
                  Add another citizenship
                </Label>
                <select
                  id="other-citizenship"
                  className="mt-2 w-full rounded-lg border border-border bg-background p-3 text-sm"
                  value=""
                  onChange={(event) => {
                    if (event.target.value && !citizenships.includes(event.target.value))
                      setCitizenships([...citizenships, event.target.value]);
                  }}
                >
                  <option value="">Choose a country</option>
                  {[...CORRIDOR_COUNTRIES, ...OTHER_COUNTRIES]
                    .filter((country) => !CITIZENSHIP_OPTIONS.includes(country))
                    .map((country) => (
                      <option key={country} value={country}>
                        {country}
                      </option>
                    ))}
                </select>
                {citizenships
                  .filter((country) => !CITIZENSHIP_OPTIONS.includes(country))
                  .map((country) => (
                    <CheckChoice
                      key={country}
                      label={country}
                      checked
                      onChange={() =>
                        setCitizenships(citizenships.filter((value) => value !== country))
                      }
                    />
                  ))}
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
                legend="What total return are you targeting over your investment horizon?"
                name="target-return"
                value={profile.targetReturn}
                options={['5–10%', '5–15%', '10–15%']}
                onChange={(targetReturn) => setProfile((current) => ({ ...current, targetReturn }))}
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
              <p className="text-sm text-dim">
                A U.S. person includes a U.S. citizen or resident alien for tax purposes, including
                people meeting the green card or substantial presence test. Exceptions may apply.{' '}
                <a
                  className="underline"
                  href="https://www.irs.gov/taxtopics/tc851"
                  target="_blank"
                  rel="noreferrer"
                >
                  Check the IRS guidance
                </a>{' '}
                before declaring your status.
              </p>
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

                <input
                  ref={passportInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  className="sr-only"
                  aria-label="Capture or upload identity document"
                  onChange={(event) => {
                    selectPassport(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => passportInputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4" aria-hidden />
                    {passportState === 'invalid'
                      ? 'Upload a replacement passport'
                      : 'Scan or upload passport'}
                  </Button>
                  <Button type="button" variant="secondary" onClick={uploadPassport}>
                    Try sample passport scan
                  </Button>
                </div>
                {passportError && (
                  <p role="alert" className="mt-3 text-sm text-terra">
                    {passportError}
                  </p>
                )}
                {passportPreview && (
                  <img
                    src={passportPreview}
                    alt="Your selected identity document for review"
                    className="mt-4 max-h-64 w-full rounded-xl object-contain"
                  />
                )}
                {passportName && !passportPreview && (
                  <div
                    className="mt-4 rounded-xl border border-dashed border-border bg-mint p-6"
                    aria-label="Sample document preview"
                  >
                    <p className="font-mono text-xs">SPECIMEN · NOT A VALID ID</p>
                    <p className="mt-3 font-display text-lg">{passportName}</p>
                    {passportState === 'uploading' && (
                      <output className="mt-2 block animate-pulse text-sm">
                        Scanning sample document…
                      </output>
                    )}
                  </div>
                )}
                {passportState === 'invalid' && (
                  <div role="alert" className="mt-4 rounded-xl border border-terra/40 p-4 text-sm">
                    <p>
                      This sample passport expired on 12 June 2025. Choose a valid replacement; your
                      agent cannot replace your identity document for you.
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-3"
                      onClick={() => {
                        setPassportName('Valid sample passport · expires 18 Sep 2031');
                        setPassportState('resolved');
                      }}
                    >
                      Select valid sample replacement
                    </Button>
                  </div>
                )}
                {passportState === 'resolved' && (
                  <output className="mt-4 block rounded-xl bg-mint p-4 text-sm">
                    {passportName || 'Identity evidence'} selected by you. Ready for partner review;
                    identity and document validity have not been verified.
                  </output>
                )}
                <p className="mt-3 text-xs text-dim">
                  Images stay in this browser preview and are not uploaded. On supported phones, the
                  capture control opens the camera.
                </p>
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
                    Use sample proof of address
                  </Button>
                )}
              </Card>

              <p className="text-sm leading-relaxed text-dim">
                Nothing is sent automatically. You review the prepared evidence before a licensed
                partner receives it.
              </p>
            </div>
          ) : null}

          {step === 4 && (
            <div className="space-y-5">
              {[
                {
                  title: 'Personal details',
                  step: 0,
                  rows: [
                    ['Name', preparedProfile.name],
                    ['Residence', preparedProfile.residence],
                    ['Age', preparedProfile.age],
                    ['Citizenships', citizenships.join(', ')],
                  ],
                },
                {
                  title: 'Investment goals',
                  step: 1,
                  rows: [
                    ['Objective', profile.objective],
                    ['Target return', profile.targetReturn],
                    ['Horizon', profile.horizon],
                    ['Risk appetite', profile.risk],
                    ['Access to funds', profile.liquidity],
                    ['Financial situation', profile.financialSituation],
                  ],
                },
                {
                  title: 'Compliance declarations',
                  step: 2,
                  rows: [
                    ['PEP status', pepStatus],
                    ['FATCA status', fatcaStatus],
                    ['Source of funds', sources.join(', ')],
                    ['Tax identifier', `${taxIdType} ••••${taxIdLastFour}`],
                  ],
                },
                {
                  title: 'Documents',
                  step: 3,
                  rows: [
                    [
                      'Identity',
                      passportState === 'resolved'
                        ? 'Selected · pending partner verification'
                        : 'Required',
                    ],
                    ['Address', proofAddressAdded ? 'Sample evidence selected' : 'Required'],
                  ],
                },
              ].map((section) => (
                <section key={section.title} className="rounded-xl border border-border p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="font-display text-lg font-bold">{section.title}</h2>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setReturnToReview(true);
                        setStep(section.step);
                      }}
                    >
                      Edit {section.title.toLowerCase()}
                    </Button>
                  </div>
                  <dl className="space-y-2">
                    {section.rows.map(([label, value]) => (
                      <div key={label} className="flex flex-wrap justify-between gap-2 text-sm">
                        <dt className="text-dim">{label}</dt>
                        <dd className="m-0 font-medium">{value || 'Not provided'}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          )}
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
              {step === SETUP_STEPS.length - 1
                ? 'Find my matches'
                : returnToReview
                  ? 'Save and review'
                  : 'Continue'}
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

/** A preview-local currency parse for the goal form. The live screen posts
 *  minor units to the planning API; the preview has no API, so it formats the
 *  same figure for display and keeps the goal in component state for the rest
 *  of the visit. */
function formatGoalTarget(amount: number): string {
  return `US$${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function InlineError({ message }: { message: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra">
      <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
      {message}
    </p>
  );
}

/** The live "Add a goal" dialog, backed by preview state instead of the
 *  planning API. The live planning screen has offered this since goals became
 *  editable; the preview showed the goals section with no way to add one, so a
 *  visitor met a read-only version of a screen that is not read-only. */
function NewGoalDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (goal: DemoGoal) => void;
}) {
  const titleId = useId();
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [fromLabel, setFromLabel] = useState('');
  const [eta, setEta] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setName('');
      setTargetAmount('');
      setFromLabel('');
      setEta('');
      setError(null);
    }
  }, [open]);

  function handleSubmit() {
    const trimmedName = name.trim();
    const target = Number(targetAmount);
    if (!trimmedName) {
      setError('Give your goal a name.');
      return;
    }
    if (!targetAmount.trim() || !Number.isFinite(target) || target <= 0) {
      setError('Enter a target amount greater than zero.');
      return;
    }
    setError(null);
    onCreated({
      // Unique for the visit even if two goals share a name, so React keys and
      // the progress rings do not collide.
      id: `goal-${Date.now()}-${Math.round(target)}`,
      name: trimmedName,
      from: fromLabel.trim(),
      pct: 0,
      of: `US$0 of ${formatGoalTarget(Math.round(target))}`,
      eta: eta.trim(),
      color: NEW_GOAL_COLOR,
      etaClass: 'text-teal2',
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-[22px]">
        <DialogHeader>
          <DialogTitle id={titleId}>New goal</DialogTitle>
          <DialogDescription>
            Set a target and CCN will track your progress toward it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="demo-goal-name">Goal name</Label>
            <Input
              id="demo-goal-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Purchase a property"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="demo-goal-target">Target amount (US$)</Label>
            <Input
              id="demo-goal-target"
              inputMode="decimal"
              value={targetAmount}
              onChange={(event) => setTargetAmount(event.target.value)}
              placeholder="50000"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="demo-goal-from">Institution (optional)</Label>
            <Input
              id="demo-goal-from"
              value={fromLabel}
              onChange={(event) => setFromLabel(event.target.value)}
              placeholder="e.g. NCB · Sagicor"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="demo-goal-eta">Timeline (optional)</Label>
            <Input
              id="demo-goal-eta"
              value={eta}
              onChange={(event) => setEta(event.target.value)}
              placeholder="e.g. On track · mid-2028"
            />
          </div>

          {error && <InlineError message={error} />}

          <Button onClick={handleSubmit} size="lg" className="w-full">
            Create goal
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PlanningDashboard() {
  const [goals, setGoals] = useState<DemoGoal[]>(GOALS);
  const [newGoalOpen, setNewGoalOpen] = useState(false);

  return (
    <AppScreen active="planning" basePath="/demo">
      <PageHead
        eyebrow="Cover, retirement, property and legacy planning across borders"
        title="Planning"
      />

      <div data-tour="customer-planning">
        {/* The row that opened this screen showed a "Financial health 72 / 100",
            a US$120,000 "Protection gap" and a US$310,000 "Est. legacy value".
            There is no health score, no protection-gap model and no legacy
            projection anywhere in the product — not a table, not an endpoint,
            not a formula — which is why the live screen dropped all three. A
            preview that quotes three figures the product cannot compute
            promises a screen nobody can be given. Products and goals, which are
            real, open the screen on both surfaces now. */}
        <h2 className="mb-3.5 font-display text-[22px] font-bold">Recommended for you</h2>
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
                  questions from its script, which is the feel this preview
                  owes. `mt-auto` pins it to the card's foot as live does, so a
                  short description does not float its button mid-card next to
                  a long one. */}
              <Button variant="secondary" className="mt-auto w-full" asChild>
                <Link href="/demo/agent">Explore with agent</Link>
              </Button>
            </Card>
          ))}
        </div>

        <div className="mb-3.5 mt-7 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-[22px] font-bold">Your goals</h2>
          <Button variant="outline" size="sm" onClick={() => setNewGoalOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Add a goal
          </Button>
        </div>
        <div className="g3">
          {goals.map((g) => (
            <Card key={g.id} className="p-[22px]">
              <div className="mb-4 flex items-center gap-4">
                <Ring pct={g.pct} color={g.color} />
                <div>
                  <div className="text-base font-bold">{g.name}</div>
                  {/* Omitted rather than blank when a goal names no
                      institution, as live does. */}
                  {g.from ? <div className="text-[13px] text-faint">{g.from}</div> : null}
                </div>
              </div>
              <div className="border-t border-border pt-3">
                <div className="font-mono text-sm">{g.of}</div>
                {g.eta ? (
                  <div className={cn('mt-1 text-[13.5px] font-bold', g.etaClass)}>{g.eta}</div>
                ) : null}
              </div>
            </Card>
          ))}
        </div>

        <NewGoalDialog
          open={newGoalOpen}
          onOpenChange={setNewGoalOpen}
          onCreated={(goal) => setGoals((current) => [...current, goal])}
        />
      </div>
    </AppScreen>
  );
}
