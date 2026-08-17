'use client';

import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { useGoogleSignIn } from '@/app/_lib/google-sign-in';
import { DEMO_ENABLED } from '@/lib/config';
import { CircleAlert, Landmark, Lock, ShieldCheck, Target } from 'lucide-react';
import { useRouter } from 'next/navigation';

/**
 * The front door.
 *
 * This was a floating card in an empty page whose two calls to action rendered
 * as bare text — the outline border never painted (see ui/button.tsx), so the
 * one screen every new user meets had no visible buttons on it. It is now the
 * same product the landing page promises: the brand panel restates the three
 * claims sign-up is agreeing to, and the form's primary action looks primary.
 *
 * One Google button serves sign-in and sign-up — Google resolves which — so
 * "Already have an account?" needs a sentence, not a second form.
 */

const CLAIMS = [
  {
    Icon: Landmark,
    title: 'Every partner in one place',
    body: 'Your holdings at each licensed institution, unified.',
  },
  {
    Icon: Target,
    title: 'An agent inside your limits',
    body: 'It finds and checks investments; nothing happens without your yes.',
  },
  {
    Icon: ShieldCheck,
    title: 'Regulated end to end',
    body: 'Licensed firms execute, custody and settle. CCN never holds your money.',
  },
];

export default function SignInPage() {
  const router = useRouter();
  const { start: google, pending, slow, error } = useGoogleSignIn();

  return (
    <div className="flex min-h-screen bg-background font-sans text-foreground">
      {/* The brand half: what signing up is agreeing to. Desktop only — on a
          phone the form is the whole job and this would push it below the fold. */}
      <div className="hidden w-[46%] flex-col justify-between bg-primary p-12 text-[#eafaf5] min-[900px]:flex">
        <button
          type="button"
          onClick={() => router.push('/')}
          className="inline-flex items-center gap-[11px] self-start text-[#eafaf5]"
        >
          <span className="grid h-[38px] w-[38px] place-items-center rounded-[11px] bg-white/15 font-display text-[19px] font-bold text-white">
            C
          </span>
          <span className="font-display text-[17px] font-bold">Caribbean Capital Network</span>
        </button>

        <div>
          <h2 className="max-w-[400px] font-display text-[34px] font-bold leading-[1.12] tracking-[-0.8px] text-white">
            One agent for your whole Caribbean portfolio.
          </h2>
          <ul className="m-0 mt-9 flex max-w-[420px] list-none flex-col gap-6 p-0">
            {CLAIMS.map(({ Icon, title, body }) => (
              <li key={title} className="flex items-start gap-3.5">
                <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-white/10">
                  <Icon className="h-5 w-5 text-[#8fe3c0]" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-[15.5px] font-bold text-white">{title}</span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-[#eafaf5]/[.75]">
                    {body}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="text-[13px] text-[#eafaf5]/[.55]">
          Kingston · Port of Spain · Bridgetown · Toronto · London
        </div>
      </div>

      {/* The form half. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="px-8 py-[22px] min-[900px]:invisible">
          <button
            type="button"
            onClick={() => router.push('/')}
            className="inline-flex items-center gap-[11px]"
          >
            <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-primary font-display text-[17px] font-bold text-white">
              C
            </span>
            <span className="font-display text-[17px] font-bold">Caribbean Capital Network</span>
          </button>
        </div>

        <div className="flex flex-1 items-center justify-center px-6 pb-[64px] pt-4">
          <Card className="w-full max-w-[428px] px-[34px] py-9 shadow-[0_12px_44px_rgba(40,34,22,0.09)] max-[480px]:border-none max-[480px]:bg-transparent max-[480px]:px-2 max-[480px]:shadow-none">
            <h1 className="text-center font-display text-[25px] font-bold tracking-tight">
              Create your account
            </h1>
            <p className="mx-0 mb-[26px] mt-[9px] text-center text-[15px] leading-relaxed text-dim">
              Sign up so your capital agent can work across every licensed partner in the region.
            </p>
            {/* The primary action, styled as the primary action — one filled
                button on the screen, and this is it. */}
            <Button
              onClick={google}
              disabled={pending}
              aria-busy={pending}
              className="h-[54px] w-full gap-3 text-base"
            >
              <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-white font-display text-sm font-bold text-[#3f7ae0]">
                G
              </span>
              {pending ? 'Connecting to Google…' : 'Continue with Google'}
            </Button>
            {/* One line, one height, whichever of the three states is showing, so
                the card does not resize under the thumb that just tapped it. */}
            <div className="min-h-[34px] pt-3">
              {error ? (
                <p className="flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra">
                  <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
                  {error}
                </p>
              ) : slow ? (
                <output className="block text-sm text-dim">
                  Waking the server — this can take up to a minute the first time.
                </output>
              ) : null}
            </div>
            {DEMO_ENABLED && (
              <>
                <div className="my-5 flex items-center gap-3">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-[13px] text-faint">or</span>
                  <span className="h-px flex-1 bg-border" />
                </div>
                <Button
                  variant="outline"
                  onClick={() => router.push('/demo/home')}
                  className="w-full text-teal2"
                >
                  Explore the demo instead
                </Button>
              </>
            )}
            <div className="mt-[22px] flex items-center justify-center gap-2 text-[13px] text-faint">
              <Lock className="h-3.5 w-3.5" aria-hidden />
              Bank-level encryption · KYC handled by your partner
            </div>
            <div className="mt-5 text-center text-[14.5px] text-dim">
              Already have an account?{' '}
              <button
                type="button"
                onClick={google}
                disabled={pending}
                className="font-bold text-teal2 underline-offset-4 hover:underline disabled:opacity-60"
              >
                Sign in
              </button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
