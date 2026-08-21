import { InfoSection, MarketingPage } from '@/app/_components/marketing';

/**
 * The terms page: what CCN is and is not, in plain language. The central fact
 * repeats what every product surface already says — CCN routes and records;
 * licensed institutions execute and custody — because terms that contradict
 * the product are worse than none.
 */

export const metadata = { title: 'Terms · Caribbean Capital Network' };

export default function TermsPage() {
  return (
    <MarketingPage
      eyebrow="Terms"
      title="What CCN is, and what it is not"
      lead="The short version: CCN is a network and a record-keeper. Licensed institutions execute, custody and settle. You approve every move that matters."
    >
      <InfoSection title="What CCN does">
        <p>
          CCN gives you one view of holdings across the institutions you connect, a marketplace of
          products those institutions list, and an agent that researches and screens against limits
          you set. When you approve an action, CCN routes a signed instruction to the licensed
          institution that executes it, and records the outcome on an append-only audit log.
        </p>
      </InfoSection>

      <InfoSection title="What CCN does not do">
        <p>
          CCN does not hold client money, does not execute trades, and is not a custodian, broker,
          or investment adviser. The agent proposes; it cannot spend. Product information on deal
          cards (rates, terms, minimums) is supplied by the listing institution, and figures a firm
          did not report are left out rather than estimated.
        </p>
      </InfoSection>

      <InfoSection title="Risk">
        <p>
          Investing puts capital at risk. Returns are not guaranteed, a stated rate is a claim by
          the issuing institution rather than a promise by CCN, and past figures do not predict
          future ones. Every product card carries this warning because it is true everywhere, not
          just here.
        </p>
      </InfoSection>

      <InfoSection title="Fees and taxes">
        <p>
          Applicable CCN fees, institution product and withdrawal fees, and local taxes (such as
          consumption tax on a withdrawal fee) may apply. Every charge that applies to an action you
          take is shown before you confirm it and frozen at the moment you ask. A rate change later
          never reprices a request already made.
        </p>
      </InfoSection>

      <InfoSection title="Decisions belong to the firms">
        <p>
          A licensed institution may decline to take you on as a client, decline an order, or
          decline a withdrawal. Where the product requires a reason, the firm&rsquo;s reason is
          shown to you verbatim, and the decision, and who at the firm made it, is recorded.
        </p>
      </InfoSection>

      <InfoSection title="Your account">
        <p>
          Keep your sign-in credentials to yourself; actions taken from your signed-in session are
          treated as yours. You can stop using CCN at any time. Positions you hold remain facts at
          the institutions that custody them, and disconnecting a firm on CCN does not close the
          underlying account with that firm.
        </p>
      </InfoSection>

      <p className="text-[13px] text-faint">
        This page is a plain-language summary, not a substitute for the formal agreement that
        applies in your jurisdiction. Where they differ, the formal agreement governs.
      </p>
    </MarketingPage>
  );
}
