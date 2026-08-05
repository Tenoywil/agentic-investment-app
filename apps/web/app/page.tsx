'use client';

import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { authClient } from '../lib/auth-client';

const MONO = "'IBM Plex Mono', monospace";
const DISPLAY = "'Bricolage Grotesque', sans-serif";
const BODY = "'Hanken Grotesk', sans-serif";

const featureCard: CSSProperties = {
  display: 'flex',
  gap: 15,
  padding: '21px 22px',
  border: '1px solid #e4e0d6',
  borderRadius: 14,
  background: '#fdfcfa',
  cursor: 'pointer',
};
const benefitCard: CSSProperties = {
  background: '#fdfcfa',
  border: '1px solid #e4e0d6',
  borderRadius: 14,
  padding: '24px 22px',
};
const benefitIcon: CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 11,
  background: '#e8f1ec',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: 16,
};
const pipeNum: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 8,
  background: '#e8f1ec',
  color: '#0e5952',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: MONO,
  fontWeight: 700,
  fontSize: 15,
  marginBottom: 12,
};

function IconChart() {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#0e5952"
      strokeWidth={1.9}
    >
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 3 3 5-6" />
    </svg>
  );
}
function IconTarget() {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#0e5952"
      strokeWidth={1.9}
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.6" fill="#0e5952" stroke="none" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#0e5952"
      strokeWidth={1.9}
    >
      <path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z" />
      <path d="M9.3 12l1.9 1.9 3.6-3.9" />
    </svg>
  );
}
function IconTrend() {
  return (
    <svg
      aria-hidden="true"
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#0e5952"
      strokeWidth={1.9}
    >
      <path d="M3 17l6-6 4 4 8-8M21 7v5M21 7h-5" />
    </svg>
  );
}
function GoogleG() {
  return (
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
  );
}

export default function LandingPage() {
  const router = useRouter();
  const google = () => {
    authClient.signIn
      .social({ provider: 'google', callbackURL: `${window.location.origin}/onboarding` })
      .catch(() => {});
  };
  const demo = () => router.push('/onboarding');

  return (
    <div
      data-landing
      style={{ minHeight: '100vh', background: '#efece4', color: '#1e1c19', fontFamily: BODY }}
    >
      {/* NAV */}
      <div
        data-landing-nav
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          maxWidth: 1200,
          margin: '0 auto',
          padding: '22px 40px',
          gap: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 11,
              background: '#124e48',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontFamily: DISPLAY,
              fontWeight: 700,
              fontSize: 19,
            }}
          >
            C
          </div>
          <div
            style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 18, letterSpacing: '-.2px' }}
          >
            Caribbean Capital
          </div>
        </div>
        <div
          data-landing-links
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 30,
            fontSize: 15,
            color: '#5c5449',
            fontWeight: 500,
          }}
        >
          <a
            href="#how-it-works"
            style={{ cursor: 'pointer', color: 'inherit', textDecoration: 'none' }}
          >
            How it works
          </a>
          <button type="button" onClick={demo} style={linkButton}>
            Product
          </button>
          <button type="button" onClick={() => router.push('/sign-in')} style={linkButton}>
            For institutions
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            data-nav-signin
            type="button"
            onClick={() => router.push('/sign-in')}
            style={{
              padding: '10px 16px',
              border: 'none',
              background: 'transparent',
              color: '#1e1c19',
              fontFamily: BODY,
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Sign in
          </button>
          <button type="button" onClick={demo} style={tealBtn(15)}>
            See a demo
          </button>
        </div>
      </div>

      {/* HERO */}
      <div
        data-landing-hero
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: '40px 40px 34px',
          display: 'grid',
          gridTemplateColumns: '1.02fr .98fr',
          gap: 52,
          alignItems: 'center',
        }}
      >
        <div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: '#fdfcfa',
              border: '1px solid #e4e0d6',
              borderRadius: 22,
              padding: '7px 14px',
              fontSize: 13,
              fontWeight: 600,
              color: '#0e5952',
              letterSpacing: '.3px',
              marginBottom: 22,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#0a8f5b' }} />
            The financial operating system of the Caribbean
          </div>
          <div
            data-hero-h1
            style={{
              fontFamily: DISPLAY,
              fontWeight: 700,
              fontSize: 53,
              lineHeight: 1.04,
              letterSpacing: '-1.6px',
            }}
          >
            One agent for your whole Caribbean portfolio.
          </div>
          <p
            style={{
              margin: '20px 0 0',
              fontSize: 18,
              lineHeight: 1.55,
              color: '#5c5449',
              maxWidth: 520,
            }}
          >
            CCN unifies every licensed partner in one place. Your AI capital agent researches
            regional opportunities, screens them for suitability, clears compliance, and executes on
            your approval.
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 28, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={google}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 11,
                padding: '15px 22px',
                border: '1px solid #dcd6c8',
                borderRadius: 12,
                background: '#fdfcfa',
                color: '#1e1c19',
                fontFamily: BODY,
                fontSize: 16,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(30,20,10,.05)',
              }}
            >
              <GoogleG />
              Continue with Google
            </button>
            <button type="button" onClick={demo} style={tealBtn(16, '15px 22px')}>
              See a live demo →
            </button>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              marginTop: 24,
              fontSize: 13.5,
              color: '#726a5b',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg
                aria-hidden="true"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#0a8f5b"
                strokeWidth={2}
              >
                <path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z" />
              </svg>
              FSC-regulated partners
            </span>
            <span>·</span>
            <span>KYC / AML built in</span>
            <span>·</span>
            <span>Data held in-region</span>
          </div>
          <div style={{ marginTop: 13, fontSize: 13, color: '#8a8172' }}>
            One flat platform fee. Each partner's product fees are shown before you approve, with no
            hidden spreads from CCN.
          </div>
        </div>

        {/* Hero aside card */}
        <div
          style={{
            background: '#fdfcfa',
            border: '1px solid #e4e0d6',
            borderRadius: 16,
            padding: 16,
            boxShadow: '0 24px 60px rgba(40,34,22,.12)',
          }}
        >
          <div
            style={{
              background: '#124e48',
              borderRadius: 12,
              padding: '20px 22px',
              color: '#eafaf5',
            }}
          >
            <div
              style={{
                fontSize: 12,
                letterSpacing: '1px',
                textTransform: 'uppercase',
                color: 'rgba(234,250,245,.66)',
                fontWeight: 600,
              }}
            >
              Total net worth · 4 partners
            </div>
            <div
              style={{
                fontFamily: DISPLAY,
                fontWeight: 700,
                fontSize: 40,
                marginTop: 6,
                lineHeight: 1,
                letterSpacing: '-1px',
              }}
            >
              US$31,350
            </div>
            <div
              style={{
                display: 'flex',
                gap: 9,
                marginTop: 9,
                fontSize: 13.5,
                alignItems: 'center',
              }}
            >
              <span
                style={{
                  background: 'rgba(255,255,255,.1)',
                  color: '#9fe6c6',
                  padding: '3px 9px',
                  borderRadius: 7,
                  fontFamily: MONO,
                  fontWeight: 700,
                }}
              >
                ↑ 6.8%
              </span>
              <span style={{ color: 'rgba(234,250,245,.8)' }}>blended yield 6.2%</span>
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              marginTop: 14,
              padding: '13px 14px',
              border: '1px solid #e4e0d6',
              borderRadius: 11,
              background: '#fbfaf6',
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: '#0a8f5b',
                flex: 'none',
                marginTop: 5,
              }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: '#2c2925', lineHeight: 1.4, fontWeight: 600 }}>
                Agent swept US$400 into your money-market fund
              </div>
              <div style={{ fontSize: 12.5, color: '#8c8478', marginTop: 2 }}>
                Inside your US$500 limit · 2 days ago
              </div>
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginTop: 10,
              padding: '13px 14px',
              border: '1px solid #e7c3ab',
              borderRadius: 11,
              background: '#f9ede2',
            }}
          >
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '.4px',
                  textTransform: 'uppercase',
                  color: '#b4531f',
                }}
              >
                Needs your approval
              </div>
              <div style={{ fontSize: 14, color: '#1e1c19', fontWeight: 600, marginTop: 2 }}>
                Reinvest US$412 GOJ coupon
              </div>
            </div>
            <span
              style={{
                padding: '8px 14px',
                borderRadius: 9,
                background: '#124e48',
                color: '#fff',
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              Approve
            </span>
          </div>
        </div>
      </div>

      {/* PARTNER STRIP */}
      <div
        style={{
          borderTop: '1px solid #e4e0d6',
          borderBottom: '1px solid #e4e0d6',
          background: '#fdfcfa',
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: '0 auto',
            padding: '20px 40px',
            display: 'flex',
            alignItems: 'center',
            gap: 28,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontSize: 13,
              letterSpacing: '.6px',
              textTransform: 'uppercase',
              color: '#8c8478',
              fontWeight: 600,
            }}
          >
            Held at licensed partners
          </span>
          <div
            style={{
              display: 'flex',
              gap: 26,
              flexWrap: 'wrap',
              fontFamily: MONO,
              fontSize: 15,
              fontWeight: 600,
              color: '#5c5449',
            }}
          >
            {['NCB', 'SAGICOR', 'JMMB', 'PROVEN', 'BARITA', 'REPUBLIC', 'SYGNUS'].map((p) => (
              <span key={p}>{p}</span>
            ))}
          </div>
        </div>
      </div>

      {/* MISSION */}
      <div data-sec style={{ maxWidth: 1200, margin: '0 auto', padding: '58px 40px 8px' }}>
        <div
          data-mission
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 52, alignItems: 'start' }}
        >
          <div>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 12,
                letterSpacing: '2px',
                textTransform: 'uppercase',
                color: '#0e5952',
                marginBottom: 14,
              }}
            >
              Why CCN
            </div>
            <div
              data-sec-h1
              style={{
                fontFamily: DISPLAY,
                fontWeight: 700,
                fontSize: 33,
                lineHeight: 1.14,
                letterSpacing: '-.7px',
              }}
            >
              Caribbean wealth is scattered across a dozen institutions and borders.
            </div>
          </div>
          <p style={{ margin: 0, paddingTop: 6, fontSize: 17, lineHeight: 1.62, color: '#5c5449' }}>
            If you are building a life between the region and the diaspora, your money lives in
            fragments: a bond at NCB, a fund at Sagicor, cash at JMMB, a pension you have
            half-forgotten. CCN brings all of it into one place and gives you an agent that
            researches, screens and acts on it, so your capital is always working and always under
            your control.
          </p>
        </div>
      </div>

      {/* BENEFITS */}
      <div data-sec style={{ maxWidth: 1200, margin: '0 auto', padding: '34px 40px 6px' }}>
        <div
          data-benefits
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}
        >
          {[
            {
              icon: <IconChart />,
              title: 'One portfolio, every partner',
              body: 'See and manage holdings across eight licensed institutions in a single live view: net worth, yield and allocation, unified.',
            },
            {
              icon: <IconTarget />,
              title: 'An agent inside your limits',
              body: 'It surfaces regional opportunities, checks each against your risk band, and acts up to the limits you set. Anything larger comes to you to approve.',
            },
            {
              icon: <IconShield />,
              title: 'Regulated and regional',
              body: 'Every instrument is custodied and executed by an FSC-licensed partner. KYC, suitability and source-of-funds stay with the partner that already knows you; CCN links your verified status instead of re-collecting it. CCN never holds your money.',
            },
          ].map((b) => (
            <div key={b.title} style={benefitCard}>
              <span style={benefitIcon}>{b.icon}</span>
              <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 18, marginBottom: 7 }}>
                {b.title}
              </div>
              <div style={{ fontSize: 14.5, lineHeight: 1.55, color: '#5c5449' }}>{b.body}</div>
            </div>
          ))}
        </div>
      </div>

      {/* WHAT'S INSIDE */}
      <div data-sec style={{ maxWidth: 1200, margin: '0 auto', padding: '52px 40px 0' }}>
        <div
          data-sec-h1
          style={{
            fontFamily: DISPLAY,
            fontWeight: 700,
            fontSize: 28,
            letterSpacing: '-.5px',
            marginBottom: 6,
          }}
        >
          Everything to grow and protect wealth in the region
        </div>
        <div style={{ fontSize: 16, color: '#5c5449', marginBottom: 22 }}>
          Four surfaces, one account. Tap any to open it in the live demo.
        </div>
        <div data-features style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {[
            {
              icon: <IconChart />,
              title: 'Unified portfolio',
              body: 'Every holding across every partner, valued live in your chosen currency.',
            },
            {
              icon: <IconTrend />,
              title: 'Opportunities marketplace',
              body: 'Bonds, funds, real estate and private credit from across the region, matched to your goals.',
            },
            {
              icon: <IconTarget />,
              title: 'Capital agent',
              body: 'Chat or talk to an agent that plans, screens and executes on your say-so, inside your limits.',
            },
            {
              icon: <IconShield />,
              title: 'Planning & protection',
              body: 'Life cover, retirement, mortgages and estate planning that work across borders.',
            },
          ].map((f) => (
            <button
              key={f.title}
              type="button"
              onClick={demo}
              style={{ ...featureCard, textAlign: 'left', font: 'inherit' }}
            >
              <span
                style={{ ...benefitIcon, width: 42, height: 42, marginBottom: 0, flex: 'none' }}
              >
                {f.icon}
              </span>
              <div>
                <div
                  style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17, marginBottom: 4 }}
                >
                  {f.title}
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.5, color: '#5c5449' }}>{f.body}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* HOW IT WORKS */}
      <div
        id="how-it-works"
        data-sec
        style={{ maxWidth: 1200, margin: '0 auto', padding: '54px 40px 62px', scrollMarginTop: 20 }}
      >
        <div
          data-sec-h1
          style={{
            fontFamily: DISPLAY,
            fontWeight: 700,
            fontSize: 30,
            letterSpacing: '-.5px',
            marginBottom: 6,
          }}
        >
          Your agent does the work. You keep control.
        </div>
        <div style={{ fontSize: 16, color: '#5c5449', marginBottom: 26 }}>
          Every action is researched, screened and checked, then brought to you.
        </div>
        <div data-pipe style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 14 }}>
          {[
            {
              n: '1',
              t: 'Research',
              b: 'Scans 47 instruments across the 8-partner network',
              flag: false,
            },
            { n: '2', t: 'Suitability', b: 'Matches your risk band and goals', flag: false },
            { n: '3', t: 'Compliance', b: 'KYC, suitability and source-of-funds', flag: false },
            {
              n: '4',
              t: 'Your approval',
              b: 'You confirm every move above your limits',
              flag: true,
            },
            { n: '5', t: 'Execute', b: 'Routed to the partner, then monitored', flag: false },
          ].map((s) => (
            <div
              key={s.n}
              style={{
                padding: 18,
                border: `1px solid ${s.flag ? '#e7c3ab' : '#e4e0d6'}`,
                borderRadius: 13,
                background: s.flag ? '#f9ede2' : '#fdfcfa',
              }}
            >
              <div
                style={{
                  ...pipeNum,
                  background: s.flag ? '#f0d3bd' : '#e8f1ec',
                  color: s.flag ? '#b4531f' : '#0e5952',
                }}
              >
                {s.n}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 5 }}>{s.t}</div>
              <div
                style={{ fontSize: 14, color: s.flag ? '#8a5a3e' : '#6b6459', lineHeight: 1.45 }}
              >
                {s.b}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 34, flexWrap: 'wrap' }}>
          <button type="button" onClick={google} style={tealBtn(16, '15px 24px')}>
            Get started with Google
          </button>
          <button
            type="button"
            onClick={demo}
            style={{
              padding: '15px 24px',
              border: '1px solid #dcd6c8',
              borderRadius: 12,
              background: '#fdfcfa',
              color: '#1e1c19',
              fontFamily: BODY,
              fontSize: 16,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            See a live demo →
          </button>
        </div>
      </div>

      {/* FOOTER */}
      <div style={{ borderTop: '1px solid #e4e0d6', background: '#fdfcfa' }}>
        <div
          style={{
            maxWidth: 1200,
            margin: '0 auto',
            padding: '22px 40px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
            fontSize: 13.5,
            color: '#8c8478',
          }}
        >
          <span>© 2026 Caribbean Capital Network</span>
          <span>Kingston · Port of Spain · Bridgetown · Toronto · London</span>
        </div>
      </div>
    </div>
  );
}

const linkButton: CSSProperties = {
  cursor: 'pointer',
  color: 'inherit',
  background: 'none',
  border: 'none',
  font: 'inherit',
  padding: 0,
};

function tealBtn(fontSize: number, padding = '11px 20px'): CSSProperties {
  return {
    padding,
    border: 'none',
    borderRadius: fontSize >= 16 ? 12 : 11,
    background: '#124e48',
    color: '#fff',
    fontFamily: BODY,
    fontSize,
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}
