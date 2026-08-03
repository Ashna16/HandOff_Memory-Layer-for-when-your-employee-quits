/**
 * Deterministic company world generator.
 *
 * Everything here is seeded from config.scenario.seed, so the graph, the
 * at-risk count, and the coverage number are byte-identical on every run.
 * A demo that changes shape between rehearsal and stage is a demo that fails
 * on stage.
 *
 * Output: data/seed/*.json  (run `npm run seed`)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SEED_DIR = path.join(HERE, '..', 'data', 'seed');

/** mulberry32 — tiny, fast, deterministic. */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUBJECT = { id: 'p:sarah', name: 'Sarah Chen', role: 'Staff Engineer, Personalization', email: 'sarah.chen@example-spotify.com', slack: '@sarah', tenureYears: 6 };

const PEOPLE = [
  SUBJECT,
  { id: 'p:marcus', name: 'Marcus Webb', role: 'Senior Engineer, Personalization', email: 'marcus.webb@example-spotify.com', slack: '@marcus', tenureYears: 2 },
  { id: 'p:priya', name: 'Priya Raman', role: 'Engineer, Feature Platform', email: 'priya.raman@example-spotify.com', slack: '@priya', tenureYears: 3 },
  { id: 'p:tomas', name: 'Tomas Lindqvist', role: 'Engineering Manager', email: 'tomas.lindqvist@example-spotify.com', slack: '@tomas', tenureYears: 5 },
  { id: 'p:dana', name: 'Dana Okafor', role: 'Engineer, Ingest', email: 'dana.okafor@example-spotify.com', slack: '@dana', tenureYears: 1 },
];

const SYSTEMS = [
  { id: 's:ranking', name: 'Discover Weekly Ranking Pipeline', tier: 'tier-1' },
  { id: 's:featurestore', name: 'Feature Store', tier: 'tier-1' },
  { id: 's:ingest', name: 'Listen Event Ingest', tier: 'tier-2' },
  { id: 's:delivery', name: 'Playlist Delivery', tier: 'tier-2' },
];

/** `solo: true` = Sarah is the only human who has ever touched it. These are
 *  the nodes that bloom red on stage. */
const FILES = [
  { id: 'f:retry_queue', path: 'services/ranking/retry_queue.py', system: 's:ranking', solo: true, criticality: 5 },
  { id: 'f:bypass_guard', path: 'services/ranking/bypass_guard.py', system: 's:ranking', solo: true, criticality: 5 },
  { id: 'f:weights', path: 'services/ranking/config/ranking_weights.yaml', system: 's:ranking', solo: true, criticality: 5 },
  { id: 'f:cold_start', path: 'services/ranking/cold_start.py', system: 's:ranking', solo: true, criticality: 4 },
  { id: 'f:refresh_cron', path: 'services/ranking/weekly_refresh_cron.py', system: 's:ranking', solo: true, criticality: 4 },
  { id: 'f:shadow_eval', path: 'services/ranking/shadow_eval.py', system: 's:ranking', solo: true, criticality: 4 },
  { id: 'f:tie_breaker', path: 'services/ranking/tie_breaker.py', system: 's:ranking', solo: true, criticality: 3 },
  { id: 'f:backfill', path: 'services/ranking/backfill.py', system: 's:ranking', solo: true, criticality: 3 },
  { id: 'f:feature_decay', path: 'services/ranking/feature_decay.py', system: 's:featurestore', solo: true, criticality: 4 },
  { id: 'f:candidate_gen', path: 'services/ranking/candidate_gen.py', system: 's:ranking', solo: false, criticality: 4 },
  { id: 'f:scorer', path: 'services/ranking/scorer.py', system: 's:ranking', solo: false, criticality: 4 },
  { id: 'f:api', path: 'services/ranking/api.py', system: 's:ranking', solo: false, criticality: 3 },
  { id: 'f:fs_client', path: 'services/featurestore/client.py', system: 's:featurestore', solo: false, criticality: 3 },
  { id: 'f:fs_schema', path: 'services/featurestore/schema.py', system: 's:featurestore', solo: false, criticality: 3 },
  { id: 'f:fs_writer', path: 'services/featurestore/writer.py', system: 's:featurestore', solo: false, criticality: 3 },
  { id: 'f:ingest_consumer', path: 'services/ingest/consumer.py', system: 's:ingest', solo: false, criticality: 3 },
  { id: 'f:ingest_dedupe', path: 'services/ingest/dedupe.py', system: 's:ingest', solo: false, criticality: 3 },
  { id: 'f:delivery_cache', path: 'services/delivery/cache.py', system: 's:delivery', solo: false, criticality: 2 },
  { id: 'f:delivery_api', path: 'services/delivery/api.py', system: 's:delivery', solo: false, criticality: 2 },
  { id: 'f:shared_metrics', path: 'libs/metrics.py', system: 's:ranking', solo: false, criticality: 2 },
  // The rest of the org. She never touched most of this, which is the point:
  // the baseline coverage number has to reflect a real company, not just the
  // corner of it that is on fire.
  { id: 'f:serving', path: 'services/ranking/serving.py', system: 's:ranking', solo: false, criticality: 4 },
  { id: 'f:eval_harness', path: 'services/ranking/eval_harness.py', system: 's:ranking', solo: false, criticality: 3 },
  { id: 'f:dataset', path: 'services/ranking/dataset.py', system: 's:ranking', solo: false, criticality: 3 },
  { id: 'f:fs_compaction', path: 'services/featurestore/compaction.py', system: 's:featurestore', solo: false, criticality: 3 },
  { id: 'f:fs_backfill_reader', path: 'services/featurestore/backfill_reader.py', system: 's:featurestore', solo: false, criticality: 3 },
  { id: 'f:schema_registry', path: 'services/ingest/schema_registry.py', system: 's:ingest', solo: false, criticality: 3 },
  { id: 'f:offsets', path: 'services/ingest/offsets.py', system: 's:ingest', solo: false, criticality: 3 },
  { id: 'f:ingest_replay', path: 'services/ingest/replay.py', system: 's:ingest', solo: false, criticality: 3 },
  { id: 'f:personalization_api', path: 'services/delivery/personalization_api.py', system: 's:delivery', solo: false, criticality: 3 },
  { id: 'f:delivery_fallback', path: 'services/delivery/fallback.py', system: 's:delivery', solo: false, criticality: 2 },
  { id: 'f:ranker_client', path: 'services/delivery/ranker_client.py', system: 's:delivery', solo: false, criticality: 2 },
  { id: 'f:lib_config', path: 'libs/config.py', system: 's:ranking', solo: false, criticality: 2 },
  { id: 'f:lib_logging', path: 'libs/logging.py', system: 's:ranking', solo: false, criticality: 2 },
  { id: 'f:lib_flags', path: 'libs/featureflags.py', system: 's:ranking', solo: false, criticality: 2 },
  { id: 'f:ab_assign', path: 'services/ranking/ab_assign.py', system: 's:ranking', solo: false, criticality: 3 },
  { id: 'f:metrics_export', path: 'services/ranking/metrics_export.py', system: 's:ranking', solo: false, criticality: 3 },
  { id: 'f:fs_gc', path: 'services/featurestore/gc.py', system: 's:featurestore', solo: false, criticality: 3 },
  { id: 'f:fs_api', path: 'services/featurestore/api.py', system: 's:featurestore', solo: false, criticality: 3 },
  { id: 'f:ingest_partitioner', path: 'services/ingest/partitioner.py', system: 's:ingest', solo: false, criticality: 3 },
  { id: 'f:ingest_health', path: 'services/ingest/health.py', system: 's:ingest', solo: false, criticality: 2 },
  { id: 'f:delivery_shaper', path: 'services/delivery/shaper.py', system: 's:delivery', solo: false, criticality: 3 },
  { id: 'f:lib_retry', path: 'libs/retry.py', system: 's:ranking', solo: false, criticality: 3 },
  { id: 'f:lib_auth', path: 'libs/auth.py', system: 's:delivery', solo: false, criticality: 3 },
  { id: 'f:lib_tracing', path: 'libs/tracing.py', system: 's:ingest', solo: false, criticality: 3 },
  { id: 'f:fs_migrations', path: 'services/featurestore/migrations.py', system: 's:featurestore', solo: false, criticality: 3 },
  { id: 'f:ranking_tests', path: 'services/ranking/tests/test_scorer.py', system: 's:ranking', solo: false, criticality: 3 },
  { id: 'f:delivery_tests', path: 'services/delivery/tests/test_api.py', system: 's:delivery', solo: false, criticality: 3 },
  { id: 'f:ingest_tests', path: 'services/ingest/tests/test_consumer.py', system: 's:ingest', solo: false, criticality: 3 },
  { id: 'f:deploy_ranking', path: 'deploy/ranking.yaml', system: 's:ranking', solo: false, criticality: 3 },
  { id: 'f:deploy_ingest', path: 'deploy/ingest.yaml', system: 's:ingest', solo: false, criticality: 3 },
];

const DOCS = [
  { id: 'd:runbook_ranking', title: 'Runbook — Discover Weekly Ranking', path: 'docs/runbooks/ranking.md', system: 's:ranking', soloEditor: true, covers: ['f:retry_queue', 'f:refresh_cron'] },
  { id: 'd:runbook_backfill', title: 'Runbook — Weekly Backfill', path: 'docs/runbooks/backfill.md', system: 's:ranking', soloEditor: true, covers: ['f:backfill'] },
  { id: 'd:adr_weights', title: 'ADR-041 — Ranking Weight Governance', path: 'docs/adr/041-ranking-weights.md', system: 's:ranking', soloEditor: false, covers: ['f:scorer'] },
  { id: 'd:onboard_fs', title: 'Feature Store Onboarding', path: 'docs/featurestore/onboarding.md', system: 's:featurestore', soloEditor: false, covers: ['f:fs_client', 'f:fs_schema'] },
  { id: 'd:runbook_ingest', title: 'Runbook — Listen Event Ingest', path: 'docs/runbooks/ingest.md', system: 's:ingest', soloEditor: false, covers: ['f:ingest_consumer', 'f:ingest_dedupe'] },
  { id: 'd:delivery_arch', title: 'Playlist Delivery Architecture', path: 'docs/delivery/architecture.md', system: 's:delivery', soloEditor: false, covers: ['f:delivery_api', 'f:delivery_cache'] },
  { id: 'd:eng_handbook', title: 'Personalization Engineering Handbook', path: 'docs/handbook.md', system: 's:ranking', soloEditor: false, covers: ['f:lib_config', 'f:lib_logging', 'f:lib_flags', 'f:serving'] },
  { id: 'd:ingest_offsets', title: 'Offset Management and Replay', path: 'docs/ingest/offsets.md', system: 's:ingest', soloEditor: false, covers: ['f:offsets', 'f:ingest_replay', 'f:schema_registry'] },
];

const INCIDENTS = [
  { id: 'i:mar14', key: 'INC-2291', title: 'Discover Weekly refresh stalled 4h — ingest lag cascade', date: '2026-03-14', responder: 'p:sarah', system: 's:ranking', touches: ['f:retry_queue', 'f:bypass_guard'], resolution: 'Bypassed the retry queue and let the batch replay from the ingest offset. Downstream dedupe absorbed the duplicates.' },
  { id: 'i:jan22', key: 'INC-2104', title: 'Cold-start users served empty playlists', date: '2026-01-22', responder: 'p:sarah', system: 's:ranking', touches: ['f:cold_start'], resolution: 'Dropped the fallback play-count threshold to 7 for the affected cohort.' },
  { id: 'i:nov08', key: 'INC-1977', title: 'Weekly refresh collided with feature store compaction', date: '2025-11-08', responder: 'p:sarah', system: 's:featurestore', touches: ['f:refresh_cron', 'f:feature_decay'], resolution: 'Moved the cron off the top of the hour.' },
];

/** Her decision heuristics — the "how she thinks" layer. The Mapper agent
 *  derives these from commit and ticket language; the evidence lists below
 *  are what it cites. */
const PATTERNS = [
  { id: 'pat:retry_first', name: 'Checks the retry queue before the logs', detail: 'On any ingest-side failure she reads queue depth first — logs only tell her what already failed, depth tells her what is about to.', evidence: ['i:mar14', 'f:retry_queue'], confidence: 0.91 },
  { id: 'pat:shadow_over_ab', name: 'Shadow-evaluates ranking changes instead of A/B testing them', detail: 'Weight changes go through two shadow cycles before any user traffic, because weekly playlists have seven-day seasonality that a 48-hour A/B test reads as noise.', evidence: ['f:shadow_eval', 'f:weights'], confidence: 0.87 },
  { id: 'pat:coldstart_is_data', name: 'Treats cold-start as a data problem, never a model problem', detail: 'Her fix for empty playlists is always to change what counts as enough signal, not to retrain.', evidence: ['i:jan22', 'f:cold_start'], confidence: 0.79 },
  { id: 'pat:revert_first', name: 'Reverts first, debugs after — but only during peak hours', detail: 'Off-peak she will debug in place; between 06:00 and 22:00 CET she reverts within four minutes and investigates from a clean baseline.', evidence: ['i:mar14'], confidence: 0.83 },
  { id: 'pat:p99', name: 'Reads p99, distrusts p50 on batch jobs', detail: 'Every alert threshold she has ever authored is set on the tail, because a healthy median on a refresh job hides a stalled shard.', evidence: ['f:refresh_cron', 'f:shared_metrics'], confidence: 0.74 },
  // Heuristics the Mapper can infer from her history but that no question on
  // the agenda will confirm. They stay at inferred confidence for the whole
  // run, and that residue is the argument for the human meeting: the agent
  // gets you to the nineties, it does not get you to a hundred.
  { id: 'pat:blast_radius', name: 'Sizes the blast radius before touching the fix', detail: 'Her first message in every incident thread is a count of affected users, not a hypothesis.', evidence: ['i:mar14'], confidence: 0.68 },
  { id: 'pat:one_change', name: 'Never ships two ranking changes in the same week', detail: 'Weekly refresh means one change per cycle is the only way to attribute a movement to a cause.', evidence: ['f:weights'], confidence: 0.71 },
  { id: 'pat:upstream_first', name: 'Assumes upstream before blaming the model', detail: 'Ranking regressions get a freshness check before anyone opens a notebook.', evidence: ['f:feature_decay'], confidence: 0.66 },
  { id: 'pat:cache_last', name: 'Suspects the cache last, not first', detail: 'She has been burned by chasing cache ghosts that turned out to be upstream schema drift.', evidence: ['f:delivery_cache'], confidence: 0.61 },
  { id: 'pat:no_friday', name: 'No Friday changes to anything on the weekly path', detail: 'Not a policy anywhere — just something she has done for six years and everyone copies.', evidence: ['f:backfill'], confidence: 0.77 },
  { id: 'pat:data_diff', name: 'Reads the data diff before the code diff', detail: 'On a ranking review she opens the feature distribution first and the pull request second.', evidence: ['f:dataset', 'f:shadow_eval'], confidence: 0.64 },
];

/**
 * Tacit knowledge with no written trace anywhere in the seeded corpus.
 * The Gap-Hunter finds these *structurally* (solo-owned + uncovered by docs +
 * referenced by an open ticket or incident). The question phrasing and the
 * concepts an answer should contain live here.
 */
const KNOWLEDGE_TOPICS = [
  {
    id: 'g:bypass', anchor: 'f:bypass_guard', system: 's:ranking', criticality: 5,
    title: 'Why the retry queue gets bypassed during an ingest cascade',
    question: 'On March 14th you bypassed the retry queue during the refresh stall instead of draining it. Walk me through what you were looking at when you made that call, and what would have happened if you had drained it instead.',
    expects: ['dedupe', 'downstream', 'replay', 'offset', 'backpressure', 'duplicate'],
    modelAnswer: "Draining would have pushed backpressure into the scorer. Downstream dedupe already absorbs duplicates, so replaying from the ingest offset was strictly cheaper than letting the queue climb.",
    rescuesPatterns: ['pat:retry_first'],
  },
  {
    id: 'g:cron', anchor: 'f:refresh_cron', system: 's:ranking', criticality: 4,
    title: 'Why the weekly refresh cron runs at 03:07 UTC and not 03:00',
    question: 'The weekly refresh cron is set to 03:07 UTC. Seven minutes past the hour is a very specific choice. Why?',
    expects: ['compaction', 'feature store', 'contention', 'collide', 'top of the hour', 'batch'],
    modelAnswer: "The storage compaction job owns the top of the hour. Starting on the hour means fighting it for IO and the whole refresh crawls, so we shift seven minutes past to clear the contention window.",
    rescuesPatterns: [],
  },
  {
    id: 'g:weights', anchor: 'f:weights', system: 's:ranking', criticality: 5,
    title: 'Why the diversity weight is pinned at 0.37',
    question: 'The diversity weight in ranking_weights.yaml is 0.37, and there is a comment that just says "do not raise". What breaks when someone raises it?',
    expects: ['skip', 'churn', 'saturation', 'familiar', 'retention', 'experiment'],
    modelAnswer: "Above 0.37 the skip rate climbs faster than discovery does. People bounce off unfamiliar tracks before the experiment ever shows saturation, and retention follows the skips.",
    rescuesPatterns: ['pat:shadow_over_ab'],
  },
  {
    id: 'g:coldstart', anchor: 'f:cold_start', system: 's:ranking', criticality: 4,
    title: 'Why the cold-start fallback threshold is 7 plays',
    question: 'Cold-start falls back at seven plays. Where did seven come from, and what tells you it needs to move?',
    expects: ['noise', 'confidence', 'precision', 'signal', 'cohort', 'threshold'],
    modelAnswer: "Below seven plays the signal is noise and precision stops improving. Seven is where confidence in the cohort levels off — you move it when a new market has a different play-rate distribution.",
    rescuesPatterns: ['pat:coldstart_is_data'],
  },
  {
    id: 'g:shadow', anchor: 'f:shadow_eval', system: 's:ranking', criticality: 4,
    title: 'Why shadow eval must run two full cycles before promotion',
    question: 'Nobody is allowed to promote a ranking change after one shadow cycle. What does the second cycle catch that the first one cannot?',
    expects: ['seasonality', 'weekly', 'monday', 'variance', 'week-over-week', 'refresh'],
    modelAnswer: "One cycle cannot see weekly seasonality. A change that looks flat on a Thursday reads as a regression on the Monday refresh, so you need the variance across two full weeks before promoting.",
    rescuesPatterns: ['pat:shadow_over_ab'],
  },
  {
    id: 'g:salt', anchor: 'f:tie_breaker', system: 's:ranking', criticality: 3,
    title: 'Why the tie-breaker hash salt must never be rotated',
    question: 'The tie-breaker salt is hardcoded and there is no rotation story. What happens to users if someone rotates it?',
    expects: ['reshuffle', 'stable', 'cache', 'order', 'user', 'consistent'],
    modelAnswer: "Rotating it reshuffles every stable playlist ordering and invalidates the delivery cache for every user at once. The order they saw yesterday is gone, so we never rotate it.",
    rescuesPatterns: [],
  },
  {
    id: 'g:backfill', anchor: 'f:backfill', system: 's:ranking', criticality: 3,
    title: 'Why backfill must run --no-parallel on Fridays',
    question: 'Your backfill runbook says --no-parallel on Fridays only. What is special about Friday?',
    expects: ['label', 'contention', 'weekly', 'deadline', 'pipeline', 'cutoff'],
    modelAnswer: "Friday collides with the weekly label pipeline. Parallel backfill starves it of workers and the labels miss their cutoff, so on Fridays it has to run single-threaded.",
    rescuesPatterns: [],
  },
  {
    id: 'g:escalation', anchor: 'f:feature_decay', system: 's:featurestore', criticality: 4,
    title: 'Who to escalate to when the feature store is late',
    question: 'When feature freshness slips past the refresh window, who do you actually call, and what do you ask them for?',
    expects: ['ingest', 'dana', 'escalate', 'on-call', 'freshness', 'window'],
    modelAnswer: "I page the ingest on-call, usually Dana, and ask for the freshness window and where the lag is sitting — the feature store is downstream of them, so it is almost always an ingest problem.",
    rescuesPatterns: ['pat:p99'],
  },
];

const COMMIT_VERBS = ['fix', 'refactor', 'tune', 'guard', 'handle', 'add', 'drop', 'pin', 'harden', 'instrument'];
const COMMIT_SUBJECTS = [
  'retry backoff', 'queue depth alarm', 'shard skew', 'null cohort', 'stale feature read',
  'p99 threshold', 'batch window', 'idempotency key', 'cache warm path', 'schema drift',
  'partition key', 'dedupe window', 'fallback ordering', 'weight clamp', 'offset commit',
];

/** Commit messages where she explains herself. The Mapper mines these for the
 *  thinking layer, so they need to read like a real engineer's reasoning. */
const REASONED_COMMITS = [
  { file: 'f:retry_queue', msg: 'bypass retry queue when ingest lag > 20m\n\nDraining is the wrong instinct here. Downstream dedupe already absorbs\nduplicates, so replaying from the offset is strictly cheaper than letting\nbackpressure climb into the scorer.' },
  { file: 'f:refresh_cron', msg: 'move weekly refresh off the top of the hour\n\nCompaction owns :00. We were losing an hour a week to contention nobody\nwas measuring because p50 looked fine.' },
  { file: 'f:shadow_eval', msg: 'require two shadow cycles before promote\n\nOne cycle cannot see weekly seasonality. A change that looks flat on a\nThursday reads as a regression on the Monday refresh.' },
  { file: 'f:cold_start', msg: 'lower fallback threshold to 7 plays\n\nBelow seven the signal is noise and we are just ranking randomness with\nextra steps. Seven is where precision stops moving.' },
  { file: 'f:weights', msg: 'clamp diversity weight at 0.37\n\nAbove this, skip rate climbs faster than discovery does. Do not raise\nwithout two shadow cycles.' },
  { file: 'f:tie_breaker', msg: 'freeze tie-breaker salt\n\nRotating this reshuffles every stable playlist ordering and invalidates\nthe delivery cache for every user at once.' },
  { file: 'f:bypass_guard', msg: 'guard the bypass behind an explicit lag threshold\n\nI do not want this to be a judgement call at 3am for whoever is on call.' },
  { file: 'f:backfill', msg: 'document --no-parallel for Friday runs\n\nFriday collides with the weekly label pipeline. Parallel backfill starves it\nand the labels miss the cutoff.' },
  { file: 'f:feature_decay', msg: 'alert on freshness tail, not mean\n\nA healthy mean with one stalled shard is the exact failure we shipped last\nquarter.' },
];

function generateCommits(rand) {
  const commits = [];
  // Her whole tenure, not just the recent past: the record strip is meant to
  // show six years of one person holding the same systems.
  const start = new Date('2020-08-03T09:00:00Z').getTime();
  const end = new Date('2026-07-28T18:00:00Z').getTime();
  const span = end - start;

  // Reasoned commits first — these are the ones the Mapper quotes.
  REASONED_COMMITS.forEach((rc, i) => {
    commits.push({
      sha: `c${String(i).padStart(4, '0')}`,
      author: 'p:sarah',
      date: new Date(start + span * (0.35 + i * 0.06)).toISOString(),
      message: rc.msg,
      files: [rc.file],
      reasoned: true,
    });
  });

  const soloFiles = FILES.filter((f) => f.solo);
  const sharedFiles = FILES.filter((f) => !f.solo);
  const others = PEOPLE.filter((p) => p.id !== 'p:sarah' && p.id !== 'p:tomas');

  // Guarantee pass: every shared file gets two distinct non-Sarah authors.
  // "Shared" has to be true in the commit history, because the hero query
  // derives ownership from commits and never trusts a flag.
  sharedFiles.forEach((f, i) => {
    const a = others[i % others.length];
    const b = others[(i + 1) % others.length];
    for (const author of [a, b]) {
      commits.push({
        sha: `s${String(commits.length).padStart(4, '0')}`,
        author: author.id,
        date: new Date(start + span * (0.1 + (i / sharedFiles.length) * 0.8)).toISOString(),
        message: `${COMMIT_VERBS[i % COMMIT_VERBS.length]} ${COMMIT_SUBJECTS[i % COMMIT_SUBJECTS.length]}`,
        files: [f.id],
        reasoned: false,
      });
    }
  });

  for (let i = commits.length; i < 460; i++) {
    // 58% of all commits are hers — she is the centre of gravity here.
    const isSarah = rand() < 0.58;
    const author = isSarah ? 'p:sarah' : others[Math.floor(rand() * others.length)].id;
    // Non-Sarah authors can never touch a solo file — that is what makes it solo.
    const pool = isSarah ? (rand() < 0.62 ? soloFiles : sharedFiles) : sharedFiles;
    const touched = [pool[Math.floor(rand() * pool.length)].id];
    if (rand() < 0.3) touched.push(sharedFiles[Math.floor(rand() * sharedFiles.length)].id);

    const verb = COMMIT_VERBS[Math.floor(rand() * COMMIT_VERBS.length)];
    const subj = COMMIT_SUBJECTS[Math.floor(rand() * COMMIT_SUBJECTS.length)];
    commits.push({
      sha: `c${String(i).padStart(4, '0')}`,
      author,
      date: new Date(start + span * rand()).toISOString(),
      message: `${verb} ${subj}`,
      files: [...new Set(touched)],
      reasoned: false,
    });
  }

  return commits.sort((a, b) => a.date.localeCompare(b.date));
}

function generateTickets(rand) {
  const tickets = [];
  const open = [
    { key: 'DW-1841', title: 'Ranking weights review before Q3 model swap', refs: ['f:weights'], assignee: 'p:sarah', note: 'Blocked on Sarah — she is the only one who knows why 0.37 is the ceiling.' },
    { key: 'DW-1867', title: 'Cold-start cohort regression on new markets', refs: ['f:cold_start'], assignee: 'p:sarah', note: 'Needs the reasoning behind the 7-play threshold before we tune it for JP.' },
    { key: 'DW-1902', title: 'Move refresh cron into the new scheduler', refs: ['f:refresh_cron', 'f:feature_decay'], assignee: 'p:sarah', note: 'Migration will reset the schedule. Nobody has documented why 03:07.' },
  ];
  open.forEach((t, i) => {
    tickets.push({ id: `t:open${i}`, key: t.key, title: t.title, status: 'Open', assignee: t.assignee, references: t.refs, note: t.note, created: '2026-07-20T10:00:00Z', blockedOnSubject: true });
  });

  const titles = ['Investigate scorer latency', 'Add dashboard for refresh lag', 'Upgrade feature store client', 'Backfill missing labels', 'Reduce candidate set size', 'Fix flaky delivery test', 'Document ingest offsets', 'Rotate service credentials', 'Add tracing to scorer', 'Tune dedupe window', 'Split metrics library', 'Cache warm on deploy', 'Handle empty cohort', 'Alert on shard skew', 'Retire legacy endpoint'];
  const statuses = ['Done', 'Done', 'Done', 'In Progress', 'Open'];
  for (let i = 0; i < 27; i++) {
    const assignee = rand() < 0.45 ? 'p:sarah' : PEOPLE[1 + Math.floor(rand() * 4)].id;
    const f = FILES[Math.floor(rand() * FILES.length)];
    tickets.push({
      id: `t:${i}`,
      key: `DW-${1500 + i * 7}`,
      title: titles[i % titles.length],
      status: statuses[Math.floor(rand() * statuses.length)],
      assignee,
      references: [f.id],
      note: '',
      created: new Date(new Date('2025-06-01').getTime() + rand() * 3.6e10).toISOString(),
      blockedOnSubject: false,
    });
  }
  return tickets;
}

export function generate() {
  const rand = rng(config.scenario.seed);
  const world = {
    meta: {
      company: config.scenario.company,
      system: config.scenario.system,
      subject: SUBJECT,
      lastDay: config.scenario.lastDay,
      generatedFrom: config.scenario.seed,
    },
    people: PEOPLE,
    systems: SYSTEMS,
    files: FILES,
    docs: DOCS,
    incidents: INCIDENTS,
    patterns: PATTERNS,
    topics: KNOWLEDGE_TOPICS,
    commits: generateCommits(rand),
    tickets: generateTickets(rand),
  };
  return world;
}

export function write() {
  fs.mkdirSync(SEED_DIR, { recursive: true });
  const world = generate();
  for (const [key, value] of Object.entries(world)) {
    fs.writeFileSync(path.join(SEED_DIR, `${key}.json`), JSON.stringify(value, null, 2));
  }
  // Also emit the docs as real markdown with authorship frontmatter, so the
  // corpus on disk looks like a corpus, not like a fixture.
  const docDir = path.join(SEED_DIR, 'docs');
  fs.mkdirSync(docDir, { recursive: true });
  for (const d of world.docs) {
    const authors = d.soloEditor ? ['Sarah Chen'] : ['Sarah Chen', 'Marcus Webb', 'Priya Raman'].slice(0, 2 + Math.round(Math.random()));
    fs.writeFileSync(
      path.join(docDir, path.basename(d.path)),
      `---\ntitle: ${d.title}\nauthors: [${authors.join(', ')}]\nsystem: ${d.system}\nlast_reviewed: 2026-05-11\n---\n\n# ${d.title}\n\n(Seeded corpus document for the Handoff demo.)\n`
    );
  }
  return world;
}

export function load() {
  if (!fs.existsSync(path.join(SEED_DIR, 'meta.json'))) return write();
  const world = {};
  for (const key of ['meta', 'people', 'systems', 'files', 'docs', 'incidents', 'patterns', 'topics', 'commits', 'tickets']) {
    world[key] = JSON.parse(fs.readFileSync(path.join(SEED_DIR, `${key}.json`), 'utf8'));
  }
  return world;
}

// Note: compare resolved paths, not URL strings — this project lives under a
// directory with a space in it, which percent-encodes in import.meta.url.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const w = write();
  console.log(`seeded ${w.commits.length} commits, ${w.tickets.length} tickets, ${w.files.length} files, ${w.docs.length} docs, ${w.topics.length} knowledge topics → ${SEED_DIR}`);
}
