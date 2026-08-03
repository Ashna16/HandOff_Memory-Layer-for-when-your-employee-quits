#!/usr/bin/env node
/**
 * Handoff MCP server.
 *
 * Exposes the knowledge graph to any other agent — Claude Code, Claude Desktop,
 * or anything else speaking MCP — so the memory Handoff builds is not trapped
 * inside Handoff's own UI. That is the whole argument for building institutional
 * memory as a graph rather than as a document: other things can use it.
 *
 * It is a thin client over the running app's HTTP API rather than a second copy
 * of the engine, so an agent asking a question sees exactly the state a human
 * sees on screen, including answers captured seconds ago in the exit interview.
 *
 * Protocol: JSON-RPC 2.0 over stdio. Hand-rolled, because it is about ninety
 * lines and adding an SDK dependency to this project would be the only
 * dependency in it.
 *
 *   node app/mcp/server.js            # expects the app on :4173
 *   HANDOFF_URL=http://host:port node app/mcp/server.js
 */

import readline from 'node:readline';

const BASE = (process.env.HANDOFF_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const NAME = 'handoff';
const VERSION = '1.0.0';

const TOOLS = [
  {
    name: 'ask_memory',
    description:
      'Ask a natural-language question about the departing employee — what they own, how they think, what they explained in their exit interview, and what would break if they left today. Answers are synthesised from a knowledge graph built out of their commits, tickets, documents, incidents, and interview transcript, and cite the graph nodes they used. Use this first for anything open-ended.',
    inputSchema: {
      type: 'object',
      properties: { question: { type: 'string', description: 'The question, in plain English.' } },
      required: ['question'],
    },
  },
  {
    name: 'search_memory',
    description:
      'Semantic + graph search over the knowledge graph. Returns the matching nodes and their relationships rather than prose. Use when you want the raw facts to reason over yourself, or to check what ask_memory would have seen.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', description: 'Nodes to return before graph expansion. Default 14.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'what_dies_with',
    description:
      'List every asset whose only human edge is the given person — the files, documents and tickets that would have no remaining owner if they left. This is the core risk query.',
    inputSchema: {
      type: 'object',
      properties: { person: { type: 'string', description: 'Full name, e.g. "Sarah Chen". Defaults to the current subject.' } },
    },
  },
  {
    name: 'list_gaps',
    description:
      'List the knowledge gaps: things that exist nowhere in writing and are known only to the departing employee. Each shows whether it has been answered in the exit interview, and the answer if so.',
    inputSchema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['all', 'open', 'rescued'], description: 'Default "all".' } },
    },
  },
  {
    name: 'get_situation',
    description:
      'The current state of the offboarding: who is leaving, when, how much of their knowledge is covered, what the agents have done so far, and how many gaps remain. Use for a quick orientation before other calls.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ── tool implementations ────────────────────────────────────────────────────

async function callTool(name, args = {}) {
  switch (name) {
    case 'ask_memory': {
      const r = await post('/api/chat', { question: args.question, stream: false });
      return `${r.answer}\n\n— retrieved ${r.citations.length} nodes from the knowledge graph (${r.engine})`;
    }

    case 'search_memory': {
      const r = await get(`/api/memory/search?q=${encodeURIComponent(args.query)}&k=${args.limit || 14}`);
      if (!r.hits.length) return `Nothing in memory matches "${args.query}".`;
      return r.hits.map((h) => `[${h.id}] (${h.label}${h.viaGraph ? ', reached by graph traversal' : ''})\n${h.text}`).join('\n\n');
    }

    case 'what_dies_with': {
      const s = await get('/api/state');
      if (!s.findings) return 'No offboarding run has been executed yet — memory is empty. Start a run in the Handoff UI first.';
      const subject = s.subject?.name;
      if (args.person && args.person.toLowerCase() !== subject?.toLowerCase()) {
        return `The current run is for ${subject}. Re-run Handoff for ${args.person} to analyse them.`;
      }
      const lines = s.findings.soloOwned.map((a) => {
        const node = s.graph.nodes.find((n) => n.id === a.id);
        const state = node?.risk === 'rescued' ? 'rescued in the exit interview'
          : node?.risk === 'transfer-scheduled' ? 'knowledge-transfer session booked'
            : 'STILL AT RISK';
        return `- ${a.path || a.title} (criticality ${a.criticality}/5) — ${state} [${a.id}]`;
      });
      return `${s.findings.soloOwned.length} assets have exactly one human edge (${subject}):\n\n${lines.join('\n')}\n\n`
        + `${s.findings.undocumented.length} of them have no shared documentation. `
        + `${s.findings.blockers.length} open tickets are blocked on ${subject} personally.`;
    }

    case 'list_gaps': {
      const s = await get('/api/state');
      const wanted = args.status || 'all';
      const gaps = (s.gaps || []).filter((g) =>
        wanted === 'all' || (wanted === 'rescued' ? g.status === 'rescued' : g.status !== 'rescued'));
      if (!gaps.length) return `No gaps matching "${wanted}".`;
      return gaps.map((g) => {
        const head = `${g.status === 'rescued' ? '✓' : '○'} ${g.title} (${g.anchorPath}, criticality ${g.criticality}/5) [${g.id}]`;
        const q = `   Q: ${g.question}`;
        const a = g.answer ? `   A: ${g.answer}` : '   A: — not yet answered; this knowledge exists nowhere else.';
        return `${head}\n${q}\n${a}`;
      }).join('\n\n');
    }

    case 'get_situation': {
      const s = await get('/api/state');
      if (!s.subject) return 'No offboarding run has been executed yet.';
      const m = s.metrics || {};
      return [
        `Departing: ${s.subject.name}, ${s.subject.role}. Last day ${s.health.scenario.lastDay}.`,
        `Company: ${s.health.scenario.company}. System: ${s.health.scenario.system}.`,
        `Run status: ${s.status}.`,
        `Knowledge coverage: ${s.coverage.pct}% (ceiling ${s.coverage.projected}% once booked sessions happen and the agenda is finished).`,
        `${m.atRisk} solo-owned assets · ${m.gapsFound} knowledge gaps, ${m.gapsRescued} answered.`,
        `${m.actions} rescue actions executed by ${m.agents} agents across ${m.handoffs} handoffs, with ${m.approvals} human approval gate(s).`,
        `Memory: ${s.graph.nodes.length} nodes, ${s.graph.edges.length} relationships.`,
      ].join('\n');
    }

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ── JSON-RPC over stdio ─────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  // Notifications carry no id and expect no response.
  const respond = (result) => {
    if (msg.id === undefined || msg.id === null) return;
    write({ jsonrpc: '2.0', id: msg.id, result });
  };
  const fail = (code, message) => {
    if (msg.id === undefined || msg.id === null) return;
    write({ jsonrpc: '2.0', id: msg.id, error: { code, message } });
  };

  try {
    switch (msg.method) {
      case 'initialize':
        return respond({
          protocolVersion: msg.params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: NAME, version: VERSION },
        });

      case 'notifications/initialized':
        return;

      case 'tools/list':
        return respond({ tools: TOOLS });

      case 'tools/call': {
        const text = await callTool(msg.params?.name, msg.params?.arguments || {});
        return respond({ content: [{ type: 'text', text }] });
      }

      case 'ping':
        return respond({});

      default:
        return fail(-32601, `method not found: ${msg.method}`);
    }
  } catch (err) {
    // Tool errors come back as content, not protocol errors, so the calling
    // agent can read the reason and adapt rather than just seeing a failure.
    if (msg.method === 'tools/call') {
      return respond({
        content: [{ type: 'text', text: `Handoff is unreachable at ${BASE} (${err.message}). Start it with: cd app && npm start` }],
        isError: true,
      });
    }
    fail(-32603, err.message);
  }
});

function write(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

async function get(route) {
  const res = await fetch(`${BASE}${route}`, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`${res.status} ${route}`);
  return res.json();
}

async function post(route, body) {
  const res = await fetch(`${BASE}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`${res.status} ${route}`);
  return res.json();
}
