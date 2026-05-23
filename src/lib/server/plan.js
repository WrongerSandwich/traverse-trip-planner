// Plan structured-data layer.
//
// `plan.md` per trip holds the curated trip: day-by-day stops + lodging
// assignments, plus trip-wide bits (field_guide_notes, gotchas).
// Stored as structured YAML in frontmatter; body is currently unused but
// tolerated for forward compatibility. References candidate ids from
// candidates.md. See referential-integrity rules in spec
// 2026-05-22-planning-plan-and-candidates-design.md.

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import { atomicWrite } from './atomic-write.js';
import { findTripLocation } from './data.js';
import { readCandidates } from './candidates.js';
import { TraverseError } from './errors.js';

const PLAN_FILENAME = 'plan.md';

export function emptyPlan() {
  return { field_guide_notes: '', gotchas: '', days: [] };
}

export function planPath(slug) {
  const loc = findTripLocation(slug);
  if (!loc || loc.kind !== 'dir') return null;
  return join(loc.path, PLAN_FILENAME);
}

export function readPlan(slug) {
  const path = planPath(slug);
  if (!path || !existsSync(path)) return null;
  const content = readFileSync(path, 'utf8');
  return parsePlanFile(content);
}

export function parsePlanFile(content) {
  const match = content.match(/^---\n([\s\S]*?)\n?---\n?([\s\S]*)$/);
  if (!match) return null;
  let data;
  try {
    data = yamlParse(match[1]) || {};
  } catch (err) {
    throw new TraverseError('model_returned_invalid_yaml', `plan.md YAML parse failed: ${err.message}`);
  }
  return {
    field_guide_notes: data.field_guide_notes ?? '',
    gotchas: data.gotchas ?? '',
    days: Array.isArray(data.days)
      ? data.days.map((d) => ({ ...d, stops: Array.isArray(d?.stops) ? d.stops : [] }))
      : [],
  };
}

export function serializePlanFile(plan) {
  const yaml = yamlStringify(plan, {
    lineWidth: 0,
    defaultStringType: 'PLAIN',
    blockQuote: 'literal',
  }).trimEnd();
  return `---\n${yaml}\n---\n`;
}

export function writePlan(slug, plan) {
  const path = planPath(slug);
  if (!path) throw new Error(`Cannot write plan for trip "${slug}" — no folder stage found.`);
  atomicWrite(path, serializePlanFile(plan));
  return path;
}

function loadOrInit(slug) {
  return readPlan(slug) || emptyPlan();
}

function requireCandidate(slug, id) {
  const cands = readCandidates(slug);
  if (!cands) throw new Error(`Candidate "${id}" not in candidates.md — file missing.`);
  if (!cands.stops.some((s) => s.id === id) && !cands.lodging.some((l) => l.id === id)) {
    throw new Error(`Candidate "${id}" not in candidates.md.`);
  }
}

function findDay(plan, number) {
  const day = plan.days.find((d) => d.number === number);
  if (!day) throw new Error(`Day ${number} not found.`);
  return day;
}

export function addDay(slug) {
  const plan = loadOrInit(slug);
  const nextNumber = plan.days.length ? Math.max(...plan.days.map((d) => d.number)) + 1 : 1;
  plan.days.push({ number: nextNumber, stops: [] });
  writePlan(slug, plan);
}

export function removeDay(slug, number) {
  const plan = loadOrInit(slug);
  const day = findDay(plan, number);
  if (day.stops.length > 0) throw new Error(`Day ${number} has assigned stops; move them first.`);
  if (day.lodging_id) throw new Error(`Day ${number} has assigned lodging; clear it first.`);
  // Drop `date` on any day whose number changes — the date was tied to its original
  // calendar slot, not its position in the trip, so renumbering invalidates it.
  plan.days = plan.days
    .filter((d) => d.number !== number)
    .map((d, i) => {
      const newNumber = i + 1;
      if (d.number === newNumber) return d;
      const { date: _drop, ...rest } = d;
      return { ...rest, number: newNumber };
    });
  writePlan(slug, plan);
}

export function addStopToDay(slug, dayNumber, candidateId) {
  requireCandidate(slug, candidateId);
  const plan = loadOrInit(slug);
  const day = findDay(plan, dayNumber);
  if (!day.stops.includes(candidateId)) day.stops.push(candidateId);
  writePlan(slug, plan);
}

export function removeStopFromDay(slug, dayNumber, candidateId) {
  const plan = loadOrInit(slug);
  const day = findDay(plan, dayNumber);
  day.stops = day.stops.filter((id) => id !== candidateId);
  writePlan(slug, plan);
}

export function moveStopToDay(slug, fromDay, toDay, candidateId) {
  const plan = loadOrInit(slug);
  const from = findDay(plan, fromDay);
  const to = findDay(plan, toDay);
  from.stops = from.stops.filter((id) => id !== candidateId);
  if (!to.stops.includes(candidateId)) to.stops.push(candidateId);
  writePlan(slug, plan);
}

export function reorderStops(slug, dayNumber, newOrder) {
  const plan = loadOrInit(slug);
  const day = findDay(plan, dayNumber);
  const current = new Set(day.stops);
  const next = new Set(newOrder);
  if (current.size !== next.size || [...current].some((id) => !next.has(id))) {
    throw new Error(`reorderStops day ${dayNumber}: id set mismatch.`);
  }
  day.stops = [...newOrder];
  writePlan(slug, plan);
}

export function setDayMetadata(slug, dayNumber, patch) {
  const plan = loadOrInit(slug);
  const day = findDay(plan, dayNumber);
  for (const k of ['date', 'drive_distance_mi', 'notes']) {
    if (k in patch) {
      if (patch[k] == null || patch[k] === '') delete day[k];
      else day[k] = patch[k];
    }
  }
  writePlan(slug, plan);
}

export function setLodgingForDay(slug, dayNumber, candidateId) {
  if (candidateId != null) requireCandidate(slug, candidateId);
  const plan = loadOrInit(slug);
  const day = findDay(plan, dayNumber);
  if (candidateId == null) delete day.lodging_id;
  else day.lodging_id = candidateId;
  writePlan(slug, plan);
}

export function promoteCandidateToDay(slug, candidateId, dayNumber) {
  requireCandidate(slug, candidateId);
  const plan = loadOrInit(slug);
  if (plan.days.length === 0) {
    plan.days.push({ number: 1, stops: [] });
  }
  const target = dayNumber == null ? plan.days[0] : findDay(plan, dayNumber);
  const cands = readCandidates(slug);
  const isLodging = cands?.lodging.some((l) => l.id === candidateId);
  if (isLodging) target.lodging_id = candidateId;
  else if (!target.stops.includes(candidateId)) target.stops.push(candidateId);
  writePlan(slug, plan);
}

export function unPromoteCandidate(slug, candidateId) {
  const plan = loadOrInit(slug);
  for (const day of plan.days) {
    day.stops = day.stops.filter((id) => id !== candidateId);
    if (day.lodging_id === candidateId) delete day.lodging_id;
  }
  writePlan(slug, plan);
}

export function isCandidatePromoted(slug, candidateId) {
  const plan = readPlan(slug);
  if (!plan) return false;
  return plan.days.some((d) => d.stops.includes(candidateId) || d.lodging_id === candidateId);
}

export function findDanglingCandidateIds(slug) {
  const plan = readPlan(slug);
  if (!plan) return [];
  const cands = readCandidates(slug);
  const known = new Set([...(cands?.stops ?? []).map((s) => s.id), ...(cands?.lodging ?? []).map((l) => l.id)]);
  const referenced = new Set();
  for (const day of plan.days) {
    for (const id of day.stops) referenced.add(id);
    if (day.lodging_id) referenced.add(day.lodging_id);
  }
  return [...referenced].filter((id) => !known.has(id));
}
