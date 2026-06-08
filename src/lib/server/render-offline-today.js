// Pure renderer for the offline Today-view bundle. Returns one self-contained
// HTML document — inlined CSS, inline vanilla-JS day switcher, geo:/tel: links,
// no external subresources. Mirrors the live Today view's content; see
// docs/superpowers/specs/2026-06-07-offline-support-design.md.
//
// Token exception: this generated artifact cannot reference app.css, so it
// inlines literal light-theme color values (simplified single-accent palette).

import { navUrl, telHref, geoHref } from '../today.js';

/** Escape the five HTML-significant characters. */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Make a URL safe for an href attribute: drop disallowed protocols (returns
 * null so the caller can omit the link), then escape attribute-breaking
 * characters. Deliberately does NOT escape `&` so query strings (e.g. the
 * Google Maps `?api=1&destination=...` URL) render literally.
 *
 * @param {string|null|undefined} url
 * @returns {string|null}
 */
function safeHref(url) {
  const s = String(url ?? '');
  if (/^(javascript:|data:)/i.test(s)) return null;
  return s
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Format a YYYY-MM-DD string as "Weekday, Month D"; '' when missing/invalid. */
function formatDayHeading(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

/** Format a YYYY-MM-DD string as "Mon D"; '' when missing/invalid. */
function formatShortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function renderStop(stop, destination, index) {
  const number = index + 1;
  const isFirst = index === 0;
  const navHref = safeHref(navUrl(stop, destination));
  const geo = safeHref(geoHref(stop.coords, stop.name));
  const callHref = stop.phone ? safeHref(telHref(stop.phone)) : null;
  const siteHref = stop.website ? safeHref(stop.website) : null;

  const meta = [];
  if (stop.hours) {
    meta.push(`<div class="meta-row"><span class="meta-icon">◷</span><span class="meta-value muted">${esc(stop.hours)}</span></div>`);
  }
  if (stop.address) {
    meta.push(`<div class="meta-row"><span class="meta-icon">◎</span><span class="meta-value">${esc(stop.address)}</span></div>`);
  }

  const actions = [];
  if (navHref) actions.push(`<a class="action-btn primary" href="${navHref}">↗ Navigate</a>`);
  if (geo) actions.push(`<a class="action-btn" href="${geo}">⊚ Maps app</a>`);
  if (callHref) actions.push(`<a class="action-btn" href="${callHref}">☎ Call</a>`);
  if (siteHref) actions.push(`<a class="action-btn" href="${siteHref}">⤴ Site</a>`);

  const tips = (stop.tips ?? []).map((t) => `<li>${esc(t)}</li>`).join('');
  const todos = (stop.todos ?? [])
    .map((td) => `<li class="${td.done ? 'done' : ''}"><span class="todo-box">${td.done ? '✓' : ''}</span><span>${esc(td.text)}</span></li>`)
    .join('');
  let disclosure = '';
  if (tips || todos) {
    disclosure =
      `<details class="disclosure"><summary>Tips &amp; to-dos</summary>` +
      (tips ? `<ul class="tip-list">${tips}</ul>` : '') +
      (todos ? `<ul class="todo-list">${todos}</ul>` : '') +
      `</details>`;
  }

  return (
    `<article class="stop-card${isFirst ? ' first' : ''}">` +
    `<div class="stop-head"><div class="num${isFirst ? ' num-first' : ''}">${number}</div>` +
    `<div class="stop-title"><h3>${esc(stop.name)}</h3>` +
    `<span class="cat-chip">${esc(stop.category || 'misc')}</span></div></div>` +
    (isFirst ? `<div class="start-here">Start here</div>` : '') +
    (stop.description ? `<p class="description">${esc(stop.description)}</p>` : '') +
    (meta.length ? `<div class="meta">${meta.join('')}</div>` : '') +
    `<div class="actions">${actions.join('')}</div>` +
    disclosure +
    `</article>`
  );
}

function renderLodging(lodging, destination) {
  const navHref = safeHref(navUrl({ name: lodging.name, coords: lodging.coords ?? null }, destination));
  const bookingHref = lodging.booking_url ? safeHref(lodging.booking_url) : null;
  const navBtn = navHref ? `<a class="action-btn primary" href="${navHref}">↗ Navigate</a>` : '';
  const booking = bookingHref ? `<a class="action-btn" href="${bookingHref}">⤴ Booking</a>` : '';
  return (
    `<div class="section-label">Tonight</div>` +
    `<section class="lodging-card"><span class="moon">☾</span>` +
    `<div class="lodging-body"><p class="lodging-name">${esc(lodging.name)}</p>` +
    `<div class="actions">${navBtn}${booking}</div>` +
    `</div></section>`
  );
}

function renderDay(day, destination) {
  const heading = day.date ? formatDayHeading(day.date) : `Day ${day.n}`;
  const stops = day.stops?.length
    ? `<div class="section-label">Stops</div>` +
      day.stops.map((s, i) => renderStop(s, destination, i)).join('')
    : `<p class="empty-day">No stops planned for this day.</p>`;
  const lodging = day.lodging ? renderLodging(day.lodging, destination) : '';
  return (
    `<section class="day" data-day="${day.n}" data-date="${esc(day.date ?? '')}">` +
    `<div class="day-heading"><h1>${esc(heading)}</h1>` +
    `<p class="day-sub">Day ${day.n} · ${esc(destination)}</p></div>` +
    stops + lodging +
    `</section>`
  );
}

function renderFieldGuide(notes, gotchas) {
  if (!notes.length && !gotchas.length) return '';
  const noteList = notes.length
    ? `<p class="fg-label">Notes</p><ul class="fg-list">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
    : '';
  const gotchaList = gotchas.length
    ? `<p class="fg-label gotcha">Gotchas</p><ul class="fg-list gotcha">${gotchas.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>`
    : '';
  return `<details class="field-guide"><summary>Field guide &amp; gotchas</summary>${noteList}${gotchaList}</details>`;
}

const STYLE = `
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:#FCFAF5;color:#112619;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.45}
.wrap{max-width:540px;margin:0 auto;padding:0 16px 48px}
header{padding:14px 16px 8px;max-width:540px;margin:0 auto;border-bottom:1px solid #DCD2BC}
.eyebrow{font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#D87B3F}
.trip-title{font-size:15px;font-weight:600;color:#2D5840;margin:2px 0 0}
.banner{font-size:12.5px;color:#5F5341;background:#F6F1E5;border:1px solid #DCD2BC;border-radius:10px;padding:8px 12px;margin:12px 0}
.day-picker{display:flex;gap:8px;overflow-x:auto;padding:10px 16px;max-width:540px;margin:0 auto}
.day-pill{flex:0 0 auto;min-height:44px;padding:8px 14px;border:1px solid #C9B695;border-radius:999px;background:#F6F1E5;color:#2D5840;font-size:13px;font-weight:600;cursor:pointer}
.day-pill.active{background:#1F4332;border-color:#1F4332;color:#FCFAF5}
.day[hidden]{display:none}
.day-heading{margin:16px 0 4px}
.day-heading h1{font-size:26px;font-weight:600;margin:0 0 4px;line-height:1.2}
.day-sub{font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#5F5341;margin:0}
.section-label{font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#5F5341;margin:22px 0 10px 2px}
.empty-day{color:#5F5341;font-style:italic;margin:22px 0 12px}
.stop-card{background:#F6F1E5;border:1px solid #DCD2BC;border-radius:16px;padding:14px;margin-bottom:12px}
.stop-card.first{border-color:#2D5840;box-shadow:0 0 0 1px #2D5840}
.stop-head{display:flex;gap:12px;align-items:flex-start;margin-bottom:8px}
.num{flex:0 0 auto;width:30px;height:30px;border-radius:50%;background:#EBE0C9;color:#5F5341;font-size:14px;font-weight:600;line-height:30px;text-align:center}
.num-first{background:#2D5840;color:#FCFAF5}
.stop-title{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.stop-title h3{margin:0;font-size:19px;font-weight:600;line-height:1.2}
.cat-chip{align-self:flex-start;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#5F5341;background:#EBE0C9;padding:4px 8px;border-radius:6px}
.start-here{display:inline-block;margin-bottom:8px;font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#FCFAF5;background:#2D5840;padding:4px 8px;border-radius:999px}
.description{margin:0 0 10px;font-size:14px;color:#2D5840}
.meta{display:grid;gap:6px;margin-bottom:12px}
.meta-row{display:flex;gap:9px;font-size:14px;align-items:flex-start}
.meta-icon{flex:0 0 auto;width:18px;text-align:center;color:#5F5341;font-size:13px}
.meta-value.muted{color:#5F5341;font-style:italic}
.actions{display:flex;gap:8px;flex-wrap:wrap}
.action-btn{flex:1;min-width:96px;display:flex;align-items:center;justify-content:center;gap:5px;min-height:46px;border-radius:11px;border:1px solid #C9B695;background:#F6F1E5;color:#112619;font-size:14px;font-weight:600;text-decoration:none}
.action-btn.primary{background:#2D5840;border-color:#2D5840;color:#FCFAF5}
.lodging-card{background:#F6F1E5;border:1px solid #DCD2BC;border-radius:16px;padding:14px;display:flex;gap:12px;align-items:flex-start;margin-bottom:12px}
.moon{flex:0 0 auto;font-size:20px}
.lodging-body{flex:1;min-width:0}
.lodging-name{font-size:17px;font-weight:600;margin:0 0 10px}
details{background:#F6F1E5;border:1px solid #DCD2BC;border-radius:16px;padding:14px;margin-top:12px}
.stop-card details{background:transparent;border:none;border-top:1px dashed #DCD2BC;border-radius:0;padding:10px 0 0;margin-top:12px}
summary{cursor:pointer;font-weight:600;min-height:44px;display:flex;align-items:center}
.tip-list,.todo-list,.fg-list{margin:10px 0 2px;padding-left:18px;display:grid;gap:8px}
.todo-list{list-style:none;padding-left:0}
.todo-list li{display:flex;gap:9px;align-items:flex-start}
.todo-list li.done span:last-child{color:#5F5341;text-decoration:line-through}
.todo-box{flex:0 0 auto;width:17px;height:17px;border:1.5px solid #9A8A6F;border-radius:5px;text-align:center;line-height:15px;font-size:12px;color:#FCFAF5}
.todo-list li.done .todo-box{background:#2D5840;border-color:#2D5840}
.tip-list li,.fg-list li{font-size:13.5px;color:#2D5840}
.fg-label{font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#5F5341;margin:16px 0 8px}
.fg-label.gotcha,.fg-list.gotcha li{color:#8D4C24}
footer{text-align:center;font-size:12px;color:#5F5341;margin-top:24px}
`;

// Inline switcher: pills toggle .day visibility; on load, resolve the current
// day against the device clock (mirrors resolveCurrentDay), else default-day.
const SCRIPT = `
(function(){
  var root=document.getElementById('app');
  var days=[].slice.call(document.querySelectorAll('.day'));
  var pills=[].slice.call(document.querySelectorAll('.day-pill'));
  function show(n){
    days.forEach(function(d){ d.hidden = d.getAttribute('data-day')!==String(n); });
    pills.forEach(function(p){ p.classList.toggle('active', p.getAttribute('data-day')===String(n)); });
  }
  pills.forEach(function(p){ p.addEventListener('click', function(){ show(p.getAttribute('data-day')); }); });
  function todayStr(){ var d=new Date(); var m=String(d.getMonth()+1).padStart(2,'0'); var dd=String(d.getDate()).padStart(2,'0'); return d.getFullYear()+'-'+m+'-'+dd; }
  function resolve(){
    var t=todayStr();
    var dated=days.map(function(d){return d.getAttribute('data-date');}).filter(Boolean).sort();
    for(var i=0;i<days.length;i++){ if(days[i].getAttribute('data-date')===t) return days[i].getAttribute('data-day'); }
    if(dated.length){ if(t>dated[dated.length-1]) return days[days.length-1].getAttribute('data-day'); }
    return root.getAttribute('data-default-day');
  }
  show(resolve());
})();
`;

/**
 * Render the offline Today bundle as a self-contained HTML document.
 * @param {object} vm  View-model (see plan / spec).
 * @returns {string}
 */
export function renderOfflineToday(vm) {
  const synced = vm.generatedAt.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const pills = vm.days
    .map((d) => {
      const short = formatShortDate(d.date);
      const label = short ? `Day ${d.n} · ${esc(short)}` : `Day ${d.n}`;
      return `<button class="day-pill" data-day="${d.n}">${label}</button>`;
    })
    .join('');
  const dayHtml = vm.days.map((d) => renderDay(d, vm.destination)).join('');
  const fg = renderFieldGuide(vm.fieldGuideNotes ?? [], vm.gotchas ?? []);

  return (
    `<!doctype html>\n<html lang="en">\n<head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>Today — ${esc(vm.title)} · Traverse (offline)</title>` +
    `<style>${STYLE}</style></head>` +
    `<body><div id="app" data-default-day="${vm.defaultDay}">` +
    `<header><div class="eyebrow">Traverse · Today</div>` +
    `<p class="trip-title">${esc(vm.title)}</p></header>` +
    `<nav class="day-picker">${pills}</nav>` +
    `<div class="wrap">` +
    `<p class="banner">Offline copy · synced ${esc(synced)} — re-download if you change the plan.</p>` +
    dayHtml + fg +
    `<footer>Read-only offline snapshot · Traverse</footer>` +
    `</div></div>` +
    `<script>${SCRIPT}</script></body></html>`
  );
}
