import Link from 'next/link';

const PARTNERS = ['NCB', 'Sagicor', 'JMMB', 'Proven', 'Barita', 'Republic', 'Sygnus'];

const STEPS = [
  {
    title: 'The agent proposes',
    body: 'Your capital agent researches regional opportunities — government bonds, funds, real estate, private credit — and proposes moves that fit your goals and risk band.',
  },
  {
    title: 'You approve — one tap',
    body: 'A deterministic limits engine checks every move against the caps you set. Anything larger becomes a "needs your approval" card. Nothing executes without you.',
  },
  {
    title: 'Partners execute & settle',
    body: 'FSC-licensed partners custody, execute and settle the order in-region (T+2). CCN orchestrates; the partner is always the actor of record.',
  },
];

export default function LandingPage() {
  return (
    <>
      <section className="section hero">
        <div className="container">
          <p className="eyebrow">For the Caribbean &amp; its diaspora</p>
          <h1>One agent for your whole Caribbean portfolio.</h1>
          <p className="lead">
            Caribbean Capital Network unifies your holdings across every partner institution, finds
            regional opportunities, and acts within limits you set — escalating anything larger for
            your one-tap approval. You stay in control; licensed partners execute and settle.
          </p>
          <div className="cta-row">
            <Link className="btn btn-primary" href="/onboarding">
              Get verified &amp; start
            </Link>
            <Link className="btn btn-secondary" href="/sign-in">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <section className="section--tight" id="how">
        <div className="container">
          <p className="eyebrow">How it works</p>
          <div className="grid" style={{ marginTop: 'var(--sp-4)' }}>
            {STEPS.map((s, i) => (
              <article className="card" key={s.title}>
                <span className="step-index" aria-hidden="true">
                  {i + 1}
                </span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section--tight">
        <div className="container">
          <div className="trust">
            <span className="step-index" aria-hidden="true">
              ✓
            </span>
            <p className="lead" style={{ margin: 0 }}>
              <strong style={{ color: 'var(--text)' }}>
                CCN holds no client money and executes nothing.
              </strong>{' '}
              Custody, execution and settlement always happen at an FSC-licensed partner. The model
              can propose, but only the limits engine and your approval can create an order.
            </p>
          </div>
        </div>
      </section>

      <section className="section" id="institutions">
        <div className="container">
          <p className="eyebrow">For institutions</p>
          <h2 style={{ fontSize: 'var(--fs-heading)', margin: 'var(--sp-2) 0 var(--sp-3)' }}>
            A regulated, referral-driven distribution channel.
          </h2>
          <p className="lead">
            Licensed partners keep custody and remain the actor of record. CCN routes suitable,
            pre-screened, KYC-verified clients and orders to your desk — with a masked-client
            console for accept/settle, product listings, and an onboarding funnel.
          </p>
          <div className="partner-strip" aria-label="Partner network">
            {PARTNERS.map((p) => (
              <span className="partner-chip" key={p}>
                {p}
              </span>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
