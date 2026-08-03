/**
 * Does the interview grader actually work?
 *
 * Runs real answers through the real path — same prompt, same model, same
 * fallback — and checks the verdicts. Two of these cases are the ones that
 * matter, because they are where concept matching gets it wrong:
 *
 *   GOOD-odd-words     correct answer using almost none of the expected terms
 *   EMPTY-right-words  confident nonsense containing every expected term
 *
 * A keyword matcher fails both. If a model swap breaks either, don't ship it.
 *
 *   npm run eval
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

config.pacing.latencyMin = 0;
config.pacing.latencyMax = 1;
config.pacing.beatScale = 0;
config.guild.approvalRequired = false;

const CASES = [
  {
    label: 'GOOD-odd-words', gap: 'g:cron', expect: true,
    answer: 'The storage compaction job grabs the hour boundary. If we start on the hour we fight it for IO and the whole thing crawls. Shifting a few minutes past clears that window.',
    why: 'correct, but avoids most of the expected vocabulary',
  },
  {
    label: 'EMPTY-right-words', gap: 'g:weights', expect: false,
    answer: 'We set the diversity weight to 0.37 after careful analysis and extensive experimentation with the churn and skip rate metrics over several quarters.',
    why: 'contains churn, skip, experiment — and says nothing actionable',
  },
  {
    label: 'VAGUE', gap: 'g:bypass', expect: false,
    answer: 'it just works that way, you learn it after a while',
    why: 'appeal to experience',
  },
  {
    label: 'GOOD-normal', gap: 'g:bypass', expect: true,
    answer: 'Draining would push backpressure into the scorer. Downstream dedupe absorbs duplicates so replaying from the ingest offset was cheaper.',
    why: 'names the mechanism',
  },
  {
    label: 'PARTIAL', gap: 'g:salt', expect: false,
    answer: 'Because it would change things for users.',
    why: 'true but unusable — no mechanism',
  },
  {
    label: 'GOOD-terse', gap: 'g:backfill', expect: true,
    answer: 'Friday is when the weekly label pipeline runs. Parallel backfill starves it of workers and the labels miss their cutoff.',
    why: 'short but complete',
  },
];

const stream = new LaserStream();
stream.opts.journal = false;
const llm = new LLM();
const orch = new Orchestrator({
  graph: new Graph(), stream, rocket: new RocketRide(),
  guild: new Guild(stream), linkup: new Linkup(), snyk: new Snyk(), llm,
});

await orch.boot();
console.log(`\ngrading model: ${llm.available ? llm.opts.model : 'NONE — deterministic concept matching'}\n`);
await orch.run();

let pass = 0, total = 0, ms = 0;
for (const c of CASES) {
  const gap = orch.gaps.find((g) => g.id === c.gap);
  if (!gap) { console.log(`· ${c.label} skipped (no gap ${c.gap} in this run)`); continue; }
  gap.status = 'at-risk';                       // re-arm between cases

  const started = Date.now();
  const r = await orch.answer(c.gap, c.answer);
  ms += Date.now() - started;
  total++;

  const ok = r.rescued === c.expect;
  if (ok) pass++;
  console.log(`${ok ? '✓' : '✗'} ${c.label.padEnd(19)} got=${String(r.rescued).padEnd(5)} want=${String(c.expect).padEnd(5)} ${c.why}`);
  if (!ok) console.log(`    answer: "${c.answer.slice(0, 90)}…"`);
}

console.log(`\n${pass}/${total} correct · avg ${Math.round(ms / (total || 1))}ms per grade · engine ${llm.available ? llm.opts.model : 'concept-match'}`);
await orch.graph.close();
process.exit(pass === total ? 0 : 1);
