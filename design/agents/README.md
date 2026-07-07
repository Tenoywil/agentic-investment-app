# CCN — Agentic System Design

Design of the **Caribbean Capital Network (CCN)** AI capital agent: one agent for a
whole Caribbean portfolio that researches regional opportunities, acts inside
limits you set, and escalates larger moves for approval. This document specifies
the agent architecture, orchestration, human-in-the-loop control, data sources,
and key decision points, with the workflow diagrams the design is built around.

> Diagrams are authored in Mermaid (`*.mmd`) and rendered to `exports/*.svg` and
> `exports/*.png`. GitHub renders the inline Mermaid below directly.

## Stack

A pragmatic stack that fits the product and the existing prototype (the Warm
build already ships as a React UI on Vercel):

| Layer | Choice | Why |
| --- | --- | --- |
| Client | React app on **Vercel** | Existing Warm prototype; fast static + edge delivery. Voice via Web Speech / TTS. |
| API + agent runtime | **Supabase Edge Functions (Deno)** | Server-side home for the Claude tool-use loop and the guardrail/limits engine — secrets and partner calls never touch the client. |
| Agent model | **Anthropic Claude** (tool use) | Orchestrator + specialist agents as tool-calling loops. |
| Data | **Supabase Postgres** (in-region) | Holdings, instruments, limits, approvals, goals, immutable audit log. Row-level security per user. |
| Live updates | **Supabase Realtime** | Push portfolio changes and "Needs your approval" cards to the client. |
| Docs | **Supabase Storage** | KYC / source-of-funds documents, held in-region. |
| Auth | **Supabase Auth** | Sessions; KYC-gated activation. |
| External | FSC-licensed **partner APIs**, market/reference data, **KYC/AML** provider | Custody, execution, quotes, verification. |

**Regulated & regional by construction:** every instrument is custodied and
executed by an FSC-licensed partner; KYC, suitability, and source-of-funds are
handled before the agent can act; data is held in-region.

## 1. System architecture

Where the agent runs and what it talks to.

```mermaid
%% CCN — System Architecture (agent runtime + stack)
flowchart TB
    subgraph Client["Client · React on Vercel"]
        UI["Warm Web App<br/>Home · Portfolio · Opportunities<br/>Agent · Planning · Institutions"]
        VOICE["Voice I/O<br/>speech-to-text · TTS readout"]
    end

    subgraph Runtime["API &amp; Agent Runtime · Supabase Edge Functions (Deno)"]
        ORCH["Capital Agent — Orchestrator<br/>Claude tool-use loop"]
        GUARD["Guardrail &amp; Limits Engine<br/>risk band · per-move limits"]
        AUD["Audit Log Writer<br/>immutable action trail"]
    end

    subgraph Data["Data · Supabase (in-region)"]
        PG[("Postgres<br/>holdings · instruments · limits<br/>approvals · goals · audit")]
        RT{{"Realtime channels<br/>portfolio · approval cards"}}
        STG[("Storage<br/>KYC / source-of-funds docs")]
        AUTH["Supabase Auth<br/>session · row-level security"]
    end

    subgraph External["External · FSC-licensed partners &amp; providers"]
        PART["Partner APIs<br/>NCB · Sagicor · JMMB · Proven<br/>Barita · Republic · Sygnus"]
        MKT["Market &amp; Reference Data"]
        KYCP["KYC / AML / Source-of-Funds"]
        LLM["Anthropic Claude API"]
    end

    UI <-->|HTTPS / RPC| Runtime
    VOICE <--> UI
    UI -->|login| AUTH

    ORCH <-->|reason · tool calls| LLM
    ORCH --> GUARD --> AUD --> PG
    Runtime <-->|read / write| PG
    Runtime -->|push| RT --> UI
    Runtime <-->|holdings · quotes · orders| PART
    Runtime <-->|prices| MKT
    Runtime <-->|verify| KYCP
    STG --- Runtime
```

## 2. Agent orchestration

A single **Capital Agent** orchestrator plans and delegates to specialist agents,
each exposed to it as a tool. They share context (your limits, risk band,
portfolio state, audit) so decisions are consistent.

```mermaid
%% CCN — Agent Orchestration (orchestrator + specialist agents)
flowchart TB
    USER((User)) -->|"chat · schedule · market event"| ORCH

    ORCH["Capital Agent · Orchestrator<br/>plans, delegates, composes replies"]

    subgraph Specialists["Specialist agents (tools of the orchestrator)"]
        RES["Research Agent<br/>scan ~47 instruments · 8 partners<br/>Opportunities marketplace"]
        RISK["Risk &amp; Suitability Agent<br/>risk band · concentration · suitability"]
        EXE["Execution Agent<br/>route &amp; place orders within limits"]
        PLAN["Planning Agent<br/>insurance · retirement · estate · mortgage<br/>goal progress rings"]
        COMP["Compliance Agent<br/>KYC · AML · source of funds"]
    end

    ORCH -->|"find yield / idle cash"| RES
    ORCH -->|"score candidate"| RISK
    ORCH -->|"place approved move"| EXE
    ORCH -->|"track goals"| PLAN
    ORCH -->|"gate actions"| COMP

    RES -->|"ranked opportunities"| ORCH
    RISK -->|"in-band? + rationale"| ORCH
    EXE -->|"order status / fills"| ORCH
    PLAN -->|"progress + gaps"| ORCH
    COMP -->|"cleared / blocked"| ORCH

    ORCH -->|"proposal · approval card · voice"| USER

    MEM[("Shared context<br/>user limits · risk band<br/>portfolio state · audit")]
    ORCH <--> MEM
    Specialists <--> MEM
```

| Agent | Responsibility | Reads | Acts on |
| --- | --- | --- | --- |
| **Capital Agent** (orchestrator) | Plans, delegates, composes replies, owns the approval loop | Shared context | Proposals, approval cards, voice |
| **Research** | Surface opportunities across ~47 instruments / 8 partners | Partner APIs, market data | Ranked candidate list |
| **Risk & Suitability** | Check against risk band, concentration, suitability | Portfolio, risk band | In-band verdict + rationale |
| **Execution** | Route and place orders **within limits** | Limits, approvals | Partner order APIs |
| **Planning** | Track insurance / retirement / estate / mortgage goals | Goals, holdings | Progress rings, gap flags |
| **Compliance** | KYC / AML / source-of-funds gating | KYC store, provider | Clear / block |

## 3. Agentic workflow — the money loop *(primary diagram)*

End-to-end: inputs → research → **decision points** → human-in-the-loop →
execution → outputs → audit. This is the diagram that answers "inputs, agent
orchestration, human-in-the-loop steps, data sources and APIs, outputs, and key
decision points."

```mermaid
%% CCN — Agentic Workflow (inputs → orchestration → HITL → outputs)
flowchart TD
    subgraph IN["Inputs"]
        I1["User goals &amp; risk band"]
        I2["Per-move &amp; daily limits"]
        I3["Portfolio state (8 partners)"]
        I4["Market events · maturing coupons · idle cash"]
    end

    IN --> RES["Research Agent<br/>surface opportunity across partners"]

    subgraph SRC["Data sources &amp; APIs"]
        D1["Partner APIs · FSC-licensed"]
        D2["Market &amp; reference data"]
        D3["KYC / AML / source-of-funds"]
    end
    D1 -.feeds.-> RES
    D2 -.feeds.-> RES

    RES --> SUIT{"In risk band<br/>&amp; suitable?"}
    SUIT -- No --> DROP["Log rationale · discard"]:::terminal
    SUIT -- Yes --> COMPG{"Compliance clear?<br/>KYC / AML / limits"}
    D3 -.checks.-> COMPG
    COMPG -- Blocked --> DROP
    COMPG -- Clear --> LIM{"Within your<br/>set limits?"}

    LIM -- "Yes · auto-act" --> EXE["Execution Agent<br/>place order via partner API"]
    LIM -- "No · larger move" --> CARD["Create &quot;Needs your approval&quot; card"]

    CARD --> HITL{"Human approves?<br/>one-tap"}
    HITL -- "Approve" --> EXE
    HITL -- "Reject / expire" --> DROP

    EXE --> SETTLE["Custody &amp; settlement<br/>at licensed partner"]
    SETTLE --> UPD["Update unified portfolio<br/>(Realtime)"]

    subgraph OUT["Outputs"]
        O1["Approval / result card"]
        O2["Voice readout + projected yield impact"]
        O3["Portfolio &amp; goal rings updated"]
    end
    UPD --> OUT
    OUT --> LOG[("Immutable audit log<br/>KYC/AML trail")]:::terminal

    classDef terminal fill:#e8f1ec,stroke:#0e5952,color:#0e5952;
```

**Key decision points**
1. **In risk band & suitable?** — Risk agent rejects anything outside your band.
2. **Compliance clear?** — KYC / AML / source-of-funds and hard limits.
3. **Within your set limits?** — the auto-act vs. escalate fork. At or below your
   limit the agent acts; above it, the move becomes an approval card.
4. **Human approves?** — one-tap Approve; reject or expiry means no order.

## 4. Human-in-the-loop approval

The escalation path in detail — how a larger move becomes an approval card and,
once approved, an executed order with an audit entry.

```mermaid
%% CCN — Human-in-the-loop approval (sequence)
sequenceDiagram
    autonumber
    actor U as User
    participant AG as Capital Agent
    participant GL as Guardrail / Limits
    participant EX as Execution Agent
    participant PA as Partner API (FSC)
    participant DB as Supabase (PG + Realtime)

    AG->>GL: proposed move (instrument, amount, rationale)
    GL-->>AG: exceeds set limit → approval required
    AG->>DB: create approval card + snapshot
    DB-->>U: Realtime "Needs your approval" (+ voice)
    U->>DB: one-tap Approve
    DB-->>AG: approval event (scope, timestamp)
    AG->>EX: execute within approved scope
    EX->>PA: place order
    PA-->>EX: fill / confirmation
    EX->>DB: write holding + immutable audit entry
    DB-->>U: portfolio updated (+ voice: projected yield impact)
    Note over AG,DB: If rejected or expired → no order, rationale logged
```

## 5. Data & API integration

Aggregation in, order routing out, compliance in the middle — all custodied and
executed at FSC-licensed partners.

```mermaid
%% CCN — Data &amp; API integration map
flowchart LR
    subgraph Partners["FSC-licensed partners (custody &amp; execution)"]
        P1["NCB"]
        P2["Sagicor"]
        P3["JMMB"]
        P4["Proven"]
        P5["Barita"]
        P6["Republic"]
        P7["Sygnus"]
    end

    subgraph CCN["CCN Platform"]
        AGG["Aggregation &amp; Normalization<br/>unify holdings · yield · allocation"]
        ROUTER["Order Router<br/>place / cancel within limits"]
        GATE["Compliance Gateway<br/>KYC · AML · suitability"]
        STOREPG[("Supabase Postgres<br/>in-region")]
    end

    MKT["Market &amp; reference data"]
    KYCP["KYC / AML / source-of-funds provider"]

    P1 & P2 & P3 & P4 & P5 & P6 & P7 -->|"holdings · quotes · statements"| AGG
    ROUTER -->|"orders"| P1 & P2 & P3 & P4 & P5 & P6 & P7
    MKT -->|"prices · yields"| AGG
    AGG --> STOREPG
    GATE <--> KYCP
    ROUTER --> GATE
    AGG -->|"unified live view"| APP["Web app · Agent"]
    GATE --> STOREPG
```

## 6. Onboarding / KYC gate

The agent cannot act until KYC + source-of-funds are verified, a risk band is set,
and limits are configured.

```mermaid
%% CCN — Onboarding / KYC gate (agent activation)
flowchart TD
    S(("Start")) --> SIGN["Sign up · Supabase Auth"]
    SIGN --> KYC{"KYC + source of<br/>funds verified?"}
    KYC -- No --> COLL["Collect documents<br/>→ Supabase Storage"]
    COLL --> REV["Compliance Agent review<br/>(KYC/AML provider)"]
    REV --> KYC
    KYC -- Yes --> SUIT["Suitability assessment<br/>→ set risk band"]
    SUIT --> LIM["Set agent limits<br/>per-move · daily · categories"]
    LIM --> CONNECT["Connect FSC partners<br/>(read + trade scopes)"]
    CONNECT --> ACTIVE(("Agent active<br/>within your limits"))
```

## Guardrails & data model (supporting)

**Guardrails** (enforced server-side, not by the model):
- Every proposed action passes the **Limits Engine** before execution; the model
  can *propose* but cannot bypass a limit.
- Risk band and per-move / daily / category caps are user-set and stored in Postgres.
- Every action (proposed, approved, rejected, executed) is written to an
  **immutable audit log** with the KYC/AML trail.
- Partner scopes are explicit (read vs. trade); trade scope requires an active
  approval or an in-limit auto-act.

**Core tables** (illustrative): `users`, `partners`, `instruments`, `holdings`,
`limits`, `risk_profiles`, `opportunities`, `approvals`, `goals`, `audit_log`,
`kyc_documents`.

## Files

| File | Diagram |
| --- | --- |
| `01-system-architecture.mmd` | System architecture / stack |
| `02-agent-orchestration.mmd` | Orchestrator + specialist agents |
| `03-agent-workflow.mmd` | **Primary** end-to-end agentic workflow |
| `04-approval-sequence.mmd` | Human-in-the-loop approval sequence |
| `05-data-api-integration.mmd` | Data & API integration map |
| `06-onboarding-kyc.mmd` | Onboarding / KYC gate |

Rendered `*.svg` and `*.png` for each live in `exports/`. To re-render:

```bash
npx @mermaid-js/mermaid-cli -i design/agents/03-agent-workflow.mmd \
  -o design/agents/exports/03-agent-workflow.png -b white -s 2
```
