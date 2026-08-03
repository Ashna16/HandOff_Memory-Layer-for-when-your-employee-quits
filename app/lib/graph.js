/**
 * The memory layer.
 *
 * Every question Handoff asks its memory is a *named query* defined once, with
 * two executions: real Cypher against FalkorDB (live) and an in-process
 * evaluation over the same graph shape (replay). Same name, same row shape,
 * same answer — so flipping modes changes nothing the audience can see.
 *
 * The store keeps an in-memory mirror in both modes. In live mode the mirror
 * exists only to render the UI without parsing graph objects off the wire;
 * the *answers* — solo ownership, gaps, coverage — come back from FalkorDB.
 * Each result carries `engine` so the UI can prove which one answered.
 */

import { RespClient, esc, mapLit } from './resp.js';
import config from '../config.js';

const OWNS = ['AUTHORED', 'EDITED']; // the two edge types that mean "a human touched this"

export class Graph {
  constructor(opts = config.falkor) {
    this.opts = opts;
    this.mode = opts.mode;
    this.client = null;
    this.connected = false;
    this.nodes = new Map();   // id → {id, label, ...props}
    this.edges = [];          // {from, type, to, ...props}
    this.queryLog = [];       // every Cypher we ran — shown in the UI
  }

  get engine() { return this.connected ? 'falkordb' : 'in-process'; }

  async connect() {
    if (this.mode !== 'live') return this;
    try {
      this.client = new RespClient(this.opts);
      await this.client.connect();
      await this.client.command(['GRAPH.QUERY', this.opts.graph, 'MATCH (n) DETACH DELETE n']);
      this.connected = true;
    } catch (err) {
      // Never let a database take the demo down. Log loudly, keep running.
      console.warn(`[graph] FalkorDB unavailable (${err.message}) — falling back to in-process memory`);
      this.connected = false;
    }
    return this;
  }

  async close() { this.client?.quit(); this.connected = false; }

  // ── writes ────────────────────────────────────────────────────────────────

  async addNodes(label, rows) {
    for (const r of rows) this.nodes.set(r.id, { ...r, label });
    if (!this.connected || !rows.length) return;
    const list = rows.map((r) => mapLit(r)).join(', ');
    await this.#cypher(
      `UNWIND [${list}] AS row MERGE (n:${label} {id: row.id}) SET n += row`
    );
  }

  async addEdges(type, rows) {
    for (const r of rows) this.edges.push({ ...r, type });
    if (!this.connected || !rows.length) return;
    const list = rows.map((r) => mapLit(r)).join(', ');
    await this.#cypher(
      `UNWIND [${list}] AS row MATCH (a {id: row.from}), (b {id: row.to}) ` +
      `MERGE (a)-[e:${type}]->(b) SET e += row`
    );
  }

  /** Continuous write-back: the interview mutates memory while it runs, which
   *  is the whole point of a memory layer that compounds instead of resetting. */
  async setNodeProps(id, props) {
    const n = this.nodes.get(id);
    if (n) Object.assign(n, props);
    if (!this.connected) return;
    await this.#cypher(`MATCH (n {id: ${esc(id)}}) SET n += ${mapLit(props)}`);
  }

  // ── named queries ─────────────────────────────────────────────────────────

  async run(name, params = {}) {
    const q = QUERIES[name];
    if (!q) throw new Error(`unknown query: ${name}`);
    if (this.connected) {
      try {
        const cypher = q.cypher(params);
        const rows = await this.#cypher(cypher);
        return { rows, engine: 'falkordb', cypher };
      } catch (err) {
        console.warn(`[graph] live query "${name}" failed (${err.message}) — using in-process`);
      }
    }
    const cypher = q.cypher(params);
    this.queryLog.push({ name, cypher, engine: 'in-process', at: Date.now() });
    return { rows: q.local(this, params), engine: 'in-process', cypher };
  }

  async #cypher(cypher) {
    this.queryLog.push({ cypher, engine: 'falkordb', at: Date.now() });
    const reply = await this.client.command(['GRAPH.QUERY', this.opts.graph, cypher, '--compact']);
    return parseReply(reply);
  }

  // ── in-process helpers (also the reference semantics for the Cypher) ───────

  /** Distinct Person ids with an ownership edge into `assetId`. */
  ownersOf(assetId) {
    const set = new Set();
    for (const e of this.edges) {
      if (e.to === assetId && OWNS.includes(e.type) && this.nodes.get(e.from)?.label === 'Person') set.add(e.from);
    }
    return [...set];
  }

  out(id, type) { return this.edges.filter((e) => e.from === id && (!type || e.type === type)); }
  in_(id, type) { return this.edges.filter((e) => e.to === id && (!type || e.type === type)); }
  node(id) { return this.nodes.get(id); }

  /** Everything the UI needs to draw, in one payload. */
  snapshot() {
    return {
      nodes: [...this.nodes.values()],
      edges: this.edges,
      engine: this.engine,
    };
  }
}

/**
 * The query registry. `cypher` is what actually runs against FalkorDB;
 * `local` is the same question answered over the mirror.
 */
export const QUERIES = {
  /**
   * THE hero query. Every asset whose only human edge is the departing person.
   * This is the line that turns the screen red.
   */
  soloOwned: {
    cypher: ({ person }) => `
      MATCH (a)<-[:AUTHORED|EDITED]-(q:Person)
      WITH a, collect(DISTINCT q.id) AS owners
      WHERE size(owners) = 1 AND owners[0] = ${esc(person)}
      RETURN a.id AS id, a.path AS path, a.title AS title, a.criticality AS criticality, a.system AS system
      ORDER BY a.criticality DESC`,
    local: (g, { person }) => {
      const out = [];
      for (const n of g.nodes.values()) {
        if (n.label !== 'File' && n.label !== 'Doc') continue;
        const owners = g.ownersOf(n.id);
        if (owners.length === 1 && owners[0] === person) {
          out.push({ id: n.id, path: n.path, title: n.title, criticality: n.criticality ?? 3, system: n.system });
        }
      }
      return out.sort((a, b) => (b.criticality ?? 0) - (a.criticality ?? 0));
    },
  },

  /** Solo-owned assets that no *shared* document explains. Written knowledge
   *  held by one person is a risk; unwritten knowledge held by one person is a
   *  countdown. This separates the two. */
  undocumented: {
    cypher: ({ person }) => `
      MATCH (a:File)<-[:AUTHORED]-(q:Person)
      WITH a, collect(DISTINCT q.id) AS owners
      WHERE size(owners) = 1 AND owners[0] = ${esc(person)}
      OPTIONAL MATCH (d:Doc)-[:COVERS]->(a)
      OPTIONAL MATCH (d)<-[:EDITED]-(e:Person) WHERE e.id <> ${esc(person)}
      WITH a, count(DISTINCT e) AS otherEditors
      WHERE otherEditors = 0
      RETURN a.id AS id, a.path AS path, a.criticality AS criticality, a.system AS system
      ORDER BY a.criticality DESC`,
    local: (g, { person }) => {
      const out = [];
      for (const n of g.nodes.values()) {
        if (n.label !== 'File') continue;
        const owners = g.ownersOf(n.id);
        if (owners.length !== 1 || owners[0] !== person) continue;
        const docs = g.in_(n.id, 'COVERS').map((e) => e.from);
        const otherEditors = docs.flatMap((d) => g.ownersOf(d)).filter((p) => p !== person);
        if (otherEditors.length === 0) out.push({ id: n.id, path: n.path, criticality: n.criticality ?? 3, system: n.system });
      }
      return out.sort((a, b) => b.criticality - a.criticality);
    },
  },

  /** Open work that stops moving the day she leaves. */
  openBlockers: {
    cypher: ({ person }) => `
      MATCH (p:Person {id: ${esc(person)}})-[:ASSIGNED]->(t:Ticket)-[:REFERENCES]->(f:File)
      WHERE t.status <> 'Done'
      RETURN t.id AS id, t.key AS key, t.title AS title, t.status AS status, f.id AS file, t.note AS note`,
    local: (g, { person }) => g.out(person, 'ASSIGNED')
      .map((e) => g.node(e.to))
      .filter((t) => t && t.status !== 'Done')
      .map((t) => {
        const file = g.out(t.id, 'REFERENCES')[0]?.to;
        return { id: t.id, key: t.key, title: t.title, status: t.status, file, note: t.note };
      }),
  },

  /** The thinking layer: how she reasons, not what she owns. */
  patterns: {
    cypher: ({ person }) => `
      MATCH (p:Person {id: ${esc(person)}})-[r:REASONS_LIKE]->(pat:Pattern)
      RETURN pat.id AS id, pat.name AS name, pat.detail AS detail, pat.confidence AS confidence
      ORDER BY pat.confidence DESC`,
    local: (g, { person }) => g.out(person, 'REASONS_LIKE')
      .map((e) => g.node(e.to))
      .filter(Boolean)
      .map((p) => ({ id: p.id, name: p.name, detail: p.detail, confidence: p.confidence }))
      .sort((a, b) => b.confidence - a.confidence),
  },

  /**
   * Multi-hop: who should inherit each system? Rank everyone else by how much
   * they have already touched inside it. A flat vector store cannot answer
   * this; two hops of graph traversal can.
   */
  successors: {
    cypher: ({ system, exclude }) => `
      MATCH (q:Person)-[:AUTHORED|EDITED]->(a)-[:BELONGS_TO]->(s:System {id: ${esc(system)}})
      WHERE q.id <> ${esc(exclude)}
      RETURN q.id AS id, q.name AS name, q.email AS email, count(a) AS touches
      ORDER BY touches DESC`,
    local: (g, { system, exclude }) => {
      const tally = new Map();
      for (const e of g.edges) {
        if (e.type !== 'BELONGS_TO' || e.to !== system) continue;
        for (const owner of g.ownersOf(e.from)) {
          if (owner === exclude) continue;
          tally.set(owner, (tally.get(owner) || 0) + 1);
        }
      }
      return [...tally.entries()]
        .map(([id, touches]) => ({ id, name: g.node(id)?.name, email: g.node(id)?.email, touches }))
        .sort((a, b) => b.touches - a.touches);
    },
  },

  /** Coverage: of everything at risk, how much now has a second human, a
   *  document, or a recorded answer behind it. This is the number on the meter. */
  coverage: {
    cypher: () => `
      MATCH (g:Gap) RETURN g.id AS id, g.status AS status, g.criticality AS criticality`,
    local: (g) => [...g.nodes.values()]
      .filter((n) => n.label === 'Gap')
      .map((n) => ({ id: n.id, status: n.status, criticality: n.criticality })),
  },

  /** Incidents she personally resolved — the richest source of tacit reasoning. */
  incidentsHandled: {
    cypher: ({ person }) => `
      MATCH (p:Person {id: ${esc(person)}})-[:RESPONDED_TO]->(i:Incident)
      RETURN i.id AS id, i.key AS key, i.title AS title, i.date AS date`,
    local: (g, { person }) => g.out(person, 'RESPONDED_TO').map((e) => {
      const i = g.node(e.to);
      return { id: i.id, key: i.key, title: i.title, date: i.date };
    }),
  },
};

/**
 * FalkorDB compact replies come back as [header, rows, stats]. We only ever
 * RETURN scalars (never node objects), which keeps this parser honest and
 * short — the alternative is decoding the compact node encoding for no gain.
 */
function parseReply(reply) {
  if (!Array.isArray(reply)) return [];
  if (reply.length < 2) return [];
  const [header, rows] = reply;
  const names = (header || []).map((h) => (Array.isArray(h) ? h[1] : h));
  return (rows || []).map((row) => {
    const obj = {};
    row.forEach((cell, i) => { obj[names[i]] = unwrap(cell); });
    return obj;
  });
}

/** Compact scalars arrive as [typeCode, value]. */
function unwrap(cell) {
  if (Array.isArray(cell) && cell.length === 2 && typeof cell[0] === 'number') {
    const v = cell[1];
    return typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  }
  return cell;
}
