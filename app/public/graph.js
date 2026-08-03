/**
 * The graph view.
 *
 * Canvas, one animation loop, no libraries. The whole point of this view is a
 * single readable idea: red is what has exactly one human behind it. Everything
 * else in the drawing is deliberately quiet so the red carries.
 */

/**
 * Node state is a *status* encoding — critical / warning / good — not a
 * categorical one, so it uses the reserved status steps rather than series
 * hues. These are the validated fixed status palette; good↔warning measures
 * ΔE 11.3 under protanopia and 27.6 to normal vision against this surface,
 * where the previous ad-hoc red/amber/mint sat at 9.3 and failed the
 * lightness band. Do not re-step them by eye — run the validator.
 *
 * Colour is never the only channel: every state also carries a distinct mark
 * shape (see #drawNode), a labelled legend, and a worded tooltip.
 */
const COLORS = {
  risk: '#8c3b28',      // solo-owned — dies with her
  sched: '#b68235',     // no written trace — must be asked
  ok: '#3f6b45',        // preserved
  neutral: '#bab6b6',   // shared with others — recedes
  hersSolo: '#9b9797',  // stage 0: only her hands have ever touched it
  hersShared: '#d7d3d3',// stage 0: built with the team
  subject: '#201f1d',
  person: '#7d7979',
  system: '#605d5d',
  surface: '#f3f2f2',   // paper — the 2px ring that separates overlapping marks
  edge: 'rgba(32,31,29,0.08)',
  edgeHot: 'rgba(140,59,40,0.20)',
  edgeOk: 'rgba(63,107,69,0.26)',
  rule: 'rgba(32,31,29,0.34)',
};

const SIZE = { Person: 7, System: 10, File: 4, Doc: 5, Ticket: 2.6, Incident: 5, Pattern: 5, Gap: 6.5, Answer: 3 };

/**
 * The drawing is columnar, not a cloud: her, then the systems she owns, then
 * the artifacts inside them, then the knowledge that exists nowhere but in her
 * head. Reading left to right is reading outward from the person into the
 * things that only she can explain — which is the argument the product makes.
 *
 * The simulation still runs; it only resolves the vertical packing within each
 * column, so the layout stays alive without losing its structure.
 */
const COLUMNS = [
  { key: 'person', at: 0.10, label: 'Person', has: (n) => n.label === 'Person' },
  { key: 'system', at: 0.31, label: 'Systems', has: (n) => n.label === 'System' },
  { key: 'artifact', at: 0.57, label: 'Artifacts', has: (n) => ['File', 'Doc', 'Ticket', 'Incident'].includes(n.label) },
  { key: 'tacit', at: 0.85, label: 'Tacit knowledge', has: (n) => ['Gap', 'Pattern', 'Answer'].includes(n.label) },
];

function columnOf(n) {
  return COLUMNS.find((c) => c.has(n)) || COLUMNS[2];
}

/** Stable per-id scatter, so a node sits in the same place on every run. */
function hash(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

export class GraphView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.nodes = new Map();
    this.edges = [];
    this.subjectId = null;
    this.hover = null;
    this.t = 0;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.#resize();
    window.addEventListener('resize', () => this.#resize());
    // The canvas is constructed while the stage is still hidden, so its first
    // measurement is 0×0. Observe the box instead of trusting that one read.
    new ResizeObserver(() => this.#resize()).observe(canvas);
    canvas.addEventListener('mousemove', (e) => this.#onMove(e));
    canvas.addEventListener('mouseleave', () => { this.hover = null; this.onHover?.(null); });

    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  #resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (!w || !h) return;
    const wasEmpty = !this.w || !this.h;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.w = w; this.h = h;

    // Anything positioned before we knew the stage size is sitting at 0,0.
    if (wasEmpty) {
      for (const n of this.nodes.values()) {
        const a = Math.random() * Math.PI * 2;
        const d = 30 + Math.random() * 90;
        n.x = w / 2 + Math.cos(a) * d;
        n.y = h / 2 + Math.sin(a) * d;
        n.vx = n.vy = 0;
      }
    }
    this.#anchors();
  }

  /** Systems get fixed anchors; everything that belongs to one is pulled toward
   *  its anchor, so the drawing reads as an org rather than a hairball. */
  #anchors() {
    const systems = [...this.nodes.values()].filter((n) => n.label === 'System');
    const cx = this.w / 2, cy = this.h / 2;
    // Elliptical, following the shape of the stage — a circle on a wide canvas
    // bunches the labels together at the top and bottom.
    const rx = this.w * 0.33, ry = this.h * 0.30;
    systems.forEach((s, i) => {
      const a = (i / Math.max(1, systems.length)) * Math.PI * 2 - Math.PI / 4;
      s.ax = cx + Math.cos(a) * rx;
      s.ay = cy + Math.sin(a) * ry;
    });
  }

  setGraph(snapshot, subjectId) {
    this.subjectId = subjectId;
    const cx = this.w / 2, cy = this.h / 2;

    for (const n of snapshot.nodes) {
      const existing = this.nodes.get(n.id);
      if (existing) { Object.assign(existing, n); continue; }
      // New nodes enter from near the centre so the bloom reads as growth.
      const a = Math.random() * Math.PI * 2;
      const d = 30 + Math.random() * 90;
      this.nodes.set(n.id, {
        ...n,
        x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d,
        vx: 0, vy: 0, born: performance.now(), flash: 0,
      });
    }
    this.edges = snapshot.edges.map((e) => ({ ...e }));
    this.#anchors();
  }

  /** Called on every risk change so the colour transition is a real event. */
  mark(nodeId, risk) {
    const n = this.nodes.get(nodeId);
    if (!n) return;
    n.risk = risk;
    n.flash = performance.now();
  }

  /** Clicking a citation in the memory chat points at the node it came from. */
  flash(nodeId) {
    const n = this.nodes.get(nodeId);
    if (!n) return false;
    n.flash = performance.now();
    this.hover = n;                       // also reveals its label
    setTimeout(() => { if (this.hover === n) this.hover = null; }, 2500);
    return true;
  }

  #onMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    // Nearest-point hit testing with a ~24px target — the marks themselves are
    // 3–12px, and a dot you have to land on dead-centre is not a hit target.
    let best = null, bestD = 24 * 24;
    for (const n of this.nodes.values()) {
      const dx = n.x - mx, dy = n.y - my;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = n; }
    }
    if (best !== this.hover) {
      this.hover = best;
      this.onHover?.(best, mx, my);
    }
  }

  // ── simulation ────────────────────────────────────────────────────────────

  #tick(now) {
    const list = [...this.nodes.values()];
    const cx = this.w / 2, cy = this.h / 2;

    // Repulsion, within a column only and on the vertical axis only. Horizontal
    // separation is what makes the four bands legible, so nothing is allowed to
    // push sideways — otherwise the columns smear back into a cloud. Nodes in
    // different columns simply do not see each other.
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (a.col !== b.col) continue;
        let dy = b.y - a.y;
        const dx = b.x - a.x;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { d2 = 1; dy = Math.random() - 0.5; }
        if (d2 > 26000) continue;
        const f = 460 / d2;
        const d = Math.sqrt(d2);
        const fy = (dy / d) * f;
        a.vy -= fy;
        b.vy += fy;
      }
    }

    // springs
    for (const e of this.edges) {
      const a = this.nodes.get(e.from), b = this.nodes.get(e.to);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      // Springs act on Y only. The columns own X, so a horizontal pull would
      // just fight the anchor and smear the bands into each other; what the
      // spring is for now is keeping a file near the system it belongs to.
      const rest = e.type === 'BELONGS_TO' ? 30 : 60;
      const k = e.type === 'BELONGS_TO' ? 0.0075 : 0.0021;
      const f = (d - rest) * k;
      const fy = (dy / d) * f;
      a.vy += fy;
      b.vy -= fy;
    }

    for (const n of list) {
      // Column anchoring. X is held firmly so the four bands stay legible;
      // Y is left to the simulation so the packing still breathes. A small
      // per-node offset keeps a band from collapsing into a single hard line.
      const col = columnOf(n);
      n.col = col.key;
      if (n.jitter === undefined) n.jitter = (hash(n.id) % 60) - 30;
      const targetX = this.w * col.at + n.jitter;

      if (n.id === this.subjectId) {
        // Pinned. This is a drawing about one person; letting the simulation
        // decide where she ends up gives away the composition.
        n.x = targetX; n.y = cy; n.vx = 0; n.vy = 0;
        continue;
      }

      n.vx += (targetX - n.x) * 0.020;
      n.vy += (cy - n.y) * 0.0009;

      // Soft walls. A hard clamp makes nodes pile up along the edge in a line,
      // which reads as a rendering bug rather than a layout.
      // Vertical walls only — X belongs to the column anchor now. The top band
      // is reserved for the column headers, the bottom for the legend.
      const top = 104, bottom = this.h - 104;
      if (n.y < top) n.vy += (top - n.y) * 0.030;
      if (n.y > bottom) n.vy += (bottom - n.y) * 0.030;
      // Keep the headline count in the top-left corner clear.
      if (n.x < 240 && n.y < 172) n.vy += 0.9;

      // A slow perpetual drift. Without it the simulation reaches equilibrium
      // and freezes, which reads as a screenshot — the graph has to look alive
      // for the whole demo, not just while it is settling. Each node gets its
      // own phase from its id hash, so the field breathes instead of pulsing in
      // unison, and the amplitude is small enough to never fight the columns.
      const t = now / 1000;
      const phase = n.jitter * 0.21;
      n.vx += Math.cos(t * 0.23 + phase) * 0.013;
      n.vy += Math.sin(t * 0.31 + phase) * 0.021;

      // Light friction and a hard speed limit: enough to keep the drift gentle,
      // not so much that it damps the motion out entirely.
      n.vx *= 0.93; n.vy *= 0.93;
      const MAX = 0.55;
      if (n.vx > MAX) n.vx = MAX; else if (n.vx < -MAX) n.vx = -MAX;
      if (n.vy > MAX) n.vy = MAX; else if (n.vy < -MAX) n.vy = -MAX;
      n.x += n.vx; n.y += n.vy;

      n.x = Math.max(14, Math.min(this.w - 14, n.x));
      n.y = Math.max(20, Math.min(this.h - 20, n.y));
    }
  }

  // ── drawing ───────────────────────────────────────────────────────────────

  loop(now) {
    this.t = now;
    this.#tick(now);
    const { ctx } = this;
    ctx.clearRect(0, 0, this.w, this.h);

    // Column headers — the reading order, stated. Ruled small caps at the top
    // of each band, the way a ledger names its columns.
    ctx.save();
    ctx.font = '600 9.5px "Lora", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(32,31,29,0.38)';
    for (const col of COLUMNS) {
      const x = this.w * col.at;
      ctx.fillText(col.label.toUpperCase().split('').join(' '), x, 34);
      ctx.strokeStyle = 'rgba(32,31,29,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 46);
      ctx.lineTo(x, this.h - 74);
      ctx.stroke();
    }
    ctx.restore();

    // edges
    for (const e of this.edges) {
      const a = this.nodes.get(e.from), b = this.nodes.get(e.to);
      if (!a || !b) continue;
      const hot = a.risk === 'at-risk' || b.risk === 'at-risk';
      const good = a.risk === 'rescued' || b.risk === 'rescued';
      const hovered = this.hover && (e.from === this.hover.id || e.to === this.hover.id);
      ctx.strokeStyle = hovered ? 'rgba(32,31,29,0.34)' : good ? COLORS.edgeOk : hot ? COLORS.edgeHot : COLORS.edge;
      ctx.lineWidth = hovered ? 1.1 : 0.7;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // nodes
    for (const n of this.nodes.values()) {
      const age = (now - n.born) / 620;
      const grow = age >= 1 ? 1 : easeOut(Math.max(0, age));
      if (grow <= 0.001) continue;

      const base = SIZE[n.label] ?? 3.5;
      const bump = n.label === 'File' ? (n.criticality ?? 3) * 0.55 : 0;
      let r = (base + bump) * grow;

      const color = this.#color(n);

      // pulse ring on anything still at risk — the countdown, made visible
      if (n.risk === 'at-risk') {
        const phase = ((now / 1400) + (n.x + n.y) / 900) % 1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + phase * 17, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(140,59,40,${(1 - phase) * 0.5})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // rescue flash
      if (n.flash) {
        const f = (now - n.flash) / 900;
        if (f < 1) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + f * 34, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(63,107,69,${(1 - f) * 0.9})`;
          ctx.lineWidth = 1.6;
          ctx.stroke();
          r *= 1 + (1 - f) * 0.35;
        } else n.flash = 0;
      }

      // A 2px surface ring, not a border: in a force layout marks overlap, and
      // without it two adjacent nodes read as one blob.
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 1, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.surface;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      if (n.label === 'System') {
        ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.stroke();
      } else {
        ctx.fillStyle = color; ctx.fill();
      }

      // Shape carries the status too, so the three states survive colour
      // blindness, a bad projector, and a greyscale screenshot:
      //   at risk   solid disc + concentric ring   (an alarm)
      //   booked    solid disc + open top arc      (partially closed)
      //   rescued   donut — punched through        (closed)
      const status = n.risk || (n.label === 'Gap' ? n.status : null);
      if (status === 'rescued' && r > 2.5) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.surface;
        ctx.fill();
      } else if (status === 'transfer-scheduled' && r > 2.5) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 0.72, Math.PI * 1.15, Math.PI * 1.85);
        ctx.strokeStyle = COLORS.surface;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      } else if (status === 'at-risk' && r > 3) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 0.55, 0, Math.PI * 2);
        ctx.strokeStyle = COLORS.surface;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      if (n.id === this.subjectId) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 6, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(32,31,29,0.5)'; ctx.lineWidth = 1; ctx.stroke();
      }
    }

    // labels — only the structural ones, so the drawing stays legible
    ctx.font = '600 11.5px "Lora", Georgia, serif';
    ctx.textAlign = 'center';
    for (const n of this.nodes.values()) {
      // Only the structural anchors carry a permanent label. Every other name
      // is available on hover — a drawing where everything shouts reads as noise.
      const isBig = n.label === 'System' || n.id === this.subjectId;
      if (!isBig && n !== this.hover) continue;
      const grow = Math.min(1, (now - n.born) / 620);
      ctx.fillStyle = n.id === this.subjectId ? 'rgba(32,31,29,0.94)'
        : n.label === 'System' ? `rgba(32,31,29,${0.72 * grow})`
          : `rgba(32,31,29,${0.6 * grow})`;
      const text = n.name || n.title || n.path?.split('/').pop() || '';
      const r = SIZE[n.label] ?? 4;
      // System labels hang below their node so they cannot collide with the
      // headline count in the top-left corner.
      ctx.fillText(text, n.x, n.label === 'System' ? n.y + r + 15 : n.y - r - 8);
    }

    requestAnimationFrame(this.loop);
  }

  #color(n) {
    if (n.risk === 'at-risk') return COLORS.risk;
    if (n.risk === 'transfer-scheduled') return COLORS.sched;
    if (n.risk === 'rescued') return COLORS.ok;
    if (n.label === 'Gap') return n.status === 'rescued' ? COLORS.ok : n.status === 'partial' ? COLORS.sched : COLORS.risk;
    if (n.id === this.subjectId) return COLORS.subject;
    if (n.label === 'Person') return COLORS.person;
    if (n.label === 'System') return COLORS.system;
    if (n.label === 'Pattern') return n.status === 'confirmed' ? COLORS.ok : 'rgba(32,31,29,0.30)';
    // Before any analysis runs, the graph already answers stage 0: what did she
    // build alone (bright), with the team (mid), never touch (recessive)?
    if (n.hers === 'solo') return COLORS.hersSolo;
    if (n.hers === 'shared') return COLORS.hersShared;
    return COLORS.neutral;
  }
}

function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
