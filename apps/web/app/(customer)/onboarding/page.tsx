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
  type KycDocument,
  type KycStatus,
  type SourceOfFunds,
  formatRiskBand,
  getKycDocuments,
  getOnboardingStatus,
  submitCompliance,
  submitFunds,
  submitIdentity,
  submitRisk,
  uploadKycDocument,
} from '@/lib/onboarding-api';
import { ArrowRight, Check, CircleAlert, FileText, ShieldCheck } from 'lucide-react';
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
  'Verification is performed by licensed partners, who carry the regulatory duty. With your consent, CCN shares these intake details only with the partner reviewing you or executing your trade.',
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
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [placeOfBirth, setPlaceOfBirth] = useState('');
  const [residentialAddress, setResidentialAddress] = useState('');
  const [citizenships, setCitizenships] = useState('');
  const [occupation, setOccupation] = useState('');
  const [employer, setEmployer] = useState('');
  const [pepStatus, setPepStatus] = useState<'none' | 'self' | 'family' | 'close_associate'>(
    'none',
  );
  const [taxCountry, setTaxCountry] = useState('');
  const [taxIdType, setTaxIdType] = useState<'trn' | 'ssn' | 'tin' | 'national_id' | 'other'>(
    'tin',
  );
  const [taxIdentifier, setTaxIdentifier] = useState('');
  const [fatcaStatus, setFatcaStatus] = useState<'us_person' | 'non_us_person' | 'undetermined'>(
    'undetermined',
  );
  const [fatcaForm, setFatcaForm] = useState<'w9' | 'w8ben' | 'not_applicable'>('not_applicable');
  const [declared, setDeclared] = useState<boolean[]>(DECLARATIONS.map(() => false));
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [sources, setSources] = useState<Record<string, boolean>>({ salary: true });
  const [sourceOfWealth, setSourceOfWealth] = useState('');
  const [accountPurpose, setAccountPurpose] = useState('Long-term investing');
  const [expectedAnnualInvestment, setExpectedAnnualInvestment] = useState('');
  const [expectedFrequency, setExpectedFrequency] = useState<
    'one_off' | 'monthly' | 'quarterly' | 'annually' | 'irregular'
  >('monthly');
  // Source of truth for the Done step — set from /status on resume, or from
  // submitRisk()'s response when the step is completed live in this session.
  const [serverBand, setServerBand] = useState<string | null>(null);
  // The legacy API field is named identityVerified, but today it records only
  // that the person completed identity intake. The licensed partner owns actual
  // document verification and the final KYC decision.
  const [identityIntakeRecorded, setIdentityIntakeRecorded] = useState(false);

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
        if (status?.identityVerified) setIdentityIntakeRecorded(true);
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

  /**
   * Only the affirmations gate the step. The PEP item is a disclosure — being
   * one is not disqualifying, it is something the firm carrying the KYC
   * obligation has to be told — so requiring it ticked would once again make
   * "not a PEP" the only way through.
   */
  const allDeclared = DECLARATIONS.every((d, i) => !d.mustBeTrue || declared[i] === true);
  const riskComplete = scores.length === RISK_QUESTIONS.length;
  const hasSource = Object.values(sources).some(Boolean);
  const identityComplete =
    fullName.trim() !== '' &&
    dateOfBirth !== '' &&
    placeOfBirth.trim() !== '' &&
    residentialAddress.trim() !== '' &&
    country.trim() !== '' &&
    citizenships.split(',').some((value) => value.trim() !== '') &&
    occupation.trim() !== '';
  const complianceComplete =
    allDeclared &&
    taxCountry.trim() !== '' &&
    taxIdentifier.trim() !== '' &&
    fatcaStatus !== 'undetermined';
  const fundsComplete =
    hasSource &&
    sourceOfWealth.trim() !== '' &&
    accountPurpose.trim() !== '' &&
    /^\d+(\.\d{1,2})?$/.test(expectedAnnualInvestment);

  const canContinue = !(
    (step === 0 && !identityComplete) ||
    (step === 1 && !complianceComplete) ||
    (step === 2 && !riskComplete) ||
    (step === LAST && !fundsComplete)
  );

  const continueLabel = ['Start identity intake', 'Continue', 'Continue', 'Confirm & finish'][step];

  async function handleContinue() {
    setError(null);
    if (step === 0) {
      const name = fullName.trim();
      const residencyCountry = country.trim();
      const occ = occupation.trim();
      if (!identityComplete) {
        setError('Complete every identity, address, residence and citizenship field.');
        return;
      }
      setBusy(true);
      try {
        await submitIdentity({
          fullName: name,
          dateOfBirth,
          placeOfBirth: placeOfBirth.trim(),
          residentialAddress: residentialAddress.trim(),
          residencyCountry,
          citizenships: citizenships
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          occupation: occ,
          employer: employer.trim() || undefined,
        });
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
        await submitCompliance({
          pepStatus,
          taxResidencies: [
            {
              country: taxCountry.trim(),
              identifierType: taxIdType,
              identifier: taxIdentifier.trim(),
            },
          ],
          fatcaStatus,
          fatcaForm,
        });
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
        const [whole = '0', fraction = ''] = expectedAnnualInvestment.split('.');
        const expectedAnnualInvestmentMinor = `${whole}${fraction.padEnd(2, '0')}`.replace(
          /^0+(?=\d)/,
          '',
        );
        await submitFunds({
          sources: chosen,
          sourceOfWealth: sourceOfWealth.trim(),
          accountPurpose: accountPurpose.trim(),
          expectedAnnualInvestmentMinor,
          expectedFrequency,
        });
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
                Partner-reviewed onboarding · your agent structures the evidence
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
                  dateOfBirth={dateOfBirth}
                  onDateOfBirthChange={setDateOfBirth}
                  placeOfBirth={placeOfBirth}
                  onPlaceOfBirthChange={setPlaceOfBirth}
                  residentialAddress={residentialAddress}
                  onResidentialAddressChange={setResidentialAddress}
                  citizenships={citizenships}
                  onCitizenshipsChange={setCitizenships}
                  occupation={occupation}
                  onOccupationChange={setOccupation}
                  employer={employer}
                  onEmployerChange={setEmployer}
                  recorded={identityIntakeRecorded}
                />
              ) : null}
              {step === 1 ? (
                <ComplianceStep
                  declared={declared}
                  onToggle={(i, v) => setDeclared((d) => d.map((x, j) => (j === i ? v : x)))}
                  pepStatus={pepStatus}
                  onPepStatusChange={setPepStatus}
                  taxCountry={taxCountry}
                  onTaxCountryChange={setTaxCountry}
                  taxIdType={taxIdType}
                  onTaxIdTypeChange={setTaxIdType}
                  taxIdentifier={taxIdentifier}
                  onTaxIdentifierChange={setTaxIdentifier}
                  fatcaStatus={fatcaStatus}
                  onFatcaStatusChange={setFatcaStatus}
                  fatcaForm={fatcaForm}
                  onFatcaFormChange={setFatcaForm}
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
                  sourceOfWealth={sourceOfWealth}
                  onSourceOfWealthChange={setSourceOfWealth}
                  accountPurpose={accountPurpose}
                  onAccountPurposeChange={setAccountPurpose}
                  expectedAnnualInvestment={expectedAnnualInvestment}
                  onExpectedAnnualInvestmentChange={setExpectedAnnualInvestment}
                  expectedFrequency={expectedFrequency}
                  onExpectedFrequencyChange={setExpectedFrequency}
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
 *  the intake is already complete. */
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
  dateOfBirth,
  onDateOfBirthChange,
  placeOfBirth,
  onPlaceOfBirthChange,
  residentialAddress,
  onResidentialAddressChange,
  citizenships,
  onCitizenshipsChange,
  occupation,
  onOccupationChange,
  employer,
  onEmployerChange,
  recorded,
}: {
  fullName: string;
  onFullNameChange: (v: string) => void;
  country: string;
  onCountryChange: (v: string) => void;
  dateOfBirth: string;
  onDateOfBirthChange: (v: string) => void;
  placeOfBirth: string;
  onPlaceOfBirthChange: (v: string) => void;
  residentialAddress: string;
  onResidentialAddressChange: (v: string) => void;
  citizenships: string;
  onCitizenshipsChange: (v: string) => void;
  occupation: string;
  onOccupationChange: (v: string) => void;
  employer: string;
  onEmployerChange: (v: string) => void;
  recorded: boolean;
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
          <Label htmlFor="date-of-birth">Date of birth</Label>
          <Input
            id="date-of-birth"
            type="date"
            value={dateOfBirth}
            onChange={(e) => onDateOfBirthChange(e.target.value)}
            autoComplete="bday"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="place-of-birth">Place of birth</Label>
          <Input
            id="place-of-birth"
            value={placeOfBirth}
            onChange={(e) => onPlaceOfBirthChange(e.target.value)}
            placeholder="City and country"
          />
        </div>
      </div>
      <div className="mb-4 flex flex-col gap-1.5">
        <Label htmlFor="residential-address">Residential address</Label>
        <Input
          id="residential-address"
          value={residentialAddress}
          onChange={(e) => onResidentialAddressChange(e.target.value)}
          autoComplete="street-address"
          placeholder="Full current residential address"
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
          <Label htmlFor="citizenships">Citizenship(s)</Label>
          <Input
            id="citizenships"
            value={citizenships}
            onChange={(e) => onCitizenshipsChange(e.target.value)}
            placeholder="Jamaica, Canada"
          />
          <span className="text-xs text-faint">Separate dual citizenships with commas.</span>
        </div>
      </div>
      <div className="mb-4 flex flex-col gap-4 sm:flex-row">
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
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="employer">Employer (if applicable)</Label>
          <Input
            id="employer"
            value={employer}
            onChange={(e) => onEmployerChange(e.target.value)}
            autoComplete="organization"
          />
        </div>
      </div>
      {recorded ? (
        <Callout>Identity intake recorded · ready to share with a partner you choose</Callout>
      ) : null}
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
  pepStatus,
  onPepStatusChange,
  taxCountry,
  onTaxCountryChange,
  taxIdType,
  onTaxIdTypeChange,
  taxIdentifier,
  onTaxIdentifierChange,
  fatcaStatus,
  onFatcaStatusChange,
  fatcaForm,
  onFatcaFormChange,
}: {
  declared: boolean[];
  onToggle: (i: number, v: boolean) => void;
  pepStatus: 'none' | 'self' | 'family' | 'close_associate';
  onPepStatusChange: (v: 'none' | 'self' | 'family' | 'close_associate') => void;
  taxCountry: string;
  onTaxCountryChange: (v: string) => void;
  taxIdType: 'trn' | 'ssn' | 'tin' | 'national_id' | 'other';
  onTaxIdTypeChange: (v: 'trn' | 'ssn' | 'tin' | 'national_id' | 'other') => void;
  taxIdentifier: string;
  onTaxIdentifierChange: (v: string) => void;
  fatcaStatus: 'us_person' | 'non_us_person' | 'undetermined';
  onFatcaStatusChange: (v: 'us_person' | 'non_us_person' | 'undetermined') => void;
  fatcaForm: 'w9' | 'w8ben' | 'not_applicable';
  onFatcaFormChange: (v: 'w9' | 'w8ben' | 'not_applicable') => void;
}) {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="sr-only">Declarations</legend>
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pep-status">Politically exposed person status</Label>
          <Select
            value={pepStatus}
            onValueChange={(value) => onPepStatusChange(value as typeof pepStatus)}
          >
            <SelectTrigger id="pep-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not a PEP</SelectItem>
              <SelectItem value="self">I am a PEP</SelectItem>
              <SelectItem value="family">Family member of a PEP</SelectItem>
              <SelectItem value="close_associate">Close associate of a PEP</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tax-country">Tax residence</Label>
          <Input
            id="tax-country"
            value={taxCountry}
            onChange={(e) => onTaxCountryChange(e.target.value)}
            placeholder="Country"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tax-id-type">Tax identifier type</Label>
          <Select
            value={taxIdType}
            onValueChange={(value) => onTaxIdTypeChange(value as typeof taxIdType)}
          >
            <SelectTrigger id="tax-id-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="trn">TRN</SelectItem>
              <SelectItem value="ssn">SSN</SelectItem>
              <SelectItem value="tin">TIN</SelectItem>
              <SelectItem value="national_id">National ID</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tax-identifier">TRN / SSN / TIN</Label>
          <Input
            id="tax-identifier"
            type="password"
            value={taxIdentifier}
            onChange={(e) => onTaxIdentifierChange(e.target.value)}
            autoComplete="off"
          />
          <span className="text-xs text-faint">Encrypted before storage.</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fatca-status">FATCA status</Label>
          <Select
            value={fatcaStatus}
            onValueChange={(value) => onFatcaStatusChange(value as typeof fatcaStatus)}
          >
            <SelectTrigger id="fatca-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="undetermined">Select status</SelectItem>
              <SelectItem value="us_person">U.S. person</SelectItem>
              <SelectItem value="non_us_person">Not a U.S. person</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fatca-form">Tax form</Label>
          <Select
            value={fatcaForm}
            onValueChange={(value) => onFatcaFormChange(value as typeof fatcaForm)}
          >
            <SelectTrigger id="fatca-form">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="w9">W-9</SelectItem>
              <SelectItem value="w8ben">W-8BEN</SelectItem>
              <SelectItem value="not_applicable">Not yet provided</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-[11px]">
        {DECLARATIONS.map((d, i) => (
          <ToggleRow
            key={d.id}
            checked={declared[i] ?? false}
            onChange={(v) => onToggle(i, v)}
            label={d.text}
          />
        ))}
      </div>
    </fieldset>
  );
}

function FundsStep({
  sources,
  onToggle,
  sourceOfWealth,
  onSourceOfWealthChange,
  accountPurpose,
  onAccountPurposeChange,
  expectedAnnualInvestment,
  onExpectedAnnualInvestmentChange,
  expectedFrequency,
  onExpectedFrequencyChange,
}: {
  sources: Record<string, boolean>;
  onToggle: (id: string, v: boolean) => void;
  sourceOfWealth: string;
  onSourceOfWealthChange: (v: string) => void;
  accountPurpose: string;
  onAccountPurposeChange: (v: string) => void;
  expectedAnnualInvestment: string;
  onExpectedAnnualInvestmentChange: (v: string) => void;
  expectedFrequency: 'one_off' | 'monthly' | 'quarterly' | 'annually' | 'irregular';
  onExpectedFrequencyChange: (
    v: 'one_off' | 'monthly' | 'quarterly' | 'annually' | 'irregular',
  ) => void;
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
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="source-of-wealth">Source of wealth</Label>
          <Input
            id="source-of-wealth"
            value={sourceOfWealth}
            onChange={(e) => onSourceOfWealthChange(e.target.value)}
            placeholder="How your overall wealth was accumulated"
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="account-purpose">Purpose of this account</Label>
          <Input
            id="account-purpose"
            value={accountPurpose}
            onChange={(e) => onAccountPurposeChange(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="expected-annual">Expected annual investment (USD)</Label>
          <Input
            id="expected-annual"
            inputMode="decimal"
            value={expectedAnnualInvestment}
            onChange={(e) => onExpectedAnnualInvestmentChange(e.target.value)}
            placeholder="12000"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="expected-frequency">Expected frequency</Label>
          <Select
            value={expectedFrequency}
            onValueChange={(value) => onExpectedFrequencyChange(value as typeof expectedFrequency)}
          >
            <SelectTrigger id="expected-frequency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="one_off">One-off</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="quarterly">Quarterly</SelectItem>
              <SelectItem value="annually">Annually</SelectItem>
              <SelectItem value="irregular">Irregular</SelectItem>
            </SelectContent>
          </Select>
        </div>
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

/**
 * What actually happened, and what happens next.
 *
 * This card used to announce "You're verified · Tier 2" and tick "Identity
 * verified (KYC · Tier 2)". Nothing had been verified: the legacy
 * `identity_verified` field becomes true after a typed name, country and
 * occupation. Optional documents can support the licensed firm's later review,
 * but CCN has no IDV or liveness provider and does not own the KYC decision.
 *
 * So the screen said the one thing the whole architecture is careful not to
 * claim. What the person has really done is complete an intake record, and
 * what they are really waiting on is a firm accepting them — which is the next
 * thing they will hit, and worth telling them now rather than at the point it
 * blocks them.
 *
 * The suitability band falls back to nothing rather than to "High Moderate". A
 * band is the output of the three answers they just gave; printing a default
 * when the server did not return one shows somebody a risk profile they were
 * never assessed for.
 */
function DoneStep({ band }: { band: string }) {
  const steps = [
    'Identity details recorded',
    band ? `Suitability: ${band} profile` : 'Suitability assessed from your answers',
    'Source of funds declared',
  ];

  return (
    <div className="py-3.5 text-center">
      <span className="mx-auto mb-[18px] grid h-[72px] w-[72px] place-items-center rounded-full bg-mint">
        <Check className="h-[38px] w-[38px] text-success" aria-hidden />
      </span>
      <h1 className="font-display text-[23px] font-bold tracking-tight">Your details are in</h1>
      <p className="mx-auto mt-2.5 max-w-[400px] text-[15px] leading-relaxed text-dim">
        Connect an account at a licensed partner next. They verify your identity and accept you as
        their client — CCN never holds your money and does not carry out KYC itself.
      </p>
      <ul className="mx-auto mt-5 flex max-w-[360px] list-none flex-col gap-2 p-0 text-left">
        {steps.map((item) => (
          <li key={item} className="flex items-center gap-2.5 text-[14.5px] text-foreground">
            <Check className="h-4 w-4 flex-none text-success" aria-hidden />
            {item}
          </li>
        ))}
      </ul>
      <DocumentUploads />
      <Button asChild className="mt-6">
        <Link href="/portfolio">Connect an account</Link>
      </Button>
    </div>
  );
}

/** What each upload slot asks for, in the reader's words. `compliance` is the
 *  address-and-tax step, so it holds the proof-of-address document. */
const DOC_SLOTS: {
  step: KycDocument['step'];
  documentType: NonNullable<KycDocument['documentType']>;
  label: string;
  hint: string;
}[] = [
  {
    step: 'identity',
    documentType: 'government_id',
    label: 'Photo ID',
    hint: 'Passport or national ID',
  },
  {
    step: 'compliance',
    documentType: 'proof_of_address',
    label: 'Proof of address',
    hint: 'Utility bill or bank statement',
  },
  {
    step: 'funds',
    documentType: 'source_of_funds',
    label: 'Source of funds',
    hint: 'Payslip or account statement',
  },
  { step: 'compliance', documentType: 'tax_form', label: 'FATCA tax form', hint: 'W-9 or W-8BEN' },
];

/**
 * Optional document uploads, offered at the moment they become useful: the
 * next thing that happens is a firm reviewing this person, and a reviewer
 * with documents to look at decides faster than one with declarations alone.
 * Optional because CCN is not the KYC owner — the firm may collect its own.
 */
function DocumentUploads() {
  const [docs, setDocs] = useState<KycDocument[]>([]);
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getKycDocuments()
      .then((r) => setDocs(r.documents))
      .catch(() => {});
  }, []);

  async function onPick(
    step: KycDocument['step'],
    documentType: NonNullable<KycDocument['documentType']>,
    file: File | undefined,
  ) {
    if (!file) return;
    setBusyStep(documentType);
    setError(null);
    try {
      const { id } = await uploadKycDocument({ step, documentType, file });
      setDocs((ds) => [
        {
          id,
          step,
          documentType,
          label: file.name,
          mime: file.type,
          issuingCountry: null,
          expiresAt: null,
          createdAt: new Date().toISOString(),
        },
        ...ds,
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload that file.');
    } finally {
      setBusyStep(null);
    }
  }

  return (
    <div className="mx-auto mt-6 max-w-[400px] rounded-xl bg-[#f4f0e7] px-4 py-4 text-left dark:bg-white/[0.04]">
      <b className="font-display text-[14.5px]">Speed up the firm&rsquo;s review</b>
      <p className="mb-3 mt-1 text-[12.5px] leading-relaxed text-dim">
        Optional. The firm you connect to reviews you before accepting — documents give their desk
        something to verify against. JPG, PNG or PDF, up to 2MB each.
      </p>
      <div className="flex flex-col gap-2">
        {DOC_SLOTS.map((slot) => {
          const uploaded = docs.find((d) => d.documentType === slot.documentType);
          return (
            <label
              key={slot.documentType}
              className="flex cursor-pointer items-center gap-2.5 rounded-[10px] border border-solid border-border bg-card px-3 py-2.5"
            >
              {uploaded ? (
                <Check className="h-4 w-4 flex-none text-success" aria-hidden />
              ) : (
                <FileText className="h-4 w-4 flex-none text-faint" aria-hidden />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-bold">{slot.label}</span>
                <span className="block truncate text-[12px] text-faint">
                  {uploaded ? uploaded.label : slot.hint}
                </span>
              </span>
              <span className="text-[12.5px] font-bold text-teal2">
                {busyStep === slot.documentType ? 'Uploading…' : uploaded ? 'Replace' : 'Add'}
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="sr-only"
                disabled={busyStep !== null}
                onChange={(e) => {
                  void onPick(slot.step, slot.documentType, e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          );
        })}
      </div>
      {error ? (
        <p className="mb-0 mt-2 flex items-center gap-1.5 text-[12.5px] text-[#a44e20] dark:text-terra">
          <CircleAlert className="h-3.5 w-3.5 flex-none" aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}
