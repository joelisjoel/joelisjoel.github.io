// "How it all grew": draws the homepage tree from the JSON in
// _includes/tree.html (which comes from _data/home.yml).
//
// Time runs up the trunk: oldest at the roots, newest at the crown. Each
// item is a leaf. A leaf with a `parent` grows out of that leaf (the first
// child continues the parent's branch, later ones fork); a leaf without one
// branches off the trunk. Branches alternate right and left and reuse space
// once they stop growing, so the tree stays compact on a phone.
(() => {
  const nav = document.querySelector('.tree');
  const canvas = document.getElementById('tree-canvas');
  const dataEl = document.getElementById('tree-data');
  if (!nav || !canvas || !dataEl) return;

  let data;
  try { data = JSON.parse(dataEl.textContent); } catch (e) { return; }
  if (!data.items || !data.items.length) return;

  const NS = 'http://www.w3.org/2000/svg';
  const color = Object.fromEntries(data.threads.map((t) => [t.id, t.color]));
  const used = new Set(data.items.map((it) => it.thread));

  // Legend: only threads that appear on the tree
  nav.querySelectorAll('.tree-legend li').forEach((li) => {
    const sw = li.querySelector('.swatch');
    const t = data.threads.find((x) => x.color === sw.dataset.color);
    if (!t || !used.has(t.id)) li.remove();
    else sw.style.background = t.color;
  });

  // ---------- layout (independent of width) ----------
  const items = data.items.map((it, i) => ({ ...it, i, when: String(it.when) }));
  const byId = Object.fromEntries(items.map((it) => [it.id, it]));
  const depthOf = (it) => {
    let d = 0; const seen = new Set([it.id]);
    for (let p = byId[it.parent]; p && !seen.has(p.id); p = byId[p.parent]) { seen.add(p.id); d++; }
    return d;
  };
  items.forEach((it) => { it.depth = depthOf(it); it.year = it.when.slice(0, 4); });
  items.sort((a, b) => a.when.localeCompare(b.when) || a.depth - b.depth || a.i - b.i);
  items.forEach((it, k) => { it.order = k; });

  // Parent links must point back in time; ignore any that don't
  const kids = {};
  items.forEach((it) => {
    const p = byId[it.parent];
    if (p && p.order < it.order) (kids[p.id] = kids[p.id] || []).push(it);
    else it.parent = null;
  });
  items.forEach((it) => { it.continues = !!(it.parent && kids[it.parent][0] === it); });

  // Branches: a branch starts at an item that doesn't continue its parent's
  // branch and runs through first children. New branches alternate sides;
  // each takes the innermost free lane on its side.
  const lanes = [];  // { side, level, end }
  let nextSide = 1;  // 1 = right, -1 = left
  items.forEach((it) => {
    if (it.continues) { it.lane = byId[it.parent].lane; return; }
    let last = it;
    while (kids[last.id]) last = kids[last.id][0];
    const side = nextSide; nextSide = -nextSide;
    const mine = lanes.filter((l) => l.side === side);
    let lane = mine.filter((l) => l.end < it.order).sort((a, b) => a.level - b.level)[0];
    if (!lane) { lane = { side, level: mine.length }; lanes.push(lane); }
    lane.end = last.order;
    it.lane = lane;
  });
  items.forEach((it) => { it.side = it.lane.side; it.level = it.lane.level; });

  // Rows: left and right leaves may share a row; same side may not.
  // A child sits above its parent; a new year starts a new row.
  const lastRow = { '1': -1, '-1': -1 };
  let prev = null;
  items.forEach((it) => {
    let r = Math.max(lastRow[it.side] + 1, prev ? prev.row : 0);
    if (prev && prev.year !== it.year) r = Math.max(r, prev.row + 1);
    if (it.parent) r = Math.max(r, byId[it.parent].row + 1);
    it.row = r;
    lastRow[it.side] = r;
    prev = it;
  });
  const rows = Math.max(...items.map((it) => it.row)) + 1;

  // ---------- drawing ----------
  const el = (name, attrs, parent) => {
    const n = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };

  function draw() {
    const W = Math.max(300, Math.round(canvas.clientWidth));
    const rowH = 34, top = 36, bottom = 44;
    const H = top + rows * rowH + bottom;
    const cx = Math.round(W / 2);
    const y = (row) => top + (rows - 1 - row) * rowH + rowH / 2;
    const x = (it) => cx + it.side * (24 + it.level * 16);
    const yTop = y(rows - 1) - 18, yBot = H - bottom + 6;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'tree-svg' });
    const defs = el('defs', {}, svg);
    const g = el('linearGradient', { id: 'trunk-grad', x1: 0, y1: 1, x2: 0, y2: 0 }, defs);
    el('stop', { offset: 0, 'stop-color': '#E0A84E' }, g);
    el('stop', { offset: 1, 'stop-color': '#29C2C7' }, g);
    const glow = el('radialGradient', { id: 'crown-glow' }, defs);
    el('stop', { offset: 0, 'stop-color': '#29C2C7', 'stop-opacity': 0.28 }, glow);
    el('stop', { offset: 1, 'stop-color': '#29C2C7', 'stop-opacity': 0 }, glow);

    el('ellipse', { cx, cy: yTop + 20, rx: Math.min(W / 2, 220), ry: 70, fill: 'url(#crown-glow)' }, svg);

    // Roots
    const roots = el('g', { class: 'roots', stroke: '#E0A84E', fill: 'none', 'stroke-linecap': 'round' }, svg);
    [[-34, 16], [-16, 22], [0, 24], [18, 21], [36, 14]].forEach(([dx, dy]) => {
      el('path', { d: `M ${cx} ${yBot - 4} Q ${cx + dx * 0.3} ${yBot + dy * 0.9} ${cx + dx} ${yBot + dy}`, 'stroke-width': 2 }, roots);
    });

    // Trunk: tapered, gold at the roots to teal at the crown
    el('path', {
      d: `M ${cx - 5} ${yBot} C ${cx - 3} ${(yBot + yTop) / 2} ${cx - 2} ${yTop + 30} ${cx - 1.2} ${yTop} L ${cx + 1.2} ${yTop} C ${cx + 2} ${yTop + 30} ${cx + 3} ${(yBot + yTop) / 2} ${cx + 5} ${yBot} Z`,
      fill: 'url(#trunk-grad)',
    }, svg);

    // Branches: one segment into each leaf
    const branches = el('g', { fill: 'none', 'stroke-linecap': 'round' }, svg);
    items.forEach((it) => {
      const lx = x(it), ly = y(it.row);
      let d;
      if (it.continues) {
        const p = byId[it.parent];
        d = `M ${x(p)} ${y(p.row)} L ${lx} ${ly}`;
      } else if (it.parent) {
        const p = byId[it.parent], px = x(p), py = y(p.row);
        d = `M ${px} ${py} C ${px} ${(py + ly) / 2} ${lx} ${py - (py - ly) * 0.3} ${lx} ${ly}`;
      } else {
        const oy = ly + rowH * 0.42;
        d = `M ${cx} ${oy} Q ${cx} ${ly} ${lx} ${ly}`;
      }
      el('path', { d, stroke: color[it.thread] || '#888', 'stroke-width': it.continues ? 2.5 : 2.2, 'data-id': it.id, class: 'branch' }, branches);
    });

    // Year rings on the trunk, where a new year starts
    const rings = el('g', { class: 'rings' }, svg);
    let seenYear = null;
    items.forEach((it) => {
      if (it.year === seenYear) return;
      seenYear = it.year;
      const approx = items.some((o) => o.year === it.year && o.approx) && !items.some((o) => o.year === it.year && !o.approx);
      const ry = y(it.row) + rowH / 2;
      const label = (approx ? '~' : '') + it.year;
      el('rect', { x: cx - 21, y: ry - 8, width: 42, height: 16, rx: 8, class: 'ring' }, rings);
      const t = el('text', { x: cx, y: ry + 3.5, 'text-anchor': 'middle', class: 'ring-text' }, rings);
      t.textContent = label;
    });

    // Leaves
    const leaves = el('g', {}, svg);
    items.forEach((it) => {
      const lx = x(it), ly = y(it.row);
      const a = el('a', { href: it.url, class: 'leaf', 'data-id': it.id }, leaves);
      const tip = el('title', {}, a);
      tip.textContent = `${it.title} · ${it.approx ? '~' : ''}${it.when.length > 4 ? it.when : it.year} · ${it.section}`;
      el('circle', { cx: lx, cy: ly, r: 11, class: 'hit' }, a);
      el('circle', { cx: lx, cy: ly, r: 5, fill: color[it.thread] || '#888', class: 'dot' }, a);
      const tx = lx + it.side * 10;
      const t = el('text', { x: tx, y: ly + 4, 'text-anchor': it.side > 0 ? 'start' : 'end', class: 'leaf-text' }, a);
      t.textContent = it.label;
      t.dataset.full = it.label;
    });

    canvas.replaceChildren(svg);

    // Shorten labels that don't fit their side
    svg.querySelectorAll('.leaf-text').forEach((t) => {
      const room = t.getAttribute('text-anchor') === 'start' ? W - Number(t.getAttribute('x')) - 4 : Number(t.getAttribute('x')) - 4;
      let s = t.dataset.full;
      while (t.getComputedTextLength() > room && s.length > 4) { s = s.slice(0, -2); t.textContent = s.trimEnd() + '…'; }
    });

    // Hover or focus a leaf: light up its line back to the trunk
    const lineage = (id) => { const ids = new Set(); for (let p = byId[id]; p; p = byId[p.parent]) ids.add(p.id); return ids; };
    svg.querySelectorAll('.leaf').forEach((a) => {
      const on = () => {
        const ids = lineage(a.dataset.id);
        svg.classList.add('focus');
        svg.querySelectorAll('[data-id]').forEach((n) => n.classList.toggle('lit', ids.has(n.dataset.id)));
      };
      const off = () => { svg.classList.remove('focus'); svg.querySelectorAll('.lit').forEach((n) => n.classList.remove('lit')); };
      a.addEventListener('pointerenter', on); a.addEventListener('focus', on);
      a.addEventListener('pointerleave', off); a.addEventListener('blur', off);
    });
  }

  nav.classList.add('ready');
  draw();
  let lastW = canvas.clientWidth, timer;
  new ResizeObserver(() => {
    if (Math.abs(canvas.clientWidth - lastW) < 2) return;
    lastW = canvas.clientWidth;
    clearTimeout(timer); timer = setTimeout(draw, 80);
  }).observe(canvas);
})();
