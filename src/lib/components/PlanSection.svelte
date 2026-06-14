<script>
  import { invalidate } from '$app/navigation';
  import ConfirmModal from '$lib/components/ConfirmModal.svelte';
  import StopCard from '$lib/components/StopCard.svelte';
  import LodgingCard from '$lib/components/LodgingCard.svelte';
  import HideToast from '$lib/components/HideToast.svelte';
  import { failureSentence } from '$lib/errors-registry.js';
  import { formatDayHeader } from '$lib/format-date.js';
  import { nudgeJobsPoll } from '$lib/utils/jobs-store.js';
  import { driveConnectorLabel } from '$lib/utils/drive-connector.js';

  let { plan, candidates, slug, destination = null, readonly = false, working = $bindable(false) } = $props();

  // ── Confirm modal ──
  let confirmOpen = $state(false);
  let confirmOpts = $state({});
  let confirmResolve = null;

  function showConfirm(opts) {
    if (confirmResolve) confirmResolve(false);
    return new Promise((resolve) => {
      confirmResolve = resolve;
      confirmOpts = opts;
      confirmOpen = true;
    });
  }

  function candidateById(id) {
    return (
      candidates?.stops.find((s) => s.id === id) ||
      candidates?.lodging.find((l) => l.id === id)
    );
  }

  const promotedStopIds = $derived.by(() => {
    const ids = new Set();
    for (const day of plan?.days ?? []) {
      for (const s of day.stops ?? []) {
        const id = typeof s === 'string' ? s : s.id;
        if (id) ids.add(id);
      }
    }
    return ids;
  });

  const prepStops = $derived.by(() =>
    (candidates?.stops ?? []).filter(
      (s) => promotedStopIds.has(s.id) && (s.tips?.length || s.todos?.length),
    ),
  );

  const prepTotal = $derived(
    prepStops.reduce((n, s) => n + (s.todos?.length ?? 0), 0),
  );
  const prepDone = $derived(
    prepStops.reduce((n, s) => n + (s.todos?.filter((t) => t.done).length ?? 0), 0),
  );

  // ── UI state ──
  let pickerOpen = $state(null); // day number or `lodging:${n}` (legacy click-fallback)
  // Per-day actions menu (⋯). Holds the open day number or null. Destructive
  // day removal lives here rather than as a bare × in the header, matching the
  // detail page's lifecycle-menu pattern and reserving × for "remove an item".
  let dayMenuOpen = $state(/** @type {number | null} */ (null));
  // Per-day "arrange" mode. When set to a day number, that day's stops reveal
  // their reorder / move / remove toolbar; at rest the cards are pure identity.
  // Only one day arranges at a time.
  let arrangingDay = $state(/** @type {number | null} */ (null));
  // Cross-day move picker for touch / keyboard users (the drag-handle
  // affordance is hidden on coarse pointers). Holds the stop being moved.
  let movePickerFor = $state(/** @type {null | { dayNumber: number, stopId: string }} */ (null));
  // Per-field inline editing: { dayNumber, field } where field is 'date' | 'drive' | 'notes'.
  // The brief calls for editing one field at a time rather than the previous
  // shared-form pattern that bundled all three.
  let editingField = $state(/** @type {null | { dayNumber: number, field: 'date'|'drive'|'notes' }} */ (null));
  let editDraft = $state(/** @type {any} */ (null));
  let errorCode = $state(/** @type {string|null} */ (null));
  let errorCtx = $state(/** @type {Record<string,string>} */ ({}));

  // Hide-with-undo toast for stop removal + lodging clear, mirroring
  // CandidatesSection. `kind` discriminates how Undo restores the item.
  let hideToast = $state(/** @type {{ kind: 'stop'|'lodging'|'move', dayNumber?: number, candidateId?: string, name: string, fromDay?: number, toDay?: number, stopId?: string } | null} */ (null));
  let hideToastTimer = null;

  // ── Drag-drop state ──
  // dragOverDay: day number currently hovered with a drag payload.
  // dragOverLodging: same, but specifically over the lodging slot (a more
  // precise drop target that fires for lodging payloads only).
  // dragEnterCounts defeats the dragleave-on-child-boundary flicker.
  let dragOverDay = $state(null);
  let dragOverLodging = $state(null);
  let activeDragType = $state(/** @type {'stop'|'lodging'|null} */ (null));
  const dragEnterCounts = new Map();

  function onDayDragEnter(dayNumber, e) {
    e.preventDefault();
    const next = (dragEnterCounts.get(dayNumber) || 0) + 1;
    dragEnterCounts.set(dayNumber, next);
    dragOverDay = dayNumber;
    // Sniff the payload type from the dataTransfer types list (the JSON
    // payload itself is gated by the browser until drop, but the MIME
    // entry is visible during dragover).
    if (e.dataTransfer?.types?.includes('application/x-traverse-candidate')) {
      // We can't read the payload yet; default to 'stop' visually and
      // let the actual drop handler distinguish.
      activeDragType = activeDragType ?? 'stop';
    }
  }

  function onDayDragLeave(dayNumber) {
    const next = (dragEnterCounts.get(dayNumber) || 1) - 1;
    if (next <= 0) {
      dragEnterCounts.delete(dayNumber);
      if (dragOverDay === dayNumber) dragOverDay = null;
      if (dragEnterCounts.size === 0) activeDragType = null;
    } else {
      dragEnterCounts.set(dayNumber, next);
    }
  }

  function onLodgingDragEnter(dayNumber, e) {
    e.preventDefault();
    e.stopPropagation();
    dragOverLodging = dayNumber;
    activeDragType = 'lodging';
  }
  function onLodgingDragLeave(dayNumber, e) {
    e.stopPropagation();
    if (dragOverLodging === dayNumber) dragOverLodging = null;
  }

  async function onDayDrop(dayNumber, e) {
    e.preventDefault();
    dragEnterCounts.delete(dayNumber);
    dragOverDay = null;
    dragOverLodging = null;
    activeDragType = null;

    // Cross-day reorder takes priority: if the drag source is one of our
    // own stop rows and it landed on a different day card, perform a
    // move (DELETE source + POST target). Same-day drops on the day-card
    // background (not on a stop row) are a no-op — the within-row drop
    // handler owns same-day reorder. Reorder + non-stop-row + same day
    // shouldn't normally fire because the row handler stops propagation.
    let reorder = null;
    try {
      const raw = e.dataTransfer?.getData('application/x-traverse-reorder');
      if (raw) reorder = JSON.parse(raw);
    } catch { /* tolerate */ }
    if (reorder?.stopId && Number.isFinite(reorder.dayNumber)) {
      if (reorder.dayNumber === dayNumber) {
        // Same-day drop on the day background — within-row handler should
        // have taken it. Drop fell through; treat as no-op.
        reorderDrag = null;
        reorderOverIdx = null;
        return;
      }
      await moveStopAcrossDays(reorder.dayNumber, dayNumber, reorder.stopId);
      reorderDrag = null;
      reorderOverIdx = null;
      return;
    }

    // Otherwise, this is a cross-card drop from CandidatesSection.
    let payload = null;
    try {
      const raw = e.dataTransfer?.getData('application/x-traverse-candidate');
      if (raw) payload = JSON.parse(raw);
    } catch { /* fall through to text/plain id-only path */ }
    if (!payload?.id) {
      const id = e.dataTransfer?.getData('text/plain');
      if (!id) return;
      const isStop = (candidates?.stops ?? []).some((s) => s.id === id);
      const isLodging = (candidates?.lodging ?? []).some((l) => l.id === id);
      payload = { id, type: isStop ? 'stop' : (isLodging ? 'lodging' : null) };
    }
    if (!payload?.type) return;
    if (payload.type === 'stop') await addStop(dayNumber, payload.id);
    else if (payload.type === 'lodging') await setLodging(dayNumber, payload.id);
  }

  /**
   * Move a stop from one day to another via the atomic server endpoint.
   * The plan.md write happens in a single pass on the server (see
   * moveStopToDay in plan.js), so the client doesn't have to design
   * around partial-failure semantics — it's either entirely succeeded
   * or entirely failed.
   */
  async function moveStopAcrossDays(fromDay, toDay, stopId) {
    const ok = await api(`/api/plan/${slug}/move-stop`, {
      method: 'POST',
      body: JSON.stringify({ fromDay, toDay, stopId }),
    });
    // Moves are reversible like removals — surface an undo toast so a one-tap
    // (or accidental drag) relocation can be taken back. Applies to every move
    // path: direct one-tap, picker, and cross-day drag-drop.
    if (ok) {
      const cand = candidateById(stopId);
      queueHideToast({ kind: 'move', name: cand?.name ?? stopId, fromDay, toDay, stopId });
    }
    return ok;
  }

  // Touch-flow path for cross-day move: open the picker, then select a
  // target day. Drag-handle equivalents on coarse pointers; desktop users
  // hit this path via keyboard too (the button is accessible at all
  // pointer types — just visually de-emphasized when drag is the
  // expected primary gesture).
  function openMovePicker(dayNumber, stopId) {
    movePickerFor = { dayNumber, stopId };
  }
  function closeMovePicker() {
    movePickerFor = null;
  }
  // "Move" tap handler. With only one other day there's a single possible
  // destination, so skip the picker and move directly; otherwise toggle the
  // day picker. Avoids a one-option Hobson's-choice list on short trips.
  function startMove(dayNumber, stopId) {
    const others = (plan?.days ?? []).filter((d) => d.number !== dayNumber);
    if (others.length === 1) {
      if (movePickerFor) closeMovePicker();
      moveStopAcrossDays(dayNumber, others[0].number, stopId);
      return;
    }
    if (movePickerFor?.stopId === stopId && movePickerFor?.dayNumber === dayNumber) {
      closeMovePicker();
    } else {
      openMovePicker(dayNumber, stopId);
    }
  }
  async function moveViaPicker(toDay) {
    if (!movePickerFor) return;
    const { dayNumber: fromDay, stopId } = movePickerFor;
    movePickerFor = null;
    await moveStopAcrossDays(fromDay, toDay, stopId);
  }

  async function onLodgingDrop(dayNumber, e) {
    e.preventDefault();
    e.stopPropagation();
    dragOverLodging = null;
    dragOverDay = null;
    activeDragType = null;
    dragEnterCounts.clear();
    let payload = null;
    try {
      const raw = e.dataTransfer?.getData('application/x-traverse-candidate');
      if (raw) payload = JSON.parse(raw);
    } catch { /* tolerate */ }
    if (!payload?.id) {
      const id = e.dataTransfer?.getData('text/plain');
      if (!id) return;
      const isLodging = (candidates?.lodging ?? []).some((l) => l.id === id);
      payload = { id, type: isLodging ? 'lodging' : null };
    }
    // Lodging slot only accepts lodging payloads; a stop dropped here
    // gets routed to the day-card handler instead (caller decides).
    if (payload?.type !== 'lodging') return;
    await setLodging(dayNumber, payload.id);
  }

  // Within-day stop reorder via drag handle. The drag source is a stop
  // row inside this PlanSection; the drop target is another stop row in
  // the same day for reorder, OR another day card for a cross-day move
  // (routed to moveStopAcrossDays via the atomic /move-stop endpoint).
  // Cross-card drag-from-Candidates still works via onDayDrop.
  let reorderDrag = $state(/** @type {{ dayNumber: number, stopId: string, fromIdx: number } | null} */ (null));
  let reorderOverIdx = $state(null);

  function onStopDragStart(dayNumber, stopId, idx, e) {
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'move';
    // Use a different MIME so cross-card drops from Candidates don't
    // collide with same-card reorders.
    e.dataTransfer.setData('application/x-traverse-reorder', JSON.stringify({ dayNumber, stopId, fromIdx: idx }));
    e.dataTransfer.setData('text/plain', stopId);
    reorderDrag = { dayNumber, stopId, fromIdx: idx };
  }
  function onStopDragEnd() {
    reorderDrag = null;
    reorderOverIdx = null;
  }
  function onStopDragOver(dayNumber, idx, e) {
    if (!reorderDrag || reorderDrag.dayNumber !== dayNumber) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    reorderOverIdx = idx;
  }
  async function onStopDrop(dayNumber, dropIdx, e) {
    if (!reorderDrag || reorderDrag.dayNumber !== dayNumber) return;
    e.preventDefault();
    e.stopPropagation();
    const { stopId, fromIdx } = reorderDrag;
    reorderDrag = null;
    reorderOverIdx = null;
    if (fromIdx === dropIdx) return;
    const day = plan.days.find((d) => d.number === dayNumber);
    if (!day) return;
    const order = [...day.stops];
    order.splice(fromIdx, 1);
    // After removing, the insertion index shifts by 1 if fromIdx < dropIdx
    const insertAt = fromIdx < dropIdx ? dropIdx - 1 : dropIdx;
    order.splice(insertAt, 0, stopId);
    await api(`/api/plan/${slug}/day/${dayNumber}/stops`, {
      method: 'PUT',
      body: JSON.stringify({ order }),
    });
  }

  // Touch-friendly within-day reorder. Drag handles don't fire on coarse
  // pointers, so the ↑/↓ buttons next to each stop are the primary gesture
  // on mobile. Same endpoint as the drag drop, just constructed from idx
  // shifts instead of a drop target.
  async function nudgeStop(dayNumber, fromIdx, direction) {
    const day = plan.days.find((d) => d.number === dayNumber);
    if (!day) return;
    const toIdx = fromIdx + direction;
    if (toIdx < 0 || toIdx >= day.stops.length) return;
    const order = [...day.stops];
    const [moved] = order.splice(fromIdx, 1);
    order.splice(toIdx, 0, moved);
    await api(`/api/plan/${slug}/day/${dayNumber}/stops`, {
      method: 'PUT',
      body: JSON.stringify({ order }),
    });
  }

  // ── API plumbing ──
  async function api(path, opts) {
    working = true;
    errorCode = null;
    errorCtx = {};
    try {
      const res = await fetch(path, {
        headers: { 'content-type': 'application/json' },
        ...opts,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        errorCode = body.code || 'action_failed';
        errorCtx = body.context || { action: 'update the plan' };
        return false;
      }
      await invalidate('app:trip');
      return true;
    } catch {
      errorCode = 'network_error';
      return false;
    } finally {
      working = false;
    }
  }

  async function toggleTodo(stopId, todoId, done) {
    await api(`/api/candidates/${slug}/stops/${stopId}/todos/${todoId}`, {
      method: 'PATCH',
      body: JSON.stringify({ done }),
    });
  }

  async function startStopPrep(force = false) {
    const ok = await api(`/api/actions/stop-prep/${slug}`, {
      method: 'POST',
      body: JSON.stringify({ force }),
    });
    // stop-prep is an Ambient Background job (202). Nudge the jobs poll so the
    // global pill / per-trip badge pick it up immediately instead of waiting
    // out the 10s poll interval.
    if (ok) nudgeJobsPoll();
  }

  async function confirmRegenerate() {
    const ok = await showConfirm({
      title: 'Re-generate all prep?',
      body: 'This clears every check-off and regenerates tips and to-dos for all stops.',
      confirmLabel: 'Re-generate',
      danger: true,
    });
    if (!ok) return;
    await startStopPrep(true);
  }

  export async function addDay() {
    await api(`/api/plan/${slug}`, { method: 'POST' });
  }

  async function removeDay(n) {
    const ok = await showConfirm({
      title: `Remove Day ${n}?`,
      body: 'Stops assigned to this day will return to the candidates pool.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    await api(`/api/plan/${slug}/day/${n}`, { method: 'DELETE' });
  }

  async function addStop(dayNumber, candidateId) {
    await api(`/api/plan/${slug}/day/${dayNumber}/stops`, {
      method: 'POST',
      body: JSON.stringify({ id: candidateId }),
    });
    pickerOpen = null;
  }

  async function removeStopWithUndo(dayNumber, id) {
    const cand = candidateById(id);
    const name = cand?.name ?? id;
    const ok = await api(`/api/plan/${slug}/day/${dayNumber}/stops/${id}`, {
      method: 'DELETE',
    });
    if (ok) queueHideToast({ kind: 'stop', dayNumber, candidateId: id, name });
  }

  async function setLodging(dayNumber, candidateId) {
    await api(`/api/plan/${slug}/day/${dayNumber}/lodging`, {
      method: 'PUT',
      body: JSON.stringify({ id: candidateId }),
    });
    pickerOpen = null;
  }

  // Clear a day's lodging with an undo toast — matches the stop-removal
  // safety model so a fat-finger tap on the lodging × isn't an
  // unrecoverable wipe of a chosen stay (the previous behavior cleared
  // it silently and immediately).
  async function clearLodgingWithUndo(dayNumber) {
    const day = plan.days.find((d) => d.number === dayNumber);
    const priorId = day?.lodging_id;
    if (!priorId) return;
    const cand = candidateById(priorId);
    const name = cand?.name ?? priorId;
    const ok = await api(`/api/plan/${slug}/day/${dayNumber}/lodging`, {
      method: 'PUT',
      body: JSON.stringify({ id: null }),
    });
    if (ok) queueHideToast({ kind: 'lodging', dayNumber, candidateId: priorId, name });
  }

  async function saveField(dayNumber, patch) {
    await api(`/api/plan/${slug}/day/${dayNumber}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    editingField = null;
    editDraft = null;
  }

  function startEdit(dayNumber, field) {
    const day = plan.days.find((d) => d.number === dayNumber);
    if (!day) return;
    editingField = { dayNumber, field };
    if (field === 'date') editDraft = day.date ?? '';
    else if (field === 'drive') editDraft = day.drive_distance_mi ?? '';
    else if (field === 'notes') editDraft = day.notes ?? '';
  }
  function cancelEdit() {
    editingField = null;
    editDraft = null;
  }
  async function commitEdit() {
    if (!editingField) return;
    const { dayNumber, field } = editingField;
    if (field === 'date') {
      await saveField(dayNumber, { date: editDraft || null });
    } else if (field === 'drive') {
      const n = editDraft === '' || editDraft == null ? null : Number(editDraft);
      await saveField(dayNumber, { drive_distance_mi: Number.isFinite(n) ? n : null });
    } else if (field === 'notes') {
      await saveField(dayNumber, { notes: editDraft ?? '' });
    }
  }

  // ── Hide toast (stop removal) ──
  function queueHideToast(entry) {
    if (hideToastTimer) { clearTimeout(hideToastTimer); hideToastTimer = null; }
    hideToast = entry;
    hideToastTimer = setTimeout(() => {
      hideToast = null;
      hideToastTimer = null;
    }, 5000);
  }
  async function undoHide() {
    if (!hideToast) return;
    const { kind, dayNumber, candidateId, fromDay, toDay, stopId } = hideToast;
    hideToast = null;
    if (hideToastTimer) { clearTimeout(hideToastTimer); hideToastTimer = null; }
    if (kind === 'move') {
      // Move the stop back to the day it came from.
      await api(`/api/plan/${slug}/move-stop`, {
        method: 'POST',
        body: JSON.stringify({ fromDay: toDay, toDay: fromDay, stopId }),
      });
    } else if (kind === 'lodging') {
      // Re-assign the lodging we just cleared.
      await api(`/api/plan/${slug}/day/${dayNumber}/lodging`, {
        method: 'PUT',
        body: JSON.stringify({ id: candidateId }),
      });
    } else {
      // Re-promote: same endpoint that promotes candidates into days.
      await api(`/api/plan/${slug}/promote`, {
        method: 'POST',
        body: JSON.stringify({ id: candidateId, day: dayNumber }),
      });
    }
  }
  function dismissHideToast() {
    hideToast = null;
    if (hideToastTimer) { clearTimeout(hideToastTimer); hideToastTimer = null; }
  }

  // ── Picker helpers (click fallback for promote/lodging) ──
  function unpromotedStops() {
    const inPlan = new Set();
    for (const d of plan?.days ?? []) for (const s of d.stops) inPlan.add(s);
    return (candidates?.stops ?? []).filter((s) => !inPlan.has(s.id) && !s.hidden);
  }
  // Lodging is intentionally NOT filtered by "already used in another day".
  // The common pattern is staying at the same place for consecutive nights,
  // so prior assignment in other days shouldn't remove a candidate from
  // the picker. The server side (setLodgingForDay in plan.js) allows the
  // same lodging_id on multiple days without complaint.
  function unpromotedLodging() {
    return (candidates?.lodging ?? []).filter((l) => !l.hidden);
  }

  // ── Display helpers ──
  // Day header formatting is shared with CandidatesSection via the
  // format-date util — see src/lib/format-date.js for the format rules.

  // Haversine in miles for the distance chip on each compact StopCard.
  function distanceMi(a, b) {
    if (!a || !b) return null;
    const lat1 = Number(a.lat), lng1 = Number(a.lng);
    const lat2 = Number(b.lat), lng2 = Number(b.lng);
    if (!Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)) return null;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 3959;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const x = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(x)));
  }

</script>

<svelte:window onpointerdown={(e) => {
  if (dayMenuOpen == null) return;
  if (!e.target?.closest?.('.day-menu-wrap')) dayMenuOpen = null;
}} />

{#if errorCode}
  <div class="banner-error" role="alert">
    <span>{failureSentence(errorCode, errorCtx)}</span>
    <button type="button" class="banner-dismiss" onclick={() => { errorCode = null; }}>Dismiss</button>
  </div>
{/if}

{#if !plan}
  <div class="empty">
    <p>Plan will appear after extraction completes.</p>
  </div>
{:else if plan.days.length === 0}
  <!-- Ghost-preview empty state — mirrors CandidatesSection so the two
       adjacent sections share a visual vocabulary in the empty path. -->
  <div class="empty-pre">
    <div class="ghost-preview" aria-hidden="true">
      <div class="ghost-day-card"></div>
      <div class="ghost-day-card"></div>
    </div>
    <p class="empty-line">
      Drag a stop from Candidates to start Day 1, or use the button below to outline first.
    </p>
    <button class="btn-inline add-day-empty" onclick={addDay} disabled={working || readonly}>+ Add Day 1</button>
  </div>
{:else}
  {#if prepStops.length > 0}
    <div class="trip-prep">
      <div class="trip-prep-head">
        <h3>Trip prep</h3>
        <span class="count">{prepDone} of {prepTotal} done</span>
        {#if !readonly}
          <div class="trip-prep-actions">
            <button type="button" class="prep-chip" disabled={working} onclick={() => startStopPrep(false)}>
              Refresh prep
            </button>
            <button type="button" class="prep-chip" disabled={working} onclick={confirmRegenerate}>
              Re-generate all
            </button>
          </div>
        {/if}
      </div>
      {#if prepTotal > 0}
        <div class="trip-prep-bar" role="progressbar" aria-valuenow={prepDone} aria-valuemin={0} aria-valuemax={prepTotal} aria-label="Trip prep: {prepDone} of {prepTotal} done">
          <div class="trip-prep-bar-fill" style="width: {Math.round((prepDone / prepTotal) * 100)}%"></div>
        </div>
      {/if}
    </div>
  {/if}
  {#each plan.days as day (day.number)}
    {@const header = formatDayHeader(day)}
    <article
      class="day-card"
      class:arranging={arrangingDay === day.number}
      class:drop-target-active={dragOverDay === day.number && reorderDrag?.dayNumber !== day.number}
      class:drop-stop={dragOverDay === day.number && activeDragType !== 'lodging' && reorderDrag?.dayNumber !== day.number}
      class:drop-lodging={dragOverDay === day.number && activeDragType === 'lodging'}
      ondragenter={(e) => onDayDragEnter(day.number, e)}
      ondragover={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; }}
      ondragleave={() => onDayDragLeave(day.number)}
      ondrop={(e) => onDayDrop(day.number, e)}
    >
      <header class="day-header">
        <div class="day-anchor">
          <h3 class="day-primary">{header.primary}</h3>
          {#if header.secondary}<span class="day-secondary">{header.secondary}</span>{/if}
        </div>

        {#if editingField?.dayNumber === day.number && editingField.field === 'drive'}
          <span class="field-edit field-edit--drive">
            <input
              type="number"
              class="field-input"
              bind:value={editDraft}
              placeholder="mi"
              onkeydown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
              onblur={commitEdit}
            />
            <span class="field-suffix">mi</span>
          </span>
        {:else if day.drive_distance_mi}
          <button
            type="button"
            class="chip chip--drive"
            onclick={() => startEdit(day.number, 'drive')}
            disabled={readonly}
            title="Edit drive distance"
          >~{day.drive_distance_mi} mi</button>
        {:else if !readonly}
          <button
            type="button"
            class="chip chip--drive chip--placeholder"
            onclick={() => startEdit(day.number, 'drive')}
            title="Add drive distance"
          >+ drive</button>
        {/if}

        {#if editingField?.dayNumber === day.number && editingField.field === 'date'}
          <span class="field-edit field-edit--date">
            <input
              type="date"
              class="field-input"
              bind:value={editDraft}
              onkeydown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
              onblur={commitEdit}
            />
          </span>
        {:else if !day.date && !readonly}
          <button
            type="button"
            class="chip chip--date chip--placeholder"
            onclick={() => startEdit(day.number, 'date')}
            title="Add date"
          >+ date</button>
        {/if}

        {#if !readonly}
          {#if arrangingDay === day.number}
            <button
              type="button"
              class="btn-inline btn-primary day-done"
              onclick={() => { arrangingDay = null; }}
            >Done</button>
          {:else}
            <div class="day-menu-wrap">
              <button
                type="button"
                class="btn-inline btn-icon header-icon"
                onclick={(e) => { e.stopPropagation(); dayMenuOpen = dayMenuOpen === day.number ? null : day.number; }}
                disabled={working}
                aria-label="Day actions"
                aria-haspopup="menu"
                aria-expanded={dayMenuOpen === day.number}
                title="Day actions"
              >⋯</button>
              {#if dayMenuOpen === day.number}
                <div class="day-menu" role="menu">
                  {#if day.stops.length > 0}
                    <button
                      type="button"
                      role="menuitem"
                      class="day-menu-item"
                      onclick={() => { dayMenuOpen = null; arrangingDay = day.number; }}
                      disabled={working}
                    >Arrange stops</button>
                  {/if}
                  <button
                    type="button"
                    role="menuitem"
                    class="day-menu-item day-menu-item--danger"
                    onclick={() => { dayMenuOpen = null; removeDay(day.number); }}
                    disabled={working}
                  >Remove day</button>
                </div>
              {/if}
            </div>
          {/if}
        {/if}
      </header>

      <!-- Notes at rest — first-class field, not edit-only as before. -->
      {#if editingField?.dayNumber === day.number && editingField.field === 'notes'}
        <div class="notes-edit">
          <textarea
            class="notes-textarea"
            bind:value={editDraft}
            rows="3"
            placeholder="What's the shape of this day?"
            onkeydown={(e) => { if (e.key === 'Escape') cancelEdit(); }}
          ></textarea>
          <div class="notes-edit-actions">
            <button class="btn-inline btn-primary" onclick={commitEdit} disabled={working || readonly}>Save</button>
            <button class="btn-inline" onclick={cancelEdit} disabled={working || readonly}>Cancel</button>
          </div>
        </div>
      {:else if day.notes}
        {#if readonly}
          <p class="notes notes--readonly">{day.notes}</p>
        {:else}
          <button
            type="button"
            class="notes notes--editable"
            onclick={() => startEdit(day.number, 'notes')}
            aria-label="Edit notes for {header.primary}"
          >
            <span class="notes-body">{day.notes}</span>
            <span class="notes-edit-hint" aria-hidden="true">edit</span>
          </button>
        {/if}
      {:else if !readonly}
        <button
          type="button"
          class="notes-add"
          onclick={() => startEdit(day.number, 'notes')}
        >+ Add notes</button>
      {/if}

      <!-- Stops list — compact StopCards instead of bare flexbox rows. -->
      {#if day.stops.length > 0}
        <ul class="stops-list" role="list" aria-busy={working}>
          {#each day.stops as id, i (id)}
            {@const cand = candidateById(id)}
            {#if i > 0}
              {@const prevId = day.stops[i - 1]}
              {@const prevCand = candidateById(prevId)}
              {@const seg = (prevCand?.drive_to_next?.mi > 0)
                ? prevCand.drive_to_next
                : { mi: distanceMi(prevCand?.coords, cand?.coords) }}
              {@const connLabel = driveConnectorLabel(seg)}
              {#if connLabel}
                <li class="drive-connector" aria-hidden="true">{connLabel}</li>
              {/if}
            {/if}
            <li
              class="stop-row"
              class:reorder-target={reorderOverIdx === i && reorderDrag?.dayNumber === day.number}
              ondragover={(e) => onStopDragOver(day.number, i, e)}
              ondrop={(e) => onStopDrop(day.number, i, e)}
            >
              {#if cand}
                {#if cand.id && candidates?.stops?.find((s) => s.id === id)}
                  <div class="stop-row-controls">
                    <StopCard
                      stop={cand}
                      compact={true}
                      promoted={true}
                      distance={null}
                      {readonly}
                      {working}
                      ondragstart={() => onStopDragStart(day.number, id, i, event)}
                      ondragend={onStopDragEnd}
                      onToggleTodo={(todoId, done) => toggleTodo(cand.id, todoId, done)}
                    />
                    {#if arrangingDay === day.number && !readonly}
                      <div class="arrange-toolbar" role="group" aria-label="Arrange {cand.name}">
                        {#if day.stops.length > 1}
                          <button
                            type="button"
                            class="nudge-btn"
                            onclick={() => nudgeStop(day.number, i, -1)}
                            aria-label="Move {cand.name} up"
                            title="Move up"
                            disabled={working || i === 0}
                          >↑</button>
                          <button
                            type="button"
                            class="nudge-btn"
                            onclick={() => nudgeStop(day.number, i, +1)}
                            aria-label="Move {cand.name} down"
                            title="Move down"
                            disabled={working || i === day.stops.length - 1}
                          >↓</button>
                        {/if}
                        {#if plan.days.length > 1}
                          <button
                            type="button"
                            class="move-btn"
                            class:active={movePickerFor?.stopId === id && movePickerFor?.dayNumber === day.number}
                            onclick={() => startMove(day.number, id)}
                            aria-label="Move {cand.name} to a different day"
                            title="Move to another day"
                            disabled={working}
                          >Move</button>
                        {/if}
                        <button
                          type="button"
                          class="arrange-remove"
                          onclick={() => removeStopWithUndo(day.number, id)}
                          aria-label="Remove {cand.name} from this day"
                          title="Remove from this day"
                          disabled={working}
                        >✕</button>
                      </div>
                    {/if}
                  </div>
                  {#if movePickerFor?.stopId === id && movePickerFor?.dayNumber === day.number}
                    <div class="move-picker" role="group" aria-label="Move {cand.name} to which day">
                      <p class="move-picker-head">Move <strong>{cand.name}</strong> to…</p>
                      {#each plan.days.filter((d) => d.number !== day.number) as target (target.number)}
                        {@const targetHeader = formatDayHeader(target)}
                        <button
                          type="button"
                          class="move-picker-item"
                          onclick={() => moveViaPicker(target.number)}
                          disabled={working}
                        >
                          <span class="move-picker-primary">{targetHeader.primary}</span>
                          {#if targetHeader.secondary}<span class="move-picker-secondary">{targetHeader.secondary}</span>{/if}
                          <span class="move-picker-count">{target.stops.length} stop{target.stops.length === 1 ? '' : 's'}</span>
                        </button>
                      {/each}
                      <button type="button" class="move-picker-cancel" onclick={closeMovePicker}>Cancel</button>
                    </div>
                  {/if}
                {:else if candidates?.lodging?.find((l) => l.id === id)}
                  <!-- A lodging accidentally in a day's stops list is a
                       schema oddity; render as dangling so the dangling
                       banner has a path to surface it. -->
                  <div class="dangling-row" role="alert" title="Lodging in stops list. Move it to the lodging slot.">
                    ⚠ {cand.name} is filed as a stop but is a lodging
                  </div>
                {/if}
              {:else}
                <div class="dangling-row" role="alert">
                  ⚠ Missing candidate ({id})
                  <button class="btn-inline btn-icon" onclick={() => removeStopWithUndo(day.number, id)} disabled={readonly}>×</button>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      <button
        type="button"
        class="add-stop"
        onclick={() => (pickerOpen = pickerOpen === day.number ? null : day.number)}
        disabled={working || readonly}
      >+ Add stop</button>

      <!-- Lodging slot — its own drop target so dragging a LodgingCard
           onto a day defaults to the lodging slot. Stop payloads dropped
           anywhere on the day card route to the stops list instead. -->
      <div
        class="lodging-slot"
        class:lodging-drop-active={dragOverLodging === day.number}
        role="region"
        aria-label="Lodging for {header.primary}"
        ondragenter={(e) => onLodgingDragEnter(day.number, e)}
        ondragover={(e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; }}
        ondragleave={(e) => onLodgingDragLeave(day.number, e)}
        ondrop={(e) => onLodgingDrop(day.number, e)}
      >
        {#if day.lodging_id}
          {@const l = candidateById(day.lodging_id)}
          {#if l}
            <LodgingCard
              lodging={l}
              compact={true}
              promoted={true}
              {readonly}
              {working}
              showDragHandle={false}
              onHide={() => clearLodgingWithUndo(day.number)}
            />
          {:else}
            <div class="dangling-row" role="alert">
              ⚠ Missing lodging ({day.lodging_id})
              <button class="btn-inline btn-icon" onclick={() => setLodging(day.number, null)} disabled={readonly}>×</button>
            </div>
          {/if}
        {:else}
          <button
            type="button"
            class="lodging-empty"
            onclick={() => (pickerOpen = pickerOpen === `lodging:${day.number}` ? null : `lodging:${day.number}`)}
            disabled={working || readonly}
            aria-label="Add lodging for this day"
          >
            <span class="lodging-empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 17v-7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v7" />
                <path d="M3 14h18" />
                <path d="M3 17v3" />
                <path d="M21 17v3" />
              </svg>
            </span>
            <span class="lodging-empty-label">+ Add lodging</span>
            <span class="lodging-empty-hint">Or drag a place to stay</span>
          </button>
        {/if}
      </div>

      <!-- Click-flow pickers (kept as fallback for touch + keyboard). -->
      {#if pickerOpen === day.number}
        <div class="picker">
          <h5>Add a stop to {header.primary}</h5>
          {#each unpromotedStops() as s (s.id)}
            <button onclick={() => addStop(day.number, s.id)} class="picker-item" disabled={working || readonly}>
              <span class="picker-cat">{s.category}</span> {s.name}
            </button>
          {/each}
          {#if unpromotedStops().length === 0}
            <p class="picker-empty">All stops already in plan.</p>
          {/if}
        </div>
      {:else if pickerOpen === `lodging:${day.number}`}
        <div class="picker">
          <h5>Assign lodging to {header.primary}</h5>
          {#each unpromotedLodging() as l (l.id)}
            <button onclick={() => setLodging(day.number, l.id)} class="picker-item" disabled={working || readonly}>
              <span class="picker-cat">{l.price_tier}</span> {l.name}
            </button>
          {/each}
          {#if unpromotedLodging().length === 0}
            <p class="picker-empty">No lodging candidates yet.</p>
          {/if}
        </div>
      {/if}

      <!-- Drop label, shown only while a candidate or cross-day reorder
           is mid-drag over this day. Suppressed when the drag source
           is a stop row in THIS day (within-row reorder owns the
           visual signal via the insertion marker). -->
      {#if dragOverDay === day.number && activeDragType !== 'lodging' && reorderDrag?.dayNumber !== day.number}
        <div class="drop-label" aria-hidden="true">
          {#if reorderDrag}
            Move to {header.primary}
          {:else}
            Drop to add to {header.primary}
          {/if}
        </div>
      {/if}
    </article>
  {/each}
{/if}

<HideToast
  open={!!hideToast}
  message={hideToast
    ? (hideToast.kind === 'move'
        ? `Moved ${hideToast.name} to Day ${hideToast.toDay}.`
        : `${hideToast.kind === 'lodging' ? 'Cleared' : 'Removed'} ${hideToast.name} from Day ${hideToast.dayNumber}.`)
    : ''}
  onUndo={undoHide}
  onDismiss={dismissHideToast}
/>

<ConfirmModal
  bind:open={confirmOpen}
  title={confirmOpts.title ?? ''}
  body={confirmOpts.body ?? ''}
  confirmLabel={confirmOpts.confirmLabel ?? 'Confirm'}
  danger={confirmOpts.danger ?? false}
  onconfirm={() => { const r = confirmResolve; confirmResolve = null; r?.(true); }}
  oncancel={() => { const r = confirmResolve; confirmResolve = null; r?.(false); }}
/>

<style>
  /* ── Banner ──────────────────────────────────────────────────────────── */
  .banner-error {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.75rem;
    background: var(--state-danger-surface);
    color: var(--text-primary);
    border: 1px solid var(--state-danger);
    border-radius: 4px;
    margin-bottom: 1rem;
    font-family: var(--font-sans);
    font-size: 0.9rem;
  }
  .banner-error span { flex: 1; }
  .banner-dismiss {
    background: transparent;
    border: 0.5px solid var(--state-danger);
    color: var(--state-danger);
    font-family: var(--font-sans);
    font-size: 0.74rem;
    font-weight: 600;
    padding: 0.25rem 0.55rem;
    border-radius: 4px;
    cursor: pointer;
  }
  .banner-dismiss:hover { background: color-mix(in oklab, var(--state-danger) 8%, transparent); }

  /* ── Empty / ghost-preview ───────────────────────────────────────────── */
  .empty {
    padding: 2rem;
    text-align: center;
    color: var(--text-tertiary);
    font-family: var(--font-sans);
  }
  .empty p { margin: 0 0 0.75rem; }
  .empty-pre {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem 0.5rem;
    align-items: stretch;
  }
  .ghost-preview {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .ghost-day-card {
    height: 84px;
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    opacity: 0.5;
  }
  .ghost-day-card:nth-child(1) { opacity: 0.55; }
  .ghost-day-card:nth-child(2) { opacity: 0.35; }
  .empty-line {
    color: var(--text-tertiary);
    font-size: 0.92rem;
    line-height: 1.55;
    font-style: italic;
    text-align: center;
    padding: 0.5rem;
    margin: 0;
  }
  .add-day-empty { align-self: center; }

  /* ── Day card ───────────────────────────────────────────────────────── */
  .day-card {
    position: relative;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    /* 3px accent left edge — the signature Tier-2 day-card treatment. */
    border-left: 3px solid var(--accent);
    padding: 0.85rem 1rem 0.85rem 0.9rem;
    margin-bottom: 0.85rem;
    background: var(--surface-page);
    font-family: var(--font-sans);
    transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
  }
  /* Arrange mode — a quiet accent wash + border so it's clear which day's
     stops are currently rearrangeable. */
  .day-card.arranging {
    border-color: color-mix(in oklab, var(--accent) 35%, var(--border-subtle));
    border-left-color: var(--accent);
    background: color-mix(in oklab, var(--accent) 3%, var(--surface-page));
  }
  /* Drop target affordance — dashed inset outline + accent border + soft
     accent wash. Differentiated by payload type so the user sees what
     they're about to commit to. */
  .day-card.drop-target-active {
    border-color: var(--accent);
    border-left-color: var(--accent);
    background: color-mix(in oklab, var(--accent) 5%, var(--surface-page));
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .day-card.drop-target-active::after {
    content: '';
    position: absolute;
    inset: 6px;
    border: 1.5px dashed color-mix(in oklab, var(--accent) 60%, transparent);
    border-radius: 4px;
    pointer-events: none;
  }
  /* Drop label sits inside the day card during drag. The card already
     has accent border + accent wash + dashed inset outline doing the
     celebratory work; the pill is for the *label*, not the celebration.
     Quiet chip treatment (page surface + accent text) keeps the
     centered text readable without piling on a fourth visual signal. */
  .drop-label {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--surface-page);
    color: var(--accent-text);
    border: 1px solid color-mix(in oklab, var(--accent) 40%, var(--border-default));
    padding: 0.32rem 0.7rem;
    border-radius: 999px;
    font-family: var(--font-sans);
    font-size: 0.76rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    pointer-events: none;
    z-index: 5;
  }

  /* ── Day header ─────────────────────────────────────────────────────── */
  .day-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.65rem;
    flex-wrap: wrap;
  }
  .day-anchor {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
  }
  .day-primary {
    margin: 0;
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: 0.005em;
  }
  /* "Day N" secondary label — rendered as a quiet pill badge beside the
     date so the day number is always visible even on date-labelled cards. */
  .day-secondary {
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    color: var(--accent-text);
    background: color-mix(in oklab, var(--accent) 12%, transparent);
    padding: 0.14rem 0.5rem;
    border-radius: 999px;
    border: 0.5px solid color-mix(in oklab, var(--accent) 30%, transparent);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .header-icon {
    padding: 3px 8px;
    line-height: 1;
    min-width: 1.6rem;
  }

  /* Per-day actions menu (⋯) — mirrors CandidatesSection's refresh kebab.
     Holds the confirm-gated "Remove day" so destructive day removal isn't a
     bare × on the surface next to the per-stop remove ×. */
  .day-menu-wrap {
    position: relative;
    display: inline-flex;
  }
  .day-menu {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 0.25rem;
    background: var(--surface-raised);
    border: 0.5px solid var(--border-default);
    border-radius: 4px;
    box-shadow: 0 2px 8px var(--shadow-soft, rgba(0, 0, 0, 0.08));
    z-index: 10;
    min-width: 9rem;
    overflow: hidden;
  }
  .day-menu-item {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: 0;
    padding: 0.5rem 0.7rem;
    font-family: var(--font-sans);
    font-size: 0.84rem;
    color: var(--text-primary);
    cursor: pointer;
  }
  .day-menu-item:hover:not(:disabled) { background: var(--surface-sunken); }
  .day-menu-item:disabled { opacity: 0.5; cursor: not-allowed; }
  .day-menu-item--danger { color: var(--state-danger); }
  @media (pointer: coarse) {
    .day-menu-item { min-height: var(--tap-min); }
  }

  /* Header chip used for drive distance + date placeholders. Click toggles
     inline editing. Placeholder variant is muted so it doesn't compete
     with populated chips. */
  .chip {
    background: var(--surface-page);
    border: 0.5px solid var(--border-default);
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 0.74rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 3px 9px;
    border-radius: 999px;
    cursor: pointer;
    transition: background-color 0.12s, color 0.12s, border-color 0.12s;
  }
  .chip:hover:not(:disabled) {
    background: var(--surface-raised);
    color: var(--text-primary);
    border-color: var(--border-strong);
  }
  .chip--placeholder {
    color: var(--text-tertiary);
    background: transparent;
    font-weight: 500;
  }
  .chip--placeholder:hover:not(:disabled) {
    color: var(--text-secondary);
  }

  /* Inline field editors — replace the chip / notes with their input
     primitives in place. Save-on-blur for date and drive; explicit save
     for notes (longer content). */
  .field-edit {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: var(--surface-page);
    border: 1px solid var(--accent);
    padding: 2px 6px;
    border-radius: 4px;
  }
  .field-input {
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 0.85rem;
    width: auto;
    outline: none;
  }
  .field-edit--drive .field-input { width: 4.5em; }
  .field-edit--date .field-input { width: 9em; }
  .field-suffix {
    font-size: 0.74rem;
    color: var(--text-tertiary);
  }

  /* ── Notes ──────────────────────────────────────────────────────────── */
  /* Two render modes share the same chrome:
       .notes.notes--readonly: a plain <p> when the trip is read-only
       .notes.notes--editable: a <button> styled like a paragraph so it
                               carries the click-to-edit affordance with
                               proper keyboard semantics */
  .notes {
    position: relative;
    display: block;
    width: 100%;
    margin: 0 0 0.85rem;
    padding: 0.55rem 0.7rem;
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 0.88rem;
    line-height: 1.5;
    background: color-mix(in oklab, var(--surface-sunken) 60%, transparent);
    border: none;
    border-radius: 4px;
    text-align: left;
    transition: background-color 0.12s;
  }
  .notes--readonly { cursor: text; }
  .notes--editable {
    cursor: pointer;
  }
  .notes--editable:hover,
  .notes--editable:focus-visible {
    background: var(--surface-sunken);
  }
  .notes--editable:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  .notes-body {
    display: inline;
  }
  .notes-edit-hint {
    margin-left: 0.5rem;
    font-size: 0.7rem;
    color: var(--text-tertiary);
    opacity: 0;
    transition: opacity 0.12s;
    text-transform: lowercase;
    letter-spacing: 0.04em;
  }
  .notes--editable:hover .notes-edit-hint,
  .notes--editable:focus-visible .notes-edit-hint { opacity: 1; }
  .notes-add {
    background: transparent;
    border: 0.5px dashed var(--border-default);
    color: var(--text-tertiary);
    font-family: var(--font-sans);
    font-size: 0.78rem;
    font-weight: 500;
    padding: 0.35rem 0.7rem;
    border-radius: 4px;
    cursor: pointer;
    margin-bottom: 0.85rem;
    transition: color 0.12s, border-color 0.12s, background-color 0.12s;
  }
  .notes-add:hover:not(:disabled) {
    color: var(--text-secondary);
    border-color: var(--border-strong);
    background: color-mix(in oklab, var(--surface-sunken) 40%, transparent);
  }
  .notes-edit {
    margin-bottom: 0.85rem;
  }
  .notes-textarea {
    width: 100%;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--accent);
    border-radius: 4px;
    background: var(--surface-page);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 0.88rem;
    line-height: 1.5;
    resize: vertical;
    outline: none;
  }
  .notes-edit-actions {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.4rem;
  }

  /* ── Stops list ─────────────────────────────────────────────────────── */
  .stops-list {
    list-style: none;
    padding: 0;
    margin: 0 0 0.45rem;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  /* Drive connector — renders between consecutive stops when both stops have
     coords. Prefers real drive data (prevCand.drive_to_next.mi) when present;
     falls back to straight-line Haversine distance between the two stops.
     driveConnectorLabel returns null when mi is null/0, so pairs without
     coords simply produce no connector element. */
  .drive-connector {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0 0.5rem;
    font-family: var(--font-sans);
    font-size: 0.7rem;
    font-weight: 500;
    color: var(--text-tertiary);
    letter-spacing: 0.02em;
    list-style: none;
    height: 1.4rem;
  }
  .stop-row {
    position: relative;
  }
  /* Stop-row container — holds the compact StopCard and, only while the day
     is being arranged, the reorder/move/remove toolbar, which wraps to its
     own full-width row beneath the card. */
  .stop-row-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    row-gap: 0.35rem;
  }
  .stop-row-controls > :global(.stop-card) {
    flex: 1 1 100%;
    min-width: 0;
  }

  /* Arrange-mode toolbar — a horizontal row of reorder (↑ ↓), Move, and
     remove (✕), shown only when the day is in arrange mode. Indented to
     align under the card content. */
  .arrange-toolbar {
    flex-basis: 100%;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding-left: calc(18px + 0.5rem + 8px);
  }
  .nudge-btn,
  .arrange-remove {
    flex-shrink: 0;
    background: transparent;
    border: 0.5px solid var(--border-default);
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 0.95rem;
    font-weight: 500;
    line-height: 1;
    min-width: 2rem;
    padding: 0.25rem 0;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.12s, color 0.12s, border-color 0.12s;
  }
  .nudge-btn:hover:not(:disabled) {
    background: var(--surface-page);
    color: var(--text-primary);
    border-color: var(--border-strong);
  }
  .nudge-btn:disabled { opacity: 0.3; cursor: not-allowed; }
  .arrange-remove {
    margin-left: auto;
    color: var(--text-tertiary);
  }
  .arrange-remove:hover:not(:disabled) {
    color: var(--state-danger);
    border-color: var(--state-danger);
  }
  .arrange-remove:disabled { opacity: 0.4; cursor: not-allowed; }

  .move-btn {
    flex-shrink: 0;
    background: transparent;
    border: 0.5px solid var(--border-default);
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 11.5px;
    font-weight: 500;
    letter-spacing: 0.04em;
    padding: 0.25rem 12px;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.12s, color 0.12s, border-color 0.12s;
  }
  .move-btn:hover:not(:disabled) {
    background: var(--surface-page);
    color: var(--text-primary);
    border-color: var(--border-strong);
  }
  .move-btn.active {
    background: color-mix(in oklab, var(--accent) 10%, transparent);
    color: var(--accent-text);
    border-color: color-mix(in oklab, var(--accent) 40%, var(--border-default));
  }
  .move-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  @media (pointer: coarse) {
    .nudge-btn,
    .arrange-remove {
      min-width: var(--tap-min);
      min-height: var(--tap-min);
      font-size: 1rem;
    }
    .move-btn {
      min-height: var(--tap-min);
      font-size: 0.95rem;
      padding: 0 12px;
    }
  }

  /* Move-to-day picker — opens below the stop row when the move button
     is active. Lists OTHER days; tapping one fires the atomic move. */
  .move-picker {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 4px 0 8px 1rem;
    padding: 4px;
    background: var(--surface-sunken);
    border-radius: 5px;
  }
  .move-picker-head {
    margin: 0;
    padding: 0.3rem 0.4rem 0.4rem;
    font-family: var(--font-sans);
    font-size: 0.78rem;
    color: var(--text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .move-picker-head strong {
    color: var(--text-primary);
    font-weight: 600;
  }
  .move-picker-cancel {
    margin-top: 2px;
    background: transparent;
    border: 0.5px solid var(--border-default);
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 0.8rem;
    padding: 0.4rem 0.65rem;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.12s, color 0.12s;
  }
  .move-picker-cancel:hover {
    background: var(--surface-raised);
    color: var(--text-primary);
  }
  .move-picker-item {
    display: grid;
    grid-template-columns: auto auto 1fr;
    gap: 0.5rem;
    align-items: baseline;
    text-align: left;
    background: var(--surface-page);
    border: 0.5px solid var(--border-subtle);
    border-radius: 4px;
    padding: 0.4rem 0.65rem;
    cursor: pointer;
    font-family: var(--font-sans);
    color: var(--text-primary);
    transition: background-color 0.12s, border-color 0.12s;
  }
  .move-picker-item:hover:not(:disabled) {
    background: var(--surface-raised);
    border-color: var(--border-default);
  }
  .move-picker-item:disabled { opacity: 0.5; cursor: not-allowed; }
  .move-picker-primary {
    font-size: 0.85rem;
    font-weight: 600;
  }
  .move-picker-secondary {
    font-size: 0.74rem;
    color: var(--text-tertiary);
  }
  .move-picker-count {
    justify-self: end;
    font-size: 0.72rem;
    color: var(--text-tertiary);
  }

  /* Insertion marker for within-day reorder — a 2px accent line above
     the target row. No layout-property transition (animating padding
     trips the impeccable layout-animation ban); the line alone is the
     drop signal. */
  .stop-row.reorder-target::before {
    content: '';
    position: absolute;
    top: -1px;
    left: 4px;
    right: 4px;
    height: 2px;
    background: var(--accent);
    border-radius: 999px;
  }
  .dangling-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.7rem;
    background: var(--state-warning-surface);
    color: var(--state-warning);
    border-radius: 4px;
    font-size: 0.85rem;
    font-family: var(--font-sans);
  }

  /* ── Add stop ───────────────────────────────────────────────────────── */
  /* Dashed ghost button — full-width to read as "append to this day", not
     an afterthought. Kept dashed so it visually reads as "not filled yet". */
  .add-stop {
    width: 100%;
    background: transparent;
    border: 1px dashed var(--border-default);
    color: var(--text-tertiary);
    font-family: var(--font-sans);
    font-size: 0.8rem;
    font-weight: 500;
    padding: 0.4rem 0.75rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    margin-bottom: 0.85rem;
    transition: color 0.12s, border-color 0.12s, background-color 0.12s;
  }
  .add-stop:hover:not(:disabled) {
    color: var(--accent-text);
    border-color: color-mix(in oklab, var(--accent) 50%, var(--border-default));
    background: color-mix(in oklab, var(--accent) 4%, transparent);
  }
  .add-stop:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ── Lodging slot ───────────────────────────────────────────────────── */
  .lodging-slot {
    position: relative;
    padding-top: 0.75rem;
    border-top: 1px dashed var(--border-default);
    transition: border-color 0.15s ease, background-color 0.15s ease;
  }
  .lodging-slot.lodging-drop-active {
    border-top-color: var(--accent);
    background: color-mix(in oklab, var(--accent) 4%, transparent);
  }
  .lodging-slot.lodging-drop-active::after {
    content: 'Set as lodging';
    position: absolute;
    top: 50%;
    right: 0.6rem;
    transform: translateY(-50%);
    background: var(--accent);
    color: var(--text-inverse);
    padding: 0.25rem 0.6rem;
    border-radius: 999px;
    font-size: 0.7rem;
    font-weight: 600;
    pointer-events: none;
  }
  /* Empty lodging slot is a dashed drop-zone with the bed glyph so the
     "this is where lodging goes" affordance survives even at rest. */
  .lodging-empty {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 0.55rem;
    padding: 0.55rem 0.75rem;
    background: transparent;
    border: 0.5px dashed var(--border-default);
    border-radius: 5px;
    color: var(--text-tertiary);
    font-family: var(--font-sans);
    cursor: pointer;
    transition: color 0.12s, border-color 0.12s, background-color 0.12s;
  }
  .lodging-empty:hover:not(:disabled) {
    color: var(--text-secondary);
    border-color: var(--border-strong);
    background: color-mix(in oklab, var(--surface-sunken) 40%, transparent);
  }
  .lodging-empty:disabled { opacity: 0.5; cursor: not-allowed; }
  .lodging-empty-icon {
    color: var(--bone-600);
    display: inline-flex;
    flex-shrink: 0;
  }
  :global([data-theme="dark"]) .lodging-empty-icon { color: var(--bone-200); }
  .lodging-empty-label {
    font-size: 0.86rem;
    font-weight: 500;
  }
  .lodging-empty-hint {
    margin-left: auto;
    font-size: 0.72rem;
    color: var(--text-tertiary);
    font-style: italic;
  }

  /* ── Click-flow picker (touch / keyboard fallback) ──────────────────── */
  .picker {
    margin-top: 0.6rem;
    padding: 0.55rem;
    background: var(--surface-sunken);
    border-radius: 5px;
  }
  .picker h5 {
    margin: 0 0 0.5rem;
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 0.85rem;
    font-weight: 500;
  }
  .picker-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.5rem;
    background: none;
    border: none;
    border-bottom: 1px solid var(--border-default);
    cursor: pointer;
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 0.9rem;
  }
  .picker-item:last-child { border-bottom: none; }
  .picker-item:hover:not(:disabled) { background: var(--surface-raised); }
  .picker-item:disabled { opacity: 0.5; cursor: not-allowed; }
  .picker-cat {
    font-size: 0.72rem;
    padding: 0.1rem 0.4rem;
    border-radius: 0.25rem;
    background: var(--surface-page);
    color: var(--text-tertiary);
    margin-right: 0.4rem;
  }
  .picker-empty {
    margin: 0;
    color: var(--text-tertiary);
    font-size: 0.85rem;
  }

  /* ── Buttons ─────────────────────────────────────────────────────────── */
  .btn-inline {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    background: transparent;
    border: 0.5px solid var(--border-default);
    padding: 4px 10px;
    border-radius: 4px;
    color: var(--text-secondary);
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    letter-spacing: 0.02em;
    transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }
  .btn-inline:hover:not(:disabled) {
    background: var(--surface-raised);
    color: var(--text-primary);
  }
  .btn-inline:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-inline.btn-primary {
    background: var(--forest-800);
    color: var(--text-inverse);
    border-color: var(--forest-800);
  }
  .btn-inline.btn-primary:hover:not(:disabled) {
    background: var(--forest-900);
    border-color: var(--forest-900);
    color: var(--text-inverse);
  }
  :global([data-theme="dark"]) .btn-inline.btn-primary {
    background: var(--bone-100);
    color: var(--forest-900);
    border-color: var(--bone-100);
  }
  :global([data-theme="dark"]) .btn-inline.btn-primary:hover:not(:disabled) {
    background: var(--bone-200);
    border-color: var(--bone-200);
    color: var(--forest-900);
  }
  .btn-inline.btn-icon {
    padding: 3px 8px;
    line-height: 1;
    min-width: 1.75rem;
  }

  /* Hide-toast chrome lives in HideToast.svelte — shared with CandidatesSection. */

  /* Touch: every interactive element in a Day card sits below 44px on
     desktop. The day header chips (drive / date / × remove-day), the
     dashed + Add stop / + Add lodging / + Add notes affordances, the
     move-to-day controls and the inline Save/Cancel buttons all need a
     real tap floor on a phone. */
  @media (pointer: coarse) {
    .chip {
      min-height: var(--tap-min);
      padding: 0.55rem 0.85rem;
      font-size: 0.85rem;
    }
    .btn-inline {
      min-height: var(--tap-min);
      padding: 0.5rem 0.95rem;
      font-size: 13px;
    }
    .btn-inline.btn-icon {
      min-width: var(--tap-min);
      min-height: var(--tap-min);
      padding: 0.4rem 0.55rem;
      font-size: 1.05rem;
    }
    .add-stop {
      min-height: var(--tap-min);
      padding: 0.6rem 0.95rem;
      font-size: 0.85rem;
    }
    .lodging-empty {
      min-height: var(--tap-min);
      padding: 0.7rem 0.85rem;
    }
    /* A hairline + breathing room between stops keeps the resting list of
       places legible, and clearly bounds each stop when arrange mode adds
       its toolbar. */
    .stops-list {
      gap: 0;
    }
    .stop-row + .stop-row {
      margin-top: 0.65rem;
      padding-top: 0.65rem;
      border-top: 1px solid var(--border-subtle);
    }
    /* Remaining sub-44px tap targets: the click-fallback stop/lodging
       picker rows, the move-to-day picker rows + its Cancel, and the
       "+ Add notes" affordance. Floor them like the rest of the card. */
    .picker-item {
      min-height: var(--tap-min);
      display: flex;
      align-items: center;
    }
    .move-picker-item {
      min-height: var(--tap-min);
    }
    .move-picker-cancel {
      min-height: var(--tap-min);
    }
    .notes-add {
      min-height: var(--tap-min);
      padding: 0.5rem 0.85rem;
    }
    .banner-dismiss {
      min-height: var(--tap-min);
    }
    .notes--editable {
      min-height: var(--tap-min);
    }
    .field-input {
      min-height: var(--tap-min);
    }
  }

  /* ── Trip-prep roll-up ──────────────────────────────────────────────── */
  .trip-prep {
    margin-bottom: 1rem;
    padding: 0.65rem 0.9rem;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--accent) 4%, var(--surface-sunken));
  }
  .trip-prep-head {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    flex-wrap: wrap;
  }
  .trip-prep-head h3 {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  .trip-prep-head .count {
    color: var(--text-tertiary);
    font-size: 0.8rem;
    font-weight: 500;
  }
  .trip-prep-actions {
    margin-left: auto;
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  /* Quiet chip buttons for prep actions (Refresh / Re-generate). */
  .prep-chip {
    display: inline-flex;
    align-items: center;
    background: var(--surface-raised);
    border: 0.5px solid var(--border-default);
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 0.72rem;
    font-weight: 500;
    padding: 0.22rem 0.6rem;
    border-radius: 999px;
    cursor: pointer;
    white-space: nowrap;
    transition: background-color 0.12s, color 0.12s, border-color 0.12s;
  }
  .prep-chip:hover:not(:disabled) {
    background: var(--surface-page);
    color: var(--text-primary);
    border-color: var(--border-strong);
  }
  .prep-chip:disabled { opacity: 0.5; cursor: not-allowed; }
  /* Progress bar — thin accent fill on a sunken track. */
  .trip-prep-bar {
    margin-top: 0.5rem;
    height: 4px;
    border-radius: 999px;
    background: var(--surface-sunken);
    overflow: hidden;
  }
  .trip-prep-bar-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 999px;
    transition: width 0.3s ease;
  }
  @media (pointer: coarse) {
    .prep-chip {
      min-height: var(--tap-min);
      padding: 0.5rem 0.8rem;
      font-size: 0.8rem;
    }
  }
</style>
