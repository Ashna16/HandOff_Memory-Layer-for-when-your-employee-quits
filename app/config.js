/**
 * Handoff — single source of truth for every credential and mode flag.
 *
 * ═══════════════════════════════════════════════════════════════════════
 *  VENUE CHECKLIST (Aug 3, Frontier Tower) — this is the ONLY file to edit.
 *  Every value below can also be supplied as an environment variable.
 *  Flip a service to live by filling its credentials and setting mode:'live'.
 * ═══════════════════════════════════════════════════════════════════════
 */

// Secrets live in app/.env, which is gitignored. Never put a key in this file.
try { process.loadEnvFile(new URL('./.env', import.meta.url)); } catch { /* no .env — fine */ }

const env = process.env;

/** Global default. Individual services can override. 'replay' | 'live' */
const MODE = env.HANDOFF_MODE || 'replay';

/** Per-service mode: falls back to global MODE unless explicitly pinned. */
const mode = (svc) => env[`HANDOFF_${svc}_MODE`] || MODE;

export const config = {
  mode: MODE,
  port: Number(env.PORT || 4173),

  /** Demo pacing. Replay mode fakes realistic network latency so the feed
   *  breathes on stage instead of dumping 40 events in one frame. */
  pacing: {
    latencyMin: Number(env.HANDOFF_LATENCY_MIN || 180),
    latencyMax: Number(env.HANDOFF_LATENCY_MAX || 620),
    ingestBatchDelay: 90,
    /** Held beats at the two moments the audience needs time to look: the red
     *  bloom, and the gap list. Set to 0 for headless runs. */
    beatScale: Number(env.HANDOFF_BEAT_SCALE ?? 1),
  },

  /** ── FalkorDB — the memory layer ──────────────────────────────────────
   *  Local:  docker run -p 6379:6379 -it --rm falkordb/falkordb:latest
   *  Cloud:  falkordb.com → create instance → copy host/port/password.
   *  Live mode speaks the real Redis protocol and issues real GRAPH.QUERY
   *  Cypher (see lib/queries.js). Replay mode runs the same named queries
   *  against an in-process graph so the demo survives a dead network. */
  falkor: {
    mode: mode('FALKOR'),
    host: env.FALKOR_HOST || '127.0.0.1',
    port: Number(env.FALKOR_PORT || 6379),
    username: env.FALKOR_USERNAME || '',
    password: env.FALKOR_PASSWORD || '', // VENUE: paste FalkorDB Cloud password
    graph: env.FALKOR_GRAPH || 'handoff',
  },

  /** ── LaserData — the real-time layer ──────────────────────────────────
   *  Free tier cloud account, or local Laser Stack (Apache Iggy).
   *  Local quickstart: docker run -p 8090:8090 -p 3000:3000 iggyrs/iggy
   *  The resignation event arrives here; every agent action is published
   *  back as a durable, replayable event that drives the activity feed. */
  laser: {
    mode: mode('LASER'),
    url: env.LASER_URL || 'http://127.0.0.1:3000', // VENUE: LaserData cloud URL
    apiKey: env.LASER_API_KEY || '', // VENUE: paste LaserData key
    username: env.LASER_USERNAME || 'iggy',
    password: env.LASER_PASSWORD || 'iggy',
    stream: env.LASER_STREAM || 'handoff',
    topic: env.LASER_TOPIC || 'offboarding',
    /** Persist every published event to disk. This journal IS the replay
     *  fixture — rehearse live once and replay mode inherits real payloads. */
    journal: true,
  },

  /** ── RocketRide — the motion / execution layer ────────────────────────
   *  Cloud: cloud.rocketride.ai (redeem the Discord promo code first).
   *  Runs the analysis pipeline AND executes real-world actions:
   *  email, calendar invite, Jira ticket, handover doc, access revocation. */
  rocketride: {
    mode: mode('ROCKETRIDE'),
    // RocketRide is a WebSocket engine; the SDK upgrades https→wss under the
    // hood. Confirmed endpoint from docs.rocketride.org/cloud.
    url: env.ROCKETRIDE_URI || env.ROCKETRIDE_URL || 'https://api.rocketride.ai',
    apiKey: env.ROCKETRIDE_APIKEY || env.ROCKETRIDE_API_KEY || '', // set in app/.env
    pipeline: env.ROCKETRIDE_PIPELINE || 'handoff-rescue',
    /** RocketRide is an orchestration runtime, not an integration catalogue —
     *  it has no pre-built calendar or identity connector. These two are staged
     *  and the UI labels every receipt 'simulated' accordingly. The real
     *  RocketRide contribution is the pipeline in rocket.step(), which is all
     *  seven phases end to end. */
    tools: {
      calendar: env.RR_TOOL_CALENDAR || 'google_calendar.create_event',
      revoke: env.RR_TOOL_REVOKE || 'identity.revoke_access',
    },
  },

  /** ── Guild.ai — the multi-agent coordination layer ────────────────────
   *  Four specialists hand work off to each other; risky actions route to a
   *  human gate before anything executes. Guild also performs the two actions
   *  addressed to a person — the email and the Jira ticket — through its own
   *  built-in integrations. */
  guild: {
    mode: mode('GUILD'),
    url: env.GUILD_URL || 'https://api.guild.ai/v1', // VENUE: confirm base URL
    apiKey: env.GUILD_API_KEY || '', // VENUE: paste Guild workspace key
    workspace: env.GUILD_WORKSPACE || 'handoff',
    /** Human-in-the-loop. Actions tagged risky pause the run until approved.
     *  This is a P0 demo beat — a judge clicks approve on stage. */
    approvalRequired: env.GUILD_APPROVAL !== 'off',
    approvalTimeoutMs: 120000,
    /** Guild performs the actions addressed to a person, through its own
     *  built-in integrations. Everything a human receives or decides lives
     *  in this layer; the machine work lives in RocketRide. */
    tools: {
      // Confirmed against docs.guild.ai. Guild's service packages expose tools
      // with a `<service>_` prefix — see `guild agent capabilities`.
      email: env.GUILD_TOOL_EMAIL || 'email_send',
      slack: env.GUILD_TOOL_SLACK || 'slack_post_message',
      jira: env.GUILD_TOOL_JIRA || 'jira_create_issue',
      /** The live reassignment — PUT /rest/api/3/issue/{key} with a new
       *  assignee. This is the one that makes stage 4 real. */
      jiraAssign: env.GUILD_TOOL_JIRA_ASSIGN || 'jira_edit_issue',
      doc: env.GUILD_TOOL_DOC || 'google_docs_create',
    },
    /** The deployed agent that performs the actions, and the real Jira tickets
     *  it reassigns on stage. When set, stage 4 fires a genuine reassignment
     *  against these keys through the published agent — the "watch the real
     *  board change" beat. Empty → every Guild action is simulated. */
    agent: env.GUILD_AGENT || 'handoff-rescuer',
    // config.js lives in app/, so the sibling agent dir is one level up. Decode
    // the file URL — the repo path contains a space that percent-encodes.
    agentDir: env.GUILD_AGENT_DIR || decodeURIComponent(new URL('../guild-agent', import.meta.url).pathname),
    // Absolute path to the guild CLI: a spawned process does not inherit the
    // interactive shell's PATH (nvm's bin in particular).
    cli: env.GUILD_CLI || `${env.HOME}/.nvm/versions/node/${process.version}/bin/guild`,
    /** Off by default so rehearsals are instant and smooth. Turn on for the
     *  real "watch the board change" beat: GUILD_LIVE_JIRA=on. */
    liveJira: env.GUILD_LIVE_JIRA === 'on',
    // One real ticket = one hero beat. Reassigning six live would take ~70s of
    // agent rebuilds; one reassigns in the background while the feed moves.
    // These point at real, personal destinations (a Jira account, a Slack
    // channel, an inbox), so they live in app/.env — never hardcoded here.
    // See .env.example for the variable names.
    realTickets: (env.GUILD_REAL_TICKETS || 'KAN-1').split(',').map((s) => s.trim()).filter(Boolean),
    realAssignee: env.GUILD_REAL_ASSIGNEE || '',
    slackChannel: env.GUILD_SLACK_CHANNEL || '',
    realEmail: env.GUILD_REAL_EMAIL || '',
    invokeTimeoutMs: Number(env.GUILD_INVOKE_TIMEOUT || 90000),
  },

  /** ── Linkup — optional garnish. Prices the loss of the departing skill
   *  profile against the live market, which reorders rescue priorities. */
  linkup: {
    mode: mode('LINKUP'),
    url: env.LINKUP_URL || 'https://api.linkup.so/v1/search',
    apiKey: env.LINKUP_API_KEY || '', // VENUE: paste Linkup key (optional)
    enabled: env.LINKUP_ENABLED !== 'off',
  },

  /** ── Snyk — optional garnish. Solo-owned code gets scanned before its
   *  ownership transfers to someone who has never read it. */
  snyk: {
    mode: mode('SNYK'),
    org: env.SNYK_ORG || '',
    apiKey: env.SNYK_API_KEY || '', // VENUE: paste Snyk token (optional)
    enabled: env.SNYK_ENABLED !== 'off',
  },

  /** ── The reasoning layer ──────────────────────────────────────────────
   *  Three jobs, and Handoff degrades gracefully without any of them:
   *   1. Grading exit-interview answers on whether they are actually usable
   *      by whoever inherits the system (falls back to concept matching).
   *   2. Extracting her decision patterns from real commit text, so the
   *      "how she thinks" layer is derived rather than authored.
   *   3. Answering questions over the whole graph — the memory chat, which is
   *      also what the MCP server exposes to other agents.
   *
   *  Provider-agnostic on purpose: point `baseUrl` and `model` at Anthropic,
   *  a local model, or anything else speaking the same chat-completions shape. */
  llm: {
    provider: env.LLM_PROVIDER || 'openai',
    apiKey: env.OPENAI_API_KEY || '', // set in app/.env — never here
    baseUrl: env.LLM_BASE_URL || 'https://api.openai.com/v1',
    /** Small and cheap everywhere. Measured against the grading cases in
     *  scripts/grade-eval.js, mini beat both nano (5/5 vs 4/5) and the larger
     *  models on latency, so there is nothing to buy by going bigger here. */
    model: env.LLM_MODEL || 'gpt-5.4-mini',
    chatModel: env.LLM_CHAT_MODEL || 'gpt-5.4-mini',
    embedModel: env.LLM_EMBED_MODEL || 'text-embedding-3-small',
    timeoutMs: Number(env.LLM_TIMEOUT_MS || 45000),
    /** Off entirely: every LLM path uses its deterministic fallback. */
    enabled: env.LLM_ENABLED !== 'off',
  },

  /** The scenario. Changing `subject` and re-running is the P2 judge card:
   *  "pick anyone on the roster and I'll run it live." */
  scenario: {
    company: 'Spotify',
    system: 'Discover Weekly ranking pipeline',
    subject: 'Sarah Chen',
    lastDay: '2026-08-12',
    seed: 20260803, // deterministic world → deterministic demo
  },
};

/** Services in live mode but missing credentials — surfaced by the smoke test
 *  and printed at boot so a blank key never becomes a mid-demo surprise. */
export function credentialWarnings() {
  const warn = [];
  const need = [
    ['falkor', config.falkor, () => config.falkor.host],
    ['laser', config.laser, () => config.laser.url],
    ['rocketride', config.rocketride, () => config.rocketride.apiKey],
    ['guild', config.guild, () => config.guild.apiKey],
    ['linkup', config.linkup, () => config.linkup.apiKey],
  ];
  for (const [name, svc, has] of need) {
    if (svc.mode === 'live' && !has()) {
      warn.push(`${name} is set to live but has no credentials in config.js`);
    }
  }
  return warn;
}

export default config;
