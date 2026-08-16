import { InfoSection, MarketingPage } from '@/app/_components/marketing';

/**
 * The privacy page: what is collected, where it lives, who sees it. Written as
 * a plain-language description of what the product actually does — the same
 * no-overclaiming rule as every other surface. It is informational copy, not
 * legal advice, and says so.
 */

export const metadata = { title: 'Privacy · Caribbean Capital Network' };

export default function PrivacyPage() {
  return (
    <MarketingPage
      eyebrow="Privacy"
      title="What we hold, where it lives, and who can see it"
      lead="This page describes, in plain language, how Caribbean Capital Network handles your information. It reflects how the product is actually built."
    >
      <InfoSection title="What we collect">
        <p>
          Your account identity (name and email from your sign-in provider), the onboarding
          declarations you make (identity details, a risk fact-find, source-of-funds), any KYC
          documents you choose to upload (capped at 2MB each), the connections you make to
          institutions, and the orders, approvals and withdrawal requests you create. Exchange-rate
          and product reference data is not about you at all.
        </p>
      </InfoSection>

      <InfoSection title="Where it lives">
        <p>
          Your data is held in-region-oriented infrastructure with database-level access controls:
          every record is scoped to its owner by row-level security, enforced by the database itself
          rather than by application code alone. Documents you upload live under the same controls
          as everything else about you — there is no separate file store with separate rules.
        </p>
      </InfoSection>

      <InfoSection title="Who can see what">
        <p>
          <b className="text-foreground">You</b> see your own records.{' '}
          <b className="text-foreground">A firm you connect to</b> sees the KYC package you
          consented to share — your declarations, your uploaded documents, and the positions and
          orders held through that firm — for exactly as long as the connection exists. It never
          sees your holdings at any other institution.{' '}
          <b className="text-foreground">CCN administration</b> holds a read-across for operating
          the network; it cannot edit the audit trail, which is append-only for everyone including
          CCN.
        </p>
        <p>We do not sell your data, and there is no advertising use of it.</p>
      </InfoSection>

      <InfoSection title="The audit trail">
        <p>
          Actions that matter — a client accepted, funds recorded, a withdrawal paid, an order
          settled — are written to an append-only, hash-chained log naming who decided what. The
          database rejects edits and deletions on it outright. This is a feature of the product, and
          it also means those records cannot be silently altered or erased.
        </p>
      </InfoSection>

      <InfoSection title="Your choices">
        <p>
          You choose which institutions to connect and which documents to upload — uploads are
          optional, and the firm you connect to may collect its own instead. Disconnecting from a
          firm ends its window into your records. For questions or requests about your data, contact
          your institution for records they own, and CCN for records the platform owns.
        </p>
      </InfoSection>

      <p className="text-[13px] text-faint">
        This page is a plain-language description, not a contract or legal advice. Where a local
        regulation grants you specific rights, those rights apply regardless of anything written
        here.
      </p>
    </MarketingPage>
  );
}
