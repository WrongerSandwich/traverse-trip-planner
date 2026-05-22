// Plan structured-data layer.
//
// `plan.md` per trip holds the curated trip: day-by-day stops + lodging
// assignments, plus trip-wide bits (cover_query, field_guide_notes, gotchas).
// Stored as structured YAML in frontmatter; body is currently unused but
// tolerated for forward compatibility. References candidate ids from
// candidates.md. See referential-integrity rules in spec
// 2026-05-22-planning-plan-and-candidates-design.md.

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import { atomicWrite } from './atomic-write.js';
import { findTripLocation } from './data.js';
import { TraverseError } from './errors.js';

const PLAN_FILENAME = 'plan.md';

export function emptyPlan() {
  return { cover_query: '', field_guide_notes: '', gotchas: '', days: [] };
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
    cover_query: data.cover_query ?? '',
    field_guide_notes: data.field_guide_notes ?? '',
    gotchas: data.gotchas ?? '',
    days: Array.isArray(data.days) ? data.days : [],
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
