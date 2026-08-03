/**
 * Handoff — front of house.
 *
 * The UI subscribes to the event stream and renders it. It does not poll for
 * application state to decide what to show; it reacts to events, exactly like
 * the agents do. The only thing it fetches directly is the graph snapshot,
 * because drawing needs geometry and events carry meaning.
 */

import { GraphView } from './graph.js';
import { Voice } from './voice.js';

const $ = (id) => document.getElementById(id);
const api = (route, body) => fetch(route, body
  ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  : undefined).then((r) => r.json());

const state = {
  subject: null,
  coverage: null,
  baseline: null,
  gaps: [],
  current: null,
  typing: false,
  events: 0,
  started: false,
};

const graph = new GraphView($('graph'));
const voice = new Voice();

// ── boot ────────────────────────────────────────────────────────────────────
// Runs at the very bottom of this module: everything below is declared with
// `const`, so booting from the top would read those bindings before they exist.

async function boot() {
  const health = await api('/api/health');
  renderSponsors(health);
  $('gate-mode').textContent = health.mode;
  if (health.mode === 'live') $('gate-mode').classList.add('live');

  const people = await api('/api/people');
  $('roster').innerHTML = people
    .map((p) => `<button data-name="${p.name}">${p.name}<span class="dim"> · ${p.role.split(',')[0]}</span></button>`)
    .join('');
  $('roster').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    $('subject-input').value = btn.dataset.name;
    begin();
  });

  $('gate-form').addEventListener('submit', (e) => { e.preventDefault(); begin(); });

  const es = new EventSource('/api/stream');
  es.onmessage = (msg) => handle(JSON.parse(msg.data));
}

/**
 * The stream is durable, so the server replays its whole history to every new
 * connection — which is right for a late-joining browser and wrong for anything
 * with a side effect. EventSource reconnects on its own, and each reconnect was
 * replaying `interview.question`, starting a *second* interview loop on top of
 * the first: two voices, half a second apart.
 *
 * The server tags replayed frames. Do not try to infer this from `seq` — it
 * restarts at zero on every run, so a sequence-based guard silently swallows
 * the next run instead.
 */
function isReplay(ev) {
  return ev.replay === true;
}

async function begin() {
  if (state.started) return;
  state.started = true;
  const subject = $('subject-input').value.trim();
  $('gate').classList.add('leaving');
  setTimeout(() => { $('gate').hidden = true; }, 520);
  $('stage').hidden = false;
  await api('/api/run', { subject });
}

// ── the stream ──────────────────────────────────────────────────────────────

function handle(ev) {
  const replay = isReplay(ev);
  state.events++;
  $('feed-count').textContent = state.events;
  ping('laserdata');

  // Replayed events are history: render them, never re-fire them.
  if (replay) { addEvent(ev); return; }

  switch (ev.type) {
    case 'resignation.received':
      setSubject(ev);
      break;

    case 'ingest.progress':
      ping('rocketride');
      refreshGraph();
      break;

    case 'memory.written':
      ping('falkordb');
      refreshGraph();
      break;

    case 'risk.identified':
      ping('falkordb');
      if (ev.cypher) showCypher(ev.cypher, ev.engine);
      refreshGraph();
      break;

    case 'gap.identified':
      ping('falkordb');
      refreshGraph();
      break;

    case 'agent.handoff':
      ping('guild');
      setAgent(ev.to);
      break;

    case 'action.approval_required':
      ping('guild');
      showApproval(ev);
      break;

    case 'action.approved':
    case 'action.rejected':
      ping('guild');
      hideApproval();
      break;

    case 'action.executed':
      ping('rocketride');
      refreshGraph();
      break;

    case 'coverage.updated':
      setCoverage(ev.coverage);
      break;

    case 'node.rescued':
      if (ev.nodeId) graph.mark(ev.nodeId, 'rescued');
      if (ev.gapId) graph.mark(ev.gapId, 'rescued');
      refreshGraph();
      break;

    case 'interview.question':
      // Idempotent as well as replay-guarded: the dock opening twice is the
      // same failure as speaking twice.
      if (ev.agenda && $('dock').hidden) openDock(ev.agenda);
      break;

    case 'phase.changed':
      applyPhase(ev.phase);
      refreshGraph();      // so the derivations panel settles out of "querying"
      break;

    case 'run.complete':
      setAgent(null, true);
      break;
  }

  if (ev.type === 'action.executed' && ev.reassign) markReassigned(ev.reassign);

  addEvent(ev);
}

// ── the staged flow ─────────────────────────────────────────────────────────
// Each phase completes on the stream; the next button unlocks. The buttons are
// the demo's rhythm: nothing happens on stage without a person pressing it.

const PHASE_RANK = {
  idle: 0, running: 0, mapped: 1, analyzing: 1.5, analyzed: 2,
  interviewing: 3, 'meetings-sending': 3.5, 'meetings-sent': 4,
  'jiras-sending': 4.5, complete: 5, error: 0,
};
const RUNNING_PHASE = { analyzing: 'ph-analyze', 'meetings-sending': 'ph-meetings', 'jiras-sending': 'ph-jiras' };
// Each button: [id, rank at which it becomes ready, rank at which it is done]
const STAGE_BTNS = [
  ['ph-analyze', 1, 2],
  ['ph-interview', 2, 3],
  ['ph-meetings', 3, 4],
  ['ph-jiras', 4, 5],
];

function applyPhase(p) {
  const rank = PHASE_RANK[p] ?? 0;
  for (const [id, readyAt, doneAt] of STAGE_BTNS) {
    const btn = $(id);
    btn.classList.remove('running');
    btn.classList.toggle('done', rank >= doneAt);
    btn.classList.toggle('ready', rank >= readyAt && rank < doneAt);
    btn.disabled = rank < readyAt || rank >= doneAt;
  }
  const running = RUNNING_PHASE[p];
  if (running) { $(running).classList.add('running'); $(running).disabled = true; }
  // Voice interview can be revisited until the jiras are out the door.
  if (p === 'meetings-sent') { $('ph-interview').disabled = false; }
  if (PHASE_RANK[p] >= 2) loadProposal();
}

for (const [id] of STAGE_BTNS) {
  $(id).addEventListener('click', async () => {
    const btn = $(id);
    if (btn.disabled) return;
    btn.classList.add('running');
    btn.disabled = true;
    await api(`/api/phase/${btn.dataset.phase}`, {});
  });
}

// ── the drafted plan ────────────────────────────────────────────────────────

let proposal = null;
async function loadProposal() {
  if (proposal) return;
  const s = await api('/api/state');
  if (!s.proposal) return;
  proposal = s.proposal;
  $('plan-meet-count').textContent = proposal.meetings.length;
  $('plan-jira-count').textContent = proposal.jiras.length;
  $('btn-plan-meetings').hidden = false;
  $('btn-plan-jiras').hidden = false;
  renderPlan();
}

function renderPlan() {
  $('plan-body').innerHTML = `
    <div class="plan-section" id="plan-sec-meetings">
      <div class="section-label">scheduled meetings <span class="dim">· one per system, successor chosen by graph traversal</span></div>
      ${proposal.meetings.map((m) => `
        <div class="pl-row">
          <div class="pl-main">
            <div class="pl-title">${escapeHtml(m.systemName)}</div>
            <div class="pl-detail dim">${m.assets.length} solo-owned assets · ${m.gapIds.length} unwritten gaps on the agenda</div>
          </div>
          <div class="pl-who"><span class="pl-from">Sarah</span><span class="pl-arrow">→</span><span class="pl-to">${escapeHtml(m.successorName.split(' ')[0])}</span></div>
          <div class="pl-when">${escapeHtml(m.whenLabel)}</div>
        </div>`).join('')}
    </div>
    <div class="plan-section" id="plan-sec-jiras">
      <div class="section-label">jira handoffs <span class="dim">· her open tickets, reassigned live at stage 4</span></div>
      ${proposal.jiras.map((j) => `
        <div class="pl-row" id="pl-${j.ticket}">
          <div class="pl-main">
            <div class="pl-title"><span class="pl-key">${escapeHtml(j.key)}</span>${escapeHtml(j.title)}</div>
            <div class="pl-detail dim">blocked on her personally</div>
          </div>
          <div class="pl-who"><span class="pl-from">${escapeHtml(j.fromName)}</span><span class="pl-arrow">→</span><span class="pl-to">${escapeHtml(j.toName)}</span></div>
          <div class="pl-when pl-status">proposed</div>
        </div>`).join('')}
    </div>`;
}

function markReassigned(j) {
  const row = $(`pl-${j.ticket}`);
  if (!row) return;
  row.classList.add('reassigned');
  const st = row.querySelector('.pl-status');
  if (st) st.textContent = 'reassigned · live';
}

function openPlan(section) {
  if (!proposal) return;
  $('plan').hidden = false;
  const sec = $(section);
  if (sec) sec.scrollIntoView({ block: 'start' });
}
$('btn-plan-meetings').addEventListener('click', () => openPlan('plan-sec-meetings'));
$('btn-plan-jiras').addEventListener('click', () => openPlan('plan-sec-jiras'));
$('btn-plan-close').addEventListener('click', () => { $('plan').hidden = true; });

// ── feed ────────────────────────────────────────────────────────────────────

const FEED_SKIP = new Set(['smoke.test']);
const TAGS = {
  'resignation.received': 'trigger', 'ingest.progress': 'rocketride', 'memory.written': 'falkordb',
  'risk.identified': 'falkordb', 'gap.identified': 'gap', 'agent.handoff': 'guild',
  'action.proposed': 'plan', 'action.approval_required': 'gate', 'action.approved': 'gate',
  'action.rejected': 'gate', 'action.executed': 'rocketride', 'interview.question': 'interview',
  'interview.answer': 'interview', 'node.rescued': 'rescued', 'coverage.updated': 'coverage',
  'market.priced': 'linkup', 'security.scanned': 'snyk', 'run.complete': 'done', 'error': 'error',
};

function addEvent(ev) {
  if (FEED_SKIP.has(ev.type)) return;
  const el = document.createElement('div');
  el.className = `ev ${ev.level || ''}`;

  // Who performed it matters as much as what it was — Guild owns the actions a
  // person receives, RocketRide the machine work.
  const via = ev.receipt?.via
    ? `<span class="via via-${ev.receipt.via}">${ev.receipt.via}</span>`
    : '';

  const receipt = ev.receipt ? `
    <div class="ev-receipt">
      ${via}${escapeHtml(ev.receipt.id)}${ev.receipt.url ? ` · ${escapeHtml(ev.receipt.url)}` : ''}
      ${ev.receipt.simulated ? '<span class="sim"> · simulated</span>' : '<span> · live</span>'}
    </div>` : '';

  el.innerHTML = `
    <div class="ev-time">${time(ev.at)}</div>
    <div>
      <div class="ev-title"><span class="ev-tag">${TAGS[ev.type] || 'event'}</span>${escapeHtml(ev.title || ev.type)}</div>
      ${ev.detail ? `<div class="ev-detail">${escapeHtml(ev.detail)}</div>` : ''}
      ${receipt}
    </div>`;

  const feed = $('feed');
  feed.prepend(el);
  while (feed.children.length > 140) feed.lastChild.remove();
}

// ── header / meters ─────────────────────────────────────────────────────────

function setSubject(ev) {
  const days = /(\d+) days/.exec(ev.detail || '');
  $('subject-name').textContent = (ev.title || '').replace('Resignation received — ', '');
  $('subject-role').textContent = (ev.detail || '').split(' · ')[0] || '';
  $('countdown-days').textContent = days ? days[1] : '—';
}

function setCoverage(c) {
  if (!c) return;
  if (state.baseline === null) { state.baseline = c.pct; $('closer-from').textContent = c.pct; }
  const prev = state.coverage?.pct;
  state.coverage = c;

  $('coverage-pct').textContent = c.pct;
  $('meter-fill').style.width = `${c.pct}%`;
  $('meter-projected').style.width = `${c.projected}%`;
  $('coverage-detail').textContent = `${c.covered} / ${c.total} weighted`;
  $('coverage-ceiling').textContent = `ceiling ${c.projected}%`;
  $('closer-to').textContent = c.pct;

  if (prev != null && c.pct !== prev) {
    const d = $('coverage-delta');
    d.textContent = `${c.pct > prev ? '+' : ''}${c.pct - prev}`;
    d.classList.add('show');
    setTimeout(() => d.classList.remove('show'), 2600);
  }
}

/**
 * The hero query stays loaded but stays off screen. It covered a quarter of the
 * graph during the one beat the graph has to carry the whole argument, which is
 * a bad trade for a proof nobody asked for yet. Press Q to show it when a judge
 * does ask.
 */
function showCypher(cypher, engine) {
  $('cypher-text').textContent = cypher;
  const badge = $('engine-badge');
  $('engine-text').textContent = engine === 'falkordb' ? 'answered by FalkorDB' : 'in-process graph';
  badge.classList.toggle('falkor', engine === 'falkordb');
}

// ── sponsors ────────────────────────────────────────────────────────────────

const SPONSORS = [
  { id: 'falkordb', name: 'FALKORDB' },
  { id: 'rocketride', name: 'ROCKETRIDE' },
  { id: 'guild', name: 'GUILD' },
  { id: 'laserdata', name: 'LASERDATA' },
];

function renderSponsors(h) {
  $('sponsors').innerHTML = SPONSORS.map((s) => {
    const live = h.services[s.id]?.live;
    return `<div class="sponsor ${live ? 'live' : ''}" id="sp-${s.id}" title="${live ? 'live' : 'local / replay'}"><span class="dot"></span>${s.name}</div>`;
  }).join('');
}

let pingTimers = {};
function ping(id) {
  const el = $(`sp-${id}`);
  if (!el) return;
  el.classList.add('ping');
  clearTimeout(pingTimers[id]);
  pingTimers[id] = setTimeout(() => el.classList.remove('ping'), 700);
}

// ── agents ──────────────────────────────────────────────────────────────────

let agents = [];
function renderAgents(list) {
  agents = list;
  $('agent-strip').innerHTML = list.map((a) => `
    <div class="agent" id="ag-${a.id}" data-id="${a.id}">
      <span class="glyph">${a.glyph}</span>
      <span class="name">${a.name}</span>
    </div>`).join('');
  $('agent-strip').addEventListener('mouseover', (e) => {
    const el = e.target.closest('.agent');
    if (!el) return;
    $('agent-charter').textContent = list.find((a) => a.id === el.dataset.id)?.charter || '';
  });
}

let activeAgent = null;
function setAgent(id, finished = false) {
  if (activeAgent) $(`ag-${activeAgent}`)?.classList.replace('active', 'done');
  if (finished) { activeAgent = null; return; }
  activeAgent = id;
  const el = $(`ag-${id}`);
  if (el) {
    el.classList.add('active');
    $('agent-charter').textContent = agents.find((a) => a.id === id)?.charter || '';
  }
}

// ── graph refresh ───────────────────────────────────────────────────────────

let refreshTimer = null;
let refreshing = false;
function refreshGraph() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      const s = await api('/api/state');
      state.subject = s.subject;
      state.gaps = s.gaps || [];
      graph.setGraph(s.graph, s.subject?.id);
      if (!agents.length && s.agents?.length) renderAgents(s.agents);
      if (s.activeAgent && s.activeAgent !== activeAgent) setAgent(s.activeAgent);
      if (s.phase) applyPhase(s.phase);

      const atRisk = s.graph.nodes.filter((n) => n.risk === 'at-risk' || (n.label === 'Gap' && n.status === 'at-risk')).length;
      $('atrisk-count').textContent = atRisk;
      renderMetrics(s);
      renderDerivations(s);
      renderHistory(s.history);
      renderPipeline(s);
    } finally { refreshing = false; }
  }, 220);
}

/**
 * What the graph worked out, in the order it worked it out.
 *
 * Rows are keyed and only appended, never re-rendered, so each derivation
 * animates in exactly once as its query lands — the panel reads as the graph
 * thinking out loud rather than as a table that refreshes.
 */
/**
 * Hovering a node answers "how long has this been hers?" — the per-asset
 * version of the record strip. The markup for this existed and was never
 * wired to anything, so nothing was ever shown.
 */
graph.onHover = (n, x, y) => {
  const tip = $('node-tip');
  if (!n) { tip.hidden = true; return; }

  const name = n.name || n.title || n.path || n.id;
  const when = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  const history = n.herCommits
    ? `${n.herCommits} commit${n.herCommits === 1 ? '' : 's'} by her · ${when(n.herFirstAt)} → ${when(n.herLastAt)}`
    : '';

  const status = n.risk === 'at-risk' ? 'Only she has ever touched it'
    : n.risk === 'rescued' ? 'Rescued — recorded in the interview'
      : n.risk === 'transfer-scheduled' ? 'Transfer session booked'
        : n.label === 'Gap' ? 'No written trace — must be asked'
          : '';

  tip.innerHTML = `<div>${escapeHtml(name)}</div>`
    + (n.path && n.path !== name ? `<div class="tip-path">${escapeHtml(n.path)}</div>` : '')
    + (history ? `<div class="tip-path">${escapeHtml(history)}</div>` : '')
    + (status ? `<div class="tip-tag" style="color:var(--${n.risk === 'rescued' ? 'ok' : n.risk === 'transfer-scheduled' ? 'sched' : 'risk'})">${status}</div>` : '');

  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
  tip.hidden = false;
};

/**
 * Her record — monthly commit volume across her whole tenure.
 *
 * A count says "eleven files". A history says "she has been the only person
 * inside this pipeline since 2024", which is the sentence that lands. Hers is
 * drawn in the accent; everyone else's sits behind it in grey, so the picture
 * is not "she was busy" but "she was the one who was there".
 *
 * Change-over-time, so: one hue, area + baseline, hairline axis, and labels
 * only at the two ends plus the incidents she personally ran.
 */
function renderHistory(h) {
  if (!h?.series?.length) return;
  const el = $('history');
  const svg = $('history-plot');
  const W = 1000, H = 46;                      // viewBox units; CSS scales it
  const peak = Math.max(...h.series.map((m) => m.hers + m.others), 1);
  const step = W / h.series.length;
  const y = (v) => H - (v / peak) * (H - 4);

  const area = (key, from) => {
    const pts = h.series.map((m, i) => `${(i * step).toFixed(1)},${y(from ? m.hers + m.others : m[key]).toFixed(1)}`);
    return `M0,${H} L${pts.join(' L')} L${W},${H} Z`;
  };

  // Incidents she personally resolved, placed on the month they happened.
  const marks = (h.incidents || []).map((inc) => {
    const i = h.series.findIndex((m) => m.month === inc.date.slice(0, 7));
    if (i < 0) return '';
    const x = (i * step + step / 2).toFixed(1);
    return `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="var(--risk)" stroke-width="1" stroke-opacity=".45"/>`
      + `<circle cx="${x}" cy="4" r="2.6" fill="var(--risk)"/>`;
  }).join('');

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML =
    `<path d="${area(null, true)}" fill="var(--neutral)" fill-opacity=".45"/>`
    + `<path d="${area('hers')}" fill="var(--accent)" fill-opacity=".55"/>`
    + marks
    + `<line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="var(--rule)" stroke-width="1"/>`;

  const fmt = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  $('history-caption').textContent = `${h.years} years · ${h.herTotal} commits · ${h.systems?.length || 0} systems held throughout`;
  $('history-from').textContent = fmt(h.firstAt);
  $('history-to').textContent = `${fmt(h.lastAt)} — her last`;
  $('history-legend').innerHTML = `<span style="color:var(--accent-deep)">hers</span> · everyone else behind · <span style="color:var(--risk)">incidents she ran</span>`;
  el.hidden = false;
}

/**
 * RocketRide's orchestration, made visible.
 *
 * It sequences every step of the analysis, but until now that happened
 * entirely off screen — the layer doing the most structural work was the one
 * you could least see. The steps are declared up front and greyed until they
 * run, so the pipeline reads as a plan being worked through rather than a log
 * appearing from nowhere.
 */
const PIPELINE = [
  ['ingest', 'read the corpus into memory'],
  ['detect', 'find what has one human edge'],
  ['gaps', 'separate undocumented from unknowable'],
  ['interview', 'open the agenda of unwritten things'],
  ['plan', 'draft the sessions and handoffs'],
  ['dispatch', 'send the invites — Guild performs each'],
  ['handoff', 'move her tickets to their new owners'],
];

function renderPipeline(s) {
  const ran = new Map((s.steps || []).map((st) => [st.name, st]));
  const running = s.phase === 'analyzing' || s.phase === 'running';

  $('pipeline-steps').innerHTML = PIPELINE.map(([name, what]) => {
    const st = ran.get(name);
    const next = !st && running;
    const cls = st ? 'ran' : next ? 'now' : 'pending';
    return `<div class="pstep ${cls}">
      <span class="tick"></span>
      <span class="pname">${name}<span class="dim" style="font-family:var(--font-body);font-size:11px"> · ${what}</span></span>
      <span class="pms">${st ? `${st.ms}ms` : next ? '…' : '—'}</span>
    </div>`;
  }).join('');

  const onCloud = (s.steps || []).some((st) => st.ranOn === 'rocketride-cloud');
  const where = $('pipeline-where');
  where.textContent = onCloud ? 'RocketRide Cloud' : 'local harness';
  where.classList.toggle('cloud', onCloud);
}

const derived = new Set();

function renderDerivations(s) {
  const f = s.footprint;
  const d = s.findings;
  const rows = [];

  if (f) {
    rows.push(['fp-solo', f.solo, 'files only she has ever touched', 'crit']);
    rows.push(['fp-shared', f.shared, 'files she built with the team', '']);
    rows.push(['fp-untouched', f.untouched, 'files that were never hers', '']);
    rows.push(['fp-docs', f.docsSole, 'documents she alone edits', 'warn']);
    rows.push(['fp-tickets', f.openTickets, 'open tickets assigned to her', 'warn']);
  }
  if (d) {
    rows.push(['fd-solo', d.soloOwned.length, 'assets whose only human edge is hers', 'crit']);
    rows.push(['fd-undoc', d.undocumented.length, 'of those with no shared documentation', 'crit']);
    rows.push(['fd-block', d.blockers.length, 'open tickets blocked on her personally', 'warn']);
    rows.push(['fd-inc', d.incidents.length, 'incidents she personally resolved', '']);
    rows.push(['fd-pat', d.patterns.length, 'decision patterns inferred from her commits', '']);
  }
  if (s.gaps?.length) {
    const rescued = s.gaps.filter((g) => g.status === 'rescued').length;
    rows.push(['g-total', s.gaps.length, 'things that exist nowhere but in her head', 'crit']);
    if (rescued) rows.push([`g-resc-${rescued}`, rescued, 'of them now recorded in memory', 'good']);
  }

  const list = $('derive-list');
  for (const [key, value, text, tone] of rows) {
    if (derived.has(key)) {
      // Counts that move (rescued gaps) get their key rebuilt above, so an
      // existing key means an unchanged row — leave it alone.
      continue;
    }
    derived.add(key);
    list.querySelector('.derive-empty')?.remove();
    const row = document.createElement('div');
    row.className = `derive-row ${tone}`;
    row.innerHTML = `<b>${value}</b><span>${escapeHtml(text)}</span>`;
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;
  }

  const status = $('derive-status');
  if (s.phase === 'analyzing' || s.phase === 'running') { status.textContent = 'querying'; status.className = 'working'; }
  else if (rows.length) { status.textContent = `${rows.length} derivations`; status.className = 'done'; }
}

function renderMetrics(s) {
  const m = s.metrics || {};
  const cells = [
    ['nodes in memory', s.graph.nodes.length],
    ['relationships', s.graph.edges.length],
    ['solo-owned', m.atRisk ?? 0],
    ['unwritten gaps', m.gapsFound ?? 0],
    ['actions taken', m.actions ?? 0],
    ['agent handoffs', m.handoffs ?? 0],
  ];
  $('metrics').innerHTML = cells.map(([label, v]) => `<div class="metric"><b>${v}</b><span>${label}</span></div>`).join('');

  $('closer-stats').innerHTML = [
    ['gaps rescued', `${m.gapsRescued ?? 0}/${m.gapsFound ?? 0}`],
    ['real actions', m.actions ?? 0],
    ['agents', m.agents ?? 4],
    ['approvals', m.approvals ?? 0],
  ].map(([l, v]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
}

// ── approval gate ───────────────────────────────────────────────────────────

let pendingApproval = null;
function showApproval(ev) {
  pendingApproval = ev.approvalId;
  $('approval-title').textContent = ev.action?.subject || ev.title;
  $('approval-detail').textContent = ev.detail || '';
  $('approval-body').textContent = ev.action?.body || '';
  $('approval').hidden = false;
}
function hideApproval() { $('approval').hidden = true; pendingApproval = null; }

$('btn-approve').addEventListener('click', () => {
  if (pendingApproval) api('/api/approve', { id: pendingApproval, approved: true });
  hideApproval();
});
$('btn-reject').addEventListener('click', () => {
  if (pendingApproval) api('/api/approve', { id: pendingApproval, approved: false });
  hideApproval();
});

// ── interview ───────────────────────────────────────────────────────────────

async function openDock(agenda) {
  // Take the agenda from the event, then reconcile against live state — on a
  // page reload the replayed event carries the statuses from when it was first
  // published, not the ones that have since been rescued.
  state.gaps = agenda;
  try {
    const s = await api('/api/state');
    if (s.gaps?.length) state.gaps = s.gaps.map((g) => ({ gapId: g.id, question: g.question, title: g.title, status: g.status }));
  } catch { /* the event's copy is good enough */ }
  // The query panel did its job during the reveal; the interview needs the
  // graph unobstructed so the room can watch nodes turn green. Press Q to
  // bring it back if a judge asks to see the Cypher again.
  $('cypher').hidden = true;
  $('dock').hidden = false;
  updateProgress();
  if (!voice.sttSupported) {
    setTypingMode(true);
    $('answer-hint').textContent = 'speech recognition unavailable in this browser — typing mode';
  }
  nextQuestion();
}

async function nextQuestion() {
  const q = await api('/api/interview/next');
  if (q.done) {
    $('question').textContent = 'Every gap on the agenda has an answer.';
    $('q-meta').textContent = 'What is left is the part no agent could reach — that is what the human meeting is for.';
    $('btn-mic').hidden = true;
    $('btn-submit').hidden = true;
    voice.speak('That is everything I could not learn on my own. Thank you.');
    return;
  }
  state.current = q;
  $('question').textContent = q.question;
  $('q-meta').textContent = q.title;
  $('transcript').innerHTML = '';
  $('answer-box').value = '';

  // Load the crib sheet — her real answer, ready for one-key entry. The
  // presenter can speak instead and override it; this just means they never
  // have to. Also pre-fill the typing box so 'use her answer' and Enter agree.
  const model = q.modelAnswer || '';
  state.modelAnswer = model;
  if (model) {
    $('crib-text').textContent = model;
    $('crib').hidden = false;
    $('answer-box').value = model;
    $('btn-use-answer').hidden = false;
  } else {
    $('crib').hidden = true;
    $('btn-use-answer').hidden = true;
  }

  updateProgress();
  await voice.speak(q.question);
  $('answer-hint').textContent = model
    ? 'press ↵ to enter her answer, or speak to override'
    : (state.typing ? 'type her answer, then submit' : 'click to answer out loud');
}

function updateProgress() {
  const done = state.gaps.filter((g) => g.status === 'rescued').length;
  $('dock-progress').textContent = `· ${done} of ${state.gaps.length} rescued`;
}

$('btn-mic').addEventListener('click', () => {
  if (voice.listening) return finishListening();
  voice.shutUp();
  const ok = voice.start(
    (final, interim) => {
      $('transcript').innerHTML = `${escapeHtml(final)} <span class="interim">${escapeHtml(interim)}</span>`;
    },
    () => { setTypingMode(true); $('answer-hint').textContent = 'microphone unavailable — typing mode'; }
  );
  if (!ok) return;
  $('btn-mic').classList.add('listening');
  $('mic-label').textContent = 'stop and submit';
  $('answer-hint').textContent = 'listening…';
});

async function finishListening() {
  const text = voice.stop();
  $('btn-mic').classList.remove('listening');
  $('mic-label').textContent = 'hold to answer';
  if (!text) { $('answer-hint').textContent = 'nothing heard — try again or switch to typing'; return; }
  await submitAnswer(text);
}

$('btn-submit').addEventListener('click', async () => {
  const text = $('answer-box').value.trim();
  if (text) await submitAnswer(text);
});

// The one-key path for a solo demo: submit her real answer without speaking.
$('btn-use-answer').addEventListener('click', () => {
  const text = ($('answer-box').value.trim()) || state.modelAnswer;
  if (text) submitAnswer(text);
});
// Enter anywhere in the dock submits her answer (Shift+Enter still types a
// newline in the box). This is what lets the presenter run the whole interview
// from the keyboard.
$('dock').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey) return;
  if ($('dock').hidden) return;
  e.preventDefault();
  const text = ($('answer-box').value.trim()) || state.modelAnswer;
  if (text) submitAnswer(text);
});

async function submitAnswer(text) {
  $('transcript').textContent = text;
  $('answer-hint').textContent = 'writing to memory…';
  const res = await api('/api/interview/answer', { gapId: state.current.gapId, text });

  if (res.rescued) {
    const g = state.gaps.find((x) => x.gapId === state.current.gapId);
    if (g) g.status = 'rescued';
    $('answer-hint').textContent = `rescued · matched ${res.matched.join(', ')}`;
    await voice.speak('Got it. That one is safe now.');
    setTimeout(nextQuestion, 700);
  } else {
    $('answer-hint').textContent = 'that does not say enough to hand over — staying on the agenda';
    await voice.speak('That is not quite enough for someone else to act on. Can you be more specific?');
  }
  updateProgress();
}

function setTypingMode(on) {
  state.typing = on;
  $('answer-box').hidden = !on;
  $('transcript').hidden = on;
  $('btn-submit').hidden = !on;
  $('btn-mic').hidden = on;
  $('btn-mode').textContent = on ? 'use voice' : 'type instead';
}

$('btn-mode').addEventListener('click', () => setTypingMode(!state.typing));
$('btn-skip').addEventListener('click', () => { voice.shutUp(); nextQuestion(); });
$('btn-end').addEventListener('click', () => { voice.shutUp(); voice.stop(); $('dock').hidden = true; });

// ── ask memory ──────────────────────────────────────────────────────────────

const memHistory = [];
let memBusy = false;

function toggleMemory(open) {
  const el = $('memory');
  el.hidden = open === undefined ? !el.hidden : !open;
  if (!el.hidden) $('memory-input').focus();
}

$('btn-memory').addEventListener('click', () => toggleMemory());
$('btn-memory-close').addEventListener('click', () => toggleMemory(false));
$('memory-log').addEventListener('click', (e) => {
  const s = e.target.closest('.suggestions button');
  if (s) { $('memory-input').value = s.textContent; askMemory(); return; }
  const c = e.target.closest('.cite');
  if (c) graph.flash(c.dataset.id);
});
$('memory-form').addEventListener('submit', (e) => { e.preventDefault(); askMemory(); });

async function askMemory() {
  if (memBusy) return;
  const question = $('memory-input').value.trim();
  if (!question) return;
  $('memory-input').value = '';
  memBusy = true;

  const log = $('memory-log');
  log.querySelector('.memory-empty')?.remove();
  log.insertAdjacentHTML('beforeend',
    `<div class="msg user"><div class="msg-role">you</div><div class="msg-body">${escapeHtml(question)}</div></div>`);

  const bot = document.createElement('div');
  bot.className = 'msg bot';
  bot.innerHTML = '<div class="msg-role">memory</div><div class="msg-body typing"></div>';
  log.appendChild(bot);
  log.scrollTop = log.scrollHeight;
  const body = bot.querySelector('.msg-body');

  let full = '';
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, history: memHistory.slice(-6) }),
    });

    // Server-sent events, read off the response body directly.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop();
      for (const frame of frames) {
        const event = /^event: (.+)$/m.exec(frame)?.[1];
        const data = JSON.parse(/^data: (.+)$/m.exec(frame)?.[1] || '{}');
        if (event === 'delta') {
          full += data.delta;
          body.innerHTML = renderAnswer(full);
          log.scrollTop = log.scrollHeight;
        } else if (event === 'done') {
          body.classList.remove('typing');
          body.insertAdjacentHTML('afterend',
            `<div class="msg-foot">${data.citations.length} nodes retrieved · ${data.engine}</div>`);
          $('memory-engine').textContent = data.engine === 'graphrag'
            ? 'graph + vector retrieval · answered by model'
            : 'graph + vector retrieval · no model, showing raw memory';
        } else if (event === 'error') {
          body.classList.remove('typing');
          body.textContent = `Memory is unavailable: ${data.message}`;
        }
      }
    }
    memHistory.push({ role: 'user', content: question }, { role: 'assistant', content: full });
  } catch (err) {
    body.classList.remove('typing');
    body.textContent = `Could not reach memory: ${err.message}`;
  } finally {
    body.classList.remove('typing');
    memBusy = false;
    log.scrollTop = log.scrollHeight;
  }
}

/** Just enough markdown for what the model actually emits, plus [node:id]
 *  citations turned into chips that flash the node in the graph. */
function renderAnswer(md) {
  let html = escapeHtml(md);
  html = html
    .replace(/```([\s\S]*?)```/g, (_, c) => `<pre><code>${c}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^###?\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<![\w*])\*([^*\n]+)\*(?!\w)/g, '<em>$1</em>')
    .replace(/\[([a-z]+:[a-zA-Z0-9_:.-]+)\]/g, '<span class="cite" data-id="$1">$1</span>');

  return html.split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-•*]\s+/.test(l) || !l.trim())) {
      return `<ul>${lines.filter((l) => l.trim()).map((l) => `<li>${l.replace(/^\s*[-•*]\s+/, '')}</li>`).join('')}</ul>`;
    }
    if (lines.every((l) => /^\s*\d+\.\s+/.test(l) || !l.trim())) {
      return `<ol>${lines.filter((l) => l.trim()).map((l) => `<li>${l.replace(/^\s*\d+\.\s+/, '')}</li>`).join('')}</ol>`;
    }
    if (/^<(h3|blockquote|pre|ul|ol)/.test(block.trim())) return block;
    return `<p>${lines.join('<br>')}</p>`;
  }).join('');
}

// ── stage controls ──────────────────────────────────────────────────────────
// Deliberately invisible. Nothing on screen should look like a demo remote.

$('btn-closer-dismiss').addEventListener('click', () => { $('closer').hidden = true; });

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  switch (e.key.toLowerCase()) {
    case 'c': $('closer').hidden = !$('closer').hidden; break;         // closing card
    case 'q': $('cypher').hidden = !$('cypher').hidden; break;         // the hero query
    case 'd': $('dock').hidden = !$('dock').hidden; break;             // interview dock
    case 'm': toggleMemory(); break;                                   // ask memory
    case 'r': if (e.shiftKey) location.reload(); break;                // hard restart
  }
});

// ── helpers ─────────────────────────────────────────────────────────────────

function time(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

boot();
