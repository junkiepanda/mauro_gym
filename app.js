// Mauro_gym: offline workout log for the SWAG program (program.js is generated from the coach workbook).
'use strict';

const KEY = 'mg.v1', DRAFT = 'mg.draft', PREV = 'mg.prev';
const APP_ID = 'mauro_gym', DATA_VERSION = 1;
const BACKUP_EVERY = 5, STEP = 2.5, BAR = 20;
const PLATES = [[25, 'p25'], [20, 'p20'], [15, 'p15'], [10, 'p10'], [5, 'p5'], [2.5, 'p2'], [1.25, 'p1']];
const $ = s => document.querySelector(s);
const SESS = Object.fromEntries(PROGRAM.sessions.map(s => [s.id, s]));
const EX = {};
PROGRAM.sessions.forEach(s => s.exercises.forEach(e => { EX[e.key] = e; }));

/* ---------- storage (never throws; falls back to memory with a warning) ---------- */
let storageOk = true, persisted = null;
const mem = {};
function sget(k) {
  try { return localStorage.getItem(k); } catch { storageOk = false; return mem[k] ?? null; }
}
function sset(k, v) {
  try { localStorage.setItem(k, v); return true; } catch { storageOk = false; mem[k] = v; banner(); return false; }
}
function sdel(k) { try { localStorage.removeItem(k); } catch { delete mem[k]; } }

let state, draft;

function freshState() {
  const st = { app: APP_ID, version: DATA_VERSION, logs: [], prog: {}, lastOpt: {}, sinceBackup: 0, lastBackup: null, seeded: true };
  // weights already written in the workbook become lap 1 history
  for (const r of EXCEL_IMPORT) {
    const ex = EX[r.key];
    if (!ex) continue;
    const entry = { inc: true, raw: r.w, sets: [] };
    if (r.option) entry.opt = r.option;
    st.logs.push({ id: 'xl-' + r.key + '-' + (r.cycle || r.option || 0), sid: r.session, date: null, imported: true,
      lap: r.cycle ? 1 : null, cycle: r.cycle || null, entries: { [r.key]: entry } });
    if (r.cycle) {
      const p = st.prog[r.session] || { cycle: 1, lap: 1 };
      if (r.cycle >= p.cycle) st.prog[r.session] = next(r.cycle, 1, ex.cycles.length);
    }
    if (r.option) st.lastOpt[r.key] = Math.max(st.lastOpt[r.key] || 0, r.option);
  }
  return st;
}
const next = (cycle, lap, n) => cycle >= n ? { cycle: 1, lap: lap + 1 } : { cycle: cycle + 1, lap };

function validState(o) {
  return o && typeof o === 'object' && o.app === APP_ID && Array.isArray(o.logs) && o.prog && typeof o.prog === 'object';
}
function load() {
  try { const o = JSON.parse(sget(KEY)); state = validState(o) ? normalize(o) : null; } catch { state = null; }
  if (!state) {
    const raw = sget(KEY);
    if (raw) sset('mg.corrupt.' + Date.now(), raw);   // keep unreadable data instead of overwriting it silently
    state = freshState();
    save();
  }
  try { const d = JSON.parse(sget(DRAFT)); draft = d && SESS[d.sid] && d.entries ? d : null; } catch { draft = null; }
}
function normalize(o) {
  o.lastOpt = o.lastOpt && typeof o.lastOpt === 'object' ? o.lastOpt : {};
  o.sinceBackup = +o.sinceBackup || 0;
  o.logs = o.logs.filter(l => l && SESS[l.sid] && l.entries && typeof l.entries === 'object');
  for (const [sid, p] of Object.entries(o.prog)) {
    const f = fundOf(sid);
    if (!SESS[sid] || !p || !f) { delete o.prog[sid]; continue; }
    p.cycle = clampInt(p.cycle, 1, f.cycles.length, 1); p.lap = clampInt(p.lap, 1, 999, 1);
  }
  return o;
}
const clampInt = (v, a, b, d) => { v = Math.round(+v); return isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };
function save() { sset(KEY, JSON.stringify(state)); }
let draftTimer;
function saveDraft(now) {
  clearTimeout(draftTimer);
  const w = () => { if (draft) sset(DRAFT, JSON.stringify(draft)); else sdel(DRAFT); };
  if (now) w(); else draftTimer = setTimeout(w, 250);
}

/* ---------- program helpers ---------- */
const fundOf = sid => SESS[sid]?.exercises.find(e => e.kind === 'fund');
const progOf = sid => state.prog[sid] || { cycle: 1, lap: 1 };
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : null; };
const fmt = n => (Math.round(n * 100) / 100).toString();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// "2x6 avvicinamento, poi 2x8-10, 2x10-12" -> rows [{warm, target, drop?}]
function parseScheme(s, kind) {
  s = String(s || '');
  const rows = [];
  let warm = '', work = s;
  const m = s.match(/^(.*?)avvicinamento[^,]*,\s*poi\s+(.*)$/i);
  if (m) { warm = m[1]; work = m[2]; }
  const add = (part, isWarm) => {
    part = part.trim();
    if (!part) return;
    if (/carico a scalare/i.test(part)) {
      const t = part.match(/(\d+(?:-\d+)?)\s*reps?/i);
      if (rows.length) rows[rows.length - 1].drop = t ? t[1] : '';
      return;
    }
    let p = part.match(/^(\d+)(?:-(\d+))?\s*x\s*(\d+(?:-\d+)?)/i);
    if (p) {
      const n = Math.max(+p[1], +(p[2] || 0));
      for (let i = 0; i < Math.min(n, 20); i++) rows.push({ warm: isWarm, target: p[3] });
      return;
    }
    p = part.match(/^x\s*(\d+)(?:-(\d+))?\s*(reps|set)?/i);   // "X 6-8 reps" = count left to you
    if (p) {
      const isSets = /set/i.test(p[3] || '');
      const n = isSets ? +p[1] : 3;
      const target = isSets ? '' : p[1] + (p[2] ? '-' + p[2] : '');
      for (let i = 0; i < n; i++) rows.push({ warm: isWarm, target });
    }
  };
  warm.split(',').forEach(p => add(p, true));
  work.split(/,(?![^(]*\))/).forEach(p => add(p, false));
  if (!rows.some(r => !r.warm)) for (let i = 0; i < 3; i++) rows.push({ warm: false, target: '' });
  return rows;
}
const topOf = t => { const ns = String(t || '').match(/\d+/g); return ns ? String(Math.max(...ns.map(Number))) : ''; };

function schemeFor(ex, d, opt) {
  if (ex.kind === 'fund') return ex.cycles[d.cycle - 1];
  if (ex.kind === 'opt') return ex.options[(opt || 1) - 1];
  return ex.scheme || '';
}

// newest logged entry for an exercise matching a filter
function findEntry(key, pred) {
  for (let i = state.logs.length - 1; i >= 0; i--) {
    const l = state.logs[i], e = l.entries[key];
    if (e && e.inc && pred(l, e)) return { log: l, e };
  }
  return null;
}
function sources(ex, d, opt) {
  if (ex.kind === 'fund') {
    return {
      same: findEntry(ex.key, l => l.cycle === d.cycle && l.lap < d.lap),
      last: findEntry(ex.key, () => true),
    };
  }
  if (ex.kind === 'opt') return { same: findEntry(ex.key, (l, e) => e.opt === opt), last: findEntry(ex.key, () => true) };
  return { same: null, last: findEntry(ex.key, () => true) };
}

function makeEntry(ex, d, opt) {
  if (ex.kind === 'opt' && !opt) {
    const lo = state.lastOpt[ex.key];
    opt = lo ? (lo % ex.options.length) + 1 : 1;
  }
  const entry = { inc: !ex.optional, sets: [], note: '' };
  if (ex.kind === 'opt') entry.opt = opt;
  if (/elastico/i.test(ex.detail)) entry.txt = true;
  if (ex.kind === 'circuit') {
    const src = findEntry(ex.key, () => true);
    const prevRounds = src?.e.rounds || [];
    const n = Math.max(3, prevRounds.length ? Math.min(prevRounds.length, 10) : 3);
    entry.rounds = Array.from({ length: n }, (_, i) => ({
      done: false, st: ex.items.map((_, j) => ({ w: prevRounds[i]?.st?.[j]?.w ?? prevRounds.at(-1)?.st?.[j]?.w ?? '', r: '' })),
    }));
    return entry;
  }
  const rows = parseScheme(schemeFor(ex, d, opt), ex.kind);
  const { same, last } = sources(ex, d, opt);
  const pick = (src, warm) => (src?.e.sets || []).filter(s => !!s.warm === warm);
  const fill = (warm, i) => {
    for (const src of [same, last]) {
      if (!src) continue;
      const arr = pick(src, warm);
      if (arr.length) return arr[Math.min(i, arr.length - 1)];
      if (!warm && src.e.raw !== undefined) {
        const n = num(src.e.raw);
        if (n !== null && /^\s*\d+([.,]\d+)?\s*$/.test(src.e.raw)) return { w: fmt(n) };
        if (!/[\d+]/.test(src.e.raw)) return { w: src.e.raw };   // band colour etc.
      }
    }
    return null;
  };
  let wi = 0, ki = 0;
  for (const r of rows) {
    const p = fill(r.warm, r.warm ? wi++ : ki++);
    const row = { warm: r.warm, target: r.target, w: p?.w ?? '', r: '', done: false };
    if (ex.kind === 'sprint') { row.t = ''; delete row.w; }
    if (r.drop !== undefined) { row.dropT = r.drop; row.w2 = p?.w2 ?? ''; row.r2 = ''; }
    // last time's reps only make sense when the rep target is the same; otherwise start at the top of the range
    row.r = ex.kind === 'sprint' ? '' : (p?.r && p.target === r.target ? p.r : topOf(r.target));
    entry.sets.push(row);
  }
  if (entry.sets.some(s => s.w && num(s.w) === null)) entry.txt = true;
  return entry;
}

function newDraft(sid) {
  const s = SESS[sid], f = fundOf(sid), p = progOf(sid);
  const d = { sid, started: new Date().toISOString(), lap: f ? p.lap : null, cycle: f ? p.cycle : null,
    act: [false, false, false], entries: {}, timerEnd: 0, timerDur: 0 };
  for (const ex of s.exercises) d.entries[ex.key] = makeEntry(ex, d);
  return d;
}

/* ---------- history formatting ---------- */
function setsLine(e) {
  if (!e) return '';
  if (e.raw !== undefined && !(e.sets || []).length) return esc(e.raw);
  if (e.rounds) return e.rounds.filter(r => r.done || r.st.some(x => x.w || x.r)).length + ' rounds';
  const work = (e.sets || []).filter(s => !s.warm);
  const parts = [];
  for (const s of work) {
    let t = s.t !== undefined ? (s.t ? esc(s.t) + 's' : '–') : (esc(s.w || '–') + (s.r ? '×' + esc(s.r) : ''));
    if (s.w2 || s.r2) t += ' ↓' + esc(s.w2 || '–') + (s.r2 ? '×' + esc(s.r2) : '');
    const prev = parts.at(-1);
    if (prev && prev.t === t) prev.n++; else parts.push({ t, n: 1 });
  }
  return parts.map(p => p.t + (p.n > 1 ? ` <span class="x">x${p.n}</span>` : '')).join(' · ') || '–';
}
const noteLine = e => e && e.note ? `<div class="hn">“${esc(e.note)}”</div>` : '';
function whenText(iso) {
  if (!iso) return 'from Excel';
  const d = new Date(iso), days = Math.floor((startOfDay(new Date()) - startOfDay(d)) / 864e5);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return days + ' days ago';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
function lastOfSession(sid) {
  for (let i = state.logs.length - 1; i >= 0; i--) if (state.logs[i].sid === sid && !state.logs[i].imported) return state.logs[i];
  return null;
}

/* ---------- views ---------- */
let view = 'home';

function render() {
  banner();
  if (view === 'session' && draft) renderSession();
  else if (view === 'history') renderHistory();
  else { view = 'home'; renderHome(); }
  renderDock();
}

function banner() {
  const b = $('#banner');
  if (!b) return;
  const msgs = [];
  if (!storageOk) msgs.push('<div class="bn bad">Storage blocked: nothing is being saved. Make a backup before closing.</div>');
  else if (state && state.sinceBackup >= BACKUP_EVERY)
    msgs.push(`<div class="bn">${state.sinceBackup} sessions since your last backup. <button data-act="backup">Back up now</button></div>`);
  b.innerHTML = msgs.join('');
}

function renderHome() {
  const now = new Date();
  const day = now.toLocaleDateString('en-GB', { weekday: 'long' });
  const date = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  let h = `<header class="top plate"><div class="brand">MAURO<span>_</span>GYM</div>
    <button class="icon" data-act="menu" aria-label="Menu">${ICON.menu}</button></header>
    
    <section class="today"><div class="day">${esc(day)}</div><div class="date">${esc(date)}</div></section>`;
  if (draft) {
    const s = SESS[draft.sid];
    h += `<button class="resume" data-act="resume"><span class="rt"><span class="rl">Session in progress</span>
      <span class="nm">${esc(s.id)} · ${esc(s.title)}</span></span><span class="go">RESUME ${ICON.arrow}</span></button>`;
  }
  h += `<div class="sect">Pick today's session</div><div class="cards">`;
  for (const s of PROGRAM.sessions) {
    const f = fundOf(s.id), p = progOf(s.id), last = lastOfSession(s.id);
    const meter = f ? `<div class="meter">${f.cycles.map((_, i) => `<i class="${i + 1 < p.cycle ? 'on' : i + 1 === p.cycle ? 'now' : ''}"></i>`).join('')}</div>` : '';
    h += `<button class="scard" data-act="start" data-sid="${s.id}">
      <div class="code">${esc(s.id)}</div>
      <div class="info"><div class="ttl">${esc(s.title)}</div>
        <div class="sub">${f ? `<b>CICLO ${p.cycle}</b>/${f.cycles.length} · LAP ${p.lap}` : (s.exercises[0]?.kind === 'circuit' ? `CIRCUITO · ${s.exercises[0].items.length} esercizi` : `${s.exercises.length} esercizi`)}
        <span class="dot">•</span>${last ? esc(whenText(last.date)) : 'not done yet'}</div>${meter}</div>
      <div class="chev">${ICON.arrow}</div></button>`;
  }
  h += `</div><div class="foot-note">Data stays on this phone${persisted ? ' · storage protected' : ''}.</div>`;
  $('#app').innerHTML = h;
}

function renderSession() {
  const s = SESS[draft.sid], f = fundOf(s.id);
  let h = `<header class="top plate"><button class="icon" data-act="home" aria-label="Back">${ICON.back}</button>
    <div class="stitle"><div class="sid">${esc(s.id)}</div><div class="sname">${esc(s.title)}</div></div>
    <button class="icon" data-act="smenu" aria-label="Session menu">${ICON.dots}</button></header>`;
  if (f) {
    h += `<div class="cyclebar"><button class="cyc" data-act="cyc" data-d="-1" aria-label="Previous cycle">‹</button>
      <div class="cv"><div class="big">CICLO ${draft.cycle}<small>/${f.cycles.length}</small></div><div class="lap">LAP ${draft.lap}</div></div>
      <button class="cyc" data-act="cyc" data-d="1" aria-label="Next cycle">›</button></div>`;
  }
  if (s.activation) {
    const done = draft.act.filter(Boolean).length;
    h += `<section class="card act ${done === 3 ? 'complete' : ''}"><div class="role">Attivazione · 3 giri, 90″ pausa</div>
      <ul class="alist">${s.activation.items.map(i => `<li><b>${esc(i.name)}</b><span>${esc(i.reps)}</span>${i.hint ? `<em>${esc(i.hint)}</em>` : ''}</li>`).join('')}</ul>
      <div class="rounds">${draft.act.map((v, i) => `<button class="rnd ${v ? 'on' : ''}" data-act="actr" data-i="${i}">${v ? ICON.check : ''}<span>GIRO ${i + 1}</span></button>`).join('')}</div></section>`;
  }
  for (const ex of s.exercises) h += exCard(ex);
  h += `<button class="finish" data-act="finish"><span>FINISH SESSION</span></button>
    <details class="notes"><summary>Coach notes</summary>${(s.rules || []).concat(s.notes || []).map(n => `<p>${esc(n)}</p>`).join('')}</details>
    <div class="spacer"></div>`;
  $('#app').innerHTML = h;
  document.querySelectorAll('.card[data-key]').forEach(c => updatePlates(c.dataset.key));
}

function exCard(ex) {
  const e = draft.entries[ex.key];
  const k = esc(ex.key);
  let h = `<section class="card ex ${e.inc ? '' : 'off'} k-${ex.kind}" data-key="${k}">
    <div class="exhead"><div><div class="role">${esc(ex.role)}</div><div class="exname">${esc(ex.name)}</div>
    ${ex.detail ? `<div class="detail">${esc(ex.detail)}</div>` : ''}</div>
    <button class="tog ${e.inc ? 'on' : ''}" data-act="inc" data-key="${k}">${e.inc ? 'IN ✓' : '+ ADD'}</button></div>`;
  if (!e.inc) return h + `<div class="offnote">${ex.optional ? 'Optional' : 'Skipped'} · tap ADD to do it today</div></section>`;
  if (ex.hint) h += `<div class="hint">${esc(ex.hint)}</div>`;
  if (ex.kind === 'opt') {
    h += `<div class="opts">${ex.options.map((o, i) => `<button class="opt ${e.opt === i + 1 ? 'on' : ''}" data-act="opt" data-key="${k}" data-o="${i + 1}">OPZ ${i + 1}</button>`).join('')}</div>`;
  }
  if (ex.kind === 'circuit') return h + circuitBody(ex, e) + '</section>';
  h += `<div class="scheme">${esc(schemeFor(ex, draft, e.opt))}</div>`;
  const { same, last } = sources(ex, draft, e.opt);
  const hist = [];
  if (same) hist.push(`<div><span class="hl">${ex.kind === 'fund' ? `LAP ${same.log.lap} · C${same.log.cycle}` : `OPZ ${e.opt}`}</span>${setsLine(same.e)} <i>${esc(whenText(same.log.date))}</i>${noteLine(same.e)}</div>`);
  if (last && last !== same) hist.push(`<div><span class="hl">LAST${ex.kind === 'fund' && last.log.cycle ? ' · C' + last.log.cycle : ex.kind === 'opt' ? ' · OPZ ' + last.e.opt : ''}</span>${setsLine(last.e)} <i>${esc(whenText(last.log.date))}</i>${noteLine(last.e)}</div>`);
  h += `<div class="hist">${hist.join('') || '<div class="none">No history yet: first time</div>'}</div>`;
  if (ex.barbell) h += `<div class="plates" data-plates="${k}"></div>`;
  const sprint = ex.kind === 'sprint';
  h += `<div class="rows">`;
  let wi = 0, ki = 0;
  e.sets.forEach((s, i) => {
    const lbl = s.warm ? 'W' + (++wi) : String(++ki);
    h += `<div class="row ${s.warm ? 'warm' : ''} ${s.done ? 'done' : ''}" data-i="${i}">
      <div class="lbl">${lbl}</div>`;
    if (sprint) {
      h += `<div class="field wide"><input class="in t" data-f="t" inputmode="decimal" value="${esc(s.t)}" placeholder="sec" aria-label="Time set ${lbl}"><u>sec</u></div>`;
    } else {
      h += `<div class="wstep"><button class="st" data-act="step" data-f="w" data-d="-1" aria-label="Minus">−</button>
        <input class="in w" data-f="w" ${e.txt ? 'inputmode="text"' : 'inputmode="decimal"'} value="${esc(s.w)}" placeholder="${e.txt ? 'band' : 'kg'}" aria-label="Weight set ${lbl}">
        <button class="st" data-act="step" data-f="w" data-d="1" aria-label="Plus">+</button></div>
        <div class="field"><input class="in r" data-f="r" inputmode="numeric" value="${esc(s.r)}" placeholder="${esc(s.target || 'reps')}" aria-label="Reps set ${lbl}"><u>${esc(s.target || 'reps')}</u></div>`;
    }
    h += `<button class="tick" data-act="tick" aria-label="Done">${ICON.check}</button></div>`;
    if (s.dropT !== undefined) {
      h += `<div class="row drop" data-i="${i}"><div class="lbl">↓</div>
        <div class="wstep"><button class="st" data-act="step" data-f="w2" data-d="-1">−</button>
        <input class="in w" data-f="w2" inputmode="decimal" value="${esc(s.w2)}" placeholder="kg" aria-label="Drop weight">
        <button class="st" data-act="step" data-f="w2" data-d="1">+</button></div>
        <div class="field"><input class="in r" data-f="r2" inputmode="numeric" value="${esc(s.r2)}" placeholder="${esc(s.dropT || 'reps')}" aria-label="Drop reps"><u>${esc(s.dropT || 'reps')}</u></div>
        <div class="dlbl">drop</div></div>`;
    }
  });
  h += `</div><div class="exfoot"><button class="small" data-act="addset" data-key="${k}">+ SET</button>
    ${e.sets.length > 1 ? `<button class="small ghost" data-act="delset" data-key="${k}">− LAST</button>` : ''}
    ${sprint ? '' : `<button class="small ghost" data-act="txt" data-key="${k}" title="Switch keyboard">${e.txt ? '123' : 'Aa'}</button>`}</div>
    <textarea class="note" data-f="note" placeholder="Note" rows="1">${esc(e.note)}</textarea></section>`;
  return h;
}

function circuitBody(ex, e) {
  let h = `<div class="scheme">${ex.items.map((it, j) => `<div class="cstat"><b>${j + 1}</b> ${esc(it.name)}${it.detail ? ', ' + esc(it.detail) : ''} <span>${esc(it.reps)}</span></div>`).join('')}</div>`;
  const last = findEntry(ex.key, () => true);
  h += `<div class="hist">${last ? `<div><span class="hl">LAST</span>${setsLine(last.e)} <i>${esc(whenText(last.log.date))}</i></div>` : '<div class="none">No history yet: first time</div>'}</div>`;
  e.rounds.forEach((r, ri) => {
    h += `<div class="cround ${r.done ? 'done' : ''}" data-r="${ri}"><div class="crh"><span>GIRO ${ri + 1}</span>
      <button class="tick" data-act="rtick" aria-label="Round done">${ICON.check}</button></div>
      ${ex.items.map((it, j) => `<div class="crow" data-j="${j}"><div class="cn">${j + 1}. ${esc(it.name)}</div>
        <input class="in w" data-f="cw" inputmode="text" value="${esc(r.st[j].w)}" placeholder="kg" aria-label="Weight">
        <input class="in r" data-f="cr" inputmode="numeric" value="${esc(r.st[j].r)}" placeholder="${esc((it.reps.match(/(\d+(?:-\d+)?)\s*reps/i) || [, 'reps'])[1])}" aria-label="Reps"></div>`).join('')}</div>`;
  });
  h += `<div class="exfoot"><button class="small" data-act="addround" data-key="${esc(ex.key)}">+ GIRO</button>
    ${e.rounds.length > 1 ? `<button class="small ghost" data-act="delround" data-key="${esc(ex.key)}">− LAST</button>` : ''}</div>
    <textarea class="note" data-f="note" placeholder="Note" rows="1">${esc(e.note)}</textarea>`;
  return h;
}

function updatePlates(key) {
  const el = document.querySelector(`[data-plates="${CSS.escape(key)}"]`);
  if (!el) return;
  const e = draft.entries[key];
  const ws = e.sets.filter(s => !s.warm).map(s => num(s.w)).filter(n => n !== null);
  const top = ws.length ? Math.max(...ws) : null;
  if (top === null || top < BAR || top > 600) {   // >600 kg is a typo, not a barbell load
    el.innerHTML = top === null || top > 600 ? '' : `<span class="pl-t">${fmt(top)} kg · lighter than the ${BAR} kg bar</span>`;
    return;
  }
  let side = (top - BAR) / 2;
  const used = [];
  for (const [w, c] of PLATES) while (side >= w - 1e-9) { used.push([w, c]); side -= w; }
  el.innerHTML = `<div class="bar"><i class="sleeve"></i>${used.map(([w, c]) => `<i class="pl ${c}" title="${w}"></i>`).join('')}<i class="collar"></i></div>
    <span class="pl-t">TOP ${fmt(top)} = bar ${BAR} + ${used.length ? used.map(u => fmt(u[0])).join(' · ') : 'nothing'} per side${side > 0.01 ? ` (+${fmt(side * 2)} off)` : ''}</span>`;
}

function renderHistory() {
  let h = `<header class="top plate"><button class="icon" data-act="home" aria-label="Back">${ICON.back}</button>
    <div class="stitle"><div class="sid">LOG</div><div class="sname">${state.logs.filter(l => !l.imported).length} sessions</div></div><span class="icon"></span></header>`;
  const logs = state.logs.slice().reverse();
  if (!logs.length) h += '<div class="empty">Nothing logged yet.</div>';
  for (const l of logs) {
    const s = SESS[l.sid];
    const lines = Object.entries(l.entries).filter(([, e]) => e.inc).map(([k, e]) =>
      `<div class="hrow"><b>${esc(EX[k]?.name || k)}${e.opt ? ` <span class="x">OPZ ${e.opt}</span>` : ''}</b><span>${setsLine(e)}</span>${noteLine(e)}</div>`).join('');
    h += `<section class="card hlog"><div class="hh"><div><span class="code-s">${esc(l.sid)}</span>
      ${l.cycle ? `C${l.cycle} · LAP ${l.lap}` : ''}</div><div class="hd">${l.date ? new Date(l.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'from Excel'}</div></div>
      ${lines}<button class="small ghost del" data-act="dellog" data-id="${esc(l.id)}">Delete</button></section>`;
  }
  $('#app').innerHTML = h;
}

/* ---------- rest timer ---------- */
let tick = null, audio = null;
function startTimer(sec) {
  if (!draft) return;
  draft.timerDur = sec; draft.timerEnd = Date.now() + sec * 1000; draft.timerFired = false;
  saveDraft(); renderDock();
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch { }
}
function renderDock() {
  const d = $('#dock');
  clearInterval(tick);
  if (view !== 'session' || !draft) { d.innerHTML = ''; d.className = ''; return; }
  const left = draft.timerEnd ? Math.ceil((draft.timerEnd - Date.now()) / 1000) : null;
  if (left === null || left <= -30) {
    d.className = 'idle';
    d.innerHTML = `<span class="dl">REST</span>${[90, 120, 150, 180].map(s => `<button data-act="timer" data-s="${s}">${s}″</button>`).join('')}`;
    if (left !== null) { draft.timerEnd = 0; saveDraft(); }
    return;
  }
  const paint = () => {
    const l = Math.ceil((draft.timerEnd - Date.now()) / 1000);
    if (l <= 0 && !draft.timerFired) { draft.timerFired = true; saveDraft(); alarm(); }
    if (l <= -30) return renderDock();
    const a = Math.abs(l), pct = Math.max(0, Math.min(100, 100 - (l / draft.timerDur) * 100));
    d.className = l <= 0 ? 'run over' : 'run';
    d.innerHTML = `<div class="prog" style="width:${pct}%"></div><button data-act="tadd" data-s="-15">−15</button>
      <div class="clock">${l <= 0 ? 'GO' : Math.floor(a / 60) + ':' + String(a % 60).padStart(2, '0')}</div>
      <button data-act="tadd" data-s="15">+15</button><button class="stop" data-act="tstop" aria-label="Stop timer">${ICON.x}</button>`;
  };
  paint();
  tick = setInterval(paint, 250);
}
function alarm() {
  try { navigator.vibrate?.([400, 150, 400, 150, 700]); } catch { }
  try {
    if (!audio) return;
    [0, 0.25, 0.5].forEach(t => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
      g.gain.setValueAtTime(0.0001, audio.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.4, audio.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + 0.2);
      o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.22);
    });
  } catch { }
}

/* ---------- wake lock (screen stays on during a session) ---------- */
let wake = null;
async function keepAwake(on) {
  try {
    if (on && !wake && navigator.wakeLock && document.visibilityState === 'visible') {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    } else if (!on && wake) { await wake.release(); wake = null; }
  } catch { wake = null; }
}

/* ---------- actions ---------- */
function go(v, push = true) {
  view = v;
  if (push && v !== 'home') history.pushState({ v }, '');
  window.scrollTo(0, 0);
  keepAwake(v === 'session');
  render();
}
addEventListener('popstate', () => { closeSheet(); view = 'home'; keepAwake(false); render(); });

function startSession(sid) {
  if (draft && draft.sid !== sid) {
    return confirmSheet(`A ${draft.sid} session is in progress. Discard it and start ${sid}?`, 'Discard & start', () => {
      draft = newDraft(sid); saveDraft(true); go('session');
    });
  }
  if (!draft) { draft = newDraft(sid); saveDraft(true); }
  go('session');
}

function changeCycle(dir) {
  const f = fundOf(draft.sid), n = f.cycles.length;
  let c = draft.cycle + dir, lap = draft.lap;
  if (c > n) { c = 1; lap++; }
  if (c < 1) { if (lap <= 1) return toast('Already at the first cycle'); c = n; lap--; }
  const apply = () => { draft.cycle = c; draft.lap = lap; draft.entries[f.key] = makeEntry(f, draft); saveDraft(true); render(); };
  const e = draft.entries[f.key];
  if (e.sets.some(s => s.done)) confirmSheet(`Switch to CICLO ${c}? The ${f.name} sets you ticked will be rebuilt for the new cycle.`, 'Switch', apply);
  else apply();
}

function cleanEntry(e) {
  if (!e.inc) return { inc: false };
  if (e.rounds) {
    const rounds = e.rounds.filter(r => r.done || r.st.some(x => x.w || x.r));
    return { inc: rounds.length > 0, rounds, note: e.note || '' };
  }
  const has = s => s.done || s.r || s.t || s.w2 || s.r2;
  const anyDone = e.sets.some(s => s.done);
  const sets = e.sets.filter(s => anyDone ? s.done : has(s)).map(s => {
    const o = { warm: !!s.warm, target: s.target };
    for (const f of ['w', 'r', 't', 'w2', 'r2']) if (s[f] !== undefined && s[f] !== '') o[f] = s[f];
    return o;
  });
  const out = { inc: sets.length > 0 || !!e.note, sets, note: e.note || '' };
  if (e.opt) out.opt = e.opt;
  return out;
}

function finish() {
  const s = SESS[draft.sid];
  const entries = {};
  let logged = 0;
  for (const ex of s.exercises) { entries[ex.key] = cleanEntry(draft.entries[ex.key]); if (entries[ex.key].inc) logged++; }
  const doIt = () => {
    const log = { id: 'L' + Date.now().toString(36), sid: draft.sid, date: new Date().toISOString(), started: draft.started,
      lap: draft.lap, cycle: draft.cycle, act: draft.act.filter(Boolean).length, entries };
    state.logs.push(log);
    const f = fundOf(draft.sid);
    if (f) state.prog[draft.sid] = next(draft.cycle, draft.lap, f.cycles.length);
    for (const ex of s.exercises) if (ex.kind === 'opt' && entries[ex.key].inc) state.lastOpt[ex.key] = entries[ex.key].opt;
    state.sinceBackup++;
    save();
    draft = null; saveDraft(true);
    history.replaceState(null, '');
    go('home', false);
    toast(f ? `Saved. Next ${s.id}: CICLO ${progOf(s.id).cycle}` : 'Saved');
  };
  if (!logged) return confirmSheet('Nothing logged in this session. Save it anyway?', 'Save empty', doIt);
  const skipped = s.exercises.filter(ex => draft.entries[ex.key].inc && !entries[ex.key].inc).map(ex => ex.name);
  confirmSheet(`Finish ${s.id}?<br><small>${logged} exercise${logged > 1 ? 's' : ''} logged${skipped.length ? ' · nothing entered for ' + skipped.map(esc).join(', ') : ''}</small>`, 'Finish', doIt);
}

function stepValue(input, field, dir) {
  const cur = num(input.value);
  let v = cur === null ? (dir > 0 ? STEP : 0) : cur + dir * STEP;
  v = Math.max(0, Math.round(v / 0.25) * 0.25);
  input.value = fmt(v);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act, key = b.dataset.key;
  const card = b.closest('.card[data-key]'), ck = card?.dataset.key;
  const row = b.closest('.row'), ri = row ? +row.dataset.i : -1;
  switch (act) {
    case 'start': return startSession(b.dataset.sid);
    case 'resume': return go('session');
    case 'home': return history.state ? history.back() : go('home', false);
    case 'menu': return menuSheet();
    case 'smenu': return sessionSheet();
    case 'backup': closeSheet(); return backup();
    case 'restore': closeSheet(); return $('#restoreFile').click();
    case 'export': closeSheet(); return exportXlsx();
    case 'history': closeSheet(); return go('history');
    case 'sheetclose': return closeSheet();
    case 'cyc': return changeCycle(+b.dataset.d);
    case 'actr': {
      const i = +b.dataset.i; draft.act[i] = !draft.act[i]; saveDraft();
      if (draft.act[i]) startTimer(90);
      return renderSession();
    }
    case 'inc': { const e = draft.entries[key]; e.inc = !e.inc; saveDraft(); return keepScroll(renderSession); }
    case 'opt': {
      const ex = EX[key], o = +b.dataset.o, e = draft.entries[key];
      if (e.opt === o) return;
      const apply = () => { const ne = makeEntry(ex, draft, o); ne.inc = true; ne.note = e.note; draft.entries[key] = ne; saveDraft(); keepScroll(renderSession); };
      if (e.sets.some(s => s.done)) return confirmSheet(`Switch to OPZ ${o}? The ticked sets will be rebuilt.`, 'Switch', apply);
      return apply();
    }
    case 'step': {
      const input = b.parentElement.querySelector('input');
      return stepValue(input, b.dataset.f, +b.dataset.d);
    }
    case 'tick': {
      const e = draft.entries[ck];
      if (b.closest('.cround')) return;
      const s = e.sets[ri];
      s.done = !s.done;
      row.classList.toggle('done', s.done);
      saveDraft();
      if (s.done) { try { navigator.vibrate?.(30); } catch { } startTimer(s.warm ? 90 : 120); }
      return;
    }
    case 'rtick': {
      const r = draft.entries[ck].rounds[+b.closest('.cround').dataset.r];
      r.done = !r.done; b.closest('.cround').classList.toggle('done', r.done); saveDraft();
      if (r.done) startTimer(150);
      return;
    }
    case 'addset': {
      const e = draft.entries[key], src = e.sets.filter(s => !s.warm).at(-1) || e.sets.at(-1);
      const n = { warm: false, target: src?.target || '', w: src?.w || '', r: src?.r || '', done: false };
      if (EX[key].kind === 'sprint') { n.t = ''; delete n.w; n.r = ''; }
      const di = e.sets.findIndex(s => s.dropT !== undefined);
      if (di >= 0) e.sets.splice(di, 0, n); else e.sets.push(n);
      saveDraft(); return keepScroll(renderSession);
    }
    case 'delset': {
      const e = draft.entries[key];
      if (e.sets.length <= 1) return;
      const di = e.sets.findIndex(s => s.dropT !== undefined);
      e.sets.splice(di >= 1 ? di - 1 : e.sets.length - 1, 1);
      saveDraft(); return keepScroll(renderSession);
    }
    case 'txt': { const e = draft.entries[key]; e.txt = !e.txt; saveDraft(); return keepScroll(renderSession); }
    case 'addround': {
      const e = draft.entries[key];
      if (e.rounds.length >= 10) return;
      e.rounds.push({ done: false, st: EX[key].items.map((_, j) => ({ w: e.rounds.at(-1)?.st[j]?.w || '', r: '' })) });
      saveDraft(); return keepScroll(renderSession);
    }
    case 'delround': { const e = draft.entries[key]; if (e.rounds.length > 1) e.rounds.pop(); saveDraft(); return keepScroll(renderSession); }
    case 'finish': return finish();
    case 'discard': return confirmSheet('Discard this session? Nothing will be saved.', 'Discard', () => {
      draft = null; saveDraft(true); history.replaceState(null, ''); go('home', false);
    });
    case 'timer': return startTimer(+b.dataset.s);
    case 'tadd': draft.timerEnd += +b.dataset.s * 1000; draft.timerDur = Math.max(15, draft.timerDur + +b.dataset.s); draft.timerFired = false; saveDraft(); return renderDock();
    case 'tstop': draft.timerEnd = 0; saveDraft(); return renderDock();
    case 'dellog': {
      const id = b.dataset.id;
      return confirmSheet('Delete this log entry? Cycles are not rolled back automatically.', 'Delete', () => {
        state.logs = state.logs.filter(l => l.id !== id); save(); render();
      });
    }
    case 'confirm': { const f = sheetCb; closeSheet(); return f && f(); }
  }
});

document.addEventListener('input', ev => {
  const t = ev.target;
  if (!draft || !t.dataset.f) return;
  const card = t.closest('.card[data-key]');
  if (!card) return;
  const e = draft.entries[card.dataset.key], f = t.dataset.f;
  if (f === 'note') { e.note = t.value.slice(0, 500); t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
  else if (f === 'cw' || f === 'cr') {
    const r = e.rounds[+t.closest('.cround').dataset.r], j = +t.closest('.crow').dataset.j;
    r.st[j][f === 'cw' ? 'w' : 'r'] = t.value.slice(0, 40);
  } else {
    const s = e.sets[+t.closest('.row').dataset.i];
    s[f] = t.value.slice(0, 40);
    if (f === 'w') updatePlates(card.dataset.key);
  }
  saveDraft();
});
document.addEventListener('focusin', ev => { if (ev.target.matches('input.in')) setTimeout(() => ev.target.select?.(), 0); });

function keepScroll(fn) { const y = window.scrollY; fn(); window.scrollTo(0, y); }

/* ---------- sheets (bottom dialogs) ---------- */
let sheetCb = null;
function openSheet(html) {
  const sh = $('#sheet');
  sh.innerHTML = `<div class="scrim" data-act="sheetclose"></div><div class="panel">${html}</div>`;
  sh.hidden = false;
}
function closeSheet() { const sh = $('#sheet'); sh.hidden = true; sh.innerHTML = ''; sheetCb = null; }
function confirmSheet(msg, ok, cb) {
  openSheet(`<p class="q">${msg}</p><div class="btns"><button class="small ghost" data-act="sheetclose">Cancel</button>
    <button class="small" data-act="confirm">${esc(ok)}</button></div>`);
  sheetCb = cb;
}
function menuSheet() {
  const n = state.logs.filter(l => !l.imported).length;
  openSheet(`<div class="mtitle">Mauro_gym</div>
    <button class="mi" data-act="history">${ICON.list}<span>Log<small>${n} sessions saved</small></span></button>
    <button class="mi" data-act="backup">${ICON.save}<span>Back up<small>${state.lastBackup ? 'last ' + whenText(state.lastBackup) : 'never backed up'} · share to Drive, WhatsApp, Files</small></span></button>
    <button class="mi" data-act="restore">${ICON.load}<span>Restore backup<small>replaces the data on this phone</small></span></button>
    <button class="mi" data-act="export">${ICON.grid}<span>Export to Excel<small>one row per set</small></span></button>
    <div class="mstat">Storage: ${!storageOk ? 'BLOCKED' : persisted ? 'protected (persistent)' : persisted === false ? 'normal (install the app to protect it)' : 'normal'}</div>`);
}
function sessionSheet() {
  openSheet(`<div class="mtitle">${esc(draft.sid)}</div>
    <button class="mi" data-act="discard">${ICON.x}<span>Discard session<small>nothing is saved</small></span></button>
    <button class="mi" data-act="sheetclose">${ICON.back}<span>Close</span></button>`);
}

let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600);
}

/* ---------- backup / restore / export ---------- */
async function shareFile(blob, name, title) {
  const file = new File([blob], name, { type: blob.type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title }); return true; }
  } catch (e) { if (e && e.name === 'AbortError') return false; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return true;
}
const stamp = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
async function backup() {
  const data = JSON.stringify({ ...state, exported: new Date().toISOString(), draft: draft || null });
  const ok = await shareFile(new Blob([data], { type: 'application/json' }), `mauro_gym_backup_${stamp()}.json`, 'Mauro_gym backup');
  if (ok) { state.sinceBackup = 0; state.lastBackup = new Date().toISOString(); save(); render(); toast('Backup created'); }
}
$('#restoreFile').addEventListener('change', async ev => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (!f) return;
  if (f.size > 20e6) return toast('That file is too big to be a Mauro_gym backup');
  let o;
  try { o = JSON.parse(await f.text()); } catch { return toast('Not a valid backup file (unreadable JSON)'); }
  if (!validState(o)) return toast('Not a Mauro_gym backup');
  if (o.version > DATA_VERSION) return toast('Backup is from a newer app version');
  const fresh = normalize(o), n = fresh.logs.filter(l => !l.imported).length;
  confirmSheet(`Restore backup with ${n} sessions?<br><small>The ${state.logs.filter(l => !l.imported).length} sessions on this phone are replaced (a safety copy is kept).</small>`, 'Restore', () => {
    sset(PREV, JSON.stringify(state));
    const d = fresh.draft; delete fresh.draft; delete fresh.exported;
    state = fresh; save();
    if (d && SESS[d.sid] && d.entries && !draft) { draft = d; saveDraft(true); }
    go('home', false); toast('Backup restored');
  });
});

function exportXlsx() {
  const head = ['Date', 'Lap', 'Ciclo', 'Exercise', 'Opzione', 'Set', 'Weight', 'Reps', 'Drop weight', 'Drop reps', 'Time (s)', 'Note'];
  const sheets = PROGRAM.sessions.map(s => ({ name: s.id + ' ' + s.title.split(/[+,]/)[0].trim(), rows: [head] }));
  const by = Object.fromEntries(PROGRAM.sessions.map((s, i) => [s.id, sheets[i]]));
  const cell = v => { const n = num(v); return n !== null && /^\s*\d+([.,]\d+)?\s*$/.test(v) ? n : (v ?? ''); };
  for (const l of state.logs) {
    const sh = by[l.sid];
    const date = l.date ? new Date(l.date).toLocaleDateString('en-GB') : 'Excel';
    for (const [k, e] of Object.entries(l.entries)) {
      if (!e.inc) continue;
      const name = EX[k]?.name || k;
      const base = [date, l.lap ?? '', l.cycle ?? '', name, e.opt ?? ''];
      if (e.raw !== undefined && !(e.sets || []).length) { sh.rows.push([...base, '-', cell(e.raw), '', '', '', '', 'imported from workbook']); continue; }
      if (e.rounds) {
        e.rounds.forEach((r, ri) => EX[k].items.forEach((it, j) => {
          if (r.st[j].w || r.st[j].r) sh.rows.push([date, '', '', it.name, '', 'Giro ' + (ri + 1), cell(r.st[j].w), cell(r.st[j].r), '', '', '', ri === 0 && j === 0 ? e.note : '']);
        }));
        continue;
      }
      let wi = 0, ki = 0;
      e.sets.forEach((s, i) => sh.rows.push([...base, s.warm ? 'W' + (++wi) : ++ki, cell(s.w), cell(s.r), cell(s.w2), cell(s.r2), cell(s.t), i === 0 ? e.note : '']));
      if (!e.sets.length && e.note) sh.rows.push([...base, '', '', '', '', '', '', e.note]);
    }
  }
  shareFile(XLSX_MIN(sheets), `mauro_gym_${stamp()}.xlsx`, 'Mauro_gym export').then(ok => ok && toast('Excel file created'));
}

/* ---------- icons ---------- */
const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICON = {
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  arrow: svg('<path d="M9 5l7 7-7 7"/>'),
  dots: svg('<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  list: svg('<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>'),
  save: svg('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'),
  load: svg('<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>'),
  grid: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 16h16M10 4v16"/>'),
};

/* ---------- boot ---------- */
load();
if (navigator.storage?.persist) {
  navigator.storage.persisted().then(p => p || navigator.storage.persist()).then(p => { persisted = p; if (view === 'home') render(); }).catch(() => { });
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { keepAwake(view === 'session'); renderDock(); }
  else saveDraft(true);
});
addEventListener('pagehide', () => saveDraft(true));
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
if (draft) { view = 'session'; history.pushState({ v: 'session' }, ''); keepAwake(true); }
render();
