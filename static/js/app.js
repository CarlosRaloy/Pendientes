/* =========================================================
   Pendientes — lógica del dashboard (listado + Gantt)
   ========================================================= */
(() => {
  'use strict';

  const API = '/api/pendientes/';
  const DAY = 86400000;
  const ESTATUS = { proceso: 'En proceso', terminado: 'Terminado', cancelado: 'Cancelado' };
  const ORDEN = { proceso: 0, terminado: 1, cancelado: 2 };
  const ZOOM = { dia: 42, semana: 16 };
  const PESO = { alta: 3, media: 2, baja: 1 };
  const PRIO = { alta: 'Alta', media: 'Media', baja: 'Baja' };
  const PALABRAS = [
    'mariposa', 'girasol', 'cascada', 'tortuga', 'montaña', 'guitarra', 'limonada', 'relámpago',
    'galleta', 'pingüino', 'ventana', 'cometa', 'manzana', 'ballena', 'castillo', 'almohada',
    'tormenta', 'volcán', 'luciérnaga', 'sombrero', 'chocolate', 'arcoíris', 'tambor', 'pirámide',
    'tiburón', 'mandarina', 'faro', 'brújula', 'canela', 'colibrí', 'aguacate', 'jaguar',
  ];

  const state = {
    items: [], filter: 'proceso', search: '', zoom: 'dia', sort: 'sugerido', editing: null,
    rank: new Map(), closedNum: new Map(), ranked: [], qaPrio: 'media', prio: null, byId: new Map(),
    viewKey: '', listLimit: 0, ganttLimit: 0,
    hideClosed: pref('hideClosed', false), sidebar: pref('sidebar', true),
    glass: pref('glass', 'auto'), // 'auto' | 'on' | 'off'
    theme: pref('theme', 'auto'), // 'auto' | 'light' | 'dark'
  };

  // Preferencias por navegador (si no hay almacenamiento, se usan los valores por defecto)
  function pref(key, def) {
    try { const v = localStorage.getItem(`pendientes.${key}`); return v === null ? def : JSON.parse(v); } catch { return def; }
  }
  function savePref(key, val) {
    try { localStorage.setItem(`pendientes.${key}`, JSON.stringify(val)); } catch { /* sin almacenamiento */ }
  }

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  /* ---------- Fechas (siempre locales, sin horas) ---------- */
  const parse = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const diff = (a, b) => Math.round((a - b) / DAY); // días de b a a
  const fmt = (d, opts) => d.toLocaleDateString('es-MX', opts);
  const fmtShort = (d) => {
    const sameYear = d.getFullYear() === today().getFullYear();
    return fmt(d, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '');
  };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- API ---------- */
  const csrf = () => (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1] || '';
  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo completar la acción.');
    return data;
  }

  /* ---------- Derivados ---------- */
  const isVencido = (p) => p.estatus === 'proceso' && parse(p.fecha_fin) < today();
  const visualStatus = (p) => (isVencido(p) ? 'vencido' : p.estatus);

  function timeInfo(p) {
    const t = today();
    const ini = parse(p.fecha_inicio);
    const fin = parse(p.fecha_fin);
    const total = diff(fin, ini) + 1;

    if (p.estatus === 'terminado') {
      const cierre = p.fecha_cierre ? parse(p.fecha_cierre) : t;
      const tarde = diff(cierre, fin);
      return tarde > 0
        ? { label: `Terminado ${plural(tarde, 'día', 'días')} tarde`, cls: 'late', pct: 100, bar: 'done' }
        : { label: 'Terminado a tiempo', cls: 'ok', pct: 100, bar: 'done' };
    }
    if (p.estatus === 'cancelado') {
      const c = p.fecha_cierre ? parse(p.fecha_cierre) : t;
      return { label: `Cancelado el ${fmtShort(c)}`, cls: '', pct: 100, bar: 'off' };
    }
    const faltan = diff(fin, t);
    const pct = Math.max(0, Math.min(100, ((diff(t, ini) + 1) / total) * 100));
    if (faltan < 0) return { label: `Vencido hace ${plural(-faltan, 'día', 'días')}`, cls: 'late', pct: 100, bar: 'late' };
    if (faltan === 0) return { label: 'Vence hoy', cls: 'warn', pct, bar: 'warn' };
    if (faltan === 1) return { label: 'Vence mañana', cls: 'warn', pct, bar: 'warn' };
    if (faltan <= 3) return { label: `Faltan ${faltan} días`, cls: 'warn', pct, bar: 'warn' };
    return { label: `Faltan ${faltan} días`, cls: '', pct, bar: '' };
  }

  /* ---------- Prioridad sugerida: ¿qué hago primero? ----------
     Combina tres cosas:
       1) Urgencia: cuántos días faltan (o cuántos lleva vencido).
       2) Importancia que tú le diste (alta / media / baja).
       3) Avance del tiempo: si ya se consumió casi todo su plazo, sube.  */
  function priorityInfo(p) {
    const t = today();
    const ini = parse(p.fecha_inicio);
    const fin = parse(p.fecha_fin);
    const faltan = diff(fin, t);
    const total = diff(fin, ini) + 1;
    const pct = Math.max(0, Math.min(100, Math.round(((diff(t, ini) + 1) / total) * 100)));
    const urg = faltan < 0 ? 12 + Math.min(-faltan, 10) * 0.5 : 10 / (faltan + 1);
    const score = PESO[p.prioridad || 'media'] * urg * (1 + pct / 200);

    const reasons = [];
    if (faltan < 0) reasons.push(`Lleva ${plural(-faltan, 'día', 'días')} vencido`);
    else if (faltan === 0) reasons.push('Vence hoy');
    else if (faltan === 1) reasons.push('Vence mañana');
    else if (faltan <= 3) reasons.push(`Vence en ${faltan} días`);
    if (p.prioridad === 'alta') reasons.push('Importancia alta para tus metas');
    if (faltan > 0 && pct >= 75) reasons.push(`Ya usaste el ${pct}% de su plazo`);
    if (!reasons.length) reasons.push(`Tienes ${plural(faltan, 'día', 'días')} de margen`);
    return { score, reasons };
  }

  // Ranking global (no depende del filtro) para que el número sea estable
  function computeRanking() {
    const ranked = state.items
      .filter((p) => p.estatus === 'proceso')
      .map((p) => ({ p, ...priorityInfo(p) }))
      .sort((a, b) => b.score - a.score || a.p.fecha_fin.localeCompare(b.p.fecha_fin) || a.p.id - b.p.id);
    state.rank = new Map(ranked.map((r, i) => [r.p.id, i + 1]));
    // Los terminados y cancelados siguen la numeración después de los que están en proceso
    const closed = state.items.filter((p) => p.estatus !== 'proceso')
      .sort((a, b) => ORDEN[a.estatus] - ORDEN[b.estatus] || a.fecha_fin.localeCompare(b.fecha_fin) || a.id - b.id);
    state.closedNum = new Map(closed.map((p, i) => [p.id, ranked.length + i + 1]));
    state.byId = new Map(state.items.map((p) => [p.id, p]));
    state.ranked = ranked;
  }

  function visibleItems() {
    const q = state.search.trim().toLowerCase();
    const byDate = (a, b) => ORDEN[a.estatus] - ORDEN[b.estatus] || a.fecha_fin.localeCompare(b.fecha_fin) || a.id - b.id;
    const bySuggested = (a, b) => {
      const ra = state.rank.get(a.id), rb = state.rank.get(b.id);
      if (ra && rb) return ra - rb;
      if (ra || rb) return ra ? -1 : 1;
      return byDate(a, b);
    };
    return state.items
      .filter((p) => {
        if (state.filter === 'vencido') return isVencido(p);
        if (state.filter === 'todos') return !(state.hideClosed && p.estatus !== 'proceso');
        return p.estatus === state.filter;
      })
      .filter((p) => !state.prio || p.prioridad === state.prio)
      .filter((p) => !q || p.nombre.toLowerCase().includes(q))
      .sort(state.sort === 'sugerido' ? bySuggested : byDate);
  }

  /* ---------- Render: encabezado ---------- */
  function renderHeader() {
    const h = new Date().getHours();
    $('#greeting').textContent = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
    $('#hero-date').textContent = cap(fmt(today(), { weekday: 'long', day: 'numeric', month: 'long' }));

    const counts = { todos: state.items.length, proceso: 0, vencido: 0, terminado: 0, cancelado: 0 };
    const prios = { alta: 0, media: 0, baja: 0 };
    let hoy = 0;
    for (const p of state.items) {
      counts[p.estatus]++;
      if (isVencido(p)) counts.vencido++;
      if (p.estatus === 'proceso') prios[p.prioridad || 'media']++;
      if (p.estatus === 'proceso' && diff(parse(p.fecha_fin), today()) === 0) hoy++;
    }
    for (const k in counts) $(`[data-stat="${k}"]`).textContent = counts[k];
    for (const k in prios) $(`[data-prio-stat="${k}"]`).textContent = prios[k];
    $('[data-stat="vencido"]').classList.toggle('zero', counts.vencido === 0);

    let resumen;
    if (!state.items.length) resumen = 'Aún no tienes pendientes. Escribe abajo el primero.';
    else if (!counts.proceso) resumen = 'Todo al día: no tienes pendientes en proceso.';
    else {
      resumen = `Tienes <b>${plural(counts.proceso, 'pendiente', 'pendientes')}</b> en proceso`;
      const extra = [];
      if (hoy) extra.push(`${hoy === 1 ? 'uno vence' : `${hoy} vencen`} hoy`);
      if (counts.vencido) extra.push(`${counts.vencido === 1 ? 'uno ya se pasó' : `${counts.vencido} ya se pasaron`} de fecha`);
      resumen += extra.length ? `: ${extra.join(' y ')}.` : '.';
    }
    $('#today-label').innerHTML = resumen;

    // Progreso: terminados sobre todo lo que no se canceló
    const base = counts.todos - counts.cancelado;
    $('#pc-text').textContent = `${counts.terminado} de ${base}`;
    $('#pc-bar').style.width = `${base ? Math.round((counts.terminado / base) * 100) : 0}%`;

    $$('.side[data-filter]').forEach((b) => b.classList.toggle('selected', !state.prio && b.dataset.filter === state.filter));
    const FN = { proceso: 'En proceso', vencido: 'Vencidos', terminado: 'Terminados', cancelado: 'Cancelados' };
    const parts = [];
    if (state.prio) parts.push(`Importancia ${PRIO[state.prio].toLowerCase()}`);
    else if (state.filter !== 'proceso') parts.push(state.filter === 'todos' ? 'Todos' : FN[state.filter]);
    if (state.search.trim()) parts.push(`“${state.search.trim()}”`);
    $('#filter-chip').hidden = !parts.length;
    $('#filter-chip-txt').textContent = `Mostrando: ${parts.join(' · ')}`;
    $$('.side[data-prio]').forEach((b) => b.classList.toggle('selected', b.dataset.prio === state.prio));
  }

  /* ---------- Render: listado ---------- */
  const chev = '<span class="popup-arrows" aria-hidden="true"><svg viewBox="0 0 10 14"><path d="M2.5 5.2L5 2.7l2.5 2.5M2.5 8.8L5 11.3l2.5-2.5"/></svg></span>';

  const trash = '<svg viewBox="0 0 24 24"><path d="M4 7h16M9.5 7V4.8c0-.4.4-.8.8-.8h3.4c.4 0 .8.4.8.8V7M6.5 7l.9 12.2c.1.9.8 1.8 1.8 1.8h5.6c1 0 1.7-.9 1.8-1.8L17.5 7M10 11v6M14 11v6"/></svg>';
  // 1-3: azul Aqua (lo primero que conviene hacer) · 4+: en proceso · gris: ya cerrados
  const rankBadge = (r, p) => {
    if (r) return `<span class="rank${r <= 3 ? ' top' : ' next'}" title="Orden sugerido: ${r}">${r}</span>`;
    const n = state.closedNum.get(p.id);
    return `<span class="rank closed" title="${ESTATUS[p.estatus]}">${n ?? ''}</span>`;
  };
  const prioTag = (p) => `<span class="prio-tag ${p.prioridad}"><i class="flag ${p.prioridad}"></i>${PRIO[p.prioridad]}</span>`;

  // Carga por día: cuántos pendientes en proceso coinciden (los vencidos cuentan hasta hoy)
  function loadCounter() {
    const t = today();
    const activos = state.items.filter((p) => p.estatus === 'proceso').map((p) => {
      const fin = parse(p.fecha_fin);
      return [parse(p.fecha_inicio), fin < t ? t : fin];
    });
    return (d) => activos.reduce((n, [a, b]) => n + (d >= a && d <= b ? 1 : 0), 0);
  }

  const icTrend = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17l5-5 4 4 8-8"/><path d="M15 8h5v5"/></svg>';
  const icCalm = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  function renderSuggestions() {
    const box = $('#sug');
    const [first, ...rest] = state.ranked;
    box.hidden = !first;
    if (!first) return;
    const p = first.p;
    const t = timeInfo(p);
    $('#sug-main').innerHTML = `
      <span class="sheen" aria-hidden="true"></span>
      <span class="glow" aria-hidden="true"></span>
      <span class="sug-badge"><span class="pulse"></span>Empieza por aquí</span>
      <h3 data-open="${p.id}">${esc(p.nombre)}</h3>
      <p class="sug-why">${first.reasons.map(esc).join(' · ')}</p>
      <div class="sug-meta">
        <span>Fecha fin: <b>${fmtShort(parse(p.fecha_fin))}</b></span>
        <span>${t.label}</span>
        <span>Importancia <b>${PRIO[p.prioridad].toLowerCase()}</b></span>
      </div>
      <div class="sug-actions">
        <button class="btn-primary sm" type="button" data-done="${p.id}">Ya lo terminé</button>
        <button class="btn-ghost sm" type="button" data-open="${p.id}">Detalles</button>
      </div>`;

    // Consejo: el día más cargado de las próximas 2 semanas
    const loadOn = loadCounter();
    const t0 = today();
    let peak = t0, max = 0;
    for (let i = 0; i < 14; i++) {
      const d = addDays(t0, i);
      const n = loadOn(d);
      if (n > max) { max = n; peak = d; }
    }
    const tip = $('#sug-tip');
    if (max >= 3) {
      const cuando = diff(peak, t0) === 0 ? 'hoy' : diff(peak, t0) === 1 ? 'mañana' : `el ${fmt(peak, { weekday: 'long', day: 'numeric' })}`;
      tip.innerHTML = `<span class="tip-ic">${icTrend}</span>
        <b>Tu día más cargado es ${cuando}</b>
        <p>Se juntan ${max} pendientes. Si cierras los dos primeros de la lista, ${diff(peak, t0) === 0 ? 'el resto de la semana queda ligero' : 'llegarás con menos presión'}.</p>`;
    } else {
      tip.innerHTML = `<span class="tip-ic calm">${icCalm}</span>
        <b>Tu semana se ve tranquila</b>
        <p>Nunca tienes más de ${plural(max, 'pendiente', 'pendientes')} a la vez. Buen momento para adelantar lo de importancia alta.</p>`;
    }

    $('#sug-next').innerHTML = rest.slice(0, 3).map((r, i) => `
      <li class="glass lift" data-open="${r.p.id}">
        <span class="rank${i < 2 ? ' top' : ''}">${i + 2}</span>
        <div><b>${esc(r.p.nombre)}</b><small>${esc(r.reasons.join(' · '))}</small></div>
      </li>`).join('');
  }

  function renderList(items) {
    const list = $('#list');
    list.innerHTML = items.map((p, i) => {
      const vs = visualStatus(p);
      const t = timeInfo(p);
      const label = vs === 'vencido' ? 'Vencido' : ESTATUS[p.estatus];
      const r = state.rank.get(p.id);
      return `
        <li class="row ${p.estatus}${r && r <= 3 ? ' is-top' : ''}" data-id="${p.id}" style="animation-delay:${Math.min(i, 12) * 25}ms">
          ${rankBadge(r, p)}
          <div class="name-cell">
            <div class="name" title="${esc(p.nombre)}">${esc(p.nombre)}</div>
            ${p.estatus === 'proceso' ? prioTag(p) : ''}
          </div>
          <div class="date">${fmtShort(parse(p.fecha_fin))}</div>
          <div class="time">
            <span class="time-label ${t.cls}">${t.label}</span>
            <div class="bar-mini"><span class="${t.bar}" style="width:${t.pct}%"></span></div>
          </div>
          <button class="pill ${vs}" data-action="status" aria-haspopup="menu" title="Cambiar estatus"><span class="dot ${vs}"></span><span class="pill-txt">${label}</span>${chev}</button>
          <button class="trash" data-action="delete" title="Eliminar" aria-label="Eliminar pendiente">${trash}</button>
        </li>`;
    }).join('');
    $('#list-hint').textContent = state.sort === 'sugerido'
      ? 'Ordenado por lo que te conviene hacer primero (urgencia + importancia).'
      : 'Ordenado por fecha de fin.';

    const empty = $('#empty');
    empty.hidden = items.length > 0;
    if (!items.length) {
      $('#empty-text').textContent = state.items.length
        ? 'No hay pendientes que coincidan con este filtro.'
        : 'Sin pendientes por ahora. Escribe arriba qué tienes que hacer.';
    }
  }

  /* ---------- Render: Gantt ---------- */
  function renderGantt(items) {
    const wrap = $('#gantt-wrap');
    const g = $('#gantt');
    $('#gantt-empty').hidden = items.length > 0;
    wrap.hidden = !items.length;
    if (!items.length) { g.innerHTML = ''; return; }

    const dayW = ZOOM[state.zoom];
    const labelW = window.innerWidth <= 900 ? 150 : 300;
    const t = today();

    // Rango de fechas visible
    let min = t, max = t;
    for (const p of items) {
      const ini = parse(p.fecha_inicio), fin = parse(p.fecha_fin);
      if (ini < min) min = ini;
      if (fin > max) max = fin;
      if (p.fecha_cierre && parse(p.fecha_cierre) > max) max = parse(p.fecha_cierre);
    }
    let start = addDays(min, state.zoom === 'dia' ? -3 : -7);
    if (state.zoom === 'semana') start = addDays(start, -((start.getDay() + 6) % 7)); // inicia en lunes
    let end = addDays(max, state.zoom === 'dia' ? 7 : 21);
    const minDays = Math.ceil((wrap.clientWidth - labelW) / dayW) + 1;
    if (diff(end, start) + 1 < minDays) end = addDays(start, minDays - 1);
    const days = diff(end, start) + 1;
    const W = days * dayW;
    const x = (d) => diff(d, start) * dayW;

    // Encabezado: meses
    let months = '';
    for (let i = 0; i < days;) {
      const d = addDays(start, i);
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const span = Math.min(diff(next, d), days - i);
      months += `<div class="g-month" style="width:${span * dayW}px"><span style="left:${labelW + 8}px">${span * dayW > 60 ? cap(fmt(d, { month: 'long', year: 'numeric' })) : ''}</span></div>`;
      i += span;
    }
    // Carga: cuántos pendientes en proceso coinciden cada día (los vencidos cuentan hasta hoy)
    const activos = state.items.filter((p) => p.estatus === 'proceso').map((p) => {
      const fin = parse(p.fecha_fin);
      return [parse(p.fecha_inicio), fin < t ? t : fin];
    });
    const loadOn = (d) => activos.reduce((n, [a, b]) => n + (d >= a && d <= b ? 1 : 0), 0);
    const loadCls = (n) => (n === 0 ? 'l0' : n === 1 ? 'l1' : n === 2 ? 'l2' : n === 3 ? 'l3' : 'l4');
    let load = '';

    // Encabezado: días o semanas
    let cells = '';
    let grid = '';
    if (state.zoom === 'dia') {
      for (let i = 0; i < days; i++) {
        const d = addDays(start, i);
        const we = d.getDay() === 0 || d.getDay() === 6;
        const isT = diff(d, t) === 0;
        cells += `<div class="g-day${we ? ' weekend' : ''}${isT ? ' today' : ''}" style="width:${dayW}px"><small>${fmt(d, { weekday: 'narrow' })}</small><b>${d.getDate()}</b></div>`;
        if (we) grid += `<span class="wk" style="left:${i * dayW}px;width:${dayW}px"></span>`;
        const n = loadOn(d);
        load += `<div class="g-load ${loadCls(n)}" style="width:${dayW}px" data-load="${n}" data-date="${iso(d)}">${n || ''}</div>`;
      }
    } else {
      for (let i = 0; i < days; i += 7) {
        const d = addDays(start, i);
        const len = Math.min(7, days - i);
        const w = len * dayW;
        cells += `<div class="g-week" style="width:${w}px">${d.getDate()} ${fmt(d, { month: 'short' }).replace('.', '')}</div>`;
        grid += `<span class="ln" style="left:${i * dayW}px"></span>`;
        let n = 0;
        for (let k = 0; k < len; k++) n = Math.max(n, loadOn(addDays(d, k)));
        load += `<div class="g-load ${loadCls(n)}" style="width:${w}px" data-load="${n}" data-date="${iso(d)}" data-week="1">${n || ''}</div>`;
      }
    }

    // Filas
    const rows = items.map((p, i) => {
      const vs = visualStatus(p);
      const ini = parse(p.fecha_inicio), fin = parse(p.fecha_fin);
      const left = x(ini);
      const width = (diff(fin, ini) + 1) * dayW;
      const info = timeInfo(p);
      const fillPct = p.estatus === 'proceso' && vs !== 'vencido' ? info.pct : 100;
      const name = esc(p.nombre);
      const fits = width > p.nombre.length * 6.6 + 24;

      let extra = '';
      if (vs === 'vencido') {
        const oL = x(fin) + dayW;
        const oW = (diff(t, fin)) * dayW;
        extra += `<div class="g-overdue" style="left:${oL}px;width:${oW}px"></div>`;
      }
      if (p.fecha_cierre && p.estatus !== 'proceso') {
        const c = parse(p.fecha_cierre);
        extra += `<div class="g-close" style="left:${x(c) + dayW / 2}px;--c:var(--${p.estatus})">${p.estatus === 'terminado' ? '✓' : '×'}</div>`;
      }

      const r = state.rank.get(p.id);
      const top = r && r <= 3;
      return `
        <div class="g-row ${p.estatus}${top ? ' is-top' : ''}" data-id="${p.id}">
          <div class="g-label" style="width:${labelW}px">${rankBadge(r, p)}<span class="dot ${vs}"></span><span class="txt">${name}</span>${p.estatus === 'proceso' && p.prioridad === 'alta' ? '<i class="flag alta" title="Importancia alta"></i>' : ''}</div>
          <div class="g-track" style="width:${W}px">
            ${extra}
            <div class="g-bar ${vs}${top ? ' focus' : ''}" data-id="${p.id}" style="left:${left}px;width:${width}px;animation-delay:${Math.min(i, 12) * 30}ms">
              <div class="fill${fillPct >= 100 ? ' full' : ''}" style="width:${fillPct}%"></div>
              <span class="lbl ${fits ? (fillPct > 55 ? 'inside' : '') : 'outside'}">${name}</span>
            </div>
          </div>
        </div>`;
    }).join('');

    g.style.width = `${labelW + W}px`;
    g.innerHTML = `
      <div class="g-head">
        <div class="g-label g-head-label" style="width:${labelW}px">
          <span>Orden · Pendiente</span>
          <span class="load-title" title="Cuántos pendientes en proceso coinciden ese día">Carga del día</span>
        </div>
        <div class="g-head-cells" style="width:${W}px">
          <div class="g-months">${months}</div>
          <div class="g-days">${cells}</div>
          <div class="g-loads">${load}</div>
        </div>
      </div>
      <div class="g-body">
        <div class="g-grid" style="left:${labelW}px;width:${W}px">${grid}</div>
        ${rows}
        <div class="g-today" style="left:${labelW + x(t) + dayW / 2}px"></div>
      </div>`;

    g.dataset.todayX = labelW + x(t) + dayW / 2;
    g.dataset.labelW = labelW;
    g.dataset.firstX = labelW + Math.min(...items.map((p) => x(parse(p.fecha_inicio))));
  }

  function scrollToToday(smooth = true) {
    const wrap = $('#gantt-wrap');
    const g = $('#gantt');
    const tx = Number(g.dataset.todayX || 0);
    const labelW = Number(g.dataset.labelW || 0);
    const firstX = Number(g.dataset.firstX || 0);
    const view = wrap.clientWidth - labelW;
    // Si el inicio de las barras y hoy caben juntos, mostrar desde la primera barra
    let target = tx - labelW - view * 0.3;
    if (tx - firstX < view * 0.85) target = firstX - labelW - 12;
    wrap.scrollTo({ left: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
  }

  /* ---------- Render general ---------- */
  // Con miles de tareas solo se dibuja una página; el resto se carga al pedirlo o al bajar
  const LIST_PAGE = 60;
  const GANTT_PAGE = 40;
  function moreButton(which, left, page, noun) {
    const box = $(`#${which}-more`);
    box.hidden = left <= 0;
    if (left > 0) $(`#${which}-more-btn`).textContent = `Mostrar ${Math.min(page, left)} ${noun} más · quedan ${left.toLocaleString('es-MX')}`;
  }
  let firstRender = true;
  function render() {
    computeRanking();
    const items = visibleItems();
    // Si cambió el filtro, la búsqueda o el orden, se vuelve a la primera página
    const key = [state.filter, state.prio, state.search, state.sort, state.hideClosed].join('|');
    if (key !== state.viewKey) { state.viewKey = key; state.listLimit = LIST_PAGE; state.ganttLimit = GANTT_PAGE; }
    const wrap = $('#gantt-wrap');
    const prevScroll = wrap.scrollLeft;
    renderHeader();
    renderSuggestions();
    renderList(items.slice(0, state.listLimit));
    renderGantt(items.slice(0, state.ganttLimit));
    moreButton('list', items.length - state.listLimit, LIST_PAGE, 'pendientes');
    moreButton('gantt', items.length - state.ganttLimit, GANTT_PAGE, 'filas');
    if (firstRender) {
      scrollToToday(false);
      firstRender = false;
      $('#list').classList.add('intro');
      $('#gantt').classList.add('intro');
      setTimeout(() => { $('#list').classList.remove('intro'); $('#gantt').classList.remove('intro'); }, 1200);
    }
    else wrap.scrollLeft = prevScroll;
    syncSegmented();
  }

  /* ---------- Control segmentado ---------- */
  function placeIndicator(seg) {
    const ind = $('.seg-indicator', seg);
    const active = $('button.active', seg);
    if (!ind) return;
    if (!active) { ind.style.width = '0px'; return; }
    ind.style.width = `${active.offsetWidth}px`;
    ind.style.transform = `translateX(${active.offsetLeft}px)`;
  }
  function syncSegmented() {
    $$('.segmented').forEach(placeIndicator);
  }

  /* ---------- Toast ---------- */
  let toastTimer;
  function toast(msg, { undo, error } = {}) {
    const el = $('#toast');
    el.className = `toast glass${error ? ' error' : ''}`;
    el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">Deshacer</button>' : ''}`;
    el.hidden = false;
    if (undo) $('button', el).onclick = () => { el.hidden = true; undo(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, undo ? 5000 : 2600);
  }

  /* ---------- Acciones ---------- */
  async function load() {
    try {
      const data = await api('GET', API);
      state.items = data.pendientes;
      render();
    } catch (e) { toast(e.message, { error: true }); }
  }

  async function update(id, changes, msg) {
    const prev = state.byId.get(id);
    try {
      const upd = await api('PATCH', `${API}${id}/`, changes);
      state.items = state.items.map((p) => (p.id === id ? upd : p));
      render();
      if (msg) {
        const back = { estatus: prev.estatus };
        toast(msg, { undo: () => update(id, back) });
      }
      return upd;
    } catch (e) { toast(e.message, { error: true }); throw e; }
  }

  async function create(data) {
    const p = await api('POST', API, data);
    state.items.push(p);
    render();
    return p;
  }

  async function remove(id) {
    const p = state.byId.get(id);
    await api('DELETE', `${API}${id}/`);
    state.items = state.items.filter((x) => x.id !== id);
    render();
    toast(`“${p.nombre}” eliminado`, {
      undo: () => create({ nombre: p.nombre, fecha_inicio: p.fecha_inicio, fecha_fin: p.fecha_fin, estatus: p.estatus, prioridad: p.prioridad })
        .catch((e) => toast(e.message, { error: true })),
    });
  }

  /* ---------- Alta rápida ---------- */
  function setQuickDate(days) {
    $('#qa-fecha').value = iso(addDays(today(), days));
    $$('.quick-dates button').forEach((b) => b.classList.toggle('on', Number(b.dataset.days) === days));
  }

  $('#quick-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = $('#qa-nombre').value.trim();
    const fecha = $('#qa-fecha').value;
    if (!nombre) { $('#qa-nombre').focus(); return; }
    if (!fecha) { $('#qa-fecha').focus(); return; }
    const data = { nombre, fecha_fin: fecha, prioridad: state.qaPrio };
    if (parse(fecha) < today()) data.fecha_inicio = fecha; // permitir registrar algo ya vencido
    try {
      const p = await create(data);
      $('#qa-nombre').value = '';
      $('#qa-nombre').focus();
      setSeg($('#qa-prio'), 'media');
      state.qaPrio = 'media';
      const r = state.rank.get(p.id);
      toast(r === 1 ? 'Agregado · ¡Es lo primero que deberías hacer!' : `Pendiente agregado · queda #${r} en tu orden sugerido`);
    } catch (err) { toast(err.message, { error: true }); }
  });

  // Selecciona un valor en un control segmentado genérico (data-val)
  function setSeg(seg, val) {
    $$('button', seg).forEach((b) => b.classList.toggle('active', b.dataset.val === val));
    placeIndicator(seg);
  }
  $('#qa-prio').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.qaPrio = b.dataset.val;
    setSeg($('#qa-prio'), state.qaPrio);
  });
  $$('.quick-dates button').forEach((b) => b.addEventListener('click', () => setQuickDate(Number(b.dataset.days))));
  $('#qa-fecha').addEventListener('input', () => $$('.quick-dates button').forEach((b) => b.classList.remove('on')));

  /* ---------- Filtros, búsqueda, zoom ---------- */
  $$('.side[data-filter]').forEach((b) => b.addEventListener('click', () => {
    state.filter = b.dataset.filter;
    state.prio = null;
    render();
  }));
  $$('.side[data-prio]').forEach((b) => b.addEventListener('click', () => {
    state.prio = state.prio === b.dataset.prio ? null : b.dataset.prio;
    if (state.prio) state.filter = 'proceso';
    render();
  }));
  function focusQuickAdd() {
    $('#qa-nombre').focus();
    $('#quick-add').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  $('#list-more-btn').addEventListener('click', () => { state.listLimit += LIST_PAGE; render(); });
  $('#gantt-more-btn').addEventListener('click', () => { state.ganttLimit += GANTT_PAGE; render(); });
  // Carga automática al llegar al final del listado
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting) && !$('#list-more').hidden) { state.listLimit += LIST_PAGE; render(); }
    }, { rootMargin: '300px' }).observe($('#list-more'));
  }
  let searchTimer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.search = e.target.value; render(); }, 150);
  });
  $('#zoom').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.zoom === state.zoom) return;
    state.zoom = b.dataset.zoom;
    $$('#zoom button').forEach((x) => x.classList.toggle('active', x === b));
    render();
    scrollToToday(false);
  });
  $('#go-today').addEventListener('click', () => scrollToToday());
  $('#sort').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.sort === state.sort) return;
    state.sort = b.dataset.sort;
    $$('#sort button').forEach((x) => x.classList.toggle('active', x === b));
    render();
  });

  /* ---------- Tarjeta de enfoque ---------- */
  $('#sug').addEventListener('click', (e) => {
    const done = e.target.closest('[data-done]');
    if (done) {
      update(Number(done.dataset.done), { estatus: 'terminado' }, '¡Excelente! Uno menos. Ahí va el siguiente.').catch(() => {});
      return;
    }
    const open = e.target.closest('[data-open]');
    if (open) openSheet(state.byId.get(Number(open.dataset.open)));
  });

  /* ---------- Listado: clics ---------- */
  $('#list').addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const id = Number(row.dataset.id);
    const p = state.byId.get(id);
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'toggle') {
      const next = p.estatus === 'terminado' ? 'proceso' : 'terminado';
      update(id, { estatus: next }, next === 'terminado' ? '¡Bien hecho! Marcado como terminado' : 'Marcado en proceso').catch(() => {});
    } else if (action === 'status') {
      openStatusMenu(e.target.closest('.pill'), p);
    } else if (action === 'delete') {
      openDelete(p);
    } else {
      openSheet(p);
    }
  });

  /* ---------- Gantt: clics y tooltip ---------- */
  const tip = $('#tooltip');
  $('#gantt').addEventListener('click', (e) => {
    const el = e.target.closest('.g-bar, .g-label');
    const row = e.target.closest('.g-row');
    if (el && row) openSheet(state.byId.get(Number(row.dataset.id)));
  });
  let tipFrame = 0;
  let tipEvent = null;
  $('#gantt').addEventListener('mousemove', (e) => {
    tipEvent = e;
    if (!tipFrame) tipFrame = requestAnimationFrame(() => { tipFrame = 0; moveTip(tipEvent); });
  });
  let tipKey = '';
  function moveTip(e) {
    const bar = e.target.closest('.g-bar');
    const loadCell = e.target.closest('.g-load');
    if (!bar && !loadCell) { tip.hidden = true; tipKey = ''; return; }
    const key = bar ? `b${bar.dataset.id}` : `l${loadCell.dataset.date}`;
    if (key === tipKey && !tip.hidden) { placeTip(e); return; }
    tipKey = key;
    if (loadCell) {
      const n = Number(loadCell.dataset.load);
      const d = parse(loadCell.dataset.date);
      const when = loadCell.dataset.week ? `Semana del ${fmtShort(d)}` : cap(fmt(d, { weekday: 'long', day: 'numeric', month: 'short' }));
      const msg = n === 0 ? 'Día libre: buen momento para adelantar algo.'
        : n === 1 ? '1 pendiente activo.'
          : n <= 3 ? `${n} pendientes activos al mismo tiempo.`
            : `${n} pendientes a la vez: considera adelantar o mover fechas.`;
      tip.innerHTML = `<b>${when}</b><span class="muted">${loadCell.dataset.week ? 'Máximo en un día: ' : ''}${msg}</span>`;
    } else {
      const p = state.byId.get(Number(bar.dataset.id));
      const t = timeInfo(p);
      const vs = visualStatus(p);
      const dur = diff(parse(p.fecha_fin), parse(p.fecha_inicio)) + 1;
      const r = state.rank.get(p.id);
      tip.innerHTML = `<b>${r ? `#${r} · ` : ''}${esc(p.nombre)}</b>
        <span class="muted">${fmtShort(parse(p.fecha_inicio))} → ${fmtShort(parse(p.fecha_fin))} · ${plural(dur, 'día', 'días')}</span><br>
        <span class="dot ${vs}"></span> ${vs === 'vencido' ? 'Vencido' : ESTATUS[p.estatus]} · ${t.label}
        ${r ? `<br><span class="muted">Importancia ${PRIO[p.prioridad].toLowerCase()} · ${esc(priorityInfo(p).reasons[0])}</span>` : ''}`;
    }
    tip.hidden = false;
    tipSize = tip.getBoundingClientRect();
    placeTip(e);
  }
  let tipSize = { width: 0, height: 0 };
  function placeTip(e) {
    let left = e.clientX + 14, top = e.clientY + 16;
    if (left + tipSize.width > window.innerWidth - 8) left = e.clientX - tipSize.width - 14;
    if (top + tipSize.height > window.innerHeight - 8) top = e.clientY - tipSize.height - 12;
    tip.style.transform = `translate(${left}px, ${top}px)`;
  }
  $('#gantt').addEventListener('mouseleave', () => { tip.hidden = true; tipKey = ''; });

  /* ---------- Menú de estatus ---------- */
  const menu = $('#status-menu');
  let menuItem = null;
  let menuAnchor = null;
  let menuTimer = 0;
  function openStatusMenu(anchor, p) {
    clearTimeout(menuTimer);
    menuAnchor?.classList.remove('open');
    menuItem = p;
    menuAnchor = anchor;
    anchor.classList.add('open');
    $$('button', menu).forEach((b) => {
      const cur = b.dataset.set === p.estatus;
      b.classList.toggle('current', cur);
      b.setAttribute('aria-checked', String(cur));
    });
    menu.classList.remove('closing', 'opening');
    menu.hidden = false;
    const r = anchor.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    let top = r.bottom + 6;
    const up = top + m.height > window.innerHeight - 8;
    if (up) top = r.top - m.height - 6;
    menu.style.top = `${top}px`;
    menu.style.left = `${Math.max(8, Math.min(r.right - m.width, window.innerWidth - m.width - 8))}px`;
    menu.dataset.dir = up ? 'up' : 'down';
    void menu.offsetWidth; // reinicia la animación
    menu.classList.add('opening');
    $('button.current', menu)?.focus({ preventScroll: true });
  }
  function closeMenu() {
    if (menu.hidden) return;
    menuAnchor?.classList.remove('open');
    menuAnchor = null;
    menuItem = null;
    menu.classList.remove('opening');
    menu.classList.add('closing');
    clearTimeout(menuTimer);
    menuTimer = setTimeout(() => { menu.hidden = true; menu.classList.remove('closing'); }, 130);
  }
  // Flechas arriba/abajo dentro del menú, como en macOS
  menu.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = $$('button', menu);
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
  });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !menuItem) return;
    const id = menuItem.id;
    const val = b.dataset.set;
    const changed = val !== menuItem.estatus;
    closeMenu();
    if (changed) update(id, { estatus: val }, `Cambiado a “${ESTATUS[val]}”`).catch(() => {});
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.target.closest('#status-menu, .pill')) closeMenu();
  });
  window.addEventListener('scroll', closeMenu, true);

  /* ---------- Hoja de edición ---------- */
  const sheet = $('#sheet');
  let editStatus = 'proceso';
  function setEditStatus(v) {
    editStatus = v;
    $$('#ed-estatus button').forEach((b) => b.classList.toggle('active', b.dataset.val === v));
    placeIndicator($('#ed-estatus'));
  }
  let editPrio = 'media';
  $('#ed-prio').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    editPrio = b.dataset.val;
    setSeg($('#ed-prio'), editPrio);
  });
  function openSheet(p) {
    if (!p) return;
    closeMenu();
    tip.hidden = true;
    state.editing = p.id;
    $('#ed-nombre').value = p.nombre;
    $('#ed-inicio').value = p.fecha_inicio;
    $('#ed-fin').value = p.fecha_fin;
    $('#ed-error').hidden = true;
    sheet.hidden = false;
    setEditStatus(p.estatus);
    editPrio = p.prioridad || 'media';
    setSeg($('#ed-prio'), editPrio);
    $('#ed-nombre').focus();
    $('#ed-nombre').select();
  }
  function closeSheet() { sheet.hidden = true; state.editing = null; }

  $('#ed-estatus').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setEditStatus(b.dataset.val);
  });
  $('#ed-cancel').addEventListener('click', closeSheet);
  sheet.addEventListener('mousedown', (e) => { if (e.target === sheet) closeSheet(); });
  $('#edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#ed-error');
    const data = {
      nombre: $('#ed-nombre').value.trim(),
      fecha_inicio: $('#ed-inicio').value,
      fecha_fin: $('#ed-fin').value,
      estatus: editStatus,
      prioridad: editPrio,
    };
    if (data.fecha_inicio && data.fecha_fin && data.fecha_fin < data.fecha_inicio) {
      err.textContent = 'La fecha de fin no puede ser antes de la fecha de inicio.';
      err.hidden = false;
      return;
    }
    try {
      const upd = await api('PATCH', `${API}${state.editing}/`, data);
      state.items = state.items.map((p) => (p.id === upd.id ? upd : p));
      closeSheet();
      render();
      toast('Cambios guardados');
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });
  $('#ed-delete').addEventListener('click', () => {
    const p = state.byId.get(state.editing);
    closeSheet();
    openDelete(p);
  });

  /* ---------- Eliminar: confirmar escribiendo una palabra aleatoria ---------- */
  const delSheet = $('#del-sheet');
  const delInput = $('#del-input');
  const delOk = $('#del-ok');
  let delTarget = null;
  let delWord = '';
  // Comparación sin importar mayúsculas ni acentos
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  function openDelete(p) {
    if (!p) return;
    closeMenu();
    tip.hidden = true;
    delTarget = p.id;
    let w;
    do { w = PALABRAS[Math.floor(Math.random() * PALABRAS.length)]; } while (w === delWord && PALABRAS.length > 1);
    delWord = w;
    $('#del-name').textContent = `“${p.nombre}”`;
    $('#del-word').textContent = delWord;
    delInput.value = '';
    delInput.classList.remove('match', 'wrong');
    delOk.disabled = true;
    delSheet.hidden = false;
    delInput.focus();
  }
  function closeDelete() { delSheet.hidden = true; delTarget = null; }

  delInput.addEventListener('input', () => {
    const ok = norm(delInput.value) === norm(delWord);
    delOk.disabled = !ok;
    delInput.classList.toggle('match', ok);
    delInput.classList.remove('wrong');
  });
  $('#del-cancel').addEventListener('click', closeDelete);
  delSheet.addEventListener('mousedown', (e) => { if (e.target === delSheet) closeDelete(); });
  $('#del-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (norm(delInput.value) !== norm(delWord)) {
      delInput.classList.remove('wrong');
      void delInput.offsetWidth; // reinicia la animación
      delInput.classList.add('wrong');
      return;
    }
    const id = delTarget;
    closeDelete();
    try { await remove(id); } catch (ex) { toast(ex.message, { error: true }); }
  });

  /* ---------- Acciones (menús, semáforo y atajos usan las mismas) ---------- */
  const helpSheet = $('#help-sheet');
  function setSort(v) { state.sort = v; $$('#sort button').forEach((x) => x.classList.toggle('active', x.dataset.sort === v)); render(); }
  function setZoom(v) { state.zoom = v; $$('#zoom button').forEach((x) => x.classList.toggle('active', x.dataset.zoom === v)); render(); scrollToToday(false); }
  function setTheme(t) {
    state.theme = t;
    savePref('theme', t);
    if (t === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    toast(t === 'auto' ? 'Apariencia automática' : t === 'dark' ? 'Modo oscuro' : 'Modo claro');
  }
  function applySidebar() { $('.layout').classList.toggle('no-sidebar', !state.sidebar); }
  function resetView() {
    state.filter = 'proceso'; state.prio = null; state.search = '';
    $('#search').value = '';
    render();
    toast('Vista restablecida');
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => toast('Tu navegador no permitió la pantalla completa', { error: true }));
  }
  function exportCSV() {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Pendiente', 'Inicio', 'Fecha fin', 'Estatus', 'Importancia', 'Orden sugerido', 'Fecha de cierre']];
    for (const p of [...state.items].sort((a, b) => a.fecha_fin.localeCompare(b.fecha_fin))) {
      rows.push([p.nombre, p.fecha_inicio, p.fecha_fin, isVencido(p) ? 'Vencido' : ESTATUS[p.estatus], PRIO[p.prioridad], state.rank.get(p.id) || '', p.fecha_cierre || '']);
    }
    const csv = '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `pendientes-${iso(today())}.csv`;
    document.body.appendChild(link);
    link.click();
    link.parentNode.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Exportados ${plural(state.items.length, 'pendiente', 'pendientes')}`);
  }
  const ACTIONS = {
    new: focusQuickAdd,
    search: () => { $('#search').focus(); $('#search').select(); },
    'edit-first': () => (state.ranked[0] ? openSheet(state.ranked[0].p) : toast('No hay pendientes en proceso')),
    reset: resetView,
    csv: exportCSV,
    print: () => window.print(),
    sidebar: () => { state.sidebar = !state.sidebar; savePref('sidebar', state.sidebar); applySidebar(); render(); },
    'hide-closed': () => {
      state.hideClosed = !state.hideClosed; savePref('hideClosed', state.hideClosed); render();
      toast(state.hideClosed ? 'Terminados y cancelados ocultos en “Todos”' : 'Mostrando terminados y cancelados');
    },
    'sort-sugerido': () => setSort('sugerido'),
    'sort-fecha': () => setSort('fecha'),
    'zoom-dia': () => setZoom('dia'),
    'zoom-semana': () => setZoom('semana'),
    today: () => { $('#gantt-wrap').scrollIntoView({ behavior: 'smooth', block: 'center' }); scrollToToday(); },
    fullscreen: toggleFullscreen,
    glass: () => {
      const live = document.documentElement.classList.contains('glass-lite');
      state.glass = live ? 'on' : 'off';
      savePref('glass', state.glass);
      applyGlass();
      toast(live ? 'Vidrio en vivo activado' : 'Modo rápido: vidrio esmerilado fijo');
    },
    shortcuts: () => { helpSheet.hidden = false; $('#help-close').focus(); },
    'theme-auto': () => setTheme('auto'),
    'theme-light': () => setTheme('light'),
    'theme-dark': () => setTheme(state.theme === 'dark' ? 'light' : 'dark'),
    top: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
  };
  function run(action) { closeDropdown(); ACTIONS[action]?.(); }

  $('#filter-clear').addEventListener('click', resetView);
  $$('.tl').forEach((b) => b.addEventListener('click', () => run(b.dataset.action)));
  $('#help-close').addEventListener('click', () => { helpSheet.hidden = true; });
  helpSheet.addEventListener('mousedown', (e) => { if (e.target === helpSheet) helpSheet.hidden = true; });
  document.addEventListener('fullscreenchange', () => $('.window').classList.toggle('is-full', !!document.fullscreenElement));

  /* ---------- Menús de la barra superior (como en macOS) ---------- */
  let openDD = null;
  const CHECKS = {
    sidebar: () => state.sidebar,
    hideClosed: () => state.hideClosed,
    sortSugerido: () => state.sort === 'sugerido',
    sortFecha: () => state.sort === 'fecha',
    zoomDia: () => state.zoom === 'dia',
    zoomSemana: () => state.zoom === 'semana',
    fullscreen: () => !!document.fullscreenElement,
    liveGlass: () => !document.documentElement.classList.contains('glass-lite'),
    themeAuto: () => state.theme === 'auto',
    themeLight: () => state.theme === 'light',
    themeDark: () => state.theme === 'dark',
  };
  function openDropdown(btn) {
    closeDropdown();
    const dd = $(`#dd-${btn.dataset.menu}`);
    $$('[data-check]', dd).forEach((it) => it.classList.toggle('checked', CHECKS[it.dataset.check]()));
    dd.hidden = false;
    const r = btn.getBoundingClientRect();
    dd.style.left = `${Math.min(r.left, window.innerWidth - dd.offsetWidth - 8)}px`;
    dd.style.top = `${r.bottom + 4}px`;
    btn.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    openDD = { btn, dd };
  }
  function closeDropdown() {
    if (!openDD) return;
    openDD.dd.hidden = true;
    openDD.btn.classList.remove('open');
    openDD.btn.setAttribute('aria-expanded', 'false');
    openDD = null;
  }
  $$('.mb-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (openDD && openDD.btn === btn) closeDropdown(); else openDropdown(btn);
    });
    // Con un menú abierto, pasar el mouse cambia de menú (igual que en Mac)
    btn.addEventListener('mouseenter', () => { if (openDD && openDD.btn !== btn) openDropdown(btn); });
  });
  $$('.menu-dd').forEach((dd) => dd.addEventListener('click', (e) => {
    const it = e.target.closest('[data-action]');
    if (it) run(it.dataset.action);
  }));
  document.addEventListener('click', (e) => { if (openDD && !e.target.closest('.menu-dd, .mb-btn')) closeDropdown(); });

  /* ---------- Teclado ---------- */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (openDD) closeDropdown();
      else if (!wallPanel.hidden) closeWallPanel();
      else if (!helpSheet.hidden) helpSheet.hidden = true;
      else if (!delSheet.hidden) closeDelete();
      else if (!menu.hidden) closeMenu();
      else if (!sheet.hidden) closeSheet();
      else if (document.activeElement === $('#search') && state.search) resetView();
      return;
    }
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    const modal = !sheet.hidden || !delSheet.hidden || !helpSheet.hidden;
    if (typing || modal || e.metaKey || e.ctrlKey || e.altKey) return;
    const keys = { n: 'new', '/': 'search', t: 'today', b: 'sidebar', f: 'fullscreen', d: 'theme-dark', '?': 'shortcuts' };
    const action = keys[e.key.toLowerCase()];
    if (action) { e.preventDefault(); run(action); }
  });

  /* ---------- Fondo de pantalla (predeterminados, imagen, GIF o video) ---------- */
  const WALLS = ['macos', 'ondas', 'azul', 'dunas', 'cumbre', 'costa'];
  const wallPanel = $('#wall-panel');
  const wallImg = $('#wall-img');
  const wallVideo = $('#wall-video');
  let wallUrl = '';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // IndexedDB guarda el archivo (sin límite práctico como localStorage)
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('pendientes', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbDo(mode, fn) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction('files', mode);
      const req = fn(tx.objectStore('files'));
      tx.oncomplete = () => res(req && req.result);
      tx.onerror = () => rej(tx.error);
    });
  }
  const wallGet = () => idbDo('readonly', (st) => st.get('wallpaper')).catch(() => null);
  const wallPut = (v) => idbDo('readwrite', (st) => st.put(v, 'wallpaper'));
  const wallDel = () => idbDo('readwrite', (st) => st.delete('wallpaper'));

  function clearMedia() {
    wallVideo.pause();
    wallVideo.removeAttribute('src');
    wallVideo.load();
    wallVideo.hidden = true;
    wallImg.hidden = true;
    wallImg.removeAttribute('src');
    if (wallUrl) { URL.revokeObjectURL(wallUrl); wallUrl = ''; }
  }
  async function applyWallpaper(name) {
    let custom = null;
    if (name === 'custom') {
      custom = await wallGet();
      if (!custom) name = 'macos';
    }
    clearMedia();
    let animated = false;
    if (custom) {
      wallUrl = URL.createObjectURL(custom.blob);
      if (custom.type.startsWith('video/')) {
        wallVideo.src = wallUrl;
        wallVideo.hidden = false;
        animated = true;
        if (!reduceMotion.matches && !document.hidden) wallVideo.play().catch(() => {});
      } else {
        wallImg.src = wallUrl;
        wallImg.hidden = false;
        animated = custom.type === 'image/gif';
      }
      $('#wp-custom-thumb').style.backgroundImage = custom.type.startsWith('video/') ? '' : `url("${wallUrl}")`;
      $('#wp-custom-thumb').classList.toggle('is-video', custom.type.startsWith('video/'));
    }
    document.documentElement.dataset.wall = name;
    // Fondo en movimiento: sin blur en vivo para que la app no se ponga lenta
    document.documentElement.classList.toggle('bg-animated', animated);
    $('#wp-custom').hidden = !custom;
    $('#wall-remove').hidden = !custom;
    $$('.wp-item', wallPanel).forEach((b) => b.classList.toggle('selected', b.dataset.wall === name));
    savePref('wall', name);
  }
  function openWallPanel() {
    const btn = $('#wall-btn');
    wallPanel.hidden = false;
    const r = btn.getBoundingClientRect();
    wallPanel.style.top = `${r.bottom + 8}px`;
    wallPanel.style.left = `${Math.max(8, Math.min(r.right - wallPanel.offsetWidth, window.innerWidth - wallPanel.offsetWidth - 8))}px`;
    wallPanel.classList.remove('opening');
    void wallPanel.offsetWidth;
    wallPanel.classList.add('opening');
    btn.setAttribute('aria-expanded', 'true');
    $('.wp-item.selected', wallPanel)?.focus({ preventScroll: true });
  }
  function closeWallPanel() {
    wallPanel.hidden = true;
    $('#wall-btn').setAttribute('aria-expanded', 'false');
  }
  $('#wall-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (wallPanel.hidden) openWallPanel(); else closeWallPanel();
  });
  wallPanel.addEventListener('click', (e) => {
    e.stopPropagation();
    const it = e.target.closest('.wp-item');
    if (it) applyWallpaper(it.dataset.wall);
  });
  document.addEventListener('click', (e) => { if (!wallPanel.hidden && !e.target.closest('#wall-panel, #wall-btn')) closeWallPanel(); });
  $('#wall-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!/^image\/|^video\/(mp4|webm)$/.test(f.type)) { toast('Ese archivo no es una imagen, GIF o video compatible', { error: true }); return; }
    if (f.size > 60 * 1024 * 1024) { toast('El archivo pesa más de 60 MB; elige uno más ligero', { error: true }); return; }
    try {
      await wallPut({ blob: f, type: f.type, name: f.name });
      await applyWallpaper('custom');
      toast(f.type === 'image/gif' || f.type.startsWith('video/') ? 'Fondo en movimiento aplicado' : 'Fondo aplicado');
    } catch {
      toast('No se pudo guardar el fondo en este navegador', { error: true });
    }
  });
  $('#wall-remove').addEventListener('click', async () => {
    await wallDel().catch(() => {});
    await applyWallpaper('macos');
    toast('Volviste al fondo de macOS');
  });
  // Ahorro: el video se pausa si la pestaña no se ve o si el sistema pide menos movimiento
  document.addEventListener('visibilitychange', () => {
    if (wallVideo.hidden) return;
    if (document.hidden || reduceMotion.matches) wallVideo.pause(); else wallVideo.play().catch(() => {});
  });

  /* ---------- Vidrio en vivo vs. modo rápido (automático según la computadora) ---------- */
  function applyGlass(slow = false) {
    document.documentElement.classList.toggle('glass-lite', state.glass === 'off' || (state.glass === 'auto' && slow));
  }
  // Mide la fluidez real al desplazarse; si la computadora no alcanza ~36 cuadros por segundo,
  // se desactiva el desenfoque en vivo (lo más costoso) y se avisa.
  (function watchSmoothness() {
    if (state.glass !== 'auto') return;
    let samples = [];
    let last = 0;
    let measuring = false;
    let checks = 0;
    function frame(t) {
      if (last) samples.push(t - last);
      last = t;
      if (samples.length < 30) requestAnimationFrame(frame);
      else finish();
    }
    function finish() {
      measuring = false;
      const sorted = samples.sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      samples = [];
      last = 0;
      checks++;
      if (median > 28 && state.glass === 'auto' && !document.documentElement.classList.contains('glass-lite')) {
        applyGlass(true);
        toast('Activé el modo rápido para que todo vaya fluido (Vista → Vidrio en vivo)');
        window.removeEventListener('scroll', onScroll);
      } else if (checks >= 3) {
        window.removeEventListener('scroll', onScroll);
      }
    }
    function onScroll() {
      if (measuring) return;
      measuring = true;
      requestAnimationFrame(frame);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
  })();

  /* ---------- Reloj de la barra de menú ---------- */
  function tickClock() {
    const d = new Date();
    const dia = d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
    const hora = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    $('#clock').textContent = `${dia}  ${hora}`;
  }

  /* ---------- Inicio ---------- */
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 120);
  });
  // Si la app queda abierta y cambia el día, refrescar cálculos
  let lastDay = iso(today());
  setInterval(() => {
    tickClock();
    if (iso(today()) !== lastDay) { lastDay = iso(today()); render(); }
  }, 15000);

  tickClock();
  applySidebar();
  applyGlass();
  applyWallpaper(WALLS.includes(pref('wall', 'macos')) || pref('wall', 'macos') === 'custom' ? pref('wall', 'macos') : 'macos');
  setQuickDate(7);
  syncSegmented();
  document.fonts?.ready.then(syncSegmented);
  load();
})();
