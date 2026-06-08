// Pure assembly of in-trip capture into (a) a prompt context block that grounds
// the retro AI and (b) a verbatim "## In-trip notes" section preserving the
// traveler's exact words. No I/O — callers pass already-read plan + candidates.

/**
 * @param {{ plan: {days?: any[]}|null, candidates: {stops?: any[]}|null }} input
 * @returns {{ promptBlock: string, verbatimSection: string|null }}
 */
export function buildCaptureContext({ plan, candidates }) {
  const days = plan?.days ?? [];
  const byId = new Map((candidates?.stops ?? []).map((s) => [s.id, s]));

  const promptLines = [];
  const verbatimLines = [];

  for (const day of days) {
    const stops = (day.stops ?? []).map((id) => byId.get(id)).filter(Boolean);
    const captured = stops.filter((s) => s.status || s.note);
    const hasDayLog = typeof day.log === 'string' && day.log.trim();
    const dayNoteStops = stops.filter((s) => typeof s.note === 'string' && s.note.trim());

    // Prompt block: include the day if anything was captured on it.
    if (captured.length || hasDayLog) {
      promptLines.push(`Day ${day.number}:`);
      for (const s of captured) {
        const status = s.status ? `${s.status}` : 'noted';
        const note = s.note ? ` Note: "${s.note}"` : '';
        promptLines.push(`- ${s.name} — ${status}.${note}`);
      }
      if (hasDayLog) promptLines.push(`Day note: "${day.log.trim()}"`);
      promptLines.push('');
    }

    // Verbatim section: only the human prose (day log + stop notes).
    if (hasDayLog || dayNoteStops.length) {
      verbatimLines.push(`**Day ${day.number}**${hasDayLog ? ` — ${day.log.trim()}` : ''}`);
      for (const s of dayNoteStops) verbatimLines.push(`- ${s.name}: ${s.note.trim()}`);
      verbatimLines.push('');
    }
  }

  const promptBlock = promptLines.join('\n').trim();
  const verbatimSection = verbatimLines.length
    ? `## In-trip notes\n\n${verbatimLines.join('\n').trim()}`
    : null;

  return { promptBlock, verbatimSection };
}
