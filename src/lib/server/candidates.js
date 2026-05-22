// Candidate pool layer.
//
// `candidates.md` holds the wide net of stops + lodging the researcher
// surfaced, plus anything the user added manually. "In plan" status is
// computed from membership in plan.md, NOT stored here.

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import { atomicWrite } from './atomic-write.js';
import { findTripLocation } from './data.js';
import { TraverseError } from './errors.js';

const CANDIDATES_FILENAME = 'candidates.md';

export function emptyCandidates() {
  return { stops: [], lodging: [] };
}

export function candidatesPath(slug) {
  const loc = findTripLocation(slug);
  if (!loc || loc.kind !== 'dir') return null;
  return join(loc.path, CANDIDATES_FILENAME);
}

export function readCandidates(slug) {
  const path = candidatesPath(slug);
  if (!path || !existsSync(path)) return null;
  const content = readFileSync(path, 'utf8');
  return parseCandidatesFile(content);
}

export function parseCandidatesFile(content) {
  const match = content.match(/^---\n([\s\S]*?)\n?---\n?([\s\S]*)$/);
  if (!match) return null;
  let data;
  try {
    data = yamlParse(match[1]) || {};
  } catch (err) {
    throw new TraverseError('model_returned_invalid_yaml', `candidates.md YAML parse failed: ${err.message}`);
  }
  return {
    stops: Array.isArray(data.stops) ? data.stops : [],
    lodging: Array.isArray(data.lodging) ? data.lodging : [],
  };
}

export function serializeCandidatesFile(cands) {
  const yaml = yamlStringify(cands, {
    lineWidth: 0,
    defaultStringType: 'PLAIN',
    blockQuote: 'literal',
  }).trimEnd();
  return `---\n${yaml}\n---\n`;
}

export function writeCandidates(slug, cands) {
  const path = candidatesPath(slug);
  if (!path) throw new Error(`Cannot write candidates for trip "${slug}" — no folder stage found.`);
  atomicWrite(path, serializeCandidatesFile(cands));
  return path;
}

const SLUG_RE = /[^a-z0-9]+/g;

export function makeCandidateId(name, existingIds) {
  const base = String(name).toLowerCase().replace(SLUG_RE, '-').replace(/^-|-$/g, '') || 'candidate';
  const taken = new Set(existingIds);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export const STOP_CATEGORIES = [
  'historic', 'food', 'outdoors', 'view', 'entertainment',
  'cultural', 'quirky', 'shopping', 'misc',
];

export const LODGING_PRICE_TIERS = ['budget', 'mid', 'splurge'];
