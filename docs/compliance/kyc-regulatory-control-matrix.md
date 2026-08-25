# CCN KYC/AML regulatory control matrix

Status: implementation baseline, 25 August 2026. This document is operational control guidance, not a legal opinion. The licensed executing/custody partner remains the KYC owner and must approve its own policy, risk appetite, product offerability and client decision.

## What the supplied drafts do and do not govern

The Research and Matching Framework and its companion workbook govern research, product eligibility and investor-to-product matching. Their sound controls are: gate before rank; return zero, one or two matches; keep match, risk and evidence scores separate; preserve provenance and freshness; append an immutable Match Run; provide reasons and counterarguments; keep commercial influence out of ranking; label sponsorship; and require licensed-human review where the result could be regulated advice.

They are not a complete KYC framework. The workbook is an implementation tracker with many rows still marked `Not Started`, `Needs Legal Review` or `Needs Tax Review`. Those statuses must not be interpreted as approval. KYC/CDD, AML risk, sanctions, tax classification, suitability, product offerability and execution approval are separate gates.

## Corridor ownership

| Phase | Market | Securities / conduct | AML / intelligence | Sanctions | Tax | Baseline retention |
|---|---|---|---|---|---|---:|
| Launch | Jamaica | FSC Jamaica | FSC Jamaica; Financial Investigations Division | Jamaica designated authority | Tax Administration Jamaica | 7 years |
| Launch | Guyana | Guyana Securities Council | GSC; FIU Guyana | FIU Guyana | Guyana Revenue Authority | 7 years |
| Launch | Trinidad and Tobago | TTSEC | TTSEC; FIUTT | FIUTT | Board of Inland Revenue | 6 years |
| Launch diaspora | United States — New York | SEC; FINRA; NY OAG Investor Protection Bureau | FinCEN; FINRA | OFAC | IRS | 5 years after account closure for CIP records |
| Launch diaspora | United States — Florida | SEC; FINRA; Florida OFR | FinCEN; FINRA | OFAC | IRS | 5 years after account closure for CIP records |
| Future | Barbados | FSC Barbados | FSC Barbados; Financial Intelligence Unit Barbados | Barbados competent authority | Barbados Revenue Authority | 5 years, subject to counsel confirmation |
| Future | United Kingdom | FCA | FCA; UKFIU | OFSI | HMRC | 5 years |
| Future | Canada | Applicable province/territory; CSA coordination; CIRO where applicable | FINTRAC | Global Affairs Canada; RCMP | CRA | 5 years |

Canada cannot be treated as one securities jurisdiction. The supported province or territory and the partner's registration category must be selected before that corridor becomes active.

## Required natural-person intake

Collect once, then refresh based on risk and triggering events:

- Full legal name and aliases; date and place of birth.
- Current residential address and a separately verified proof of address.
- Country of residence and every citizenship; dual citizenship is a list, not a boolean.
- Occupation, employer or business, account purpose and expected activity.
- Government-issued ID type, number, issuing country and expiry. Do not use the same document as both identity and address evidence where the local rule requires independent evidence.
- Every tax residence plus the relevant TRN, SSN, TIN or other national identifier, or a documented lawful reason one is unavailable.
- FATCA status (the correct acronym is FATCA), W-9 or W-8BEN classification as applicable, and CRS/self-certification where the partner is subject to it.
- PEP status for the customer, family members and close associates. PEP status triggers enhanced due diligence, source-of-funds/source-of-wealth work, senior approval and enhanced monitoring; it is not an automatic rejection.
- Source of funds for the transaction, source of wealth, supporting evidence, expected annual amount and transaction frequency.
- Sanctions, adverse information and other risk screening results with list/version, timestamp, result and human disposition; never store only a pass/fail boolean without provenance.
- Separate suitability/appropriateness assessment. Investment-risk tolerance is not the AML customer-risk rating.
- Consent, privacy notice/policy version, data-sharing scope, licensed-firm decision, reviewer, decision time, reason, next review and audit evidence.

## Customer lifecycle

1. **Pre-screen and consent** — establish market/corridor, partner eligibility, privacy notice and consent to share the intake package with the chosen partner.
2. **Identify** — collect identity, residence, address, citizenships, occupation, purpose and expected activity.
3. **Verify** — validate ID and independent proof of address; capture document metadata and authenticity result.
4. **Tax classify** — collect all tax residencies and identifiers; determine FATCA/CRS forms and indicia exceptions.
5. **Screen and risk-rate** — sanctions, PEP/family/associate and adverse-information screening; assign an AML customer-risk rating separately from suitability.
6. **Funds and wealth** — establish source of funds for expected/actual transactions and source of wealth; collect evidence proportionate to risk.
7. **EDD and escalation** — for PEP, high-risk geography/product/activity or unresolved matches, obtain more evidence and senior-management approval. Do not activate while unresolved.
8. **Partner decision** — the licensed partner records approved, needs information, EDD, declined or restricted, with policy key and next review. Only an approved, current decision may activate or execute.
9. **Fund and execute** — a funding notice is not money. The partner confirms settlement; the user approves a position; the partner accepts and settles the order; immutable audit records connect the full chain.
10. **Ongoing monitoring** — compare activity with the expected profile, re-screen sanctions/PEP, investigate anomalies and file reports to the competent authority where required.
11. **Refresh and remediation** — periodic risk-based review plus event-driven review for expired ID, address/citizenship/tax changes, PEP changes, unusual activity or policy changes. Restrict execution while material gaps remain.
12. **Exit and retain** — revoke access/offboard without erasing financial facts; preserve CDD, decisions, transactions and reports for the longest applicable corridor/partner period, then dispose securely under an approved retention schedule.

## System enforcement

- Sensitive intake sections are AES-256-GCM encrypted with per-user/per-section context binding. Only completion metadata is plaintext.
- Uploaded evidence is limited to approved non-executable formats, checked against file signatures, capped at 2 MB, downloaded as an attachment, and served with `no-store` and `nosniff`.
- A partner approval records the policy jurisdiction, AML risk, six explicit verification attestations, senior approval, reviewer, review date and next review date.
- The database activation function refuses incomplete intake, missing/partial partner review, and PEP/high-risk approval without senior sign-off.
- Order and approval execution require an active account plus an approved, unexpired partner review.
- Launch investment markets are Jamaica, Guyana and Trinidad and Tobago. New York and Florida are diaspora/offerability overlays. Barbados, the United Kingdom and Canada remain configured as future corridors and are not deleted.
- The allowlisted Marcus scenario uses the same connected-account, funding, approval, order and settlement state machines as every other customer. There is no UI bypass or security exception.

## Primary sources

- Jamaica: [FSC AML/CFT/CFP guidelines](https://www.fscjamaica.org/aml-cft-cfp/guidelines/) and [gazetted guidance](https://www.fscjamaica.org/wp-content/uploads/2023/05/Gazetted-AML-Guidelines-updated.pdf).
- Guyana: [GSC regulatory role](https://www.guyanasecuritiescouncil.com/about.html), [FIU guidelines](https://fiu.gov.gy/aml-cft-guidelines/) and [FIU handbook](https://fiu.gov.gy/wp-content/uploads/2023/07/AMLCFT-Handbook-for-REs-Updated-June-30-2023.pdf).
- Trinidad and Tobago: [TTSEC AML/CFT/CPF page](https://www.ttsec.org.tt/anti-money-laundering-combating-the-financing-of-terrorism-and-countering-proliferation-financing-aml-cft-cpf-guidelines-for-the-securities-sector/) and [2026 securities-sector guidelines](https://www.ttsec.org.tt/wp-content/uploads/2026/02/TTSEC-AMLCFTCPF-Guidelines-for-the-Securities-Sector-2026.pdf).
- United States: [FINRA Rule 2090](https://www.finra.org/rules-guidance/rulebooks/finra-rules/2090), [FINRA Rule 3310](https://www.finra.org/rules-guidance/rulebooks/finra-rules/3310), [SEC/FinCEN CIP rule](https://www.sec.gov/files/rules/final/34-47752.htm), [OFAC sanctions lists](https://ofac.treasury.gov/sanctions-list-service), [IRS FATCA](https://www.irs.gov/businesses/corporations/foreign-account-tax-compliance-act-fatca), [New York securities oversight](https://ag.ny.gov/resources/government-organizations/investments-registration-regulation/broker-dealer-and-securities) and [Florida OFR](https://flofr.gov/divisions-offices/division-of-securities/1000).
- Barbados: [FSC AML/CFT/CPF](https://www.fsc.gov.bb/aml-cft), [FSC 2021 guidelines](https://www.fsc.gov.bb/viewPDF/documents/2023-05-16-19-31-31-financialservicescommissionamlcftguidelines-revisedoctober2021.pdf) and [BRA global relations/FATCA](https://bra.gov.bb/About/Global-Relations/Contact-Us).
- United Kingdom: [FCA AML supervision](https://www.fca.org.uk/firms/financial-crime/money-laundering-terrorist-financing), [FCA Financial Crime Guide](https://handbook.fca.org.uk/handbook/fcg3) and [UK record-keeping guidance](https://www.gov.uk/guidance/money-laundering-regulations-your-responsibilities).
- Canada: [FINTRAC securities dealers](https://fintrac-canafe.canada.ca/re-ed/sec-eng), [identity verification](https://fintrac-canafe.canada.ca/guidance-directives/client-clientele/client/sec-eng.php), [PEP requirements](https://fintrac-canafe.canada.ca/guidance-directives/client-clientele/pep/pep-acct-eng.php) and [securities-dealer record keeping](https://fintrac-canafe.canada.ca/guidance-directives/recordkeeping-document/record/sec-eng).

## Required sign-offs before activating a corridor

- Local securities counsel confirms CCN's role, partner licensing, solicitation, promotion, advice, custody and product-by-product offerability.
- AML/MLRO owner approves the jurisdiction policy, risk model, screening provider/list coverage, EDD triggers, reporting procedures and retention.
- Tax counsel approves FATCA/CRS classification, forms, indicia cure and reporting responsibility.
- Privacy counsel approves controller/processor roles, cross-border transfer mechanism, notices, consent/other lawful basis, subject rights and breach response.
- Each licensed partner contract assigns final KYC, suitability, execution, transaction-monitoring, suspicious-reporting, sanctions and record-production ownership.
- Compliance tests the full lifecycle, including rejection, needs-information, PEP/high-risk escalation, expired review, revocation and evidence access isolation.
