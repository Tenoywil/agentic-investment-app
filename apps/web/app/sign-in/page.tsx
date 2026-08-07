'use client';

import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { authClient } from '../../lib/auth-client';

export default function SignInPage() {
  const router = useRouter();
  const google = () => {
    authClient.signIn
      .social({ provider: 'google', callbackURL: `${window.location.origin}/onboarding` })
      .catch(() => {});
  };

  return (
    <div className="flex min-h-screen flex-col bg-background font-sans text-foreground">
      <div className="px-10 py-[22px]">
        <button
          type="button"
          onClick={() => router.push('/')}
          className="inline-flex items-center gap-[11px]"
        >
          <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-primary font-display text-[17px] font-bold text-white">
            C
          </span>
          <span className="font-display text-[17px] font-bold">Caribbean Capital</span>
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center px-6 pb-[60px] pt-6">
        <Card className="w-full max-w-[428px] px-[34px] py-9 shadow-[0_12px_44px_rgba(40,34,22,0.09)]">
          <h1 className="text-center font-display text-[25px] font-bold tracking-tight">
            Create your account
          </h1>
          <p className="mx-0 mb-[26px] mt-[9px] text-center text-[15px] leading-relaxed text-dim">
            Sign up so your capital agent can work across every licensed partner in the region.
          </p>
          <Button variant="outline" onClick={google} className="h-[54px] w-full gap-3 text-base">
            <span className="grid h-[22px] w-[22px] place-items-center rounded-full border border-border bg-white font-display text-sm font-bold text-[#3f7ae0]">
              G
            </span>
            Continue with Google
          </Button>
          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[13px] text-faint">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button
            variant="outline"
            onClick={() => router.push('/onboarding')}
            className="w-full text-teal2"
          >
            Explore the demo instead
          </Button>
          <div className="mt-[22px] flex items-center justify-center gap-2 text-[13px] text-faint">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            Bank-level encryption · KYC handled by your partner
          </div>
          <div className="mt-5 text-center text-[14.5px] text-dim">
            Already have an account?{' '}
            <button
              type="button"
              onClick={google}
              className="font-bold text-teal2 underline-offset-4 hover:underline"
            >
              Sign in
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}
