/**
 * Chat over everything Handoff remembers.
 *
 * This is GraphRAG rather than plain RAG, and the difference is the point:
 * embeddings find the entry points, then the graph supplies the relationships
 * around them. Ask "what happens if Marcus takes over the ranking pipeline"
 * and a flat vector store returns the files whose text mentions Marcus. The
 * graph returns the files he has never touched, who else has, which of them
 * are undocumented, and what Sarah said about each in her exit interview —
 * because those are edges, not words.
 *
 * Answers cite node ids, and the UI lights those nodes up in the graph, so
 * every claim is traceable back to the memory it came from.
 */

import { cosine } from './llm.js';

const SYSTEM = `You are Handoff's memory. You answer questions about what one departing employee knows, owns, and has explained, using only the graph context provided.

Rules:
- Answer only from the CONTEXT. If it does not contain the answer, say so plainly and name what is missing.
- Cite the node ids you used, inline, like [f:retry_queue]. Cite generously.
- When the context includes something the employee said in her exit interview, quote her and attribute it. That is the highest-value information you have — it exists nowhere else. Reproduce her words character-for-character as they appear in the context; never paraphrase, tidy, or reconstruct anything inside quotation marks. If you cannot quote exactly, describe what she said without quotation marks.
- Distinguish clearly between what is documented, what was inferred from her commits, and what she confirmed out loud. Never present an inference as a confirmed fact.
- Be concise and concrete. Engineers are reading this to decide what to do next, not to be reassured.

Length: lead with the direct answer in one or two sentences, then at most four supporting points. Stay under 180 words unless explicitly asked for an exhaustive list. Do not restate the question, do not summarise at the end, and do not pad with caveats — a short answer that names the one thing that matters beats a complete one nobody finishes reading.`;

export class MemoryChat {
  constructor({ graph, llm, orchestrator }) {
    this.graph = graph;
    this.llm = llm;
    this.orch = orchestrator;
    this.index = null;       // [{id, text, vector}]
    this.indexedAt = 0;
    this.history = [];
  }

  /** One sentence per node, written so that it embeds well and reads well. */
  describe(n) {
    const g = this.graph;
    const owners = g.ownersOf(n.id).map((p) => g.node(p)?.name).filter(Boolean);
    const sys = n.system ? g.node(n.system)?.name : null;

    switch (n.label) {
      case 'File': {
        const docs = g.in_(n.id, 'COVERS').map((e) => g.node(e.from)?.title).filter(Boolean);
        const tickets = g.in_(n.id, 'REFERENCES').map((e) => g.node(e.from)?.key).filter(Boolean);
        const risk = n.risk === 'at-risk' ? 'NOBODY ELSE HAS EVER CHANGED IT'
          : n.risk === 'rescued' ? 'knowledge about it has been recovered in the exit interview'
            : n.risk === 'transfer-scheduled' ? 'a knowledge-transfer session is booked for it'
              : 'it has more than one owner';
        return `Source file ${n.path} in the ${sys || 'codebase'}, criticality ${n.criticality}/5. `
          + `Everyone who has ever committed to it: ${owners.join(', ') || 'nobody recorded'} — ${risk}. `
          + (docs.length ? `Documented by: ${docs.join('; ')}. ` : 'No documentation covers it. ')
          + (tickets.length ? `Referenced by tickets ${tickets.join(', ')}.` : '');
      }
      case 'Doc':
        return `Document "${n.title}" at ${n.path}, covering the ${sys || 'system'}. Editors: ${owners.join(', ') || 'unknown'}.`
          + (owners.length === 1 ? ' Only one person has ever edited it.' : '');
      case 'Ticket': {
        const files = g.out(n.id, 'REFERENCES').map((e) => g.node(e.to)?.path).filter(Boolean);
        const assignee = g.in_(n.id, 'ASSIGNED').map((e) => g.node(e.from)?.name)[0];
        return `Ticket ${n.key}: "${n.title}". Status ${n.status}, assigned to ${assignee || 'nobody'}.`
          + (n.note ? ` Note: ${n.note}` : '') + (files.length ? ` Touches ${files.join(', ')}.` : '');
      }
      case 'Incident': {
        const files = g.out(n.id, 'TOUCHED').map((e) => g.node(e.to)?.path).filter(Boolean);
        const responder = g.in_(n.id, 'RESPONDED_TO').map((e) => g.node(e.from)?.name)[0];
        return `Incident ${n.key} on ${n.date}: "${n.title}". Handled by ${responder}. Resolution: ${n.resolution}.`
          + (files.length ? ` Involved ${files.join(', ')}.` : '');
      }
      case 'Pattern':
        return `Decision pattern of ${this.orch.subject?.name || 'the employee'}: "${n.name}". ${n.detail} `
          + (n.status === 'confirmed'
            ? 'She CONFIRMED this in her own words during the exit interview.'
            : `INFERRED from her commit history at ${Math.round((n.confidence ?? 0) * 100)}% confidence — she has not confirmed it.`);
      case 'Gap': {
        const about = g.out(n.id, 'ABOUT').map((e) => g.node(e.to)?.path)[0];
        return `Knowledge gap: "${n.title}" (about ${about}, criticality ${n.criticality}/5). `
          + (n.status === 'rescued' ? 'ANSWERED in the exit interview.'
            : n.status === 'partial' ? 'Partially answered — the answer was not specific enough to act on.'
              : 'STILL UNANSWERED. It exists nowhere in writing and nobody else knows it.');
      }
      case 'Answer': {
        const gap = g.node(n.gap);
        return `Exit-interview answer, in her own words, to "${gap?.title || n.gap}": "${n.text}"`;
      }
      case 'Person': {
        const authored = g.out(n.id, 'AUTHORED').length;
        return `${n.name}, ${n.role}${n.email ? ` (${n.email})` : ''}. Has committed to ${authored} files.`
          + (n.id === this.orch.subject?.id ? ' THIS IS THE DEPARTING EMPLOYEE.' : '');
      }
      case 'System':
        return `System "${n.name}" (${n.tier}).`;
      default:
        return `${n.label} ${n.id}${n.title ? `: ${n.title}` : ''}`;
    }
  }

  /** Rebuilt whenever memory has grown — the interview adds nodes as it runs. */
  async ensureIndex() {
    const size = this.graph.nodes.size;
    if (this.index && this.indexedAt === size) return this.index;

    const rows = [...this.graph.nodes.values()].map((n) => ({ id: n.id, label: n.label, text: this.describe(n) }));
    const vectors = await this.llm.embed(rows.map((r) => r.text));
    this.index = rows.map((r, i) => ({ ...r, vector: vectors?.[i] || null }));
    this.indexedAt = size;
    return this.index;
  }

  /**
   * Retrieval: semantic top-k, then one hop of graph expansion.
   * The expansion is what makes an answer about a *file* also know who else
   * touched the system it belongs to.
   */
  async retrieve(question, k = 14) {
    const index = await this.ensureIndex();
    const qv = (await this.llm.embed([question]))?.[0];

    let seeds;
    if (qv && index.every((r) => r.vector)) {
      seeds = index
        .map((r) => ({ ...r, score: cosine(qv, r.vector) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    } else {
      // No embeddings available: fall back to term overlap. Cruder, still useful.
      const terms = question.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
      seeds = index
        .map((r) => ({ ...r, score: terms.filter((t) => r.text.toLowerCase().includes(t)).length }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    }

    const chosen = new Map(seeds.map((s) => [s.id, s]));
    for (const seed of seeds.slice(0, 8)) {
      const neighbours = [
        ...this.graph.out(seed.id).map((e) => e.to),
        ...this.graph.in_(seed.id).map((e) => e.from),
      ];
      for (const id of neighbours.slice(0, 6)) {
        if (chosen.has(id)) continue;
        const n = this.graph.node(id);
        if (!n) continue;
        chosen.set(id, { id, label: n.label, text: this.describe(n), score: (seed.score ?? 0) * 0.4, viaGraph: true });
      }
    }
    return [...chosen.values()].slice(0, 40);
  }

  /** Run-level facts, so the model can answer "how bad is it" without retrieval. */
  #situation() {
    const o = this.orch;
    if (!o.subject) return 'No offboarding run has been executed yet; memory is empty.';
    const c = o.coverage();
    return [
      `Departing employee: ${o.subject.name}, ${o.subject.role}. Last day ${o.world.meta.lastDay}.`,
      `Company: ${o.world.meta.company}. Primary system: ${o.world.meta.system}.`,
      o.findings ? `${o.findings.soloOwned.length} assets have exactly one human edge (hers). ${o.findings.undocumented.length} of those have no shared documentation. ${o.findings.blockers.length} open tickets are blocked on her.` : '',
      `${o.gaps.length} knowledge gaps identified; ${o.gaps.filter((g) => g.status === 'rescued').length} answered in the exit interview.`,
      `Knowledge coverage: ${c.pct}% now, ceiling ${c.projected}% once booked sessions happen and the agenda is finished.`,
      `${o.rocket.receipts.length + o.guild.receipts.length} rescue actions executed so far (${o.guild.receipts.length} via Guild, ${o.rocket.receipts.length} via RocketRide).`,
    ].filter(Boolean).join('\n');
  }

  /**
   * Ask. Streams the answer through `onDelta` and resolves with the full
   * response plus the node ids it drew on.
   */
  async ask(question, { onDelta, history = [] } = {}) {
    const context = await this.retrieve(question);
    const citations = context.map((c) => c.id);

    if (!this.llm.available) {
      const answer = this.#withoutModel(question, context);
      onDelta?.(answer);
      return { answer, citations, engine: 'retrieval-only' };
    }

    const contextBlock = context.map((c) => `[${c.id}] ${c.text}`).join('\n');
    const messages = [
      { role: 'system', content: SYSTEM },
      ...history.slice(-6),
      {
        role: 'user',
        content: `SITUATION\n${this.#situation()}\n\nCONTEXT (${context.length} nodes retrieved from the knowledge graph)\n${contextBlock}\n\nQUESTION\n${question}`,
      },
    ];

    const answer = await this.llm.stream({ messages, onDelta });
    if (answer === null) {
      const fallback = this.#withoutModel(question, context);
      onDelta?.(fallback);
      return { answer: fallback, citations, engine: 'retrieval-only' };
    }

    this.history.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
    return { answer, citations, engine: 'graphrag' };
  }

  /** Honest degradation: show what memory holds, without pretending to reason. */
  #withoutModel(question, context) {
    if (!context.length) return `No model is configured and nothing in memory matches "${question}".`;
    return [
      `No language model is configured, so here is the raw memory that matches "${question}" — ${context.length} nodes:`,
      '',
      ...context.slice(0, 12).map((c) => `• [${c.id}] ${c.text}`),
    ].join('\n');
  }
}
