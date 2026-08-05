'use client';

import { useRouter } from 'next/navigation';
import { authClient } from '../../lib/auth-client';

const DISPLAY = "'Bricolage Grotesque', sans-serif";
const BODY = "'Hanken Grotesk', sans-serif";

export default function SignInPage() {
  const router = useRouter();
  const google = () => {
    authClient.signIn
      .social({ provider: 'google', callbackURL: `${window.location.origin}/onboarding` })
      .catch(() => {});
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#efece4',
      }}
    >
      <div style={{ padding: '22px 40px' }}>
        <button
          type="button"
          onClick={() => router.push('/')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 11,
            cursor: 'pointer',
            background: 'none',
            border: 'none',
            padding: 0,
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: '#124e48',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontFamily: DISPLAY,
              fontWeight: 700,
              fontSize: 17,
            }}
          >
            C
          </div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17, color: '#1e1c19' }}>
            Caribbean Capital
          </div>
        </button>
      </div>

      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 24px 60px',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 428,
            background: '#fdfcfa',
            border: '1px solid #e4e0d6',
            borderRadius: 16,
            padding: '36px 34px',
            boxShadow: '0 12px 44px rgba(40,34,22,.09)',
          }}
        >
          <div
            style={{
              fontFamily: DISPLAY,
              fontWeight: 700,
              fontSize: 25,
              textAlign: 'center',
              letterSpacing: '-.3px',
            }}
          >
            Create your account
          </div>
          <p
            style={{
              margin: '9px 0 26px',
              textAlign: 'center',
              fontSize: 15,
              lineHeight: 1.5,
              color: '#5c5449',
            }}
          >
            Sign up so your capital agent can work across every licensed partner in the region.
          </p>
          <button
            type="button"
            onClick={google}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              padding: 15,
              border: '1px solid #dcd6c8',
              borderRadius: 12,
              background: '#fff',
              color: '#1e1c19',
              fontFamily: BODY,
              fontSize: 16,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: '#fff',
                border: '1px solid #e4e0d6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: DISPLAY,
                fontWeight: 700,
                fontSize: 14,
                color: '#3f7ae0',
              }}
            >
              G
            </span>
            Continue with Google
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
            <span style={{ height: 1, flex: 1, background: '#e4e0d6' }} />
            <span style={{ fontSize: 13, color: '#8c8478' }}>or</span>
            <span style={{ height: 1, flex: 1, background: '#e4e0d6' }} />
          </div>
          <button
            type="button"
            onClick={() => router.push('/onboarding')}
            style={{
              width: '100%',
              padding: 14,
              border: '1px solid #dcd6c8',
              borderRadius: 12,
              background: '#fdfcfa',
              color: '#0e5952',
              fontFamily: BODY,
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Explore the demo instead
          </button>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              marginTop: 22,
              fontSize: 13,
              color: '#8c8478',
            }}
          >
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#8c8478"
              strokeWidth={2}
            >
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 018 0v4" />
            </svg>
            Bank-level encryption · KYC handled by your partner
          </div>
          <div style={{ textAlign: 'center', marginTop: 20, fontSize: 14.5, color: '#5c5449' }}>
            Already have an account?{' '}
            <button
              type="button"
              onClick={google}
              style={{
                color: '#0e5952',
                fontWeight: 700,
                cursor: 'pointer',
                background: 'none',
                border: 'none',
                font: 'inherit',
                padding: 0,
              }}
            >
              Sign in
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
