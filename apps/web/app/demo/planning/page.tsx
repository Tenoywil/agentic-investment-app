'use client';

import { AppScreen, DemoJourney, PageHead } from '@/app/_components/AppScreen';
import { Badge, type BadgeProps } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { cn } from '@/app/_lib/utils';
import { CheckCircle2, Pencil, UserRoundCheck } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

const DEMO_PROFILE_STORAGE_KEY = 'ccn-demo-investor-profile';

type DemoProfile = {
  name: string;
  residence: string;
  age: string;
  objective: string;
  horizon: string;
  risk: string;
  liquidity: string;
  financialSituation: string;
  jamaicanCitizen: boolean;
  usCitizen: boolean;
};

const DEFAULT_PROFILE: DemoProfile = {
  name: 'Marcus Bailey',
  residence: 'United States',
  age: '35–44',
  objective: 'Income and long-term growth',
  horizon: '5–10 years',
  risk: 'Balanced',
  liquidity: 'Monthly access',
  financialSituation: 'Stable income; six-month cash reserve',
  jamaicanCitizen: true,
  usCitizen: true,
};

function citizenshipLabel(profile: DemoProfile): string {
  if (profile.jamaicanCitizen && profile.usCitizen) return 'Jamaica + US citizen';
  if (profile.jamaicanCitizen) return 'Jamaican citizen';
  if (profile.usCitizen) return 'US citizen';
  return 'citizenship not selected';
}

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
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [profile, setProfile] = useState<DemoProfile>(DEFAULT_PROFILE);
  const [savedProfile, setSavedProfile] = useState<DemoProfile>(DEFAULT_PROFILE);

  useEffect(() => {
    const stored = window.sessionStorage.getItem(DEMO_PROFILE_STORAGE_KEY);
    if (!stored) return;
    try {
      const restored = { ...DEFAULT_PROFILE, ...(JSON.parse(stored) as Partial<DemoProfile>) };
      setProfile(restored);
      setSavedProfile(restored);
      setSaved(true);
    } catch {
      window.sessionStorage.removeItem(DEMO_PROFILE_STORAGE_KEY);
    }
  }, []);

  function saveProfile() {
    setSavedProfile(profile);
    window.sessionStorage.setItem(DEMO_PROFILE_STORAGE_KEY, JSON.stringify(profile));
    setEditing(false);
    setSaved(true);
  }

  function toggleEditing() {
    if (editing) {
      setProfile(savedProfile);
      setEditing(false);
      return;
    }
    setEditing(true);
  }

  return (
    <AppScreen active="planning" basePath="/demo">
      <PageHead
        eyebrow="Scripted sign-in, investor profile and fact-find · about 45 seconds"
        title="Meet Marcus"
      />

      <DemoJourney current="profile" />

      <section id="profile" aria-labelledby="profile-heading" className="mb-7">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="profile-heading" className="font-display text-[22px] font-bold">
              Let’s get to know you better
            </h2>
            <p className="mb-0 mt-1 text-sm text-dim">
              Signed in with Google · marcus.bailey@example.invalid · sample identity only
            </p>
          </div>
          <Button variant={editing ? 'outline' : 'secondary'} onClick={toggleEditing}>
            <Pencil className="h-4 w-4" aria-hidden />
            {editing ? 'Cancel editing' : 'Edit profile'}
          </Button>
        </div>

        <Card className="p-5 sm:p-6">
          <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-border pb-5">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-primary font-display text-lg font-bold text-white">
              MB
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-display text-xl font-bold">{profile.name}</div>
              <div className="text-sm text-dim">
                {profile.residence} resident · {citizenshipLabel(profile)}
              </div>
            </div>
            <Badge variant="success">
              <UserRoundCheck className="h-3.5 w-3.5" aria-hidden /> Fact-find complete
            </Badge>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ProfileField id="marcus-full-name" label="Full name">
              <input
                id="marcus-full-name"
                value={profile.name}
                onChange={(event) =>
                  setProfile((current) => ({ ...current, name: event.target.value }))
                }
                disabled={!editing}
                className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm disabled:cursor-default disabled:opacity-100"
              />
            </ProfileField>
            <ProfileSelect
              label="Residency"
              value={profile.residence}
              disabled={!editing}
              options={['United States', 'Canada', 'United Kingdom', 'Jamaica']}
              onChange={(value) => setProfile((current) => ({ ...current, residence: value }))}
            />
            <ProfileSelect
              label="Age group"
              value={profile.age}
              disabled={!editing}
              options={['25–34', '35–44', '45–54', '55+']}
              onChange={(value) => setProfile((current) => ({ ...current, age: value }))}
            />
            <ProfileSelect
              label="Investment objective"
              value={profile.objective}
              disabled={!editing}
              options={[
                'Income and long-term growth',
                'Capital preservation',
                'Growth',
                'Retirement income',
              ]}
              onChange={(value) => setProfile((current) => ({ ...current, objective: value }))}
            />
            <ProfileSelect
              label="Time horizon"
              value={profile.horizon}
              disabled={!editing}
              options={['Under 3 years', '3–5 years', '5–10 years', '10+ years']}
              onChange={(value) => setProfile((current) => ({ ...current, horizon: value }))}
            />
            <ProfileSelect
              label="Risk appetite"
              value={profile.risk}
              disabled={!editing}
              options={['Conservative', 'Balanced', 'Growth']}
              onChange={(value) => setProfile((current) => ({ ...current, risk: value }))}
            />
            <ProfileSelect
              label="Liquidity need"
              value={profile.liquidity}
              disabled={!editing}
              options={['Weekly access', 'Monthly access', 'Can lock for 3 years']}
              onChange={(value) => setProfile((current) => ({ ...current, liquidity: value }))}
            />
            <ProfileField id="marcus-financial-situation" label="Financial situation">
              <input
                id="marcus-financial-situation"
                value={profile.financialSituation}
                onChange={(event) =>
                  setProfile((current) => ({ ...current, financialSituation: event.target.value }))
                }
                disabled={!editing}
                className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm disabled:cursor-default disabled:opacity-100"
              />
            </ProfileField>
            <fieldset className="rounded-xl border border-border p-3">
              <legend className="px-1 text-xs font-bold uppercase tracking-[.5px] text-faint">
                Citizenship · select all
              </legend>
              <div className="mt-1 flex flex-wrap gap-4">
                <ProfileCheckbox
                  label="🇯🇲 Jamaica"
                  checked={profile.jamaicanCitizen}
                  disabled={!editing}
                  onChange={(checked) =>
                    setProfile((current) => ({ ...current, jamaicanCitizen: checked }))
                  }
                />
                <ProfileCheckbox
                  label="🇺🇸 United States"
                  checked={profile.usCitizen}
                  disabled={!editing}
                  onChange={(checked) =>
                    setProfile((current) => ({ ...current, usCitizen: checked }))
                  }
                />
              </div>
            </fieldset>
          </div>

          {editing ? (
            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-5">
              <Button onClick={saveProfile}>Save and re-run matching</Button>
              <span className="text-sm text-dim">
                Changes flow to the research and suitability agents.
              </span>
            </div>
          ) : (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
              <output className="m-0 flex items-center gap-2 text-sm text-success-ink">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                {saved
                  ? 'Profile saved and matches refreshed.'
                  : 'Profile ready for research and matching.'}
              </output>
              <Button asChild>
                <Link href="/demo/opportunities">See Marcus’s matches</Link>
              </Button>
            </div>
          )}
        </Card>
      </section>

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

function ProfileField({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-xs font-bold uppercase tracking-[.5px] text-faint">
        {label}
      </label>
      {children}
    </div>
  );
}

function ProfileSelect({
  label,
  value,
  disabled,
  options,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  options: string[];
  onChange: (value: string) => void;
}) {
  const id = `profile-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`;
  return (
    <ProfileField id={id} label={label}>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-normal normal-case tracking-normal text-foreground disabled:cursor-default disabled:opacity-100"
      >
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </ProfileField>
  );
}

function ProfileCheckbox({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-foreground">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-primary disabled:opacity-100"
      />
      {label}
    </label>
  );
}
