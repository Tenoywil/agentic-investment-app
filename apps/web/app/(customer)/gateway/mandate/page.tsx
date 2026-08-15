'use client';

import { AppScreen, PageHead } from '@/app/_components/AppScreen';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { Input } from '@/app/_components/ui/input';
import { Label } from '@/app/_components/ui/label';
import { Textarea } from '@/app/_components/ui/textarea';
import { cn } from '@/app/_lib/utils';
import {
  type Currency,
  GatewayApiError,
  type Mandate,
  type MandateExtraction,
  type Ordinal,
  type SaveMandateInput,
  extractMandate,
  getMandate,
  saveMandate,
} from '@/lib/gateway-api';
import { Check, CircleAlert, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';

const CHECK = 'h-[18px] w-[18px] accent-primary';
const LEGEND = 'mb-2.5 text-[13px] font-bold text-foreground';
const FIELD = 'mb-4 flex flex-col gap-1.5';
const ORDINALS: { value: Ordinal; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];
const CURRENCIES: Currency[] = ['USD', 'JMD', 'TTD', 'GYD', 'BBD', 'XCD', 'BSD'];

interface FormState {
  countries: string;
  sectors: string;
  stagePreferences: string;
  minCheck: string;
  maxCheck: string;
  riskAppetite: Ordinal | null;
  horizonYears: string;
  targetReturnPct: string;
  liquidityNeed: Ordinal | null;
  boardInvolvement: boolean;
  impactPreference: boolean;
  currency: Currency;
}

const EMPTY_FORM: FormState = {
  countries: '',
  sectors: '',
  stagePreferences: '',
  minCheck: '',
  maxCheck: '',
  riskAppetite: null,
  horizonYears: '',
  targetReturnPct: '',
  liquidityNeed: null,
  boardInvolvement: false,
  impactPreference: false,
  currency: 'USD',
};

function fromMandate(m: Mandate): FormState {
  return {
    countries: m.countries.join(', '),
    sectors: m.sectors.join(', '),
    stagePreferences: m.stagePreferences.join(', '),
    minCheck: String(Math.round(Number(m.minCheckMinor) / 100)),
    maxCheck: String(Math.round(Number(m.maxCheckMinor) / 100)),
    riskAppetite: m.riskAppetite,
    horizonYears: String(m.horizonYears),
    targetReturnPct: m.targetReturnPct,
    liquidityNeed: m.liquidityNeed,
    boardInvolvement: m.boardInvolvement,
    impactPreference: m.impactPreference,
    currency: m.currency,
  };
}

function fromExtraction(e: MandateExtraction): FormState {
  return {
    countries: e.countries.join(', '),
    sectors: e.sectors.join(', '),
    stagePreferences: e.stagePreferences.join(', '),
    minCheck: e.minCheckMinor != null ? String(Math.round(e.minCheckMinor / 100)) : '',
    maxCheck: e.maxCheckMinor != null ? String(Math.round(e.maxCheckMinor / 100)) : '',
    riskAppetite: e.riskAppetite,
    horizonYears: e.horizonYears != null ? String(e.horizonYears) : '',
    targetReturnPct: e.targetReturnPct != null ? String(e.targetReturnPct) : '',
    liquidityNeed: e.liquidityNeed,
    boardInvolvement: e.boardInvolvement ?? false,
    impactPreference: e.impactPreference ?? false,
    currency: e.currency ?? 'USD',
  };
}

function splitList(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Validates the form matches gatewayMandateSchema's constraints; returns the
 *  first problem found, or null when the form is ready to submit. */
function validate(f: FormState): string | null {
  const min = Number(f.minCheck);
  const max = Number(f.maxCheck);
  const horizon = Number(f.horizonYears);
  const target = Number(f.targetReturnPct);
  if (!f.minCheck || Number.isNaN(min) || min < 0) return 'Enter a minimum cheque size.';
  if (!f.maxCheck || Number.isNaN(max) || max < 0) return 'Enter a maximum cheque size.';
  if (max < min) return 'Maximum cheque size must be at least the minimum.';
  if (!f.riskAppetite) return 'Choose a risk appetite.';
  if (!f.liquidityNeed) return 'Choose a liquidity need.';
  if (!f.horizonYears || Number.isNaN(horizon) || horizon < 0)
    return 'Enter an investment horizon.';
  if (!f.targetReturnPct || Number.isNaN(target) || target < 0)
    return 'Enter a target annual return.';
  return null;
}

function toSaveInput(f: FormState): SaveMandateInput {
  return {
    countries: splitList(f.countries),
    sectors: splitList(f.sectors),
    stagePreferences: splitList(f.stagePreferences),
    minCheckMinor: Math.round(Number(f.minCheck) * 100),
    maxCheckMinor: Math.round(Number(f.maxCheck) * 100),
    // biome-ignore lint/style/noNonNullAssertion: guarded by validate() before this is called
    riskAppetite: f.riskAppetite!,
    horizonYears: Math.round(Number(f.horizonYears)),
    targetReturnPct: Number(f.targetReturnPct),
    // biome-ignore lint/style/noNonNullAssertion: guarded by validate() before this is called
    liquidityNeed: f.liquidityNeed!,
    boardInvolvement: f.boardInvolvement,
    impactPreference: f.impactPreference,
    currency: f.currency,
  };
}

function OrdinalGroup({
  name,
  value,
  onChange,
}: { name: string; value: Ordinal | null; onChange: (v: Ordinal) => void }) {
  return (
    <div className="flex gap-2.5">
      {ORDINALS.map((o) => (
        <label
          key={o.value}
          className={cn(
            'flex-1 cursor-pointer rounded-md border px-3 py-2.5 text-center text-sm font-semibold',
            value === o.value ? 'border-primary bg-mint text-teal2' : 'border-input text-dim',
          )}
        >
          <input
            type="radio"
            name={name}
            className="sr-only"
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function MandateForm({
  form,
  setForm,
  missingFields,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  missingFields?: string[];
}) {
  return (
    <div>
      {missingFields && missingFields.length > 0 && (
        <div className="mb-5 rounded-xl border border-[#ecd2c2] bg-[#fbeee7] px-4 py-3.5 text-[13.5px] leading-snug text-[#5c4636] dark:border-[#5a3f2e] dark:bg-[#2c1f17] dark:text-[#d3b8a4]">
          <div className="mb-1 flex items-center gap-2 font-bold uppercase tracking-[.4px]">
            <CircleAlert className="h-4 w-4 text-[#a44e20] dark:text-terra" aria-hidden />
            Not enough detail to fill these in
          </div>
          Please complete: {missingFields.join(', ')}
        </div>
      )}

      <div className={FIELD}>
        <Label htmlFor="countries">Countries (comma-separated)</Label>
        <Input
          id="countries"
          value={form.countries}
          onChange={(e) => setForm({ ...form, countries: e.target.value })}
          placeholder="Jamaica, Trinidad and Tobago"
        />
      </div>
      <div className={FIELD}>
        <Label htmlFor="sectors">Sectors (comma-separated)</Label>
        <Input
          id="sectors"
          value={form.sectors}
          onChange={(e) => setForm({ ...form, sectors: e.target.value })}
          placeholder="Renewable Energy, Technology"
        />
      </div>
      <div className={FIELD}>
        <Label htmlFor="stages">Stage preferences (comma-separated)</Label>
        <Input
          id="stages"
          value={form.stagePreferences}
          onChange={(e) => setForm({ ...form, stagePreferences: e.target.value })}
          placeholder="Growth, Series A"
        />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="minCheck">Minimum cheque (US$)</Label>
          <Input
            id="minCheck"
            inputMode="numeric"
            value={form.minCheck}
            onChange={(e) => setForm({ ...form, minCheck: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="maxCheck">Maximum cheque (US$)</Label>
          <Input
            id="maxCheck"
            inputMode="numeric"
            value={form.maxCheck}
            onChange={(e) => setForm({ ...form, maxCheck: e.target.value })}
          />
        </div>
      </div>

      <fieldset className="m-0 mb-4 min-w-0 border-0 p-0">
        <legend className={LEGEND}>Risk appetite</legend>
        <OrdinalGroup
          name="riskAppetite"
          value={form.riskAppetite}
          onChange={(v) => setForm({ ...form, riskAppetite: v })}
        />
      </fieldset>

      <fieldset className="m-0 mb-4 min-w-0 border-0 p-0">
        <legend className={LEGEND}>Liquidity need</legend>
        <OrdinalGroup
          name="liquidityNeed"
          value={form.liquidityNeed}
          onChange={(v) => setForm({ ...form, liquidityNeed: v })}
        />
      </fieldset>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="horizon">Horizon (years)</Label>
          <Input
            id="horizon"
            inputMode="numeric"
            value={form.horizonYears}
            onChange={(e) => setForm({ ...form, horizonYears: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="return">Target annual return (%)</Label>
          <Input
            id="return"
            inputMode="decimal"
            value={form.targetReturnPct}
            onChange={(e) => setForm({ ...form, targetReturnPct: e.target.value })}
          />
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-1.5">
        {/* A dropdown, not a chip row: seven currencies as flex-1 radio chips
            wrapped badly on a phone and crowded even on a desktop. */}
        <Label htmlFor="mandate-currency">Currency</Label>
        <select
          id="mandate-currency"
          value={form.currency}
          onChange={(e) => setForm({ ...form, currency: e.target.value as Currency })}
          className="h-10 w-full max-w-[220px] rounded-md border border-solid border-input bg-card px-3 text-sm font-semibold text-foreground"
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className={LEGEND}>Preferences</legend>
        <label className="mb-2.5 flex cursor-pointer items-center gap-2.5 text-[14.5px] text-foreground">
          <input
            type="checkbox"
            className={CHECK}
            checked={form.boardInvolvement}
            onChange={(e) => setForm({ ...form, boardInvolvement: e.target.checked })}
          />
          I want board involvement
        </label>
        <label className="flex cursor-pointer items-center gap-2.5 text-[14.5px] text-foreground">
          <input
            type="checkbox"
            className={CHECK}
            checked={form.impactPreference}
            onChange={(e) => setForm({ ...form, impactPreference: e.target.checked })}
          />
          I prefer opportunities with impact focus
        </label>
      </fieldset>
    </div>
  );
}

type Stage = 'loading' | 'narrative' | 'confirm' | 'edit';

export default function GatewayMandatePage() {
  const [stage, setStage] = useState<Stage>('loading');
  const [narrative, setNarrative] = useState('');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    getMandate()
      .then(({ mandate }) => {
        if (mandate) {
          setForm(fromMandate(mandate));
          setNarrative(mandate.narrative ?? '');
          setStage('edit');
        } else {
          setStage('narrative');
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Could not load your mandate.');
        setStage('narrative');
      });
  }, []);

  async function handleExtract() {
    if (narrative.trim().length < 10) {
      setError('Describe your mandate in at least a sentence or two.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { extraction } = await extractMandate(narrative.trim());
      setForm(fromExtraction(extraction));
      setMissingFields(extraction.missingFields);
      setStage('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The agent is temporarily unavailable.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    const problem = validate(form);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { mandate } = await saveMandate(toSaveInput(form));
      setForm(fromMandate(mandate));
      setStage('edit');
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your mandate.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppScreen active="gatewayMandate">
      <PageHead
        eyebrow="Caribbean Capital Gateway · private-deal matching"
        title="Your investor mandate"
      />

      <Card className="mx-auto max-w-[620px] p-8">
        {stage === 'loading' && <p className="text-sm text-dim">Loading your mandate…</p>}

        {stage === 'narrative' && (
          <div>
            <p className="mb-4 text-[15px] leading-relaxed text-dim">
              Describe what you're looking for in a sentence or two — country, sector, cheque size,
              risk appetite, anything that matters to you. The agent drafts a structured mandate for
              you to review before anything is saved.
            </p>
            <div className={FIELD}>
              <Label htmlFor="narrative">Your mandate, in your own words</Label>
              <Textarea
                id="narrative"
                value={narrative}
                onChange={(e) => setNarrative(e.target.value)}
                placeholder="I'm looking to put US$10,000–500,000 into growth-stage renewable energy or tech deals in Jamaica and Trinidad, medium risk, 5+ year horizon…"
                rows={5}
              />
            </div>
            {error && (
              <p className="mb-4 flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra">
                <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
                {error}
              </p>
            )}
            <Button onClick={handleExtract} disabled={busy} size="lg" className="w-full">
              <Sparkles className="h-4 w-4" aria-hidden />
              {busy ? 'Reading your description…' : 'Draft my mandate'}
            </Button>
          </div>
        )}

        {(stage === 'confirm' || stage === 'edit') && (
          <div>
            {stage === 'confirm' && (
              <p className="mb-5 text-[15px] leading-relaxed text-dim">
                Here's what the agent drew from your description. Review and edit before saving —
                nothing is guessed silently.
              </p>
            )}
            <MandateForm
              form={form}
              setForm={setForm}
              missingFields={stage === 'confirm' ? missingFields : undefined}
            />
            {error && (
              <p className="mb-4 mt-1 flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra">
                <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
                {error}
              </p>
            )}
            {savedAt && stage === 'edit' && !error && (
              <p className="mb-4 flex items-center gap-2 text-sm text-success">
                <Check className="h-4 w-4 flex-none" aria-hidden />
                Mandate saved.
              </p>
            )}
            <div className="mt-2 flex gap-2.5">
              {stage === 'edit' && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setStage('narrative');
                    setError(null);
                  }}
                >
                  Describe again
                </Button>
              )}
              <Button onClick={handleSave} disabled={busy} size="lg" className="flex-1">
                {busy ? 'Saving…' : 'Save mandate'}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </AppScreen>
  );
}
