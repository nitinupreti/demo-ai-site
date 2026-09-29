/**
 * Stage timings kept across sessions. Every launch of a run is one session in the evidence
 * folder's timings.json, so a resume adds to the record instead of restarting the clock, and a
 * process that dies mid-stage still leaves its time behind, accurate to one heartbeat.
 */
import fs from 'node:fs';
import path from 'node:path';

export const TIMINGS_FILE = 'timings.json';
const HEARTBEAT_MS = 30000;

const iso = (ms) => new Date(ms).toISOString();
const secondsBetween = (from, to) => Number(((Date.parse(to) - Date.parse(from)) / 1000).toFixed(2));

function readRecord(file, runId) {
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(record.sessions)) return record;
  } catch {
    // The first session of a run has no record yet.
  }
  return { run_id: runId, sessions: [] };
}

function writeRecord(file, record) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

/** Closes a session its process never finished, at the last moment it was known to be alive. */
function closeAbandoned(session) {
  if (session.status !== 'RUNNING') return;
  const endedAt = session.updated_at || session.started_at;
  for (const stage of session.stages) {
    if (stage.status !== 'RUNNING') continue;
    stage.status = 'INTERRUPTED';
    stage.ended_at = endedAt;
    stage.duration_seconds = secondsBetween(stage.started_at, endedAt);
  }
  session.status = 'INTERRUPTED';
  session.ended_at = endedAt;
}

/** Time per stage summed over every session, in the order stages first ran; open ones count to `nowMs`. */
export function summarizeTimings(record, nowMs = Date.now()) {
  const now = iso(nowMs);
  const stages = new Map();
  for (const session of record.sessions) {
    for (const stage of session.stages) {
      const entry = stages.get(stage.name) || {
        name: stage.name, seconds: 0, runs: 0, reused: 0, interrupted: 0, status: null,
      };
      entry.seconds += stage.duration_seconds ?? secondsBetween(stage.started_at, now);
      if (stage.reused) entry.reused += 1;
      else entry.runs += 1;
      if (stage.status === 'INTERRUPTED') entry.interrupted += 1;
      entry.status = stage.status;
      stages.set(stage.name, entry);
    }
  }
  const history = record.sessions.map((session) => ({
    session: session.session,
    resumed: Boolean(session.resumed),
    status: session.status,
    started_at: session.started_at,
    seconds: secondsBetween(session.started_at, session.ended_at || now),
  }));
  return {
    sessions: history.length,
    total_seconds: Number(history.reduce((sum, entry) => sum + entry.seconds, 0).toFixed(2)),
    stages: [...stages.values()].map((entry) => ({ ...entry, seconds: Number(entry.seconds.toFixed(2)) })),
    history,
  };
}

/** Starts this launch's session; `previous` is what every earlier session of the run spent. */
export function openTimings(evidenceDir, { runId, resumed = false, now = Date.now } = {}) {
  const file = path.join(evidenceDir, TIMINGS_FILE);
  const record = readRecord(file, runId);
  record.sessions.forEach(closeAbandoned);
  const previous = summarizeTimings(record, now());
  const session = {
    session: record.sessions.length + 1,
    resumed,
    status: 'RUNNING',
    started_at: iso(now()),
    updated_at: iso(now()),
    ended_at: null,
    stages: [],
  };
  record.sessions.push(session);
  const save = () => {
    session.updated_at = iso(now());
    writeRecord(file, record);
  };
  save();
  const heartbeat = setInterval(save, HEARTBEAT_MS);
  heartbeat.unref?.();

  return {
    previous,
    stageStarted(name) {
      session.stages.push({
        name, status: 'RUNNING', started_at: iso(now()), ended_at: null, duration_seconds: null, reused: false,
      });
      save();
    },
    stageFinished(name, status, { reused = false } = {}) {
      const stage = session.stages.findLast((entry) => entry.name === name && entry.status === 'RUNNING');
      if (!stage) return;
      stage.status = status;
      stage.ended_at = iso(now());
      stage.duration_seconds = secondsBetween(stage.started_at, stage.ended_at);
      stage.reused = reused;
      save();
    },
    /** Closes the session and returns its length in seconds. */
    finish(status) {
      clearInterval(heartbeat);
      session.status = status;
      session.ended_at = iso(now());
      save();
      return secondsBetween(session.started_at, session.ended_at);
    },
    summary: () => summarizeTimings(record, now()),
  };
}
