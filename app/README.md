# Handoff

**Institutional memory, rescued before it walks out the door.**

An autonomous agent that fires on a resignation event, maps everything the departing
employee ever touched, works out what dies with them, interviews them by voice about
the parts that were never written down, and executes the rescue on real systems.

Built for Memory Meets Motion — Frontier Tower, San Francisco, 3 August 2026.

---

## Run it

```bash
cd app && npm start
```

No dependencies. No build step. Node 20+. Open http://localhost:4173.

```bash
npm run seed     # regenerate the seeded company (deterministic)
npm run smoke    # headless run of the whole pipeline, prints every number
npm run eval     # does the interview grader actually work? 6 cases, real path
npm run live     # every service in live mode (needs credentials in config.js)
npm run falkor   # local FalkorDB in Docker, if you want the real graph engine
npm run mcp      # MCP server over stdio, for other agents
```

### Secrets

`app/.env` holds the model API key and is gitignored. Nothing else in the repo
contains a credential, and `config.js` reads every one of them from the
environment.

> ⚠️ The key currently in `.env` was pasted into a chat transcript. **Rotate it
> after the hackathon** at platform.openai.com → API keys.

## The four mandated technologies, and what each one actually does

| | Layer | In Handoff | Load-bearing because |
|---|---|---|---|
| **FalkorDB** | Memory | The knowledge graph: people, files, docs, tickets, incidents, decision patterns, gaps. | The entire premise is one Cypher query — *find every asset whose only human edge is this person*. Remove FalkorDB and there is no product, just a list. |
| **RocketRide** | Motion | The five-step analysis pipeline, plus the machine-facing actions: calendar invite, handover doc, access revocation. | Every step of the analysis runs through `rocketride.js`, and no plan exists until it has run. |
| **Guild.ai** | Coordination + human contact | Four specialists — Mapper, Gap-Hunter, Rescuer, Interviewer — with explicit handoffs; a human approval gate on irreversible actions; **and** the two actions a person receives: the email and the Jira tickets. | The run is a sequence of agent turns, the revocation genuinely blocks until a person decides, and every human-facing message goes out through Guild's integrations. |
| **LaserData** | Real-time | The resignation arrives on a durable stream; every agent action is published back as a replayable event. | The UI renders the stream, not application state. Kill the stream and the interface goes dark. |

Linkup (rehire-market pricing) and Snyk (scanning code that is about to change owner)
are optional garnish and fail soft.

### Who executes what

Outbound actions are split by **audience**, not by convenience:

| | actions | why |
|---|---|---|
| **Guild** | the email to the departing engineer, the Jira tickets assigned to her successors, the approval gate | everything a human *receives or decides* belongs in the agent-to-human collaboration layer |
| **RocketRide** | the analysis pipeline, calendar invites, the handover doc, access revocation | orchestration and the machine work |

Each executor declares which action kinds it owns (`handles(kind)`), so moving
one across is a config change in `config.js`, not a code change. Every receipt
carries `via`, and the activity feed renders it — who did what is exactly what a
judge is checking.

## Design notes — why these colours

Node state is a **status** encoding (critical / warning / good), not a
categorical one, so it uses reserved status steps rather than series hues:
`#d03b3b` at-risk, `#fab219` transfer booked, `#0ca30c` rescued, and a
deliberately recessive `#464c56` for "has a second owner". The two action
executors are a *categorical* pair and use validated slots 1–2 — `#3987e5`
Guild, `#d95926` RocketRide — which clear every check all-pairs (CVD ΔE 26.8).

**Colour is never the only channel.** Every state also carries a mark shape:

| state | mark |
|---|---|
| at risk | solid disc + concentric ring — a bullseye |
| transfer booked | solid disc + open top arc — partially closed |
| rescued | donut, punched through — closed |
| has a second owner | small plain disc |

The legend draws those exact shapes as SVG rather than plain colour chips, so
it teaches the encoding. Verified by rendering the whole UI in greyscale: all
four states stay distinguishable with colour removed entirely.

**Two known validator failures, both deliberate:**

1. `#fab219` sits above the categorical lightness band. It is the fixed status
   warning step, which is documented as not re-themed per surface.
2. Red↔green measure ΔE 4.1 under deuteranopia on the all-pairs list. Red-green
   is *the* colour-vision collision, and no re-stepping fixes it while keeping
   green-means-good. The shape encoding above is the mitigation, and greyscale
   is a strictly harder test than deuteranopia.

Re-check any change with:

```bash
node scripts/validate_palette.js "#d03b3b,#fab219,#0ca30c" --mode dark --surface "#08090b" --pairs all
```

Other rules followed: proportional figures on hero numbers (`tabular-nums` only
where digits stack), a 2px surface ring separating overlapping marks rather than
a border, hairline recessive edges, ~24px hover targets over 3–12px marks with
nearest-point hit testing, and selective direct labels — only structural nodes
are labelled, the rest on hover.

## The reasoning layer

A small model (`gpt-5.4-mini` by default) does four jobs. Every one has a
deterministic fallback, and the UI always reports which answered — "our agent
judged this" and "our regex judged this" are different claims.

**1. Grading interview answers.** The interesting cases are the ones a keyword
matcher gets backwards:

| answer | keywords | verdict |
|---|---|---|
| "The compaction job grabs the hour boundary — starting on the hour means fighting it for IO." | almost none | **rescued** |
| "We set it to 0.37 after careful analysis of the churn and skip rate metrics over several quarters." | all of them | **rejected**, with a follow-up question |

`npm run eval` runs six such cases through the real path. Currently 6/6 at ~1.1s
per grade. If a model swap breaks either of the two rows above, don't ship it.

**2. Deriving her decision patterns** from actual commit text, so the "how she
thinks" layer is read out of the corpus rather than authored by us. Runs
concurrently with ingestion and lands as its own beat mid-run.

**3. Writing questions for assets no curated agenda covers.** This is what makes
"pick anyone on the roster and I'll run it live" a real offer — a person with no
hand-written questions still gets a real interview.

**4. Answering questions over the whole graph** — the memory chat, below.

Turn the whole layer off with `LLM_ENABLED=off` and the product still runs, on
concept matching and the seeded pattern text.

## Ask memory — GraphRAG over everything

The **ask memory** button (or `M`) opens a chat over the entire graph: her
commits, the tickets, the incidents, the decision patterns, and every answer she
gave in the exit interview.

It is GraphRAG rather than plain RAG, and the difference is load-bearing.
Embeddings find the entry points; the graph supplies the relationships around
them. Ask *"if Marcus takes over the ranking pipeline, what will he get wrong?"*
and a flat vector store returns the files whose text mentions Marcus. The graph
returns the files he has **never touched**, who else has, which of those are
undocumented, and what Sarah said about each — because those are edges, not words.

Answers cite node ids; clicking a citation flashes that node in the graph, so
every claim is traceable back to the memory it came from. The model is told to
distinguish what is documented, what was inferred from her commits, and what she
confirmed out loud, and to say plainly when the context does not contain
the answer.

Without a key, the same endpoint returns the retrieved nodes as raw facts and
says so, rather than pretending to reason.

## MCP — the same memory, for other agents

The point of building institutional memory as a graph is that other things can
use it. `app/mcp/server.js` exposes it over MCP:

| tool | |
|---|---|
| `ask_memory` | natural-language question, synthesised answer with citations |
| `search_memory` | semantic + graph retrieval, raw nodes |
| `what_dies_with` | every asset whose only human edge is this person |
| `list_gaps` | unwritten knowledge, and her answers where captured |
| `get_situation` | who's leaving, coverage, what the agents have done |

It is a thin client over the running app's HTTP API, not a second copy of the
engine, so an agent sees exactly the state a human sees on screen — including an
answer captured seconds ago in the interview.

Register it with Claude Code:

```bash
claude mcp add handoff -- node "$(pwd)/mcp/server.js"
```

Or in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "handoff": {
      "command": "node",
      "args": ["/absolute/path/to/app/mcp/server.js"],
      "env": { "HANDOFF_URL": "http://127.0.0.1:4173" }
    }
  }
}
```

The app must be running — the MCP server reads live state, and says so clearly
if it cannot reach it.

## Architecture

```
resignation event ──> LaserData stream
                            │
                   Guild coordinates four agents
                            │
  Mapper ──> Gap-Hunter ──> Rescuer ──> Interviewer
     │            │            │             │
  writes       queries      plans and     asks what was
  memory       memory       executes      never written
     │            │            │             │
     └────────────┴──> FalkorDB <────────────┘
                            │
          Guild executes ──> email · Jira        (what a human receives)
     RocketRide executes ──> calendar · doc · revoke
                            │
                    every action ──> LaserData ──> live feed + coverage meter
```

## Dual-mode: every external call has two implementations

Each service client exposes one interface and two backends: `live` talks to the real
API, `replay` runs an in-process equivalent with realistic latency. Same code path,
same event shapes, same numbers.

This is not a mock layer bolted on for the demo — it is how the thing is built, and it
means the demo cannot be taken down by venue wifi. Flip everything with `HANDOFF_MODE`,
or one service at a time with `HANDOFF_FALKOR_MODE=live`.

Live mode also degrades on its own: if FalkorDB is unreachable mid-run, the query falls
back to the in-process graph, logs a warning, and the UI badge stops claiming FalkorDB
answered. Actions that could not be executed for real are tagged `simulated` in the feed.
**Never let the room believe an email went out when it did not.**

## Where the numbers come from

Nothing on screen is hardcoded.

- **"N things die with her"** — the result of the `soloOwned` query, derived from commit
  authorship. The seed data never asserts that a file is solo-owned; the graph discovers it.
- **Knowledge coverage** — every unit of knowledge (file, doc, ticket, incident, gap,
  decision pattern) carries a weight, and earns credit for having a second human, shared
  documentation, a booked transfer, or a recorded answer. Baseline lands at 60–61%
  (it shifts by a point depending on how many questions the Gap-Hunter writes itself).
- **The ceiling (95%)** — what coverage becomes if every booked session happens and the
  whole agenda is answered. It is below 100% on purpose: several of her heuristics are
  inferred from her history and no question on the agenda confirms them. That residue is
  the argument for the human handover meeting.

## Files

```
config.js          every credential and mode flag — the only file to edit at the venue
server.js          static UI, JSON API, SSE bridge
lib/seed.js        deterministic company generator
lib/graph.js       memory layer — named queries with Cypher + in-process implementations
lib/resp.js        minimal Redis protocol client (FalkorDB speaks RESP)
lib/laser.js       stream — publish/subscribe, journalled to disk
lib/rocketride.js  pipeline steps and real-world action execution
lib/guild.js       agent registry, handoffs, human approval gate
lib/orchestrator.js the run
public/            the interface (canvas graph, event feed, voice interview)
scripts/smoke.js   headless end-to-end run
```

## Keyboard, during the demo

| Key | |
|---|---|
| `Q` | show/hide the Cypher query panel |
| `C` | the closing card (baseline → current, with run stats) |
| `D` | show/hide the interview dock |
| `M` | ask memory |
| `Shift+R` | hard reload |

See [../RUNBOOK.md](../RUNBOOK.md) for the venue schedule and the demo script.
