# Handoff — Venue Runbook

3 August 2026 · Frontier Tower, San Francisco · submission **3:30 PM**

The product is built and rehearsable tonight. Tomorrow is credentials, live-wiring,
rehearsal, and submitting early. See [app/README.md](app/README.md) for architecture,
[problem-statement.md](problem-statement.md) for what judges were told to look for.

---

## 0. Before you sleep tonight

The official setup checklist says do account creation *before* the event. All four are
self-serve:

- [ ] **RocketRide.ai** — account + API key (the *promo code* is Discord-only tomorrow)
- [ ] **Guild.ai** — account + workspace/API access
- [ ] **FalkorDB** — cloud instance, or just `npm run falkor` for local Docker
- [ ] **LaserData** — free tier cloud account, or local Laser Stack
- [ ] Optional: Linkup, Snyk
- [ ] Join both Discords: [RocketRide](https://discord.com/invite/PMXrtenMsY) (submission + promo code) and [LaserData](https://discord.gg/QXVbqWxHHb)

Paste every sponsor key into `app/config.js`. The model API key lives in
`app/.env` (gitignored) and is already set. Nothing else needs editing.

> ⚠️ **Rotate the OpenAI key after the hackathon.** It was pasted into a chat
> transcript, so treat it as public. Everything still runs without it —
> `LLM_ENABLED=off` falls back to deterministic logic — so rotating it cannot
> break the demo.

---

## 1. Venue schedule

| Time | What |
|---|---|
| 9:30–10:00 | Arrive. Grab the RocketRide promo code from Discord, redeem on RocketRide Cloud. Paste keys into `config.js`. |
| 10:00–11:00 | During opening talks: deploy the pipeline to RocketRide Cloud. Run `curl localhost:4173/api/smoke` until all four report live. |
| 11:00–12:00 | Wire live mode one service at a time (see §2). Verify one real email, one real calendar invite, one real Jira ticket. |
| 12:00–1:00 | Lunch: Snyk scan, LinkedIn post for the $250 social track, and walk the sponsor tables — that is how sponsor judges learn your project exists. |
| 1:00–2:30 | Full rehearsal in replay. Full rehearsal in live. Fix what breaks. |
| 2:30–3:15 | Freeze code. Record the backup screen capture. |
| **3:15** | **`/submit` in the RocketRide Discord — 15 minutes early.** |
| 4:00–4:40 | If top 5: demo. |

## 2. Going live, one service at a time

Never flip everything at once — you lose the ability to tell which thing broke.

```bash
HANDOFF_FALKOR_MODE=live npm start        # then the next, then the next
HANDOFF_LASER_MODE=live npm start
HANDOFF_ROCKETRIDE_MODE=live npm start
HANDOFF_GUILD_MODE=live npm start
HANDOFF_MODE=live npm start               # everything, once each has passed alone
```

After each one:

```bash
curl -s localhost:4173/api/smoke | python3 -m json.tool
```

Every check reports `ok`, the latency, and whether it ran live or fell back. The header
badges in the UI turn from grey to green as each service comes up — that is also your
judge-facing proof, so get all four green before the demo.

**If a service refuses to connect, stop trying.** It already falls back and the demo is
unaffected. Spend the time on rehearsal instead.

## 3. The demo — 3 minutes

**Before you start:** reload the page so you are on the cold-open screen. Check the four
header badges. Have a second browser tab open on the real Gmail/Calendar/Jira if live.

| | Beat | What you say |
|---|---|---|
| **0:00** | Cold open. Type **Sarah Chen**, press Trace. | "Every company has a Sarah. The one person who knows why the retry queue gets bypassed during an outage, why the cron runs at 3am, why that config value is 7 and not 8. Two weeks ago, ours resigned." |
| **0:20** | The graph blooms. **11 assets pulse red**, then the gap nodes land and it climbs to **19**. The Cypher panel shows the query. The run holds here for ~3s — that pause is deliberate, let it breathe. | "Everything red has exactly one human edge — hers. That's not a guess, that's one query against FalkorDB over 240 commits. In nine days, all of it leaves." |
| **0:45** | The feed moves: sessions booked, tickets filed, doc drafted. Point at the agent strip handing off. | "Four agents, not one prompt. The Mapper built the memory. The Gap-Hunter found what dies. Now the Rescuer is executing — the email and the Jira tickets go out through Guild, because those land in a human's inbox; the calendar, the doc and the revocation run through RocketRide. Watch the tag on each receipt." |
| **1:10** | **The approval gate stops everything.** Hand the laptop to a judge. | "It won't revoke her production access on its own. That one needs a human. Would you?" *(judge clicks approve)* |
| **1:30** | The interview dock opens. The agent **speaks the question aloud.** | "Here's the part a repo scan can't do. It's only asking about things with no written trace anywhere." |
| **1:45** | **Give a deliberately empty answer first** (see below). It gets rejected and the agent presses you. Then answer properly — a red node turns green, the meter climbs. | "Watch this —" *(give the waffle answer)* "It has every keyword we were looking for and it still failed, because the agent is judging whether someone could actually act on it. Let me try again." *(answer properly)* "That's her reasoning being written into memory as she speaks." |
| **2:15** | Press **M**. Ask: *"If Marcus takes over the ranking pipeline tomorrow, what is he most likely to get wrong?"* | "And now anyone can ask. This is a graph, so it knows which files Marcus has *never* touched — and it quotes what Sarah just told us, thirty seconds ago." |
| **2:40** | Press **C** for the closing card. | "Sixty to ninety-three. Fifteen real actions. Four agents. One human decision." |
| **2:50** | Close. | "Git gave us version control for code. Handoff is version control for the knowledge in people's heads. Memory, meet motion." |

**The waffle answer, memorised** — say it confidently, it is meant to sound good:

> *"We set the diversity weight to 0.37 after careful analysis and extensive experimentation with the churn and skip rate metrics over several quarters."*

It contains *churn*, *skip rate* and *experiment* — every concept the gap expects
— and the grader rejects it and asks what specifically breaks when it is raised.
This is the single most convincing fifteen seconds in the demo: it proves the
evaluation is real. `npm run eval` shows the same thing in a terminal if a judge
wants to poke at it.

**If a judge asks whether another agent can use this**, run the MCP server in a
terminal and let them ask from their own Claude:
`claude mcp add handoff -- node "$(pwd)/app/mcp/server.js"`

### The two lines that win the Q&A

- **"Which of the four is doing the work?"** — *LaserData hears the resignation, FalkorDB
  remembers everything she touched, Guild's four specialists decide what dies with her,
  Guild and RocketRide execute it. Pull any one out and it stops working."*
- **"Why doesn't it reach 100%?"** — *"Because it shouldn't. Several of her heuristics we
  inferred from six years of commits and she never confirmed them. That last 6% is exactly
  what the human handover meeting is for — and now that meeting has an agenda."*

## 4. When something breaks

| It breaks | Do this |
|---|---|
| A live API dies mid-run | Nothing. It already fell back and logged it. Keep talking. |
| The model API is slow or down | Grading falls back to concept matching, chat falls back to showing raw retrieved memory. Both say so on screen. If it is *slow* rather than down, restart with `LLM_ENABLED=off npm start` — instant, deterministic, and the demo still lands. |
| Ask-memory returns something wrong | Say so and click the citations — the whole point is that every claim is traceable. A judge watching you check your own system's work is a good look, not a bad one. |
| Speech recognition fails | Click **type instead**. Same flow, no voice. Budget 5 seconds. |
| The agent's voice is inaudible in the room | The question is on screen at 17px. Read it aloud yourself. |
| Everything is broken | `Shift+R`, then run in replay. It has no external dependencies at all. |
| Total laptop failure | Play the backup screen recording. |
| Judge suspects a canned demo | Type a different name at the cold open — the roster is right there. Marcus Webb runs a genuinely different graph. Offering this is worth more than doing it. |

## 5. Things worth saying out loud to judges

- Every action tagged `simulated` in the feed is simulated, and it says so on screen.
  Volunteering that buys you credibility for everything you claim is real.
- The seed data never marks a file as solo-owned. The graph derives it from commit
  authorship. Say that when you show the query.
- The coverage number is computed from weighted knowledge units, not a progress bar.
  `npm run smoke` prints the whole calculation if anyone wants to see it.
- The decision patterns were written by reading her commits, not by us. Say it when
  the "how she thinks" panel comes up — it is the difference between a demo and a fixture.
- The whole model layer is optional. `LLM_ENABLED=off` and the product still runs.
  Judges have seen a lot of projects that are a prompt in a trenchcoat; being able to
  say "the graph, the agents and the actions are all real without it" is worth saying.

## 6. Not built, on purpose

- Real repo ingestion (the seeded corpus is deterministic, which is what a demo needs)
- Auth, multi-tenancy, persistence between runs
- The P2 "handover doc rendered in the UI" — the doc is drafted and its receipt is in the
  feed, but there is no viewer for it

If asked what is next: real GitHub/Jira ingestion, and running the interview asynchronously
over Slack so it doesn't need a meeting at all.
