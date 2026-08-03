/**
 * Handoff server — static UI, JSON API, and the SSE bridge that turns the
 * LaserData stream into something a browser can render.
 *
 * Plain node:http on purpose. Zero dependencies means `npm install` cannot
 * fail on venue wifi at 9:40am.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import config, { credentialWarnings } from './config.js';
import { Graph } from './lib/graph.js';
import { LaserStream } from './lib/laser.js';
import { RocketRide } from './lib/rocketride.js';
import { Guild } from './lib/guild.js';
import { LLM } from './lib/llm.js';
import { MemoryChat } from './lib/memory-chat.js';
import { Orchestrator } from './lib/orchestrator.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, 'public');

const stream = new LaserStream();
const graph = new Graph();
const llm = new LLM();
const orch = new Orchestrator({
  graph,
  stream,
  rocket: new RocketRide(),
  guild: new Guild(stream),
  llm,
});
const chat = new MemoryChat({ graph, llm, orchestrator: orch });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = url.pathname;

  try {
    if (route === '/api/stream') return sse(req, res);
    if (route.startsWith('/api/')) return await api(route, req, res, url);
    return statik(route, res);
  } catch (err) {
    console.error('[server]', err);
    json(res, 500, { error: err.message });
  }
});

// ── API ─────────────────────────────────────────────────────────────────────

async function api(route, req, res, url) {
  switch (route) {
    case '/api/health':
      return json(res, 200, { ...orch.health(), warnings: credentialWarnings() });

    case '/api/state':
      return json(res, 200, orch.state());

    case '/api/people':
      return json(res, 200, orch.world.people);

    case '/api/run': {
      const body = await readJson(req);
      orch.run(body.subject).catch((e) => console.error(e)); // fire and forget; the stream narrates
      return json(res, 202, { accepted: true, subject: body.subject || config.scenario.subject });
    }

    case '/api/reset':
      await orch.reset();
      return json(res, 200, { ok: true });

    // The staged flow. Each phase is a button on stage; each returns 202 and
    // narrates itself over the stream, exactly like /api/run.
    case '/api/phase/analyze':
      orch.analyze().catch((e) => console.error(e));
      return json(res, 202, { accepted: true, phase: 'analyze' });
    case '/api/phase/interview':
      orch.interview().catch((e) => console.error(e));
      return json(res, 202, { accepted: true, phase: 'interview' });
    case '/api/phase/meetings':
      orch.meetings().catch((e) => console.error(e));
      return json(res, 202, { accepted: true, phase: 'meetings' });
    case '/api/phase/jiras':
      orch.jiras().catch((e) => console.error(e));
      return json(res, 202, { accepted: true, phase: 'jiras' });

    case '/api/approve': {
      const body = await readJson(req);
      const ok = orch.guild.resolveApproval(body.id, body.approved !== false, body.by || 'human');
      return json(res, ok ? 200 : 404, { ok });
    }

    case '/api/approvals':
      return json(res, 200, orch.guild.pendingApprovals());

    case '/api/interview/next':
      return json(res, 200, orch.nextQuestion() || { done: true });

    case '/api/interview/answer': {
      const body = await readJson(req);
      return json(res, 200, await orch.answer(body.gapId, body.text));
    }

    /**
     * Chat over everything in memory. Streams tokens as Server-Sent Events so
     * the answer builds on screen. Also the endpoint the MCP server calls, so
     * another agent gets exactly the same memory a human does.
     */
    case '/api/chat': {
      const body = await readJson(req);
      const question = String(body.question || '').slice(0, 2000);
      if (!question) return json(res, 400, { error: 'question required' });

      if (body.stream === false) {
        const result = await chat.ask(question, { history: body.history || [] });
        return json(res, 200, result);
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      });
      const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      try {
        const result = await chat.ask(question, {
          history: body.history || [],
          onDelta: (delta) => send('delta', { delta }),
        });
        send('done', { citations: result.citations, engine: result.engine });
      } catch (err) {
        send('error', { message: err.message });
      }
      return res.end();
    }

    /** Raw semantic + graph retrieval, no model. Useful for debugging what the
     *  chat actually saw, and for agents that want the nodes rather than prose. */
    case '/api/memory/search': {
      const q = url.searchParams.get('q') || '';
      if (!q) return json(res, 400, { error: 'q required' });
      const hits = await chat.retrieve(q, Number(url.searchParams.get('k') || 14));
      return json(res, 200, { question: q, count: hits.length, hits });
    }

    /** Venue smoke test: proves each of the four is actually reachable. */
    case '/api/smoke': {
      const out = { at: new Date().toISOString(), checks: [] };
      const check = async (name, fn) => {
        const t = Date.now();
        try { const detail = await fn(); out.checks.push({ name, ok: true, ms: Date.now() - t, detail }); }
        catch (err) { out.checks.push({ name, ok: false, ms: Date.now() - t, detail: err.message }); }
      };
      await check('FalkorDB', async () => {
        if (orch.graph.mode !== 'live') return 'replay mode — in-process graph';
        if (!orch.graph.connected) throw new Error('not connected');
        const r = await orch.graph.run('soloOwned', { person: 'p:sarah' });
        return `live · ${r.rows.length} rows via ${r.engine}`;
      });
      await check('LaserData', async () => {
        if (orch.stream.mode !== 'live') return 'replay mode — in-process broker';
        if (!orch.stream.online) throw new Error('not connected');
        orch.stream.publish('smoke.test', { title: 'smoke test' });
        return 'live · published';
      });
      await check('RocketRide', async () => {
        if (orch.rocket.mode !== 'live') return 'replay mode — local harness';
        if (!orch.rocket.online) throw new Error('not connected');
        await orch.rocket.client.ping();          // real round-trip to the Cloud engine
        return `live · Cloud session as ${orch.rocket.account?.name || 'authenticated'}`;
      });
      await check('Guild', async () => {
        if (orch.guild.mode !== 'live') return 'replay mode — local coordinator';
        if (!orch.guild.online) throw new Error('not connected');
        return `live · ${orch.guild.opts.workspace}`;
      });
      await check('LLM', async () => {
        if (!llm.available) return 'no key — deterministic fallbacks in use';
        const out = await llm.text({ system: 'Reply with one word.', user: 'Say READY', maxTokens: 800 });
        if (!out) throw new Error(llm.lastError || 'no completion');
        return `live · ${llm.opts.model} / ${llm.opts.chatModel}`;
      });
      out.ok = out.checks.every((c) => c.ok);
      return json(res, 200, out);
    }

    default:
      return json(res, 404, { error: 'not found' });
  }
}

// ── SSE: the stream, piped to the browser ───────────────────────────────────

function sse(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 1000\n\n');

  // Replay history first so a late-joining browser (or a refresh mid-demo)
  // catches up instantly instead of showing an empty feed.
  //
  // Tagged `replay` so the client can render them without re-firing their side
  // effects. Sequence numbers cannot carry this: `reset()` restarts them at
  // zero for each run, so they are not monotonic across a session.
  for (const e of stream.history) res.write(`data: ${JSON.stringify({ ...e, replay: true })}\n\n`);

  const unsubscribe = stream.subscribe((event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);

  req.on('close', () => { clearInterval(ping); unsubscribe(); });
}

// ── static ──────────────────────────────────────────────────────────────────

function statik(route, res) {
  const rel = route === '/' ? 'index.html' : route.replace(/^\/+/, '');
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

// ── helpers ─────────────────────────────────────────────────────────────────

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// ── boot ────────────────────────────────────────────────────────────────────

const health = await orch.boot();
const warnings = credentialWarnings();

server.listen(config.port, () => {
  const line = (k, v) => `  ${k.padEnd(12)} ${v}`;
  console.log(`\n  Handoff — ${config.scenario.company} · ${config.scenario.subject}`);
  console.log(`  http://localhost:${config.port}\n`);
  console.log(`  MODE: ${config.mode}`);
  for (const [name, s] of Object.entries(health.services)) {
    console.log(line(name, `${s.mode}${s.live ? '  ● live' : '  ○ local'}`));
  }
  if (warnings.length) {
    console.log('\n  ⚠  ' + warnings.join('\n  ⚠  '));
  }
  console.log('');
});
