'use client';

import { AppScreen, PageHead } from '@/app/_components/AppScreen';
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
import { EmptyState } from '@/app/_components/ui/empty';
import { Input } from '@/app/_components/ui/input';
import { Label } from '@/app/_components/ui/label';
import { SkeletonCard, SkeletonRegion } from '@/app/_components/ui/skeleton';
import { cn } from '@/app/_lib/utils';
import {
  type CreateGoalInput,
  type Goal,
  PlanningApiError,
  type PlanningProduct,
  type PlanningProductStatus,
  createGoal,
  formatUSDMinor,
  getGoals,
  getProducts,
} from '@/lib/planning-api';
import { CircleAlert, Plus, ShieldCheck, Target } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';

const STATUS_VARIANT: Record<PlanningProductStatus, BadgeProps['variant']> = {
  recommended: 'success',
  available: 'secondary',
  explore: 'terra',
};

const STATUS_LABEL: Record<PlanningProductStatus, string> = {
  recommended: 'Recommended',
  available: 'Available',
  explore: 'Explore',
};

/** Default ring/eta color when a product or goal carries none from the DB. */
const FALLBACK_COLOR = '#17786e';

/*
 * This screen opened with three figures: "Financial health 72 / 100 · Good · on
 * track", a "Protection gap" of US$120,000 and an "Est. legacy value" of
 * US$310,000. There is no health score, no protection-gap model and no legacy
 * projection anywhere in the product — not a table, not an endpoint, not a
 * formula — so all three are gone. Products and goals, which are real, now open
 * the screen.
 */

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

function InlineError({ message }: { message: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra">
      <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
      {message}
    </p>
  );
}

function NewGoalDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const titleId = useId();
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [fromLabel, setFromLabel] = useState('');
  const [eta, setEta] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setName('');
      setTargetAmount('');
      setFromLabel('');
      setEta('');
      setError(null);
      setBusy(false);
    }
  }, [open]);

  async function handleSubmit() {
    const trimmedName = name.trim();
    const target = Number(targetAmount);
    if (!trimmedName) {
      setError('Give your goal a name.');
      return;
    }
    if (!targetAmount || Number.isNaN(target) || target <= 0) {
      setError('Enter a target amount greater than zero.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const input: CreateGoalInput = {
        name: trimmedName,
        targetMinor: Math.round(target * 100),
      };
      if (fromLabel.trim()) input.fromLabel = fromLabel.trim();
      if (eta.trim()) input.eta = eta.trim();
      await createGoal(input);
      onCreated();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof PlanningApiError
          ? err.message
          : 'Could not create the goal. Please try again.',
      );
    } finally {
      setBusy(false);
    }
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
            <Label htmlFor="goal-name">Goal name</Label>
            <Input
              id="goal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Purchase a property"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="goal-target">Target amount (US$)</Label>
            <Input
              id="goal-target"
              inputMode="decimal"
              value={targetAmount}
              onChange={(e) => setTargetAmount(e.target.value)}
              placeholder="50000"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="goal-from">Institution (optional)</Label>
            <Input
              id="goal-from"
              value={fromLabel}
              onChange={(e) => setFromLabel(e.target.value)}
              placeholder="e.g. NCB · Sagicor"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="goal-eta">Timeline (optional)</Label>
            <Input
              id="goal-eta"
              value={eta}
              onChange={(e) => setEta(e.target.value)}
              placeholder="e.g. On track · mid-2028"
            />
          </div>

          {error && <InlineError message={error} />}

          <Button onClick={handleSubmit} disabled={busy} size="lg" className="w-full">
            {busy ? 'Creating…' : 'Create goal'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function PlanningPage() {
  const [products, setProducts] = useState<PlanningProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);

  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalsLoading, setGoalsLoading] = useState(true);
  const [goalsError, setGoalsError] = useState<string | null>(null);

  const [newGoalOpen, setNewGoalOpen] = useState(false);

  const loadGoals = useCallback(() => {
    setGoalsLoading(true);
    setGoalsError(null);
    return getGoals()
      .then(({ goals: rows }) => setGoals(rows))
      .catch((err) => {
        setGoalsError(err instanceof PlanningApiError ? err.message : 'Could not load your goals.');
      })
      .finally(() => setGoalsLoading(false));
  }, []);

  useEffect(() => {
    setProductsLoading(true);
    getProducts()
      .then(({ products: rows }) => setProducts(rows))
      .catch((err) => {
        setProductsError(
          err instanceof PlanningApiError ? err.message : 'Could not load planning products.',
        );
      })
      .finally(() => setProductsLoading(false));
  }, []);

  useEffect(() => {
    loadGoals();
  }, [loadGoals]);

  return (
    <AppScreen active="planning">
      <PageHead
        eyebrow="Cover, retirement, property and legacy planning across borders"
        title="Planning"
      />

      <div data-tour="customer-planning">
        <h2 className="mb-3.5 font-display text-[22px] font-bold">Recommended for you</h2>
        {productsError && (
          <div className="mb-3.5">
            <InlineError message={productsError} />
          </div>
        )}
        {productsLoading ? (
          // Two cards in the same `g2` grid the real products land in, so the
          // section holds its height and nothing below it moves when they arrive.
          <SkeletonRegion label="Loading recommended products" className="g2">
            <SkeletonCard lines={3} />
            <SkeletonCard lines={3} />
          </SkeletonRegion>
        ) : products.length === 0 && !productsError ? (
          <EmptyState
            icon={ShieldCheck}
            title="No planning products yet"
            body="Cover, retirement and legacy products from partner institutions will be listed here as they come online."
          />
        ) : (
          <div className="g2">
            {products.map((p) => (
              <Card key={p.id} className="p-[22px]">
                <div className="mb-3 flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-mint font-mono text-xs font-bold text-teal2">
                    {p.code}
                  </span>
                  <div className="flex-1">
                    <div className="text-base font-bold">{p.title}</div>
                    {p.provider && <div className="text-[13px] text-faint">{p.provider}</div>}
                  </div>
                  <Badge variant={STATUS_VARIANT[p.status] ?? 'secondary'}>
                    {STATUS_LABEL[p.status] ?? p.status}
                  </Badge>
                </div>
                {p.description && (
                  <p className="mb-4 text-sm leading-relaxed text-dim">{p.description}</p>
                )}
                {/* Was a button with no handler on every card. The agent is where
                  a question about a product actually goes. */}
                <Button variant="secondary" className="mt-auto w-full" asChild>
                  <Link href="/agent">Explore with agent</Link>
                </Button>
              </Card>
            ))}
          </div>
        )}

        <div className="mb-3.5 mt-7 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-[22px] font-bold">Your goals</h2>
          <Button variant="outline" size="sm" onClick={() => setNewGoalOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Add a goal
          </Button>
        </div>
        {goalsError && (
          <div className="mb-3.5">
            <InlineError message={goalsError} />
          </div>
        )}
        {goalsLoading ? (
          <SkeletonRegion label="Loading your goals" className="g3">
            <SkeletonCard lines={2} />
            <SkeletonCard lines={2} />
            <SkeletonCard lines={2} />
          </SkeletonRegion>
        ) : goals.length === 0 && !goalsError ? (
          <EmptyState
            icon={Target}
            title="No goals yet"
            body="Set a target, such as a home, a university fund or a retirement date, and CCN tracks your progress toward it."
            action={
              <Button variant="outline" onClick={() => setNewGoalOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                Add your first goal
              </Button>
            }
          />
        ) : (
          <div className="g3">
            {goals.map((g) => {
              const color = g.color ?? FALLBACK_COLOR;
              return (
                <Card key={g.id} className="p-[22px]">
                  <div className="mb-4 flex items-center gap-4">
                    <Ring pct={g.pct} color={color} />
                    <div>
                      <div className="text-base font-bold">{g.name}</div>
                      {g.fromLabel && <div className="text-[13px] text-faint">{g.fromLabel}</div>}
                    </div>
                  </div>
                  <div className="border-t border-border pt-3">
                    <div className="font-mono text-sm">
                      {formatUSDMinor(g.currentMinor)} of {formatUSDMinor(g.targetMinor)}
                    </div>
                    {/* A goal with no timeline set simply shows none. */}
                    {g.eta && (
                      <div className="mt-1 text-[13.5px] font-bold" style={{ color }}>
                        {g.eta}
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        <NewGoalDialog open={newGoalOpen} onOpenChange={setNewGoalOpen} onCreated={loadGoals} />
      </div>
    </AppScreen>
  );
}
