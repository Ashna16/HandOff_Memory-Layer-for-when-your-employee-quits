# Memory Meets Motion — Official Hackathon Problem Statement

Source: [Google Doc](https://docs.google.com/document/d/1f7mms4ZMx3WXzWnvR80Dlzny8RiOdVXzh86YXMksF84/edit?usp=sharing) (saved 2026-08-02). Companion to [hackathon-details.md](hackathon-details.md) (Luma listing).

- **Date:** August 3, 2026
- **Venue:** Frontier Tower, San Francisco
- **Format:** 8-hour build sprint
- **Track Partners:** RocketRide.ai · Guild.ai · LaserData · FalkorDB

## 1. Theme

Memory Meets Motion is about building AI systems that don't just react — they remember and act. Most AI demos today are stateless: every prompt starts from zero. The next generation of agentic products needs two things working together:

- **Memory:** Durable, structured, queryable context that persists across sessions, users, and time (facts, relationships, history, preferences).
- **Motion:** The ability to actually do something with that memory: orchestrate tools, take real-time action, coordinate multiple agents, and respond to live data as it happens.

Teams will build a product, agent, or workflow that demonstrates both halves working as one system — an AI that knows things and does things because of what it knows.

## 2. Mandated Tech Stack

**Every submitted project must integrate all four sponsor technologies in a meaningful way** (not just an API key sitting unused — judges will specifically check for real usage of each).

### 🧠 FalkorDB — The Memory Layer
Low-latency graph database purpose-built for AI memory and GraphRAG (Cypher-based, fast multi-hop queries). Use it as where the agent's memory actually lives:
- Model your domain as a graph — entities + relationships.
- Use it as the retrieval backend for RAG (multi-hop graph traversal gives relationship-aware context flat vector search misses).
- Write to it continuously as the agent operates, so memory compounds instead of resetting.

Links: [FalkorDB](https://github.com/FalkorDB/falkorDB) · [code-graph](https://github.com/FalkorDB/code-graph) · [graphrag-sdk](https://github.com/FalkorDB/graphrag-sdk) · [QueryWeaver](https://github.com/FalkorDB/QueryWeaver)

### 🚀 RocketRide.ai — The Motion / Orchestration Layer
The AI orchestration and agent-execution layer — how the system turns "what the agent knows" into "what the agent does": tool calls, multi-step task execution, API actions.
- Wire RocketRide as the execution engine that reads from FalkorDB memory and decides/executes the next action.
- Use it to orchestrate calls to external tools/APIs (the actual "motion" — sending an email, booking something, updating a record, hitting a live data source).
- Multi-step chains of tool calls belong in this layer.

### 🧑‍🤝‍🧑 Guild.ai — The Multi-Agent / Collaboration Layer
Where multiple agents (or agents + humans) coordinate on a task rather than one monolithic agent doing everything.
- Split the problem into specialist agents (e.g., "researcher", "planner", "critic") and use Guild.ai to coordinate handoffs between them.
- Use it for human-in-the-loop moments — pause and route a decision to a person before acting.
- Good fit anywhere division of labor beats one giant prompt.

### 📡 LaserData — The Real-Time Data Layer
The live/streaming data source — the signal that gives the agent something current to react to, rather than only static/historical memory.
- Feed live or fast-changing data into the system (event streams, activity logs, etc.) so the agent has something happening right now to respond to.
- Pair directly with FalkorDB: LaserData is the live input; FalkorDB is where that input gets persisted into long-term structured memory.

> **Note on Judging:** Judging will specifically look for **load-bearing use of all four technologies**. A one-line SDK import that's never called again will not count.

## 3. Reference Architecture

Data flow in one line: LaserData brings in what's happening now → FalkorDB remembers what's ever happened → RocketRide decides and acts on both → Guild.ai coordinates the agents doing the deciding/acting → the user sees the result.

## 4. Suggested Project Ideas (abbreviated)

Pick one, remix one, or bring your own. Ideas offered: Persistent Research Assistant, Multi-Agent Customer Support Desk, Live Market Signal Trader (sim), AI Study Companion, Fraud/Anomaly Detection Graph Agent, Recruiting Copilot, Motion-Aware Fitness Coach, Personal Finance Memory Agent, Legal/Contract Research Agent, Supply Chain Control Tower, Event Networking Matchmaker, Multi-Agent Game NPCs, Smart Home/IoT Orchestrator, AI Hackathon Judge Assistant, Incident Response Copilot. Each is broken out across the four mandated technologies in the original doc.

(Handoff is a bring-your-own idea — it overlaps no suggested idea directly; nearest neighbors are Recruiting Copilot and Incident Response Copilot.)

## 5. Setup Checklist (do BEFORE the event)

- [ ] **RocketRide.ai:** Create an account and generate an API key
- [ ] **Guild.ai:** Create an account and get workspace/API access
- [ ] **FalkorDB:** Create an instance (cloud or local Docker) and confirm connection string
- [ ] **LaserData:** Create the Free Tier cloud account or run the local stack using Laser Stack (read the Laser Stack quickstart docs). Discord for help: https://discord.gg/QXVbqWxHHb

Questions on any sponsor tool during the event go to that sponsor's table/mentor — each partner's own docs are the source of truth for exact SDK syntax and current API surface.
