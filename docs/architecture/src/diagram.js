/*
 * Tiny helper for drawing orthogonal edges between absolutely positioned HTML nodes.
 * Nodes are placed with inline left/top/width/height; edges are drawn into one SVG overlay.
 *
 *   D.init();                                  // after the nodes exist
 *   D.edge([D.a('wallet','r',.3), [1060, 0], D.a('certify','l',.8)], { color: D.C.issuer, label: ... })
 *
 * A point [x, 0] / [0, y] in a route means "keep the previous y / x" (handy for orthogonal routes).
 */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const C = {
    issuer: '#7c3aed', wallet: '#2563eb', verifier: '#0d9488', inji: '#ea580c', ref: '#475569',
    infra: '#9ca3af', ctl: '#475569', nonce: '#db2777', pass: '#15803d', fail: '#dc2626', muted: '#94a3b8',
  };
  let canvas, svg, defs;
  const markers = new Map();

  function init(id = 'canvas') {
    canvas = document.getElementById(id);
    svg = document.createElementNS(NS, 'svg');
    const w = canvas.offsetWidth, h = canvas.offsetHeight;
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    Object.assign(svg.style, { position: 'absolute', left: '0', top: '0', zIndex: '1', pointerEvents: 'none', overflow: 'visible' });
    defs = document.createElementNS(NS, 'defs');
    svg.appendChild(defs);
    canvas.appendChild(svg);
  }

  function marker(color, kind = 'arrow') {
    const id = `m-${kind}-${color.replace('#', '')}`;
    if (markers.has(id)) return id;
    const m = document.createElementNS(NS, 'marker');
    m.setAttribute('id', id);
    m.setAttribute('markerUnits', 'userSpaceOnUse');
    m.setAttribute('orient', 'auto-start-reverse');
    if (kind === 'arrow') {
      m.setAttribute('viewBox', '0 0 12 12');
      m.setAttribute('markerWidth', '11');
      m.setAttribute('markerHeight', '11');
      m.setAttribute('refX', '11');
      m.setAttribute('refY', '6');
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', 'M1,1.5 L11,6 L1,10.5 Z');
      p.setAttribute('fill', color);
      m.appendChild(p);
    } else {
      m.setAttribute('viewBox', '0 0 10 10');
      m.setAttribute('markerWidth', '7');
      m.setAttribute('markerHeight', '7');
      m.setAttribute('refX', '5');
      m.setAttribute('refY', '5');
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', '5'); c.setAttribute('cy', '5'); c.setAttribute('r', '4');
      c.setAttribute('fill', color);
      m.appendChild(c);
    }
    defs.appendChild(m);
    markers.set(id, true);
    return id;
  }

  /** Box of a node relative to the canvas. */
  function box(id) {
    const el = typeof id === 'string' ? document.getElementById(id) : id;
    if (!el) throw new Error(`no node #${id}`);
    const r = el.getBoundingClientRect(), c = canvas.getBoundingClientRect();
    return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height };
  }

  /** Anchor on a side of a node: side l/r/t/b, t = fraction (0..1) or pixel offset (>1). */
  function a(id, side, t = 0.5) {
    const b = box(id);
    const along = (len) => (t > 1 ? t : t < 0 ? len + t : len * t);
    if (side === 'l') return [b.x, b.y + along(b.h)];
    if (side === 'r') return [b.x + b.w, b.y + along(b.h)];
    if (side === 't') return [b.x + along(b.w), b.y];
    return [b.x + along(b.w), b.y + b.h];
  }

  function resolve(pts) {
    const out = [];
    for (const p of pts) {
      const prev = out[out.length - 1];
      let [x, y] = p;
      if (prev && x === 0) x = prev[0];
      if (prev && y === 0) y = prev[1];
      out.push([x, y]);
    }
    return out;
  }

  function rounded(pts, r) {
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      const d1 = Math.hypot(x1 - x0, y1 - y0), d2 = Math.hypot(x2 - x1, y2 - y1);
      const rr = Math.min(r, d1 / 2, d2 / 2);
      if (!d1 || !d2) { d += ` L${x1},${y1}`; continue; }
      const ax = x1 + ((x0 - x1) * rr) / d1, ay = y1 + ((y0 - y1) * rr) / d1;
      const bx = x1 + ((x2 - x1) * rr) / d2, by = y1 + ((y2 - y1) * rr) / d2;
      d += ` L${ax},${ay} Q${x1},${y1} ${bx},${by}`;
    }
    const l = pts[pts.length - 1];
    return d + ` L${l[0]},${l[1]}`;
  }

  /**
   * Draw an edge. opts: color, width, dash ('dash' | 'dot' | custom), end (default true), start, radius,
   * label: { at: [x, y], html, color, cls }.
   */
  function edge(points, opts = {}) {
    const color = opts.color ?? C.ctl;
    const pts = resolve(points);
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', rounded(pts, opts.radius ?? 10));
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', color);
    p.setAttribute('stroke-width', opts.width ?? 1.8);
    p.setAttribute('stroke-linejoin', 'round');
    if (opts.dash === 'dash') p.setAttribute('stroke-dasharray', '7 5');
    else if (opts.dash === 'dot') { p.setAttribute('stroke-dasharray', '1.5 4'); p.setAttribute('stroke-linecap', 'round'); }
    else if (opts.dash) p.setAttribute('stroke-dasharray', opts.dash);
    if (opts.end !== false) p.setAttribute('marker-end', `url(#${marker(color)})`);
    if (opts.start === true) p.setAttribute('marker-start', `url(#${marker(color)})`);
    if (opts.start === 'dot') p.setAttribute('marker-start', `url(#${marker(color, 'dot')})`);
    svg.appendChild(p);
    if (opts.label) label(opts.label.at, opts.label.html, { color: opts.label.color ?? color, cls: opts.label.cls, style: opts.label.style });
    return pts;
  }

  function label([x, y], html, opts = {}) {
    const el = document.createElement('div');
    el.className = `elabel ${opts.cls ?? ''}`;
    el.innerHTML = html;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    if (opts.color) el.style.color = opts.color;
    if (opts.style) Object.assign(el.style, opts.style);
    canvas.appendChild(el);
    return el;
  }

  /** Raw SVG element helper. */
  function el(tag, attrs = {}, parent) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    (parent ?? svg).appendChild(e);
    return e;
  }

  /** Report nodes/labels that overflow their own box or overlap each other (render.py prints this). */
  function audit(selector = '.node, .elabel, .frame-label') {
    const els = [...canvas.querySelectorAll(selector)];
    const issues = [];
    const c = canvas.getBoundingClientRect();
    for (const e of els) {
      if (e.scrollHeight > e.clientHeight + 1 && e.classList.contains('node')) issues.push(`overflow: ${e.id || e.textContent.slice(0, 40)} (+${e.scrollHeight - e.clientHeight}px)`);
      const r = e.getBoundingClientRect();
      if (r.right > c.right + 0.5 || r.bottom > c.bottom + 0.5 || r.left < c.left - 0.5) issues.push(`outside canvas: ${e.id || e.textContent.slice(0, 40)}`);
    }
    const labels = els.filter((e) => !e.classList.contains('node'));
    const nodes = els.filter((e) => e.classList.contains('node'));
    const hit = (p, q) => !(p.right <= q.left || q.right <= p.left || p.bottom <= q.top || q.bottom <= p.top);
    for (let i = 0; i < labels.length; i++) {
      const r1 = labels[i].getBoundingClientRect();
      for (let j = i + 1; j < labels.length; j++) {
        if (hit(r1, labels[j].getBoundingClientRect())) issues.push(`label overlap: "${labels[i].textContent.slice(0, 30)}" × "${labels[j].textContent.slice(0, 30)}"`);
      }
      for (const n of nodes) {
        if (n.contains(labels[i])) continue;
        if (hit(r1, n.getBoundingClientRect())) issues.push(`label over node: "${labels[i].textContent.slice(0, 30)}" × ${n.id || n.textContent.slice(0, 30)}`);
      }
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (nodes[i].contains(nodes[j]) || nodes[j].contains(nodes[i])) continue;
        if (hit(nodes[i].getBoundingClientRect(), nodes[j].getBoundingClientRect())) issues.push(`node overlap: ${nodes[i].id} × ${nodes[j].id}`);
      }
    }
    return issues;
  }

  window.D = { C, init, a, box, edge, label, el, audit };
})();
