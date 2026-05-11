import { json } from '@sveltejs/kit';
import { readSettings, writeSettings, redactSettings, SUPPORTED_PROVIDERS } from '$lib/server/settings.js';

const SUPPORTED_SLOTS = ['default', 'research'];

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
  const incomingSlots = body.slots ?? {};
  const keysToClear = body.keysToClear ?? [];

  for (const k of Object.keys(incomingKeys)) {
    if (!SUPPORTED_PROVIDERS.includes(k)) {
      return json({ error: `Unknown provider key: "${k}".` }, { status: 400 });
    }
    if (typeof incomingKeys[k] !== 'string') {
      return json({ error: `Key for "${k}" must be a string.` }, { status: 400 });
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

  for (const slot of Object.keys(incomingSlots)) {
    if (!SUPPORTED_SLOTS.includes(slot)) {
      return json({ error: `Unknown slot: "${slot}". Supported: ${SUPPORTED_SLOTS.join(', ')}.` }, { status: 400 });
    }
    const provider = incomingSlots[slot]?.provider;
    if (provider && !SUPPORTED_PROVIDERS.includes(provider)) {
      return json({ error: `Unknown provider for slot "${slot}": "${provider}". Supported: ${SUPPORTED_PROVIDERS.join(', ')}.` }, { status: 400 });
    }
  }

  // Load existing settings so we can merge (not replace) missing fields.
  const existing = readSettings();
  const mergedKeys = { ...(existing.keys ?? {}), ...incomingKeys };
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
  // New callers should use keysToClear instead.
  for (const k of Object.keys(mergedKeys)) {
    if (!mergedKeys[k] || !mergedKeys[k].trim()) delete mergedKeys[k];
  }

  // Explicitly clear keys requested via keysToClear.
  for (const k of keysToClear) {
    delete mergedKeys[k];
  }

  const updated = { keys: mergedKeys, slots: mergedSlots };
  writeSettings(updated);

  return json({ ok: true, settingsView: redactSettings(updated) });
}
