/**
 * Stage timings across sessions: a resume adds to the record instead of restarting the clock, and
 * a session a killed process never closed is still counted up to the last moment it was alive.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { TIMINGS_FILE, openTimings, summarizeTimings } from './timings.mjs';

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timings-check-'));
const file = path.join(dir, TIMINGS_FILE);
const at = (seconds) => Date.UTC(2026, 0, 1) + seconds * 1000;
let clock = at(0);
const now = () => clock;

// Session 1 runs discover, then is killed during plan; its last heartbeat was at 300 s.
let timings = openTimings(dir, { runId: 'r1', now });
timings.stageStarted('discover');
clock = at(60);
timings.stageFinished('discover', 'PASS');
timings.stageStarted('plan');
const killed = JSON.parse(fs.readFileSync(file, 'utf8'));
killed.sessions[0].updated_at = new Date(at(300)).toISOString();
fs.writeFileSync(file, JSON.stringify(killed));

// Session 2 resumes: discover is reused, plan runs to the end, and the run fails at fanout.
clock = at(1000);
timings = openTimings(dir, { runId: 'r1', resumed: true, now });
expect(timings.previous.sessions === 1 && timings.previous.total_seconds === 300,
  `a resume must see the earlier session's time, got ${JSON.stringify(timings.previous)}`);
timings.stageStarted('discover');
timings.stageFinished('discover', 'PASS', { reused: true });
timings.stageStarted('plan');
clock = at(1600);
timings.stageFinished('plan', 'PASS');
timings.stageStarted('fanout');
clock = at(1700);
timings.stageFinished('fanout', 'FAIL');
timings.finish('FAIL');

const record = JSON.parse(fs.readFileSync(file, 'utf8'));
const [first, second] = record.sessions;
expect(record.sessions.length === 2, `each launch must be its own session, got ${record.sessions.length}`);
expect(first.status === 'INTERRUPTED' && first.ended_at === new Date(at(300)).toISOString(),
  `a killed session must close at its last heartbeat, got ${first.status} ${first.ended_at}`);
const interruptedPlan = first.stages.find((stage) => stage.name === 'plan');
expect(interruptedPlan?.status === 'INTERRUPTED' && interruptedPlan.duration_seconds === 240,
  `the stage a kill cut short must keep the time it ran, got ${JSON.stringify(interruptedPlan)}`);
expect(second.resumed === true && second.status === 'FAIL' && second.ended_at === new Date(at(1700)).toISOString(),
  `the resumed session must be marked and closed, got ${JSON.stringify({ resumed: second.resumed, status: second.status })}`);

const summary = summarizeTimings(record, at(2000));
const byName = Object.fromEntries(summary.stages.map((stage) => [stage.name, stage]));
expect(summary.sessions === 2 && summary.total_seconds === 1000,
  `the total must add every session, got ${summary.total_seconds} over ${summary.sessions}`);
expect(summary.stages.map((stage) => stage.name).join(',') === 'discover,plan,fanout',
  `stages must keep the order they first ran in, got ${summary.stages.map((stage) => stage.name).join(',')}`);
expect(byName.discover.seconds === 60 && byName.discover.runs === 1 && byName.discover.reused === 1,
  `a reused stage must not count as another run, got ${JSON.stringify(byName.discover)}`);
expect(byName.plan.seconds === 840 && byName.plan.runs === 2 && byName.plan.interrupted === 1,
  `a stage run twice must add both runs, got ${JSON.stringify(byName.plan)}`);
expect(byName.fanout.status === 'FAIL', `a stage must report its latest status, got ${byName.fanout.status}`);

// A third launch leaves finished sessions exactly as they were.
clock = at(5000);
timings = openTimings(dir, { runId: 'r1', resumed: true, now });
timings.finish('COMPLETE');
const reopened = JSON.parse(fs.readFileSync(file, 'utf8'));
expect(JSON.stringify(reopened.sessions.slice(0, 2)) === JSON.stringify(record.sessions),
  'reopening must never rewrite a finished session');

fs.rmSync(dir, { recursive: true, force: true });
if (failures.length) {
  console.error(`timings assertions failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('timings assertions: all passed');
