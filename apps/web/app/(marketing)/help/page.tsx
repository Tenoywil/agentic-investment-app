'use client';

import { MarketingPage } from '@/app/_components/marketing';
import { DEMO_ENABLED } from '@/lib/config';
import Link from 'next/link';

/**
 * The practical questions, answered the way the product actually works. Every
 * answer here describes real behaviour — how money moves, what the agent can
 * and cannot do — because a help page that oversells is a support ticket with
 * extra steps. Plain <details> disclosure: the native control does the
 * accordion job with keyboard and screen-reader behaviour included.
 */

const FAQS: { q: string; a: string }[] = [
  {
    q: 'How do I put money in?',
    a: 'Money moves between you and your chosen institution directly: a wire or a branch deposit using the funding instructions the firm publishes in your "Add money" dialog. CCN never holds it. When you tell CCN you have sent it, the note lands on the firm’s desk; your balance updates when their desk confirms the money actually settled, and never on anyone’s say-so.',
  },
  {
    q: 'How do I take money out?',
    a: 'Press Withdraw on the firm’s card in your portfolio. Before you confirm, you see the firm’s withdrawal fee, any local tax on that fee (such as Jamaica’s GCT), and the exact amount you would receive. The firm pays you directly and records it; your balance falls only when they confirm it is paid. If they decline, you are told why in their own words.',
  },
  {
    q: 'Who verifies my identity?',
    a: 'The licensed firm you connect to. They are the regulated owner of KYC, not CCN. Onboarding records your own declarations (identity details, a risk fact-find, source of funds) and lets you attach documents (photo ID, proof of address, a payslip or statement) that the firm’s desk reviews before accepting you as a client.',
  },
  {
    q: 'What can the agent actually do?',
    a: 'Research, screen and propose. It never spends. It scans the marketplace (including while you are away), checks every candidate against your own limits (risk band, cash floor, single-position cap) and raises anything that fits as an approval card. Every card shows "How this was decided": the research, screening and sizing steps, including the candidates that were rejected and why. Nothing is executed until you approve it.',
  },
  {
    q: 'What are the limits, and who sets them?',
    a: 'You do, on the agent screen: a within-limit proposal cap, a cash floor it never breaches, a require-approval threshold, and a single-position cap. The server enforces them, so they are not advisory, and the same engine screens the marketplace, the chat, and every order you place yourself. A within-limit result still waits for your confirmation before routing.',
  },
  {
    q: 'What record do I get when something is executed?',
    a: 'Every settled order produces a contract note: a printable confirmation carrying the executing firm, the regulator, the price, units and fee the firm reported, and references both sides can quote. Figures the firm did not report are omitted rather than estimated. Everything is also written to an append-only audit log that nobody, including CCN, can edit.',
  },
  {
    q: 'What does CCN cost?',
    a: 'Applicable CCN fees, each partner’s product and withdrawal fees, and any local tax are shown before you approve. The executing firm reports the actual settlement fee; CCN does not estimate a missing figure.',
  },
  {
    q: 'Which currencies are supported?',
    a: 'Balances can be shown in USD, JMD, TTD, GYD, BBD, XCD and BSD. Conversions use published central-bank rates where available, and every converted figure names the rate’s source and date. A number nobody can date is not shown as fact.',
  },
  {
    q: 'Can a firm say no?',
    a: 'Yes: to taking you on as a client, to an order, or to a withdrawal. Each decision reaches you with the firm’s reason where one is required, and the record of who decided what is kept on the audit trail.',
  },
  {
    q: 'Is my money safe with CCN?',
    a: 'CCN never holds your money, so there is no CCN account to be safe or unsafe. Every instrument is custodied and executed by the licensed institution named on its card, under that institution’s regulator. Investing still carries risk: capital is at risk and returns are not guaranteed, which is printed on every product card rather than hidden here.',
  },
];

export default function HelpPage() {
  return (
    <MarketingPage
      eyebrow="Help"
      title="Straight answers to the practical questions"
      lead="How money gets in and out, who verifies you, what the agent can and cannot do, and what everything costs. If a question is missing, the answer inside the product is always written next to the control it explains."
    >
      <div className="flex flex-col gap-3">
        {FAQS.map((f) => (
          <details
            key={f.q}
            className="group rounded-[13px] border border-solid border-border bg-card px-5 py-1"
          >
            <summary className="cursor-pointer py-3.5 font-display text-[16px] font-bold text-foreground marker:text-teal2">
              {f.q}
            </summary>
            <p className="m-0 pb-4 text-[15px] leading-[1.65] text-dim">{f.a}</p>
          </details>
        ))}
      </div>
      <p className="mt-8 text-[13.5px] text-faint">
        Want the bigger picture first? Read <Link href="/how-it-works">how it works</Link>
        {DEMO_ENABLED && (
          <>
            , or explore the <Link href="/demo/home">live demo</Link>. Every figure there is
            labelled as sample data
          </>
        )}
        .
      </p>
    </MarketingPage>
  );
}
