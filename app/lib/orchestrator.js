/**
 * The run.
 *
 * LaserData hears the resignation → the Mapper writes everything she ever
 * touched into FalkorDB → the Gap-Hunter asks memory what dies with her →
 * the Rescuer plans, a human approves, RocketRide executes → the Interviewer
 * gets what was never written down and writes it back into memory.
 *
 * Nothing in here talks to an external system directly. Memory goes through
 * graph.js, motion through rocketride.js, coordination through guild.js,
 * and every observable moment is published to the stream.
 */

import config from '../config.js';
import { LLM } from './llm.js';
import { load as loadWorld } from './seed.js';
import { EVENT, humanDelay, beat } from './laser.js';
import { AGENTS } from './guild.js';

const DOC_WEIGHT = 2;
const TICKET_WEIGHT = 1;
const INCIDENT_WEIGHT = 2;
const PATTERN_WEIGHT = 3;
const INFERRED_CREDIT = 0.35;   // a heuristic we guessed from her commits but she never confirmed
const SCHEDULED_CREDIT = 0.6;   // a booked session is a promise, not a transfer

export class Orchestrator {
  constructor(deps) {
    Object.assign(this, deps); // graph, stream, rocket, guild, llm
    // The reasoning layer is optional everywhere, so it must never be the
    // reason construction fails — an absent one simply reports unavailable.
    this.llm ||= new LLM();
    this.world = loadWorld();
    this.subject = null;
    this.findings = null;
    this.gaps = [];
    this.plan = [];
    this.agenda = [];
    this.proposal = null;
    this.footprint = null;
    this.status = 'idle';
    this.startedAt = null;
    this.coverageHistory = [];
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  async boot() {
    await Promise.all([
      this.graph.connect(),
      this.stream.connect(),
      this.rocket.connect(),
      this.guild.connect(),
    ]);
    return this.health();
  }

  health() {
    return {
      mode: config.mode,
      scenario: config.scenario,
      services: {
        falkordb: { mode: this.graph.mode, transport: this.graph.engine, live: this.graph.connected },
        laserdata: { mode: this.stream.mode, transport: this.stream.transport, live: this.stream.online },
        rocketride: { mode: this.rocket.mode, transport: this.rocket.transport, live: this.rocket.online, account: this.rocket.account?.name || null },
        guild: { mode: this.guild.mode, transport: this.guild.transport, live: this.guild.online },
        llm: { mode: this.llm.available ? 'live' : 'off', transport: this.llm.opts.model, live: this.llm.available },
      },
    };
  }

  state() {
    return {
      status: this.status,
      phase: this.status,
      proposal: this.proposal,
      footprint: this.footprint,
      history: this.history,
      subject: this.subject,
      graph: this.graph.snapshot(),
      findings: this.findings,
      gaps: this.gaps,
      plan: this.plan,
      agenda: this.agenda,
      coverage: this.coverage(),
      coverageHistory: this.coverageHistory,
      agents: Object.values(AGENTS),
      activeAgent: this.guild.active,
      handoffs: this.guild.handoffs,
      steps: this.rocket.steps,
      receipts: [...this.rocket.receipts, ...this.guild.receipts].sort((a, b) => a.at - b.at),
      queries: this.graph.queryLog.slice(-12),
      llm: this.llm.describe(),
      context: this.stream.contextSummary(),
      metrics: this.guild.metrics({
        atRisk: this.findings?.soloOwned.length || 0,
        gapsFound: this.gaps.length,
        gapsRescued: this.gaps.filter((g) => g.status === 'rescued').length,
        actions: this.rocket.receipts.length + this.guild.receipts.length,
      }),
      health: this.health(),
    };
  }

  async reset() {
    this.graph.nodes.clear();
    this.graph.edges = [];
    this.stream.reset();
    this.rocket.reset();
    this.findings = null; this.gaps = []; this.plan = []; this.agenda = [];
    this.proposal = null; this.footprint = null; this.history = null;
    this.status = 'idle';
    this.coverageHistory = [];
  }

  /** The run is a staircase, not a slide: each phase completes, publishes
   *  itself to the stream, and waits for a person to press the next button. */
  #setPhase(phase, title, detail) {
    this.status = phase;
    this.stream.publish(EVENT.PHASE, { phase, title, detail, level: 'good' });
  }

  // ── the run ───────────────────────────────────────────────────────────────

  async run(subjectName = config.scenario.subject) {
    if (this.status === 'running') return { error: 'already running' };
    await this.reset();
    this.status = 'running';
    this.startedAt = Date.now();

    const person = this.world.people.find(
      (p) => p.name.toLowerCase() === String(subjectName).toLowerCase()
    ) || this.world.people[0];
    this.subject = person;
    await this.guild.startRun(person.name);

    // 0 — the trigger arrives on the stream. Everything downstream is a
    //     reaction to this event, not to a button.
    this.stream.publish(EVENT.RESIGNATION, {
      title: `Resignation received — ${person.name}`,
      detail: `${person.role} · last day ${config.scenario.lastDay} · ${daysUntil(config.scenario.lastDay)} days`,
      subject: person.id,
      level: 'critical',
    });
    await humanDelay(1.2);

    try {
      await this.#mapperTurn(person);
      await this.#footprint(person);
      this.#setPhase('mapped',
        'Her world is mapped — ready to start the handoff',
        'The graph shows everything she has ever touched. Press start handoff and FalkorDB works out what dies with her.');
    } catch (err) {
      this.status = 'error';
      this.stream.publish(EVENT.ERROR, { title: 'Run failed', detail: err.message, level: 'critical' });
      console.error(err);
    }
    return { ok: true, runId: this.guild.runId };
  }

  /** Phase 2 — FalkorDB studies the graph, findings land on the right panel,
   *  and the rescue plan is drafted but not executed. */
  async analyze() {
    if (this.status !== 'mapped') return { error: `cannot analyze from "${this.status}"` };
    this.status = 'analyzing';
    try {
      await this.#hunterTurn(this.subject);
      await this.#draftProposal(this.subject);
      this.#setPhase('analyzed',
        `Analysis complete — ${this.findings.soloOwned.length} assets die with her`,
        `${this.proposal.meetings.length} transfer sessions and ${this.proposal.jiras.length} Jira handoffs drafted. Review the plan, then start the voice interview.`);
    } catch (err) {
      this.status = 'error';
      this.stream.publish(EVENT.ERROR, { title: 'Analysis failed', detail: err.message, level: 'critical' });
      console.error(err);
    }
    return { ok: true };
  }

  /** Phase 3 — the voice interview over everything with no written trace. */
  async interview() {
    if (!['analyzed', 'meetings-sent', 'interviewing'].includes(this.status)) {
      return { error: `cannot interview from "${this.status}"` };
    }
    await this.rocket.step('interview', { person: this.subject.id }, () => this.#interviewerTurn(this.subject));
    this.#setPhase('interviewing',
      `Exit interview open — ${this.gaps.length} questions`,
      'Every question targets knowledge that exists nowhere but her head. Her answers are written into memory as she speaks.');
    return { ok: true };
  }

  /** Phase 4 — Guild sends the real invites. Every invite carries the questions
   *  the successor should ask AND what the interviewer already learned. */
  async meetings() {
    if (!['interviewing', 'analyzed'].includes(this.status)) {
      return { error: `cannot send meetings from "${this.status}"` };
    }
    const person = this.subject;
    this.status = 'meetings-sending';
    try {
      await this.guild.turn('rescuer', 'send the invites, each with its own briefing', async () => {
        const { result: actions } = await this.rocket.step('plan', { person: person.id }, () => this.#buildMeetingActions(person));
        this.plan = [...this.plan, ...actions];

        this.stream.publish(EVENT.PROPOSED, {
          agent: 'rescuer',
          title: `Sending ${actions.length} actions through the executors`,
          detail: actions.map((a) => a.label).join(' · '),
        });
        await humanDelay(0.6);
        // RocketRide sequences the send; Guild performs each one. The step is
        // recorded either way, so the pipeline shows the whole chain end to end.
        await this.rocket.step('dispatch', { count: actions.length }, () => this.#executeActions(actions));
        // One real email + one real calendar event, fired through the deployed
        // Guild agent and confirmed in the background so the feed never waits on
        // a ~50s agent rebuild. The simulated receipts above already landed.
        this.#confirmRealMeeting(person);
      });
      this.#setPhase('meetings-sent',
        'Invites out — every session arrives pre-briefed',
        'Each invite carries the questions to ask her and what the interviewer already captured. One button left: hand off her Jira tickets.');
    } catch (err) {
      this.status = 'error';
      this.stream.publish(EVENT.ERROR, { title: 'Meeting generation failed', detail: err.message, level: 'critical' });
      console.error(err);
    }
    return { ok: true };
  }

  /**
   * Fire one real email briefing and one real calendar invite through the
   * deployed Guild agent, and confirm them on the stream when they land. Always
   * background, never awaited — a slow agent rebuild must not hold the phase.
   * Each carries what the interview actually captured, so the successor's
   * briefing is real content, not a placeholder.
   */
  #confirmRealMeeting(person) {
    if (!config.guild.liveJira) return;
    const m = this.proposal?.meetings?.[0];
    if (!m) return;

    const learned = this.gaps
      .filter((g) => g.system === m.system && g.status === 'rescued')
      .map((g) => `• ${g.title}: ${g.distilled || truncate(g.answer || '', 160)}`);
    const openQs = this.gaps
      .filter((g) => g.system === m.system && g.status !== 'rescued')
      .map((g) => `• ${g.question}`);

    const body = [
      `You are inheriting ${m.assets?.length || 'several'} assets in ${m.systemName} that ${person.name} is the only person to have ever changed.`,
      '',
      learned.length ? `Already answered in her exit interview — don't re-ask:\n${learned.join('\n')}` : '',
      openQs.length ? `\nAsk her about these — they exist nowhere in writing:\n${openQs.join('\n')}` : '',
    ].filter(Boolean).join('\n');

    // Email the briefing.
    this.guild.emailReal(config.guild.realEmail, `Before your handover session: ${m.systemName}`, body)
      .then((res) => {
        if (!res) return;
        this.stream.publish(EVENT.EXECUTED, {
          agent: 'rescuer', kind: 'email', level: 'good',
          title: `Briefing emailed for real — ${m.systemName}`,
          detail: res.summary,
          receipt: { id: res.id, summary: res.summary, simulated: false, via: 'guild', kind: 'email' },
        });
      }).catch(() => {});

    // Book the real session two business days out.
    const start = businessDay(2).iso;
    this.guild.calendarReal(`Knowledge transfer: ${m.systemName}`, body, start, 45, [config.guild.realEmail])
      .then((res) => {
        if (!res) return;
        this.stream.publish(EVENT.EXECUTED, {
          agent: 'rescuer', kind: 'calendar', level: 'good',
          title: `Session booked for real — ${m.systemName}`,
          detail: res.summary,
          receipt: { id: res.id, url: res.url, summary: res.summary, simulated: false, via: 'guild', kind: 'calendar' },
        });
      }).catch(() => {});
  }

  /** Phase 5 — her open tickets move to the same people who got the sessions,
   *  live, and the graph rewires as each one lands. */
  async jiras() {
    if (!['meetings-sent', 'interviewing', 'analyzed'].includes(this.status)) {
      return { error: `cannot hand off jiras from "${this.status}"` };
    }
    const person = this.subject;
    this.status = 'jiras-sending';
    try {
      await this.guild.turn('rescuer', 'reassign her open tickets to their new owners', () =>
        this.rocket.step('handoff', { tickets: this.proposal.jiras.length }, async () => {
        for (const j of this.proposal.jiras) {
          const learned = this.gaps
            .filter((g) => g.anchor === j.file && g.status === 'rescued')
            .map((g) => g.distilled || truncate(g.answer || '', 200))
            .filter(Boolean);

          const action = {
            kind: 'jira',
            label: `${j.key} reassigned — ${j.fromName} → ${j.toName}`,
            subject: `[Handover] ${j.title}`,
            to: j.toEmail,
            project: 'DW',
            ticket: j.ticket,
            body: [
              `Reassigned from ${j.fromName}, whose last day is ${config.scenario.lastDay}.`,
              '',
              learned.length ? `What the exit interview already captured:\n${learned.map((l) => `- ${l}`).join('\n')}` : 'No interview answer covers this yet — raise it in your transfer session.',
              '',
              `Transfer session: see calendar invite for ${this.graph.node(this.graph.node(j.file)?.system)?.name || 'the affected system'}.`,
            ].join('\n'),
          };

          const executor = this.guild.handles('jira') ? this.guild : this.rocket;
          const receipt = await executor.execute(action);

          // If this handoff is backed by a real Jira ticket, fire a genuine
          // reassignment through the deployed Guild agent — but do not block the
          // feed on it (a cold agent rebuild is ~50s). The simulated receipt
          // above lands instantly to keep the flow smooth; when the real board
          // change confirms, a green event with a clickable URL follows. If it
          // never confirms, the demo is unaffected.
          if (j.realKey && config.guild.liveJira && this.guild.reassignReal) {
            this.guild.reassignReal(j.realKey, config.guild.realAssignee, action.body)
              .then((real) => {
                if (!real) return;
                this.guild.receipts.push({ ...real, simulated: false, via: 'guild', tool: config.guild.tools.jiraAssign, kind: 'jira', label: `${j.realKey} confirmed on live Jira`, at: Date.now() });
                this.stream.publish(EVENT.EXECUTED, {
                  agent: 'rescuer',
                  title: `Confirmed on the live Jira board — ${j.realKey}`,
                  detail: real.summary,
                  kind: 'jira',
                  receipt: { ...real, simulated: false, via: 'guild', kind: 'jira' },
                  level: 'good',
                });
                // Announce the reassignment in Slack — the notice a real team
                // would get. Also background; the board change already landed.
                this.guild.slackReal(
                  config.guild.slackChannel,
                  `${j.realKey} reassigned — offboarding ${person.name}`,
                  `${j.realKey} "${j.title}" moved to its new owner as part of ${person.name}'s handoff. The exit-interview context is on the ticket: ${real.url}`,
                ).then((s) => {
                  if (!s) return;
                  this.stream.publish(EVENT.EXECUTED, {
                    agent: 'rescuer', kind: 'slack', level: 'good',
                    title: `Team notified in Slack — ${j.realKey}`,
                    detail: s.summary,
                    receipt: { id: s.id, summary: s.summary, simulated: false, via: 'guild', kind: 'slack' },
                  });
                }).catch(() => {});
              })
              .catch(() => { /* the demo never depends on this landing */ });
          }

          // The reassignment is real in memory too: the ASSIGNED edge moves
          // from her to the successor, and the graph redraws itself.
          this.graph.edges = this.graph.edges.filter((e) => !(e.type === 'ASSIGNED' && e.to === j.ticket));
          this.graph.edges.push({ from: j.to, to: j.ticket, type: 'ASSIGNED' });
          await this.graph.setNodeProps(j.ticket, { handover: 'filed', risk: 'transfer-scheduled', assignee: j.to });
          j.status = 'reassigned';

          this.stream.publish(EVENT.EXECUTED, {
            agent: 'rescuer',
            title: `${j.key} reassigned — ${j.fromName} → ${j.toName}`,
            detail: j.title,
            kind: 'jira',
            receipt,
            reassign: { ...j },
            level: 'good',
          });
          this.#publishCoverage('action');
          await humanDelay(0.6);
        }
      }));
      this.#setPhase('complete', 'Handoff complete', 'Her knowledge has second owners, her meetings are booked, her tickets have new names on them.');
      this.stream.publish(EVENT.COMPLETE, {
        title: 'Run complete',
        detail: `${this.proposal.jiras.length} tickets reassigned · ${this.proposal.meetings.length} sessions booked · coverage ${this.coverage().pct}%`,
        metrics: this.state().metrics,
      });
    } catch (err) {
      this.status = 'error';
      this.stream.publish(EVENT.ERROR, { title: 'Jira handoff failed', detail: err.message, level: 'critical' });
      console.error(err);
    }
    return { ok: true };
  }

  /** Shared execution loop — approval gate included. */
  async #executeActions(actions) {
    for (const action of actions) {
      if (action.risky) {
        const decision = await this.guild.requestApproval(action);
        if (!decision.approved) {
          action.status = 'rejected';
          this.stream.publish(EVENT.REJECTED, { agent: 'rescuer', title: `Skipped — ${action.label}`, detail: 'A human declined this action.' });
          continue;
        }
        action.approvedBy = decision.by;
        if (decision.auto) {
          this.stream.publish(EVENT.APPROVED, {
            agent: 'rescuer', title: 'Auto-approved by policy',
            detail: `No human decision inside the window — ${action.label} proceeded under the configured default.`,
          });
        }
      }

      const executor = this.guild.handles(action.kind) ? this.guild : this.rocket;
      const receipt = await executor.execute(action);
      action.status = 'executed';
      action.receipt = receipt;

      this.stream.publish(EVENT.EXECUTED, {
        agent: 'rescuer',
        title: action.label,
        detail: receipt.summary,
        kind: action.kind,
        receipt,
        level: 'good',
      });

      await this.#applyRescueEffect(action);
      this.#publishCoverage('action');
      await humanDelay(0.4);
    }
  }

  /** Stage 1's right-panel answer: what she built alone, what she built with
   *  the team, what was never hers. Published before any analysis runs. */
  async #footprint(person) {
    let solo = 0, shared = 0, untouched = 0;
    for (const n of this.graph.nodes.values()) {
      if (n.label !== 'File') continue;
      const owners = this.graph.ownersOf(n.id);
      if (!owners.includes(person.id)) { untouched++; continue; }
      if (owners.length === 1) solo++; else shared++;
    }
    const docsSole = this.world.docs.filter((d) => d.soloEditor).length;
    const openTickets = this.world.tickets.filter((t) => t.assignee === person.id && t.status !== 'Done').length;
    this.footprint = { solo, shared, untouched, docsSole, openTickets };
    this.#buildHistory(person);

    this.stream.publish(EVENT.MEMORY, {
      agent: 'mapper',
      title: 'Her footprint, separated',
      detail: `${solo} files only she has touched · ${shared} built with the team · ${untouched} never hers · ${docsSole} docs she alone edits · ${openTickets} open tickets assigned to her`,
      footprint: this.footprint,
      level: 'warn',
    });
  }

  /** Drafted at analysis time so the plan is reviewable before anything fires. */
  async #draftProposal(person) {
    const bySystem = new Map();
    for (const a of this.findings.soloOwned) {
      const sys = a.system || 's:ranking';
      if (!bySystem.has(sys)) bySystem.set(sys, []);
      bySystem.get(sys).push(a);
    }

    const meetings = [];
    let day = 0;
    for (const [sysId, assets] of bySystem) {
      const sys = this.graph.node(sysId);
      const { rows: candidates } = await this.graph.run('successors', { system: sysId, exclude: person.id });
      const successor = candidates[0];
      if (!successor) continue;
      const when = businessDay(++day);
      meetings.push({
        system: sysId,
        systemName: sys?.name || sysId,
        successor: successor.id,
        successorName: successor.name,
        successorEmail: successor.email,
        when: when.iso,
        whenLabel: when.label,
        assets: assets.map((a) => ({ id: a.id, path: a.path, criticality: a.criticality })),
        gapIds: this.gaps.filter((g) => g.system === sysId).map((g) => g.id),
      });
    }

    const jiras = [];
    const realTickets = [...(config.guild.realTickets || [])];
    for (const b of this.findings.blockers) {
      const sysOfFile = this.graph.node(b.file)?.system || 's:ranking';
      const { rows } = await this.graph.run('successors', { system: sysOfFile, exclude: person.id });
      const successor = rows[0];
      if (!successor) continue;
      jiras.push({
        ticket: b.id, key: b.key, title: b.title, file: b.file,
        // Each handoff is backed by a real Jira ticket where one is available,
        // so stage 4 reassigns actual board items and not just graph edges.
        realKey: realTickets.shift() || null,
        from: person.id, fromName: person.name.split(' ')[0],
        to: successor.id, toName: successor.name.split(' ')[0], toEmail: successor.email,
        status: 'proposed',
      });
    }

    this.proposal = { meetings, jiras };
    this.stream.publish(EVENT.PROPOSED, {
      agent: 'rescuer',
      title: `Rescue plan drafted — ${meetings.length} transfer sessions · ${jiras.length} Jira handoffs`,
      detail: meetings.map((m) => `${m.systemName} → ${m.successorName.split(' ')[0]}`).join(' · '),
      proposal: { meetings: meetings.length, jiras: jiras.length },
    });
  }

  /** Mapper — corpus into memory, including the thinking layer. */
  async #mapperTurn(person) {
    await this.guild.turn('mapper', 'ingest corpus into memory', async () => {
      const { result: counts } = await this.rocket.step('ingest', { corpus: 'seeded' }, async () => {
        const w = this.world;

        await this.graph.addNodes('Person', w.people.map(({ id, name, role, email, tenureYears }) => ({ id, name, role, email, tenureYears })));
        await this.graph.addNodes('System', w.systems);
        this.stream.publish(EVENT.INGEST, { agent: 'mapper', title: 'People and systems mapped', detail: `${w.people.length} people · ${w.systems.length} systems`, progress: 0.1 });
        await humanDelay(0.5);

        await this.graph.addNodes('File', w.files.map(({ id, path, system, criticality }) => ({ id, path, system, criticality })));
        await this.graph.addEdges('BELONGS_TO', w.files.map((f) => ({ from: f.id, to: f.system })));
        this.stream.publish(EVENT.INGEST, { agent: 'mapper', title: `${w.files.length} source files indexed`, detail: 'services/ranking, services/featurestore, services/ingest, services/delivery', progress: 0.3 });
        await humanDelay(0.5);

        // Authorship is derived from commits — never asserted. "Solo-owned"
        // has to be a fact the graph discovers, or the hero query is theatre.
        // Authorship carries its history, not just its count. "She wrote this"
        // and "she has been the only person inside this file for four years"
        // are different facts, and the second one is the argument.
        const authorship = new Map();
        for (const c of w.commits) {
          for (const f of c.files) {
            const key = `${c.author}|${f}`;
            const prev = authorship.get(key);
            if (!prev) authorship.set(key, { commits: 1, firstAt: c.date, lastAt: c.date });
            else {
              prev.commits++;
              if (c.date < prev.firstAt) prev.firstAt = c.date;
              if (c.date > prev.lastAt) prev.lastAt = c.date;
            }
          }
        }
        await this.graph.addEdges('AUTHORED', [...authorship.entries()].map(([key, v]) => {
          const [from, to] = key.split('|');
          return { from, to, commits: v.commits, firstAt: v.firstAt, lastAt: v.lastAt };
        }));

        // Mirror her own history onto the asset, so a tooltip can answer
        // "how long has this been hers?" without walking edges.
        for (const [key, v] of authorship) {
          const [author, file] = key.split('|');
          if (author !== person.id) continue;
          await this.graph.setNodeProps(file, {
            herCommits: v.commits, herFirstAt: v.firstAt, herLastAt: v.lastAt,
          });
        }
        this.stream.publish(EVENT.INGEST, { agent: 'mapper', title: `${w.commits.length} commits attributed`, detail: `${authorship.size} authorship edges written to memory`, progress: 0.5 });
        await humanDelay(0.5);

        // Stage-0 legibility: before any risk analysis runs, the graph already
        // distinguishes what is hers. Solo = only her hands, shared = team.
        const touched = new Map();
        for (const c of w.commits) for (const f of c.files) {
          if (!touched.has(f)) touched.set(f, new Set());
          touched.get(f).add(c.author);
        }
        for (const [fileId, authors] of touched) {
          if (!authors.has(person.id)) continue;
          await this.graph.setNodeProps(fileId, { hers: authors.size === 1 ? 'solo' : 'shared' });
        }

        await this.graph.addNodes('Doc', w.docs.map(({ id, title, path, system }) => ({ id, title, path, system })));
        await this.graph.addEdges('COVERS', w.docs.flatMap((d) => d.covers.map((f) => ({ from: d.id, to: f }))));
        await this.graph.addEdges('EDITED', w.docs.flatMap((d) => (
          d.soloEditor ? [{ from: person.id, to: d.id }]
            : [{ from: person.id, to: d.id }, { from: 'p:marcus', to: d.id }, { from: 'p:priya', to: d.id }]
        )));

        await this.graph.addNodes('Ticket', w.tickets.map(({ id, key, title, status, note }) => ({ id, key, title, status, note })));
        await this.graph.addEdges('ASSIGNED', w.tickets.map((t) => ({ from: t.assignee, to: t.id })));
        await this.graph.addEdges('REFERENCES', w.tickets.flatMap((t) => t.references.map((f) => ({ from: t.id, to: f }))));
        this.stream.publish(EVENT.INGEST, { agent: 'mapper', title: `${w.tickets.length} tickets and ${w.docs.length} documents linked`, detail: 'ticket → file references resolved', progress: 0.7 });
        await humanDelay(0.5);

        await this.graph.addNodes('Incident', w.incidents.map(({ id, key, title, date, resolution }) => ({ id, key, title, date, resolution })));
        await this.graph.addEdges('RESPONDED_TO', w.incidents.map((i) => ({ from: i.responder, to: i.id })));
        await this.graph.addEdges('TOUCHED', w.incidents.flatMap((i) => i.touches.map((f) => ({ from: i.id, to: f }))));

        // The thinking layer. Mined from the commits where she explains herself.
        await this.graph.addNodes('Pattern', w.patterns.map(({ id, name, detail, confidence }) => ({ id, name, detail, confidence, status: 'inferred' })));
        await this.graph.addEdges('REASONS_LIKE', w.patterns.map((p) => ({ from: person.id, to: p.id, confidence: p.confidence })));
        await this.graph.addEdges('EVIDENCED_BY', w.patterns.flatMap((p) => p.evidence.map((e) => ({ from: p.id, to: e }))));

        // Rewrite the thinking layer from the actual commit text. Fired
        // concurrently: it lands as its own beat mid-run and can never hold up
        // the pipeline if the model is slow.
        this.#derivePatterns(person, w).catch(() => {});

        const reasoned = w.commits.filter((c) => c.reasoned).length;
        this.stream.publish(EVENT.MEMORY, {
          agent: 'mapper',
          title: `${w.patterns.length} decision patterns extracted`,
          detail: `from ${reasoned} commits where she explained her reasoning — this is the "how she thinks" layer`,
          progress: 1,
          patterns: w.patterns.map((p) => p.name),
        });
        await humanDelay(0.6);

        return {
          nodes: this.graph.nodes.size,
          edges: this.graph.edges.length,
          patterns: w.patterns.length,
        };
      });

      this.stream.publish(EVENT.MEMORY, {
        agent: 'mapper',
        title: 'Memory built',
        detail: `${counts.nodes} nodes · ${counts.edges} relationships in ${this.graph.engine === 'falkordb' ? 'FalkorDB' : 'in-process graph'}`,
        level: 'good',
      });
    });
  }

  /**
   * Her record: what she has actually been doing, month by month, for as long
   * as the corpus goes back.
   *
   * The point on stage is not that she owns things — it is that she has owned
   * them *continuously and alone for years*. A count says "eleven files". A
   * history says "she has been the only person inside the ranking pipeline
   * since 2024", and that is the sentence that makes a room uncomfortable.
   */
  #buildHistory(person) {
    const months = new Map();      // 'YYYY-MM' → { hers, others }
    let herTotal = 0, firstAt = null, lastAt = null;

    for (const c of this.world.commits) {
      const key = c.date.slice(0, 7);
      if (!months.has(key)) months.set(key, { month: key, hers: 0, others: 0 });
      const bucket = months.get(key);
      if (c.author === person.id) {
        bucket.hers++;
        herTotal++;
        if (!firstAt || c.date < firstAt) firstAt = c.date;
        if (!lastAt || c.date > lastAt) lastAt = c.date;
      } else {
        bucket.others++;
      }
    }

    const series = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));

    // The systems she has held longest — ordered by how far back her first
    // commit goes, not by how many commits she has made.
    const tenureBySystem = new Map();
    for (const n of this.graph.nodes.values()) {
      if (n.label !== 'File' || !n.herFirstAt) continue;
      const sys = n.system;
      const cur = tenureBySystem.get(sys);
      if (!cur || n.herFirstAt < cur.since) {
        tenureBySystem.set(sys, { system: sys, name: this.graph.node(sys)?.name || sys, since: n.herFirstAt });
      }
    }

    this.history = {
      series,
      herTotal,
      firstAt,
      lastAt,
      months: series.length,
      years: firstAt ? Math.max(1, Math.round(((new Date(lastAt) - new Date(firstAt)) / 3.156e10) * 10) / 10) : 0,
      incidents: this.world.incidents
        .filter((i) => i.responder === person.id)
        .map((i) => ({ id: i.id, key: i.key, title: i.title, date: i.date })),
      systems: [...tenureBySystem.values()].sort((a, b) => a.since.localeCompare(b.since)),
    };

    this.stream.publish(EVENT.MEMORY, {
      agent: 'mapper',
      title: `${herTotal} commits of hers, across ${this.history.months} months`,
      detail: `Her first was ${fmtMonth(firstAt)}, her last ${fmtMonth(lastAt)}. ${this.history.systems.length} systems have had her hands in them the whole time.`,
      history: { herTotal, firstAt, lastAt, years: this.history.years },
      level: 'warn',
    });
  }

  /**
   * The "how she thinks" layer, written by reading her commits rather than by
   * us. Same pattern ids and evidence links as the skeleton — only the wording
   * is derived — so the gap→pattern confirmation links stay intact and the
   * demo stays deterministic where it has to be.
   */
  async #derivePatterns(person, w) {
    if (!this.llm.available) return;

    const corpus = w.patterns.map((p) => {
      const evidence = p.evidence.map((id) => {
        const commits = w.commits.filter((c) => c.files.includes(id) && c.reasoned).map((c) => c.message);
        const incident = w.incidents.find((i) => i.id === id);
        return incident ? `INCIDENT ${incident.key}: ${incident.title}\nResolution: ${incident.resolution}` : commits.join('\n---\n');
      }).filter(Boolean).join('\n\n');
      return `PATTERN ${p.id}\nEvidence from her own commits and incident notes:\n${evidence || '(no direct evidence)'}`;
    }).join('\n\n═══\n\n');

    const result = await this.llm.json({
      name: 'patterns',
      system: 'You read an engineer\'s commit messages and incident notes and name the decision heuristics behind them. Write each as something a colleague would say about how she works, in her register — specific, unsentimental, no management-speak. The detail should explain the reasoning, in one or two sentences, and must be grounded in the evidence given.',
      user: `Engineer: ${person.name}, ${person.role}.\n\n${corpus}\n\nFor each PATTERN id, write a name (under 9 words) and a detail (1-2 sentences).`,
      schema: {
        type: 'object', additionalProperties: false, required: ['patterns'],
        properties: {
          patterns: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false, required: ['id', 'name', 'detail'],
              properties: { id: { type: 'string' }, name: { type: 'string' }, detail: { type: 'string' } },
            },
          },
        },
      },
    });
    if (!result?.patterns?.length) return;

    let updated = 0;
    for (const p of result.patterns) {
      if (!this.graph.node(p.id)) continue;
      await this.graph.setNodeProps(p.id, { name: p.name, detail: p.detail, derived: 'llm' });
      const known = this.findings?.patterns?.find((x) => x.id === p.id);
      if (known) { known.name = p.name; known.detail = p.detail; }
      updated++;
    }

    this.stream.publish(EVENT.MEMORY, {
      agent: 'mapper',
      title: `${updated} decision patterns rewritten from her own commits`,
      detail: result.patterns[0] ? `e.g. "${result.patterns[0].name}" — ${result.patterns[0].detail}` : '',
      derivedBy: this.llm.opts.model,
    });
  }

  /**
   * Questions for assets no curated topic covers. This is what makes "pick
   * anyone on the roster and I'll run it live" a real offer rather than a
   * bluff — a person with no hand-written agenda still gets a real interview.
   */
  async #generateQuestions(person, assets) {
    if (!this.llm.available || !assets.length) return [];

    const described = assets.map((a) => {
      const commits = this.world.commits
        .filter((c) => c.files.includes(a.id) && c.author === person.id)
        .slice(-6).map((c) => c.message.split('\n')[0]);
      const incidents = this.world.incidents.filter((i) => i.touches.includes(a.id));
      return `ASSET ${a.id} — ${a.path} (criticality ${a.criticality}/5)\n`
        + `Recent commits by her: ${commits.join(' | ') || 'none recorded'}\n`
        + (incidents.length ? `Incidents: ${incidents.map((i) => `${i.key} ${i.title} → ${i.resolution}`).join('; ')}` : '');
    }).join('\n\n');

    const result = await this.llm.json({
      name: 'gap_questions',
      system: 'You prepare exit-interview questions for a departing engineer. Ask only about knowledge that exists nowhere in writing — the reasoning behind a choice, the failure it was avoiding, the thing the next owner would get wrong. Never ask what the code does; that can be read. Ask why it is like that. One sharp question per asset, phrased as a person would say it out loud.',
      user: `Departing engineer: ${person.name}, ${person.role}. She is the only person who has ever changed these files, and nothing documents them.\n\n${described}\n\nFor each ASSET id, write a short title (under 10 words, starting "Why" or "How" or "When"), the question itself, and 4-6 lowercase concepts a usable answer would have to mention.`,
      schema: {
        type: 'object', additionalProperties: false, required: ['questions'],
        properties: {
          questions: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false, required: ['assetId', 'title', 'question', 'expects'],
              properties: {
                assetId: { type: 'string' }, title: { type: 'string' }, question: { type: 'string' },
                expects: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    });
    if (!result?.questions?.length) return [];

    return result.questions
      .filter((q) => assets.some((a) => a.id === q.assetId))
      .map((q) => {
        const asset = assets.find((a) => a.id === q.assetId);
        return {
          id: `g:gen:${q.assetId.replace(/^f:/, '')}`,
          title: q.title,
          question: q.question,
          expects: q.expects.map((e) => e.toLowerCase()),
          rescuesPatterns: [],
          anchor: q.assetId,
          anchorPath: asset.path,
          system: asset.system,
          criticality: asset.criticality,
          status: 'at-risk',
          reason: 'solo-owned and undocumented — question written by the Gap-Hunter',
          generated: true,
        };
      });
  }

  /** Gap-Hunter — what dies with her, and what was never written down at all. */
  async #hunterTurn(person) {
    await this.guild.turn('hunter', 'query memory for solo-owned assets and unwritten knowledge', async () => {
      const { result } = await this.rocket.step('detect', { person: person.id }, async () => {
        const solo = await this.graph.run('soloOwned', { person: person.id });
        await humanDelay(0.8);

        this.stream.publish(EVENT.RISK, {
          agent: 'hunter',
          title: `${solo.rows.length} assets have exactly one human edge`,
          detail: `answered by ${solo.engine === 'falkordb' ? 'FalkorDB' : 'in-process graph'} — every one of these dies with her`,
          level: 'critical',
          cypher: solo.cypher.trim(),
          engine: solo.engine,
          assets: solo.rows.map((r) => r.id),
        });

        // Mark them in memory so the graph itself carries the risk state.
        for (const row of solo.rows) await this.graph.setNodeProps(row.id, { risk: 'at-risk' });

        // Hold. This is the moment the room understands the problem.
        await beat(2800);

        const undocumented = await this.graph.run('undocumented', { person: person.id });
        const blockers = await this.graph.run('openBlockers', { person: person.id });
        const patterns = await this.graph.run('patterns', { person: person.id });
        const incidents = await this.graph.run('incidentsHandled', { person: person.id });
        await humanDelay(0.6);

        this.stream.publish(EVENT.RISK, {
          agent: 'hunter',
          title: `${undocumented.rows.length} of them have no shared documentation`,
          detail: 'documented-but-solo is a risk; undocumented-and-solo is a countdown',
          level: 'critical',
          cypher: undocumented.cypher.trim(),
          engine: undocumented.engine,
        });

        this.stream.publish(EVENT.RISK, {
          agent: 'hunter',
          title: `${blockers.rows.length} open tickets are blocked on her personally`,
          detail: blockers.rows.map((b) => b.key).join(' · '),
          level: 'warn',
        });

        return {
          soloOwned: solo.rows, undocumented: undocumented.rows,
          blockers: blockers.rows, patterns: patterns.rows, incidents: incidents.rows,
          engine: solo.engine, cypher: solo.cypher.trim(),
        };
      });

      this.findings = result;

      // Gaps: structurally derived, then given a voice. A file qualifies when
      // it is solo-owned, has no shared documentation, and something still
      // points at it — an open ticket or an incident she personally resolved.
      const { result: gaps } = await this.rocket.step('gaps', { person: person.id }, async () => {
        const undoc = new Set(result.undocumented.map((u) => u.id));
        const referenced = new Set([
          ...result.blockers.map((b) => b.file),
          ...this.world.incidents.flatMap((i) => i.touches),
        ]);

        const derived = [];
        for (const topic of this.world.topics) {
          const anchor = topic.anchor;
          if (!undoc.has(anchor)) continue;
          const reason = referenced.has(anchor)
            ? 'referenced by open work or a past incident'
            : 'solo-owned and undocumented';
          derived.push({
            id: topic.id,
            title: topic.title,
            question: topic.question,
            expects: topic.expects,
            // The demo crib sheet: a real, sufficient answer the presenter can
            // submit with one keypress instead of speaking. Never scored
            // differently — it just pre-fills the box.
            modelAnswer: topic.modelAnswer || '',
            rescuesPatterns: topic.rescuesPatterns,
            anchor,
            anchorPath: this.graph.node(anchor)?.path,
            system: topic.system,
            criticality: topic.criticality,
            status: 'at-risk',
            reason,
          });
        }
        // Anything solo-owned and undocumented that no curated topic covers
        // still deserves a question. The Gap-Hunter writes those itself.
        const covered = new Set(derived.map((d) => d.anchor));
        const uncovered = result.undocumented.filter((u) => !covered.has(u.id));
        const generated = await this.#generateQuestions(person, uncovered);
        if (generated.length) {
          this.stream.publish(EVENT.GAP, {
            agent: 'hunter',
            title: `${generated.length} more questions written from scratch`,
            detail: 'Assets with no curated agenda — the Gap-Hunter read her commits and wrote the questions itself.',
            level: 'warn',
          });
        }

        return [...derived, ...generated].sort((a, b) => b.criticality - a.criticality);
      });

      this.gaps = gaps;
      await this.graph.addNodes('Gap', gaps.map((g) => ({
        id: g.id, title: g.title, criticality: g.criticality, status: 'at-risk', system: g.system,
      })));
      await this.graph.addEdges('ABOUT', gaps.map((g) => ({ from: g.id, to: g.anchor })));
      await this.graph.addEdges('HOLDS', gaps.map((g) => ({ from: person.id, to: g.id })));
      await this.graph.addEdges('WOULD_RESCUE', gaps.flatMap((g) => g.rescuesPatterns.map((p) => ({ from: g.id, to: p }))));

      for (const g of gaps) {
        this.stream.publish(EVENT.GAP, {
          agent: 'hunter',
          title: g.title,
          detail: `${g.anchorPath} — ${g.reason}`,
          level: g.criticality >= 5 ? 'critical' : 'warn',
          gapId: g.id,
        });
        await humanDelay(0.25);
      }

      this.#publishCoverage('baseline');
      await beat(1800);

      // Linkup (market pricing) and Snyk (pre-transfer scan) were cut: neither
      // is in the mandated four, and a demo that touches six vendors explains
      // none of them well. lib/linkup.js and lib/snyk.js are still on disk if
      // that changes.
    });
  }

  /** The meeting actions, built from the drafted proposal and enriched with
   *  everything the voice interview captured. The invite is a briefing:
   *  "ask her this" + "the agent already learned this". */
  async #buildMeetingActions(person) {
    const actions = [];

    for (const m of this.proposal.meetings) {
      const openGaps = this.gaps.filter((g) => g.system === m.system && g.status !== 'rescued');
      const learned = this.gaps
        .filter((g) => g.system === m.system && g.status === 'rescued')
        .map((g) => ({ title: g.title, note: g.distilled || truncate(g.answer || '', 220) }));

      actions.push({
        kind: 'calendar',
        label: `Knowledge transfer booked — ${m.systemName} × ${m.successorName}`,
        subject: `Knowledge transfer: ${m.systemName} (${m.assets.length} solo-owned assets)`,
        attendees: [person.email, m.successorEmail].filter(Boolean),
        to: m.successorEmail,
        successor: m.successor,
        system: m.system,
        when: m.when,
        whenLabel: m.whenLabel,
        minutes: 45,
        body: agendaBody(m.systemName, m.assets, openGaps, learned),
      });

      // The invite is staged — no vendor in this stack ships a calendar
      // connector — but the briefing that makes the session worth attending is
      // a real email through Guild. It carries what the interview already
      // captured, so the successor walks in knowing what not to ask.
      actions.push({
        kind: 'email',
        label: `Session briefing emailed — ${m.successorName}`,
        subject: `Before your handover session: ${m.systemName}`,
        to: m.successorEmail,
        successor: m.successor,
        system: m.system,
        body: [
          `Hi ${(m.successorName || '').split(' ')[0]},`,
          '',
          `You are inheriting ${m.assets.length} assets in ${m.systemName} that ${person.name} is currently the only person to have ever changed.`,
          `Session: ${m.whenLabel}.`,
          '',
          learned.length
            ? `She has already answered these in her exit interview — do not spend the session on them:\n${learned.map((l) => `  • ${l.title}\n    ${l.note}`).join('\n')}`
            : 'Nothing from this system has been answered yet.',
          '',
          openGaps.length
            ? `Ask her about these. They exist nowhere in writing:\n${openGaps.map((g) => `  • ${g.title}\n    ${g.question}`).join('\n')}`
            : 'Everything on this system has been captured — treat the session as a walkthrough.',
        ].join('\n'),
      });
    }

    // The question list goes to her, ahead of the sessions — only what is
    // still open after the interview.
    const stillOpen = this.gaps.filter((g) => g.status !== 'rescued');
    actions.push({
      kind: 'slack',
      label: 'Question list sent to the departing engineer',
      subject: `Before your last day — ${stillOpen.length} things only you know`,
      to: person.slack || person.email,
      body: [
        `Hi ${person.name.split(' ')[0]},`,
        '',
        `We mapped everything you have touched and found ${this.findings.soloOwned.length} assets where you are the only person who has ever made a change.`,
        stillOpen.length
          ? `After your interview, these ${stillOpen.length} still have no usable answer:`
          : 'Your interview covered everything on the agenda — the sessions below are walkthroughs, not rescues.',
        '',
        ...stillOpen.map((g, i) => `${i + 1}. ${g.title}\n   ${g.question}`),
        '',
        'You can answer these in the exit interview rather than in writing — whichever is faster for you.',
      ].join('\n'),
    });

    actions.push({
      kind: 'doc',
      label: 'Handover document drafted',
      subject: `Handover — ${person.name} (${person.role})`,
      body: this.#handoverDoc(person),
      docFor: 'all',
    });

    // The only irreversible action in the plan. This is the one that stops.
    actions.push({
      kind: 'revoke',
      label: 'Access revocation queued for last day',
      subject: `Revoke production access — ${person.name}`,
      to: person.email,
      when: config.scenario.lastDay,
      whenLabel: config.scenario.lastDay,
      systems: this.proposal.meetings.map((m) => m.systemName),
      risky: true,
      approvalReason: `Queue production access revocation for ${person.name} on ${config.scenario.lastDay}. This is irreversible and will lock her out of ${this.proposal.meetings.length} systems she is still the sole owner of — approve only if the transfer sessions above are on the calendar.`,
      body: `Scheduled revocation of production access across ${this.proposal.meetings.length} systems, effective ${config.scenario.lastDay}.`,
    });

    return actions;
  }

  #handoverDoc(person) {
    const lines = [
      `# Handover — ${person.name}`,
      ``,
      `Role: ${person.role}. Last day: ${config.scenario.lastDay}.`,
      ``,
      `## Assets with no second owner (${this.findings.soloOwned.length})`,
      ...this.findings.soloOwned.map((a) => `- \`${a.path || a.title}\` (criticality ${a.criticality})`),
      ``,
      `## How she reasons`,
      ...this.findings.patterns.map((p) => `- **${p.name}** — ${p.detail}`),
      ``,
      `## Open questions for the exit interview (${this.gaps.length})`,
      ...this.gaps.map((g) => `- ${g.title}\n  > ${g.question}`),
      ``,
      `## Answers captured`,
      `_(populated live during the exit interview)_`,
    ];
    return lines.join('\n');
  }

  /** Rescue actions change the graph, not just the feed. */
  async #applyRescueEffect(action) {
    if (action.kind === 'calendar' && action.successor) {
      // A booked session is a commitment that a second human will hold this
      // system. Memory records the commitment now; reality follows on the day.
      const assets = this.findings.soloOwned.filter((a) => a.system === action.system);
      for (const a of assets) {
        this.graph.edges.push({ from: action.successor, to: a.id, type: 'SCHEDULED_TRANSFER', session: action.receipt?.id });
        await this.graph.setNodeProps(a.id, { risk: 'transfer-scheduled' });
      }
    }
    if (action.kind === 'jira' && action.ticket) {
      await this.graph.setNodeProps(action.ticket, { handover: 'filed', risk: 'transfer-scheduled' });
    }
    if (action.kind === 'doc') {
      for (const d of this.world.docs.filter((x) => x.soloEditor)) {
        await this.graph.setNodeProps(d.id, { risk: 'transfer-scheduled' });
      }
    }
  }

  /** Interviewer — the agenda is only what could not be learned any other way. */
  async #interviewerTurn(person) {
    await this.guild.turn('interviewer', 'conduct the exit interview on the unwritten knowledge', async () => {
      this.agenda = this.gaps.map((g) => ({ gapId: g.id, question: g.question, title: g.title, status: g.status }));
      this.stream.publish(EVENT.QUESTION, {
        agent: 'interviewer',
        title: 'Exit interview ready',
        detail: `${this.agenda.length} questions — every one of them is knowledge with no written trace. Nothing here could be learned from the repo.`,
        agenda: this.agenda,
      });
    });
  }

  // ── interview loop ────────────────────────────────────────────────────────

  nextQuestion() {
    const next = this.gaps.find((g) => g.status === 'at-risk');
    if (!next) return null;
    this.stream.publish(EVENT.QUESTION, {
      agent: 'interviewer',
      title: next.title,
      detail: next.question,
      gapId: next.id,
      question: next.question,
    });
    return { gapId: next.id, question: next.question, title: next.title, modelAnswer: next.modelAnswer || '' };
  }

  /**
   * Her answer, written back into memory as she speaks.
   *
   * Scoring is deliberately mechanical: does the answer contain the concepts
   * that make it usable to whoever inherits this? An answer that names the
   * mechanism rescues the gap. A vague one is marked partial and stays on the
   * agenda — the system is allowed to say "that is not enough", which is the
   * difference between an interview and a transcript.
   */
  async answer(gapId, text) {
    const gap = this.gaps.find((g) => g.id === gapId);
    if (!gap) return { error: 'unknown gap' };

    // The tape goes to LaserData's context layer before anything is judged:
    // whatever we conclude about this answer, her actual words survive it.
    const turn = await this.stream.remember(`interview:${this.subject.id}`, {
      gapId, question: gap.question, answer: text, at: new Date().toISOString(),
    });

    const graded = await this.#grade(gap, text);
    const { rescued, matched, distilled, followUp, engine } = graded;

    this.stream.publish(EVENT.MEMORY, {
      agent: 'interviewer',
      title: 'Her words committed to the context layer',
      detail: `"${truncate(text, 120)}" — kept verbatim in LaserData, separately from how the graph structured it.`,
      contextKey: turn.key,
      durable: Boolean(turn.durable),
    });

    this.stream.publish(EVENT.ANSWER, {
      agent: 'interviewer',
      title: rescued ? 'Answer captured' : 'Answer too thin — keeping this one open',
      detail: truncate(text, 180),
      gapId,
      matched,
      rescued,
      distilled,
      followUp,
      engine,
    });

    // Write the answer into memory regardless — a partial answer is still
    // more than the repo had a minute ago.
    const answerId = `ans:${gapId}`;
    await this.graph.addNodes('Answer', [{
      id: answerId, text: truncate(text, 600), gap: gapId,
      capturedAt: new Date().toISOString(), concepts: matched.join(','),
      distilled: distilled || '',
    }]);
    await this.graph.addEdges('ANSWERS', [{ from: answerId, to: gapId }]);
    await this.graph.addEdges('STATED', [{ from: this.subject.id, to: answerId }]);

    if (!rescued) {
      gap.status = 'partial';
      await this.graph.setNodeProps(gapId, { status: 'partial' });
      this.#publishCoverage('answer');
      return { rescued: false, matched, gap, followUp, engine };
    }

    gap.status = 'rescued';
    gap.answer = text;
    gap.distilled = distilled;
    await this.graph.setNodeProps(gapId, { status: 'rescued' });
    await this.graph.setNodeProps(gap.anchor, { risk: 'rescued' });

    // Confirming a heuristic out loud promotes it from inferred to confirmed.
    for (const patId of gap.rescuesPatterns) {
      await this.graph.setNodeProps(patId, { status: 'confirmed', confidence: 1 });
      const pat = this.findings.patterns.find((p) => p.id === patId);
      if (pat) {
        pat.confidence = 1;
        this.stream.publish(EVENT.RESCUED, {
          agent: 'interviewer',
          title: `Decision pattern confirmed — ${pat.name}`,
          detail: 'Inferred from her commits, now confirmed in her own words.',
          patternId: patId,
          level: 'good',
        });
      }
    }

    this.stream.publish(EVENT.RESCUED, {
      agent: 'interviewer',
      title: `Rescued — ${gap.title}`,
      detail: `${gap.anchorPath} now has a recorded answer in memory`,
      gapId,
      nodeId: gap.anchor,
      level: 'good',
    });

    this.#publishCoverage('answer');
    return { rescued: true, matched, gap, distilled, engine, coverage: this.coverage() };
  }

  /**
   * Is this answer good enough to hand to someone who has never seen the system?
   *
   * The model judges usability, not keyword presence — "you just know when to
   * do it" contains no concepts and should fail, while a correct explanation in
   * unexpected words should pass. Concept matching remains as the fallback, and
   * the UI reports which one decided, because "our agent evaluated this" and
   * "our regex evaluated this" are different claims.
   */
  async #grade(gap, text) {
    const words = String(text || '').toLowerCase();
    const keywordMatched = gap.expects.filter((k) => words.includes(k.toLowerCase()));

    const verdict = await this.llm.json({
      name: 'grade_answer',
      system: 'You grade answers given in an engineer\'s exit interview. An answer is sufficient only if an engineer who has never seen this system could act on it: it must name the actual mechanism or trade-off, not merely assert a conclusion or restate the question. Vague appeals to experience ("you learn it", "it just works that way") are never sufficient. Judge the substance, not the vocabulary — a correct explanation in unexpected words passes.',
      user: `QUESTION: ${gap.question}\n\nCONCEPTS A GOOD ANSWER USUALLY TOUCHES: ${gap.expects.join(', ')}\n\nHER ANSWER: "${text}"\n\nGrade it. "distilled" is the durable note to write into the knowledge graph, in the third person, capturing the mechanism she described — leave it empty if the answer is insufficient. "followUp" is the one question to press her on, or empty if sufficient. "concepts" lists which of the concepts above she actually addressed, however she worded them.`,
      schema: {
        type: 'object', additionalProperties: false,
        required: ['sufficient', 'confidence', 'concepts', 'distilled', 'followUp'],
        properties: {
          sufficient: { type: 'boolean' },
          confidence: { type: 'number' },
          concepts: { type: 'array', items: { type: 'string' } },
          distilled: { type: 'string' },
          followUp: { type: 'string' },
        },
      },
    });

    if (verdict) {
      return {
        rescued: verdict.sufficient,
        matched: verdict.concepts?.length ? verdict.concepts : keywordMatched,
        distilled: verdict.distilled || '',
        followUp: verdict.followUp || '',
        engine: this.llm.opts.model,
      };
    }

    // Deterministic fallback — the original concept match.
    const substantive = words.trim().split(/\s+/).length >= 12;
    return {
      rescued: keywordMatched.length >= 2 || (keywordMatched.length >= 1 && substantive),
      matched: keywordMatched,
      distilled: '',
      followUp: '',
      engine: 'concept-match',
    };
  }

  // ── coverage ──────────────────────────────────────────────────────────────

  /**
   * Coverage is "how much of what she knows survives her".
   *
   * Every unit of knowledge carries the weight of what it would cost to lose,
   * and earns credit for having a second human, shared documentation, a booked
   * transfer, or a recorded answer. It is deliberately not a percentage of
   * tasks completed — the number has to move because knowledge moved.
   */
  coverage() {
    if (!this.findings) return { pct: 0, covered: 0, total: 0, projected: 0 };
    let total = 0, covered = 0, projected = 0;

    for (const n of this.graph.nodes.values()) {
      const weight = this.#weight(n);
      if (!weight) continue;
      total += weight;
      covered += weight * this.#credit(n, false);
      projected += weight * this.#credit(n, true);
    }

    const pct = total ? Math.round((covered / total) * 100) : 0;
    return {
      pct,
      covered: Math.round(covered),
      total: Math.round(total),
      projected: total ? Math.round((projected / total) * 100) : 0,
    };
  }

  #weight(n) {
    switch (n.label) {
      case 'File': return n.criticality ?? 3;
      case 'Doc': return DOC_WEIGHT;
      case 'Ticket': return TICKET_WEIGHT;
      case 'Incident': return INCIDENT_WEIGHT;
      case 'Gap': return n.criticality ?? 3;
      case 'Pattern': return PATTERN_WEIGHT;
      default: return 0;
    }
  }

  /**
   * `projected` asks a different question: not "what is safe right now" but
   * "what will be safe once the booked sessions happen and the whole agenda is
   * answered". The gap between the two lines on the meter is the work still
   * outstanding, and the ceiling below 100% is the knowledge no agent gets —
   * which is exactly what the human handover meeting is for.
   */
  #credit(n, projected) {
    const person = this.subject.id;
    switch (n.label) {
      case 'File': {
        if (this.graph.ownersOf(n.id).length > 1) return 1;
        if (n.risk === 'rescued') return 1;
        if (n.risk === 'transfer-scheduled') return projected ? 1 : SCHEDULED_CREDIT;
        if (projected && this.gaps.some((g) => g.anchor === n.id)) return 1;
        const docs = this.graph.in_(n.id, 'COVERS').map((e) => e.from);
        if (docs.some((d) => this.graph.ownersOf(d).some((p) => p !== person))) return 1;
        return docs.length ? 0.5 : 0;
      }
      case 'Doc': {
        if (this.graph.ownersOf(n.id).length > 1) return 1;
        if (n.risk === 'transfer-scheduled') return projected ? 1 : SCHEDULED_CREDIT;
        return 0;
      }
      case 'Ticket': {
        const mine = this.graph.in_(n.id, 'ASSIGNED').some((e) => e.from === person);
        if (n.status === 'Done' || !mine || n.handover === 'filed') return 1;
        return projected && this.findings.blockers.some((b) => b.id === n.id) ? 1 : 0;
      }
      case 'Incident': {
        const files = this.graph.out(n.id, 'TOUCHED').map((e) => e.to);
        if (projected) return 1;
        if (files.some((f) => this.graph.node(f)?.risk === 'rescued')) return 1;
        return files.some((f) => this.graph.node(f)?.risk === 'transfer-scheduled') ? 0.5 : 0;
      }
      case 'Gap':
        if (n.status === 'rescued') return 1;
        if (projected) return 1;
        return n.status === 'partial' ? 0.4 : 0;
      case 'Pattern': {
        if (n.status === 'confirmed') return 1;
        // Only heuristics an agenda question would confirm can be projected up.
        const confirmable = this.gaps.some((g) => g.rescuesPatterns.includes(n.id));
        return projected && confirmable ? 1 : INFERRED_CREDIT;
      }
      default: return 0;
    }
  }

  #publishCoverage(cause) {
    const c = this.coverage();
    const last = this.coverageHistory[this.coverageHistory.length - 1];
    this.coverageHistory.push({ at: Date.now(), pct: c.pct, cause });
    if (!last || last.pct !== c.pct) {
      this.stream.publish(EVENT.COVERAGE, {
        title: `Knowledge coverage ${c.pct}%`,
        detail: last ? `${last.pct}% → ${c.pct}%` : 'baseline established',
        coverage: c,
        cause,
      });
    }
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function fmtMonth(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function daysUntil(dateStr) {
  const ms = new Date(dateStr).getTime() - Date.now();
  return Math.max(0, Math.round(ms / 86400000));
}

function businessDay(n) {
  const d = new Date();
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  d.setHours(10, 0, 0, 0);
  return {
    iso: d.toISOString(),
    label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ', 10:00',
  };
}

function agendaBody(systemName, assets, openGaps, learned = []) {
  return [
    `Knowledge transfer session for ${systemName}.`,
    ``,
    `You are inheriting ${assets.length} assets that currently have exactly one person who has ever changed them:`,
    ...assets.map((a) => `  - ${a.path || a.title}`),
    ``,
    ...(learned.length ? [
      `What the exit interview already captured — read before the session:`,
      ...learned.map((l) => `  ✓ ${l.title}\n    ${l.note}`),
      ``,
    ] : []),
    openGaps.length
      ? `Ask her about these specifically — none of it is written down anywhere:`
      : `Everything on this system's agenda has a recorded answer; this session is a walkthrough.`,
    ...openGaps.map((g) => `  - ${g.title}\n    ${g.question}`),
  ].join('\n');
}

function truncate(s, n) {
  const str = String(s || '');
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}
