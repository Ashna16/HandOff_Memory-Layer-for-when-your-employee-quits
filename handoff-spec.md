# Handoff

**Institutional memory, rescued before it walks out the door.**

Built for the Memory Meets Motion Hackathon — Devnovate, San Francisco, August 3, 2026.
Team: Jaidev Shah (solo).

---

## 1. The problem

When an employee resigns, companies lose two things: the artifacts they made, and the knowledge of *how they think*. The artifacts stay in the repo. The thinking leaves in two weeks.

Every engineering org has a "Sarah" — the one person who knows why the retry queue gets bypassed during outages, why the cron runs at 3 a.m., why that config value is 7 and not 8. When she resigns, that knowledge has a 9-day expiration date, and the standard response is a rushed handover meeting where nobody knows what questions to ask.

This is the "bus factor" problem, triggered not by a bus but by a resignation letter — and it happens at every company, constantly.

## 2. The product

Handoff is an autonomous agent that activates the moment a resignation event fires. It:

1. **Maps everything the employee ever touched** — mines repos, tickets, and docs into a knowledge graph, then identifies every asset whose *only* human edge is the departing employee ("what dies with her").
2. **Learns how she thinks** — extracts her decision patterns from PRs, commit messages, ticket comments, and incident threads ("when billing fails, she always checks the retry queue before the logs"). This becomes a second graph layer: not just what she owns, but how she reasons.
3. **Identifies what it couldn't learn** — knowledge gaps with no written trace become an interview agenda.
4. **Interviews her, by voice** — the agent conducts a live spoken exit interview targeting only the gaps ("In March you bypassed the retry queue. Walk me through your thinking."). Her answers are transcribed back into the graph in real time; gap nodes flip from at-risk to rescued as she speaks.
5. **Executes the rescue** — books real knowledge-transfer sessions on real calendars with auto-drafted agendas, sends real emails with targeted question lists, files real Jira handover tickets, drafts the handover doc skeleton, and queues access revocation for day zero.
6. **Prepares the humans** — generates the agenda for the human-to-human handoff meeting, covering only what the agent could not extract itself, so the one meeting humans get is spent on truly tacit knowledge.

**One-line pitch:** *Handoff doesn't just save what Sarah made. It interviews her to save how she thinks.*

## 3. Demo scenario

A recognizable real company (final pick pending — leading option: **Spotify**, where the engineer who owns the Discover Weekly ranking pipeline resigns). Seeded, realistic company data:

- A GitHub repo (~200 scripted commits; the departing engineer is sole author on the critical pipeline files)
- ~30 Jira tickets (she is assignee on the critical ones; 3 open tickets reference knowledge only she has)
- Markdown docs/runbooks with authorship metadata (she is sole editor of the key runbook)

**The 15-second wow:** type her name → the knowledge graph lights up red with everything that dies when she leaves → the agent starts rescuing it live — real calendar invites, real emails, real tickets scrolling in a feed — then the agent *calls her* and interviews her by voice, and the audience watches red nodes turn green as she answers.

## 4. Sponsor architecture

Theme mapping: **Memory** = FalkorDB + LaserData. **Motion** = RocketRide + Guild. Every sponsor has a load-bearing role — nothing is bolted on.

| Sponsor | Role | What it does in Handoff |
|---|---|---|
| **LaserData** | The ears | The resignation event arrives on a durable stream; every agent action (invite booked, ticket filed, node rescued) is published back as a replayable event, powering the live activity feed |
| **FalkorDB** | Long-term memory | The knowledge graph: `Sarah -authored-> file`, `file -belongs-to-> system`, `ticket -references-> file`, plus the thinking layer `Sarah -reasons-like-> pattern`. Core query: *find every node whose only human edge is Sarah* |
| **RocketRide** | The brain | The analysis pipeline: ingest repo/tickets/docs → build graph → detect solo-owned assets and knowledge gaps → produce the prioritized rescue plan |
| **Guild.ai** | The acting agent + control plane | Executes the outbound motion through its integrations (emails with question lists, calendar invites, Jira tickets); every run logged with metrics (gaps found, sessions booked, coverage 61% → 94%); risky actions gated behind approval |
| **Linkup** | Eyes on the world | Prices the loss: how long does this skill profile take to rehire in this market (~14 weeks) → reorders rescue priorities; fetches current external docs for tools only she configured |
| **Flexprice** | The business model | Every agent action is a metered event; at the end of a run, a real invoice renders ("this offboarding: 12 gaps found, 5 sessions booked, 9 tickets filed — $23.40"). Makes Handoff a sellable product, not a hack |

Judge-facing split (they will ask about RocketRide/Guild overlap): **RocketRide builds the memory; Guild governs the motion.**

Full data-flow one-liner: LaserData hears the resignation → FalkorDB remembers everything she touched and how she thinks → RocketRide figures out what dies with her (Linkup prices the loss) → Guild's agent rescues it with real emails, invites, and tickets → Flexprice invoices the run.

## 5. Key features (build scope)

### P0 — must exist for the demo
- Resignation event trigger via LaserData stream
- Ingestion of seeded repo + tickets + docs into FalkorDB
- "What dies with her" graph query + red/at-risk visualization
- Live agent activity feed (event-driven, from the stream)
- Guild agent executing real actions: email, calendar invite, Jira ticket
- Voice exit interview: agent asks gap-targeted questions aloud, transcribes answers, flips gap nodes to rescued in real time
- Knowledge-coverage meter animating as rescues land (61% → 94%)
- Replay mode: every external call has a recorded fallback so the demo survives dead wifi

### P1 — if time allows
- Thinking-pattern extraction shown explicitly in the UI (her decision heuristics as graph nodes)
- Linkup market-pricing panel
- Flexprice metered invoice at end of run
- Guild approval gate demo beat (agent pauses on a risky action; judge clicks approve)

### P2 — stretch
- Second employee run live on judge request (proves it's real, not canned)
- Handover doc auto-draft rendered in UI

## 6. Technical architecture

```
[Seeded company data]          [Resignation event]
  repo / tickets / docs               |
        |                       LaserData stream
        v                             |
  RocketRide ingestion  <-------------+
        |
        v
  FalkorDB graph  --(Cypher: solo-owned assets, gaps)--> Rescue plan
        |                                                    |
        v                                                    v
  UI graph view                                     Guild agent (motion)
  (red = dies with her)                     email / calendar / Jira / doc draft
        ^                                                    |
        |                                                    v
  Voice interview loop  <----- gap agenda          actions -> LaserData stream
  (STT -> transcript -> graph update)                        |
                                                             v
                                              Live activity feed + Flexprice metering
```

- **Voice:** browser Web Speech API for STT/TTS as the safe default (no API key, works offline); upgrade path to a hosted voice API if venue wifi is solid
- **UI:** single-page web app, served locally; visual design direction TBD (rejected so far: standard dashboards, newspaper/editorial, constellation, ICU monitor — direction to be picked from designer-grade references)
- **Demo resilience:** dual-mode client for every external service — `live` (real API) and `replay` (pre-recorded responses with realistic latency). Rehearse in replay, demo in live, flip one flag if anything breaks mid-pitch.

## 7. What must happen at the venue (~90 min)

1. Grab RocketRide Cloud promo code from Discord; create FalkorDB, Guild, Linkup accounts
2. Paste keys into single config file; run included smoke test
3. Wire Guild's Jira/email integrations (previously done by Jaidev in a past winning project)
4. One full rehearsal in replay mode; one in live mode

## 8. Demo script (3 minutes)

1. **(0:00) Cold open on the pain** — "Every company has a Sarah. Two weeks ago, ours resigned." Type her name. The graph blooms; 17 nodes pulse red. "Everything red dies with her in 9 days."
2. **(0:30) The agent moves** — activity feed comes alive: session booked, tickets filed, doc drafted. Point at real calendar/Jira on a second tab.
3. **(1:15) The interview** — the agent speaks, aloud, and asks Sarah (played live) about the March outage. She answers. A red node turns green on screen. Coverage meter climbs.
4. **(2:15) The receipts** — Guild dashboard: run logged, coverage 61% → 94%. Flexprice invoice renders. "Handoff turned a resignation into a checklist — and a product."
5. **(2:45) Close** — "Git gave us version control for code. Handoff is version control for the knowledge in people's heads. Memory, meet motion."

## 9. Judging strategy

- **Grand prize:** most literal expression of the theme in the room; real actions on real systems; live voice moment nobody else will attempt
- **Sponsor prizes:** each sponsor sees their tool in a hero role (see table); Flexprice and Guild likely under-targeted by other teams = prize arbitrage
- **Risk management:** deterministic seeded data, replay-mode fallback, chat-interview fallback if voice fails, all rehearsed before submission at 3:30 p.m.

## 10. Open decisions

1. Final UI design direction (pending — needs designer-grade reference alignment)
2. Final company for the scenario (leading: Spotify / Discover Weekly)
3. Voice stack: Web Speech API vs. hosted voice API (decide at venue based on wifi)
