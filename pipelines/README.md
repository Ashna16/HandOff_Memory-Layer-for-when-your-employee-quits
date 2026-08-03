# RocketRide pipeline — `handoff.pipe`

A portable RocketRide pipeline (`.pipe`, JSON) that captures Handoff's reasoning
layer: the LLM work the app performs when a departing engineer answers a
question in the exit interview.

```
answer_in (webhook)
   → extract_knowledge (extract_data)   pull the mechanism + grade sufficiency
   → distil_note (llm_openai)           write the durable handover note
   → handover_out (response)
```

**What it does.** An exit-interview answer arrives on the webhook. `extract_data`
pulls the structured knowledge out of it — the actual mechanism the engineer
described, whether it is usable by whoever inherits the system, the load-bearing
concepts, and the follow-up to press on if it is thin. `llm_openai` then writes
the two-sentence handover note that Handoff writes back into the FalkorDB
knowledge graph. It is the same reasoning the running app does when it grades an
answer and distils it (see `app/lib/orchestrator.js#grade` and
`app/lib/memory-chat.js`).

**How it relates to the app.** The Handoff app connects to RocketRide Cloud over
the real SDK (`app/lib/rocketride.js`) as a live authenticated session, and runs
its analysis as a sequence of pipeline steps. This `.pipe` is the portable,
canvas-importable form of that reasoning — drop it into the RocketRide IDE or run
it with the SDK/CLI against `https://api.rocketride.ai`.

**Run it.**

```bash
# TypeScript / Python SDK reads ${OPENAI_API_KEY} from the environment
ROCKETRIDE_URI=https://api.rocketride.ai ROCKETRIDE_AUTH=<token> \
  rocketride start pipelines/handoff.pipe
```

Providers used: `webhook`, `extract_data`, `llm_openai`, `response` — all from
the RocketRide node catalog. Credentials are referenced as `${OPENAI_API_KEY}`
and never inlined.
