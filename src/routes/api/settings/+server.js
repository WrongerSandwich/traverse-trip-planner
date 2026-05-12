import { json } from '@sveltejs/kit';
import {
  readSettings,
  writeSettings,
  redactSettings,
  SUPPORTED_PROVIDERS,
  SUPPORTED_SERVICES,
  SUPPORTED_SEARCH_PROVIDERS,
} from '$lib/server/settings.js';

const SUPPORTED_SLOTS = ['default', 'research'];
const ASSISTANT_NAME_MAX = 60;

export async function POST({ request }) {
  if (process.env.TRAVERSE_DISABLE_SETTINGS_UI) {
    return json({ error: 'Settings UI is disabled on this server.' }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  // Validate shape — reject unexpected top-level keys or deeply wrong values.
  if (body === null || typeof body !== 'object') {
    return json({ error: 'Body must be an object.' }, { status: 400 });
  }

  const incomingKeys = body.keys ?? {};
  const incomingServices = body.services ?? {};
  const incomingSlots = body.slots ?? {};
  const keysToClear = body.keysToClear ?? [];
  const servicesToClear = body.servicesToClear ?? [];

  for (const k of Object.keys(incomingKeys)) {
    if (!SUPPORTED_PROVIDERS.includes(k)) {
      return json({ error: `Unknown provider key: "${k}".` }, { status: 400 });
    }
    if (typeof incomingKeys[k] !== 'string') {
      return json({ error: `Key for "${k}" must be a string.` }, { status: 400 });
    }
  }

  for (const s of Object.keys(incomingServices)) {
    if (!SUPPORTED_SERVICES.includes(s)) {
      return json({ error: `Unknown service key: "${s}".` }, { status: 400 });
    }
    if (typeof incomingServices[s] !== 'string') {
      return json({ error: `Key for "${s}" must be a string.` }, { status: 400 });
    }
  }

  if (!Array.isArray(keysToClear)) {
    return json({ error: 'keysToClear must be an array.' }, { status: 400 });
  }
  for (const k of keysToClear) {
    if (!SUPPORTED_PROVIDERS.includes(k)) {
      return json({ error: `Unknown provider in keysToClear: "${k}".` }, { status: 400 });
    }
  }

  if (!Array.isArray(servicesToClear)) {
    return json({ error: 'servicesToClear must be an array.' }, { status: 400 });
  }
  for (const s of servicesToClear) {
    if (!SUPPORTED_SERVICES.includes(s)) {
      return json({ error: `Unknown service in servicesToClear: "${s}".` }, { status: 400 });
    }
  }

  for (const slot of Object.keys(incomingSlots)) {
    if (!SUPPORTED_SLOTS.includes(slot)) {
      return json({ error: `Unknown slot: "${slot}". Supported: ${SUPPORTED_SLOTS.join(', ')}.` }, { status: 400 });
    }
    const provider = incomingSlots[slot]?.provider;
    if (provider && !SUPPORTED_PROVIDERS.includes(provider)) {
      return json({ error: `Unknown provider for slot "${slot}": "${provider}". Supported: ${SUPPORTED_PROVIDERS.join(', ')}.` }, { status: 400 });
    }
  }

  // Validate search.provider — only validated when present; blank/missing clears.
  const incomingSearch = body.search ?? null;
  if (incomingSearch !== null && incomingSearch !== undefined) {
    if (typeof incomingSearch !== 'object') {
      return json({ error: 'search must be an object.' }, { status: 400 });
    }
    const sp = incomingSearch.provider;
    if (sp !== undefined && sp !== '' && !SUPPORTED_SEARCH_PROVIDERS.includes(sp)) {
      return json({ error: `Unknown search provider: "${sp}". Supported: ${SUPPORTED_SEARCH_PROVIDERS.join(', ')}.` }, { status: 400 });
    }
  }

  // Validate assistantName — only validated when present; blank/missing clears.
  const incomingAssistantName = body.assistantName;
  if (incomingAssistantName !== undefined) {
    if (typeof incomingAssistantName !== 'string') {
      return json({ error: 'assistantName must be a string.' }, { status: 400 });
    }
    if (incomingAssistantName.trim().length > ASSISTANT_NAME_MAX) {
      return json({ error: `assistantName must be ≤ ${ASSISTANT_NAME_MAX} characters.` }, { status: 400 });
    }
  }

  // Load existing settings so we can merge (not replace) missing fields.
  const existing = readSettings();
  const mergedKeys = { ...(existing.keys ?? {}), ...incomingKeys };
  const mergedServices = { ...(existing.services ?? {}), ...incomingServices };
  const mergedSlots = { ...(existing.slots ?? {}) };

  for (const [slotKey, slotVal] of Object.entries(incomingSlots)) {
    mergedSlots[slotKey] = {
      ...(mergedSlots[slotKey] ?? {}),
      ...slotVal,
    };
    // Remove blank slot fields so we don't override env with empty string.
    for (const field of ['provider', 'model']) {
      if (!mergedSlots[slotKey][field]) delete mergedSlots[slotKey][field];
    }
    if (Object.keys(mergedSlots[slotKey]).length === 0) delete mergedSlots[slotKey];
  }

  // Remove blank keys so they don't shadow env values with empty strings.
  // Backwards-compatible: submitting '' for a key clears it from settings.json.
  // New callers should use keysToClear / servicesToClear instead.
  for (const k of Object.keys(mergedKeys)) {
    if (!mergedKeys[k] || !mergedKeys[k].trim()) delete mergedKeys[k];
  }
  for (const s of Object.keys(mergedServices)) {
    if (!mergedServices[s] || !mergedServices[s].trim()) delete mergedServices[s];
  }

  // Explicitly clear keys/services requested by the caller.
  for (const k of keysToClear) {
    delete mergedKeys[k];
  }
  for (const s of servicesToClear) {
    delete mergedServices[s];
  }

  // Merge search.provider — only touch when the caller included it. Blank
  // string clears the override (env value resumes).
  const mergedSearch = { ...(existing.search ?? {}) };
  if (incomingSearch !== null && incomingSearch !== undefined && incomingSearch.provider !== undefined) {
    if (incomingSearch.provider) mergedSearch.provider = incomingSearch.provider;
    else delete mergedSearch.provider;
  }

  // Merge assistantName — same rules as search.
  let mergedAssistantName = existing.assistantName;
  if (incomingAssistantName !== undefined) {
    const trimmed = incomingAssistantName.trim();
    if (trimmed) mergedAssistantName = trimmed;
    else mergedAssistantName = undefined;
  }

  const updated = {
    keys: mergedKeys,
    services: mergedServices,
    slots: mergedSlots,
    ...(Object.keys(mergedSearch).length > 0 ? { search: mergedSearch } : {}),
    ...(mergedAssistantName ? { assistantName: mergedAssistantName } : {}),
  };
  writeSettings(updated);

  return json({ ok: true, settingsView: redactSettings(updated) });
}
