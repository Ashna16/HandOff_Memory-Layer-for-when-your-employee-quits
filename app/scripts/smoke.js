/**
 * Headless run of the entire pipeline. No browser, no UI.
 *
 * Use it tonight to check the numbers, and tomorrow at the venue as the
 * five-second answer to "is everything wired?" — it prints which engine
 * answered each query and whether each action was real or simulated.
 *
 *   npm run smoke                 # replay
 *   HANDOFF_MODE=live npm run smoke
 */

import config from '../config.js';
import { Graph } from '../lib/graph.js';
import { LaserStream } from '../lib/laser.js';
import { RocketRide } from '../lib/rocketride.js';
import { Guild } from '../lib/guild.js';
import { Linkup } from '../lib/linkup.js';
import { Snyk } from '../lib/snyk.js';
import { LLM } from '../lib/llm.js';
import { Orchestrator } from '../lib/orchestrator.js';

// Keep the smoke test fast — the pacing exists for the stage, not for CI.
config.pacing.latencyMin = 0;
config.pacing.latencyMax = 1;
config.pacing.beatScale = 0;
config.guild.approvalTimeoutMs = 300;

const stream = new LaserStream();
stream.opts.journal = false;
const orch = new Orchestrator({
  graph: new Graph(), stream, rocket: new RocketRide(),
  guild: new Guild(stream), linkup: new Linkup(), snyk: new Snyk(), llm: new LLM(),
});

const seen = [];
stream.subscribe((e) => seen.push(e));

await orch.boot();
console.log(`\nMODE ${config.mode}  ·  ${config.scenario.company} · ${config.scenario.subject}\n`);
for (const [name, s] of Object.entries(orch.health().services)) {
  console.log(`  ${name.padEnd(11)} ${s.mode.padEnd(7)} ${s.live ? '● live' : '○ local'}`);
}

console.log('\n── run (staged) ───────────────────────────────────────');
await orch.run();
console.log(`  phase → ${orch.status}  (footprint: ${JSON.stringify(orch.footprint)})`);
await orch.analyze();
console.log(`  phase → ${orch.status}  (proposal: ${orch.proposal.meetings.length} meetings · ${orch.proposal.jiras.length} jiras)`);
await orch.interview();
console.log(`  phase → ${orch.status}`);

const before = orch.coverage();
console.log(`\n  at-risk assets      ${orch.findings.soloOwned.length}`);
console.log(`  undocumented        ${orch.findings.undocumented.length}`);
console.log(`  blocked tickets     ${orch.findings.blockers.length}`);
console.log(`  decision patterns   ${orch.findings.patterns.length}`);
console.log(`  knowledge gaps      ${orch.gaps.length}`);
const allReceipts = [...orch.rocket.receipts, ...orch.guild.receipts];
console.log(`  actions executed    ${allReceipts.length} (${allReceipts.filter((r) => r.simulated).length} simulated)`);
console.log(`    via Guild         ${orch.guild.receipts.length}  ${orch.guild.receipts.map((r) => r.kind).join(', ')}`);
console.log(`    via RocketRide    ${orch.rocket.receipts.length}  ${orch.rocket.receipts.map((r) => r.kind).join(', ')}`);
console.log(`  agent handoffs      ${orch.guild.handoffs.length}`);
console.log(`  graph               ${orch.graph.nodes.size} nodes · ${orch.graph.edges.length} edges via ${orch.graph.engine}`);
console.log(`\n  COVERAGE after rescue actions: ${before.pct}%  (${before.covered}/${before.total})   projected ${before.projected}%`);

const baseline = orch.coverageHistory.find((c) => c.cause === 'baseline');
console.log(`  COVERAGE baseline:             ${baseline?.pct}%`);

console.log('\n── interview ──────────────────────────────────────────');
const GOOD = {
  'g:bypass': 'Draining would have pushed backpressure into the scorer. Downstream dedupe already absorbs duplicates, so replaying from the ingest offset was strictly cheaper than letting the queue climb.',
  'g:cron': 'Compaction on the feature store owns the top of the hour, so running at 03:00 collides with it. Seven minutes past clears the contention window.',
  'g:weights': 'Above 0.37 the skip rate climbs faster than discovery does. Users churn off unfamiliar recommendations before the experiment shows saturation.',
  'g:coldstart': 'Below seven plays the signal is noise, and precision stops improving. Seven is where confidence in the cohort levels off.',
  'g:shadow': 'One cycle cannot see weekly seasonality. A change that looks flat on Thursday reads as a regression on the Monday refresh, so you need the variance across two weeks.',
  'g:salt': 'Rotating it reshuffles every stable playlist ordering and invalidates the delivery cache for every user at once, so the order they saw yesterday is gone.',
  'g:backfill': 'Friday collides with the weekly label pipeline. Parallel backfill starves it and the labels miss the cutoff deadline.',
  'g:escalation': 'I page the ingest on-call, usually Dana, and ask for the freshness window and where the lag is sitting.',
};

for (const gap of [...orch.gaps]) {
  const answer = GOOD[gap.id] || 'It depends on the situation.';
  const r = await orch.answer(gap.id, answer);
  console.log(`  ${r.rescued ? '✓ rescued' : '· partial'}  ${gap.title.slice(0, 58).padEnd(58)} [${r.matched.join(', ')}]`);
}

console.log('\n── meetings + jiras ───────────────────────────────────');
await orch.meetings();
console.log(`  phase → ${orch.status}`);
await orch.jiras();
console.log(`  phase → ${orch.status}`);
const reassigned = orch.proposal.jiras.filter((j) => j.status === 'reassigned');
console.log(`  jiras reassigned    ${reassigned.length}  ${reassigned.map((j) => `${j.key}:${j.fromName}→${j.toName}`).join(' · ')}`);
const allReceipts2 = [...orch.rocket.receipts, ...orch.guild.receipts];
console.log(`  actions executed    ${allReceipts2.length} (${allReceipts2.filter((r) => r.simulated).length} simulated)`);
console.log(`    via Guild         ${orch.guild.receipts.length}  ${orch.guild.receipts.map((r) => r.kind).join(', ')}`);
console.log(`    via RocketRide    ${orch.rocket.receipts.length}  ${orch.rocket.receipts.map((r) => r.kind).join(', ')}`);

const after = orch.coverage();
console.log(`\n  COVERAGE final:                ${after.pct}%  (${after.covered}/${after.total})   ceiling ${after.projected}%`);
console.log(`\n  events published    ${seen.length}`);
console.log(`  event types         ${[...new Set(seen.map((e) => e.type))].length}`);

// A thin answer must NOT rescue a gap — the system has to be able to say no.
await orch.reset();
await orch.run();
await orch.analyze();
await orch.interview();
const thin = await orch.answer(orch.gaps[0].id, 'it just works that way');
console.log(`\n  thin-answer guard   ${thin.rescued ? '✗ FAILED — thin answer was accepted' : '✓ thin answer correctly rejected'}`);

await orch.graph.close();
console.log('');
process.exit(0);
