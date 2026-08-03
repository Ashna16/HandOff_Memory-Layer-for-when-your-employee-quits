# Handoff — Build Plan

Plan of record for the Memory Meets Motion hackathon, Aug 3 2026 — **Frontier Tower, SF**.
References: [handoff-spec.md](handoff-spec.md) (product spec), [hackathon-details.md](hackathon-details.md) (Luma listing), and [problem-statement.md](problem-statement.md) (**official problem statement — read this one first**).

---

## 0. The three facts that shape everything

**1. Real hacking time is ~3.5 hours, not a day.**
Per the official agenda: hacking begins 11:00 AM, lunch eats 12:00–1:00, submission is **3:30 PM sharp** (via `/submit` in the RocketRide Discord). That is 3.5 hours of keyboard time at the venue. The spec's "~90 min at venue" assumption is right in spirit: **everything that can be built before the event must be built tonight (Aug 2).** The venue is for API keys, live-wiring, rehearsal, and submission — not for building.

**2. The spec's sponsor list is out of date — Flexprice is not a sponsor.**
The Luma listing names six partners: RocketRide, FalkorDB, Guild.ai, LaserData, Linkup, and **Snyk**. Flexprice appears nowhere. Corrections:

- **Cut the Flexprice invoice beat** from the demo (spec §4, §5-P1, §8 step 4). Replace the "receipts" moment with the Guild run log + coverage metric alone — it already lands the same "this is a product" point. If a cost angle is wanted, render a simple self-computed "cost of this offboarding run" panel with no vendor dependency.
- **Add Snyk in a load-bearing cameo:** Handoff's day-zero offboarding step already includes access revocation; extend it with "departing employee's solo-owned code gets a Snyk scan before ownership transfer" — one real scan of the seeded repo, one screenshot-grade finding in the UI. Cheap to add (free signup, no credit card), and it makes every sponsor in the room load-bearing again. Also grab the free AI Security Engineer cert if there's downtime — judges from Snyk notice that.

Also note: the only *explicitly published* prizes are RocketRide's ($1000 Best Use of RocketRide + $250 social track). That makes RocketRide-centrality not just architecture but prize strategy — the ingestion/analysis pipeline must demonstrably run on **RocketRide Cloud** (deployed, not just local open-source), since the prize wording is "build the most with RocketRide" and "deploy an AI pipeline without managing infrastructure."

**3. The official problem statement flips the spec's RocketRide/Guild split — and mandates all four tools.**
Per [problem-statement.md](problem-statement.md): judges will **specifically check for load-bearing use of all four** of FalkorDB, RocketRide, Guild.ai, LaserData ("a one-line SDK import that's never called again will not count"). And the official role definitions are the *reverse* of the spec's §4 assignment:

- **RocketRide is the motion/execution layer** — "the execution engine that reads from FalkorDB memory and decides/executes the next action … sending an email, booking something, updating a record." So the machine-facing actions (calendar, handover doc, access revocation) and the whole analysis pipeline execute through **RocketRide**. The two actions addressed to a *person* — the email to the departing engineer and the Jira tickets assigned to successors — run on **Guild’s built-in integrations**, which Jaidev has wired and won with before. That keeps the split honest (Guild owns whatever a human receives or decides) and is the lower-risk path on a 3.5-hour clock.
- **Guild.ai is the multi-agent coordination layer** — specialist agents with handoffs, plus human-in-the-loop gates. So Handoff restructures as a **guild of specialist agents**: a *Mapper* (builds the graph), a *Gap-Hunter* (finds what dies with her), an *Interviewer* (runs the voice exit interview), and a *Rescuer* (plans the outbound actions) — coordinated by Guild, with the **approval gate promoted from P1 to P0** (human-in-the-loop is Guild's flagship feature; the judge clicking "approve" on a risky action is now a mandatory beat, not a nice-to-have).

The spec's judge-facing line "RocketRide builds the memory; Guild governs the motion" is now wrong — retire it. Use the official data-flow line instead: **"LaserData hears the resignation → FalkorDB remembers everything she touched → Guild's specialist agents decide what dies with her and what to do about it → RocketRide executes the rescue → the feed shows the result."** This matches the reference architecture judges were handed, verbatim in spirit.

Consequences: Linkup and Snyk are *optional* partners (not in the mandated four) — they stay as garnish, first to cut. The four mandated integrations get built and verified before anything optional.

---

## 1. Tonight (Aug 2) — prebuild everything

> **STATUS: BUILT.** The whole product runs in [app/](app/) — `cd app && npm start`, no dependencies,
> no build step. Phases A–C are complete and the full arc is verified end to end: cold open →
> red bloom (19 at-risk nodes) → four-agent handoff → human approval gate → 15 executed actions
> → voice exit interview → **61% → 94%** coverage. `npm run smoke` runs the whole pipeline
> headless and prints every number. Only Phase D (rehearsal + backup recording) and the venue
> credential work remain. See [RUNBOOK.md](RUNBOOK.md) for the demo script and failure drills,
> and [app/README.md](app/README.md) for architecture.
>
> Two design decisions worth knowing before you rehearse:
> - **Coverage is computed, not scripted.** Weighted knowledge units earn credit for a second
>   owner, shared docs, a booked transfer, or a recorded answer. 61% and 94% fall out of the model.
> - **The ceiling is 95%, on purpose.** Several of her heuristics are inferred from commits and
>   no interview question confirms them. That residue is the argument for the human meeting —
>   it turns "our agent isn't perfect" into the strongest line in the pitch.

Ordered so that if you stop at any point, everything above the line is demoable in replay mode.

### Phase A — Skeleton + seeded world (highest priority)
1. **Repo + project scaffold.** Single-page web app (Vite + vanilla/React), local server, one `config.ts` with every API key/flag in one place, and the global `MODE=live|replay` switch from spec §6.
2. **Seed the Spotify scenario** (lock the open decision — Spotify/Discover Weekly, spec §10.2). Generate with Claude tonight:
   - Git repo, ~200 scripted commits, Sarah sole-author on the ranking-pipeline files
   - ~30 Jira-shaped tickets as JSON (3 open ones referencing knowledge only she has)
   - Runbooks/docs with authorship metadata
   Deterministic seed data = deterministic demo (spec §9).
3. **Graph model + ingestion running locally.** Ingest seed data into FalkorDB (free Docker image locally tonight; FalkorDB Cloud at venue if easy). Implement the hero Cypher query: *nodes whose only human edge is Sarah*. Snapshot the query results to JSON — this is also your replay fixture.

### Phase B — The two wow moments
4. **Graph UI: "what dies with her."** Type her name → graph blooms → 17 nodes pulse red. This is the 15-second wow; give it the most polish budget. Pick the design direction tonight (open decision §10.1) — do not leave visual design for the venue. Load the `dataviz` skill when building it.
5. **Voice interview loop, replay-grade.** Web Speech API STT/TTS (no key, offline — the safe default per spec §6). Agent asks gap-targeted questions aloud → transcript → gap node flips red→green → coverage meter climbs. Build the chat-mode fallback in the same component.

### Phase C — Motion + streams (replay stubs tonight, live at venue)
6. **LaserData stream client** behind the dual-mode interface: resignation event in, agent actions out, powering the activity feed. Replay mode = local event emitter with realistic latency; live mode = LaserData SDK (wire tomorrow). Also run the local **Laser Stack** tonight per the quickstart docs so replay mode can optionally be a *real local stream*, not just a stub.
7. **Guild multi-agent structure + approval gate (P0 now).** Define the four specialist agents — Mapper, Gap-Hunter, Interviewer, Rescuer — with Guild coordinating handoffs, and the human-in-the-loop gate on risky actions (access revocation / external email). Tonight: agent roles + handoff logic + the approval UI beat, replay-stubbed; live Guild wiring at venue.
8. **RocketRide as the execution engine**, defined and runnable locally via the open-source harness: (a) the analysis pipeline — ingest → graph build → solo-ownership detection → gap detection → rescue plan — and (b) the **action execution**: email, calendar invite, Jira ticket, doc draft (replay stubs tonight; live at venue). Read the RocketRide Notion guide tonight so Cloud deployment tomorrow is a paste-the-promo-code job.
9. **Linkup panel (P1)** with a canned replay response for the ~14-week rehire estimate; live call is a 10-minute venue task if time allows.

### Phase D — Demo hardening
10. **Full replay-mode rehearsal** of the 3-minute script (spec §8, minus Flexprice beat). Record a backup screen capture of the whole happy path — the fallback behind the fallback.
11. **Draft tomorrow's LinkedIn post** (RocketRide social track: post + tag RocketRide, follow Instagram, join Discord — all doable during lunch).

### Cut lines if tonight runs short
P2 items (second-employee run, handover doc render) are already stretch. First P1 to cut: Linkup panel. Never cut: graph wow, voice interview, activity feed — those three *are* the demo.

## 2. Tomorrow (Aug 3) — venue schedule

| Time | What |
|---|---|
| 9:30–10:00 | Arrive early. Join RocketRide Discord, grab promo code, redeem on RocketRide Cloud. Paste all keys into `config.ts` (accounts themselves created **tonight** per the official setup checklist in [problem-statement.md](problem-statement.md) §5). |
| 10:00–11:00 | During opening talks (laptop work): deploy the RocketRide pipeline to Cloud; run smoke test. |
| 11:00–12:00 | Wire live mode: LaserData stream, Guild email/Jira integrations + agent coordination + approval gate, RocketRide calendar/doc/revoke. Verify each real action once. |
| 12:00–1:00 | Lunch: run the Snyk repo scan + capture the finding; do the social-track post; ask sponsor mentors to sanity-check your use of their tool (this is also how sponsor judges learn your project exists). |
| 1:00–2:30 | Full rehearsal in replay, then full rehearsal in live. Fix whatever breaks. Decide voice stack (Web Speech vs hosted) based on venue wifi — spec §10.3. |
| 2:30–3:15 | Polish, record final backup capture, freeze code. |
| **3:15** | **`/submit` in Discord — 15 min early. Never race a deadline you can beat.** |
| 4:00–4:40 | If top 5: demo in live mode, one flag-flip from replay if wifi dies mid-pitch. |

## 3. Updated sponsor map (supersedes spec §4 table; aligned to official role definitions)

**Mandated four** — judges verify load-bearing use of each:

| Sponsor | Official role | In Handoff | Prize angle |
|---|---|---|---|
| FalkorDB | The memory layer | Knowledge graph (assets + thinking-patterns layer) + hero "what dies with her" Cypher query; written to continuously as the interview rescues gaps | Hero visual of the demo |
| RocketRide **Cloud** | The motion/execution layer | Analysis pipeline (ingest → graph → gaps → rescue plan) **and** executor of real actions: email, calendar, Jira, doc draft — deployed on Cloud | The only published $1000 prize; be maximal here. Also do the $250 social track. |
| Guild.ai | Multi-agent coordination | Guild of specialists — Mapper, Gap-Hunter, Interviewer, Rescuer — with handoffs and the human approval gate on risky actions (P0) | Likely under-targeted by other teams (arbitrage holds) |
| LaserData | Real-time data layer | Resignation event in on a durable stream; every agent action out as replayable events → live activity feed; stream persists into FalkorDB | Event-driven architecture is literally their pitch |

**Optional partners** (garnish; first to cut):

| Sponsor | In Handoff |
|---|---|
| Linkup | Rehire-market pricing panel (~14 weeks) reordering rescue priorities |
| Snyk | Security gate at offboarding — scan her solo-owned code pre-transfer |

Judge-facing data-flow line (replaces the retired "RocketRide builds the memory; Guild governs the motion"): **LaserData hears the resignation → FalkorDB remembers everything she touched → Guild's specialist agents decide what dies with her → Guild and RocketRide execute the rescue → the feed shows the result.**

## 4. Top risks

1. **3:30 deadline vs live integrations** → replay mode is the product tonight; live mode is a venue upgrade. Anything not live by 2:30 PM demos in replay, no exceptions.
2. **Venue wifi kills voice or APIs mid-demo** → Web Speech API default (offline), one-flag replay flip, plus recorded screen capture as last resort. Rehearse the flip itself.
3. **Sponsor account/signup friction at venue** → the official checklist says do it *before* the event: create RocketRide, Guild, FalkorDB, LaserData (plus optional Linkup, Snyk) accounts **tonight**; only the promo-code redemption waits for the venue.
5. **A mandated tool reads as non-load-bearing** → judges explicitly check all four. Guild is the riskiest one to fake-look: the specialist-agent split + approval gate must be visibly real (show the Guild dashboard/handoff log, not just a diagram). Budget rehearsal time to narrating each tool's role in one sentence each.
4. **Judges suspect a canned demo** → keep the P2 "run a second employee live" card in your pocket; even offering it builds trust.
