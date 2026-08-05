'use client';

import Link from 'next/link';
import { useState } from 'react';
import { authClient } from '../../lib/auth-client';

export default function SignInPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function signInWithGoogle() {
    setError(null);
    setPending(true);
    try {
      await authClient.signIn.social({
        provider: 'google',
        callbackURL: `${window.location.origin}/onboarding`,
      });
    } catch {
      setError('Could not start sign-in. Please try again.');
      setPending(false);
    }
  }

  return (
    <section className="section">
      <div className="panel">
        <h1>Sign in</h1>
        <p className="lead" style={{ marginBottom: 'var(--sp-5)' }}>
          Continue with Google to reach your portfolio. New here? Signing in starts your one-time
          verification.
        </p>
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={signInWithGoogle}
          disabled={pending}
        >
          {pending ? 'Redirecting…' : 'Continue with Google'}
        </button>
        {error ? (
          <p role="alert" style={{ color: 'var(--danger)', marginTop: 'var(--sp-3)' }}>
            {error}
          </p>
        ) : null}
        <p style={{ marginTop: 'var(--sp-5)', color: 'var(--text-muted)' }}>
          Prefer to look around first?{' '}
          <Link href="/onboarding" style={{ color: 'var(--primary)' }}>
            Preview onboarding
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
