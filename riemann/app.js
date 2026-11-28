// Riemann proof, shrinking: fly through the import map of the Lean proof of
// the Riemann Hypothesis at seven stages, Nov 20 to Nov 25, 2026.
//
// Mirza's method (bosnadev.com/lab/riemann): one dot per Lean file, one thread
// per import, the theorem at the top, and height = the longest chain of
// imports from the theorem down to the file. Sideways position is a layout
// choice. Data: data/*.bin, packed by video/riemann/data-tools/webpack.py in
// dendroslabs/dendroslabs.github.io.
'use strict';

const STAGES = [
  { date: 'Nov 20', title: 'The submission', who: 'Levent Alpöge, with Claude', tick: '20' },
  { date: 'Nov 21', title: 'Unused files cut', who: 'Lean community · PR #45', tick: '21' },
  { date: 'Nov 22', title: 'Moved to Lean 4.36', who: 'Lean community · PR #66', tick: '22' },
  { date: 'Nov 23', title: 'Small files merged up', who: 'Lean community · PRs #221, #324', tick: '23' },
  { date: 'Nov 25', title: 'Dozens more rounds', who: 'Lean community · 88 more merged PRs', tick: '25' },
  { date: 'Nov 25', title: 'Readable edition', who: 'Luke Sernau & colleagues at Anthropic, with Claude', tick: 'R' },
  { date: 'Nov 25', title: 'Compact edition', who: 'Luke Sernau & colleagues at Anthropic, with Claude', tick: 'C' },
];
// How each step is drawn: files matched by name (morph), or a different text
// (collapse into the theorem and regrow; cross-fade between the two editions).
const MODES = ['morph', 'morph', 'morph', 'morph', 'collapse', 'soft'];

const COL = { top: [0.86, 0.52, 1.0], bot: [0.58, 0.66, 1.0], haze: [0.55, 0.30, 1.0], amber: [1.0, 0.62, 0.10], cyan: [0.15, 0.95, 1.0] };
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const lerp = (a, b, t) => a + (b - a) * t;
const fmt = n => Math.round(n).toLocaleString('en-US');
const $ = id => document.getElementById(id);

// ---------------------------------------------------------------- data ----
const D = { meta: null, st: [], loaded: 0 };

function decode(m, buf) {
  const A = (name, T) => { const [off, , n] = m.arrays[name] || []; return off === undefined ? null : new T(buf, off, n); };
  const N = m.N, q16 = A('pos', Int16Array), inv = 1 / m.q;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N * 3; i++) pos[i] = q16[i] * inv;
  const par = A('par', Int32Array), depth = new Uint16Array(N);
  let dmax = 0;
  for (let i = 0; i < N; i++) { const d = Math.round(-pos[i * 3 + 1]); depth[i] = d; if (d > dmax) dmax = d; }
  // subtree sizes on the longest-chain tree (deepest first)
  const byDepth = Array.from({ length: dmax + 1 }, () => []);
  for (let i = 0; i < N; i++) byDepth[depth[i]].push(i);
  const size = new Float32Array(N).fill(1);
  for (let d = dmax; d > 0; d--) for (const v of byDepth[d]) { const p = par[v]; if (p >= 0) size[p] += size[v]; }
  const col = new Float32Array(N * 3);
  let rmax = 0;
  for (let i = 0; i < N; i++) {
    const f = Math.pow(depth[i] / Math.max(1, dmax), 0.6);
    for (let c = 0; c < 3; c++) col[i * 3 + c] = COL.top[c] * (1 - f) + COL.bot[c] * f;
    const r = Math.hypot(pos[i * 3], pos[i * 3 + 2]); if (r > rmax) rmax = r;
  }
  const S = { ...m, pos, par, depth, depthMax: dmax, size, col, rmax,
    flines: A('lines', Uint16Array), indeg: A('indeg', Uint16Array),
    next: A('next', Int32Array), absorb: A('absorb', Int32Array), haze: A('haze', Int32Array) };
  S.hazeN = S.haze.length / 2;
  S.root = par.indexOf(-1);
  return S;
}

function linkStages() {
  for (let i = 0; i + 1 < D.st.length; i++) {
    const A = D.st[i], B = D.st[i + 1];
    if (!A || !B || B.prev) continue;
    B.prev = new Int32Array(B.N).fill(-1);
    if (A.next) for (let k = 0; k < A.N; k++) if (A.next[k] >= 0) B.prev[A.next[k]] = k;
  }
}

async function loadAll(onProgress) {
  D.meta = await (await fetch('data/stages.json')).json();
  const total = D.meta.reduce((a, m) => a + m.bytes, 0);
  let got = 0;
  const one = async (i) => {
    const m = D.meta[i];
    const res = await fetch('data/' + m.file);
    const reader = res.body ? res.body.getReader() : null;
    let buf;
    if (reader) {
      const parts = []; let n = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); n += value.length; got += value.length; onProgress(got / total); }
      buf = new Uint8Array(n); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
      buf = buf.buffer;
    } else { buf = await res.arrayBuffer(); got += buf.byteLength; onProgress(got / total); }
    D.st[i] = decode(m, buf); D.loaded++;
    linkStages();
  };
  await one(0);                       // show the submission as soon as it is in
  onProgress(got / total, true);
  for (let i = 1; i < D.meta.length; i++) await one(i);
}

// ------------------------------------------------------------ renderer ----
const R = {};
function initGL(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) return null;
  R.gl = gl;
  R.float = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
  const prog = (v, f) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, v)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, f)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; };
  R.pSeg = prog(`#version 300 es
    layout(location=0) in vec3 p0; layout(location=1) in vec3 p1; layout(location=2) in vec3 wd; layout(location=3) in vec4 col;
    uniform mat4 vp; uniform vec2 res; uniform float focal; out vec4 vc; out float vs;
    void main(){
      int id = int(wd.z + 0.5);
      float t = (id==1||id==4||id==5) ? 1.0 : 0.0;
      float side = (id==2||id==3||id==5) ? 1.0 : -1.0;
      vec4 c0 = vp*vec4(p0,1.0), c1 = vp*vec4(p1,1.0);
      if (c0.w < 0.1 || c1.w < 0.1) { gl_Position = vec4(2.,2.,2.,1.); return; }
      vec2 s0 = c0.xy/c0.w*res*0.5, s1 = c1.xy/c1.w*res*0.5;
      vec2 d = s1 - s0; float L = length(d); d = L > 1e-4 ? d/L : vec2(1.,0.);
      vec2 n = vec2(-d.y, d.x);
      vec4 c = mix(c0, c1, t);
      float w = mix(wd.x, wd.y, t) * focal / c.w; float wp = max(w, 1.0);
      c.xy += (n*side*(wp*0.5+0.75) + d*(t*2.0-1.0)*0.5)*2.0/res*c.w;
      gl_Position = c; vc = vec4(col.rgb, col.a*min(1.0, w)); vs = side*(wp*0.5+0.75)/(wp*0.5);
    }`, `#version 300 es
    precision highp float; in vec4 vc; in float vs; out vec4 o;
    void main(){ float a = vc.a*(1.0 - smoothstep(0.55, 1.75, abs(vs))); o = vec4(vc.rgb*a, a); }`);
  R.pLine = prog(`#version 300 es
    layout(location=0) in vec3 p; layout(location=1) in vec4 col; uniform mat4 vp; out vec4 vc;
    void main(){ gl_Position = vp*vec4(p,1.0); vc = col; }`, `#version 300 es
    precision highp float; in vec4 vc; out vec4 o; void main(){ o = vec4(vc.rgb*vc.a, vc.a); }`);
  R.pPt = prog(`#version 300 es
    layout(location=0) in vec4 pr; layout(location=1) in vec4 col; uniform mat4 vp; uniform float focal; out vec4 vc; out float vsz;
    void main(){ gl_Position = vp*vec4(pr.xyz,1.0); float px = pr.w*focal/max(gl_Position.w,0.1); float s = max(px*2.0, 1.2);
      gl_PointSize = min(s+2.0, 96.0); vsz = s; vc = vec4(col.rgb, col.a*min(1.0, px*2.0)); }`, `#version 300 es
    precision highp float; in vec4 vc; in float vsz; out vec4 o;
    void main(){ float r = length(gl_PointCoord-0.5)*2.0*(vsz+2.0)/vsz; float a = vc.a*(1.0-smoothstep(0.7,1.05,r)); float core = 1.0-smoothstep(0.0,0.6,r); o = vec4((vc.rgb+core*0.5)*a, a); }`);
  const quadVS = `#version 300 es
    out vec2 uv; void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); uv = p; gl_Position = vec4(p*2.0-1.0,0.,1.); }`;
  R.pDown = prog(quadVS, `#version 300 es
    precision highp float; in vec2 uv; uniform sampler2D t; uniform vec2 px; out vec4 o;
    void main(){ o = 0.25*(texture(t,uv+px*vec2(-1,-1))+texture(t,uv+px*vec2(1,-1))+texture(t,uv+px*vec2(-1,1))+texture(t,uv+px*vec2(1,1))); }`);
  R.pBlur = prog(quadVS, `#version 300 es
    precision highp float; in vec2 uv; uniform sampler2D t; uniform vec2 dir; out vec4 o;
    void main(){ float w[5] = float[](0.2270, 0.1946, 0.1216, 0.0541, 0.0162); vec4 s = texture(t,uv)*w[0];
      for(int i=1;i<5;i++){ s += texture(t,uv+dir*float(i))*w[i]; s += texture(t,uv-dir*float(i))*w[i]; } o = s; }`);
  R.pComp = prog(quadVS, `#version 300 es
    precision highp float; in vec2 uv; uniform sampler2D sc; uniform sampler2D b1; uniform sampler2D b2; uniform float glow; uniform float halo; uniform float expo; uniform vec3 bg; out vec4 o;
    void main(){ vec3 c = texture(sc,uv).rgb + glow*(0.9*texture(b1,uv).rgb + halo*texture(b2,uv).rgb);
      c = 1.0 - exp(-c*expo); o = vec4(c + bg*(1.0-max(c.r,max(c.g,c.b))), 1.0); }`);
  const vao = (attrs) => {
    const v = gl.createVertexArray(); gl.bindVertexArray(v);
    const bufs = attrs.map(([loc, n, type, norm, stride, off, share]) => {
      const b = share || gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, type, norm, stride, off); return b;
    });
    gl.bindVertexArray(null); return { v, bufs };
  };
  const bF = gl.createBuffer();
  R.seg = vao([[0, 3, gl.FLOAT, false, 36, 0, bF], [1, 3, gl.FLOAT, false, 36, 12, bF], [2, 3, gl.FLOAT, false, 36, 24, bF], [3, 4, gl.UNSIGNED_BYTE, true, 4, 0]]);
  R.seg.bufs = [bF, R.seg.bufs[3]];
  R.pt = vao([[0, 4, gl.FLOAT, false, 16, 0], [1, 4, gl.UNSIGNED_BYTE, true, 4, 0]]);
  R.ln = vao([[0, 3, gl.FLOAT, false, 12, 0], [1, 4, gl.UNSIGNED_BYTE, true, 4, 0]]);
  R.quad = gl.createVertexArray();
  const maxN = 2 * 175187 + 2000, maxQ = 120000;
  R.maxQuad = maxQ;
  R.segF = new Float32Array(maxQ * 54); R.segC = new Uint8Array(maxQ * 24);
  R.lnF = new Float32Array((maxN + 60000) * 6); R.lnC = new Uint8Array((maxN + 60000) * 8);
  R.ptF = new Float32Array(maxN * 4); R.ptC = new Uint8Array(maxN * 4);
  R.st = new Map();
  return gl;
}

function targets(w, h) {
  const gl = R.gl;
  if (R.rt && R.rt.w === w && R.rt.h === h) return;
  if (R.rt) for (const t of Object.values(R.rt)) if (t && t.tex) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
  const mk = (tw, th) => {
    tw = Math.max(1, Math.round(tw)); th = Math.max(1, Math.round(th));
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    const make = (f) => {
      if (f) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, tw, th, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    };
    make(R.float);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (R.float && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { R.float = false; make(false); }
    return { tex, fb, w: tw, h: th };
  };
  R.rt = { w, h, scene: mk(w, h), h2: mk(w / 2, h / 2), q: mk(w / 4, h / 4), q2: mk(w / 4, h / 4), e: mk(w / 8, h / 8), e2: mk(w / 8, h / 8) };
}

function nodeState(S) {
  let s = R.st.get(S.id);
  if (!s) { s = { px: new Float32Array(S.N * 3), a: new Float32Array(S.N), c: new Float32Array(S.N * 3) }; R.st.set(S.id, s); }
  return s;
}

// Positions, alpha and colour of every file at slider position v.
function build(v) {
  const i = Math.min(Math.floor(v), D.st.length - 1);
  const A = D.st[i], B = (v > i && D.st[i + 1]) ? D.st[i + 1] : null;
  const u = B ? v - i : 0, mode = MODES[i], eu = ease(u);
  const layers = [];
  const sa = nodeState(A);
  for (let k = 0; k < A.N; k++) {
    let x = A.pos[k * 3], y = A.pos[k * 3 + 1], z = A.pos[k * 3 + 2];
    let a = 1, r = A.col[k * 3], g = A.col[k * 3 + 1], b = A.col[k * 3 + 2];
    if (B && mode === 'morph') {
      const j = A.next ? A.next[k] : -1;
      if (j >= 0) { x += (B.pos[j * 3] - x) * eu; y += (B.pos[j * 3 + 1] - y) * eu; z += (B.pos[j * 3 + 2] - z) * eu; }
      else if (A.absorb && A.absorb[k] >= 0) {
        const t = A.absorb[k], lag = 0.25 * ((k * 2654435761 >>> 0) / 4294967296), w = ease(clamp((u - lag) / 0.7));
        x += (B.pos[t * 3] - x) * w; y += (B.pos[t * 3 + 1] - y) * w; z += (B.pos[t * 3 + 2] - z) * w;
        const hot = smooth(0, 0.25, u) * (1 - smooth(0.75, 1, w));
        r += (COL.amber[0] - r) * hot; g += (COL.amber[1] - g) * hot; b += (COL.amber[2] - b) * hot;
        a *= (1 - smooth(0.6, 1, w)) * (1 + 1.2 * hot);
      } else {
        const hot = smooth(0, 0.2, u);
        r += (COL.amber[0] - r) * hot; g += (COL.amber[1] - g) * hot; b += (COL.amber[2] - b) * hot;
        a *= (1 + 1.8 * hot * (1 - smooth(0.2, 0.6, u))) * (1 - smooth(0.35, 0.85, u));
        y -= 14 * u * u;
      }
    } else if (B && mode === 'soft') {
      const j = A.next ? A.next[k] : -1;
      if (j >= 0) { x += (B.pos[j * 3] - x) * eu; y += (B.pos[j * 3 + 1] - y) * eu; z += (B.pos[j * 3 + 2] - z) * eu; }
      else a *= 1 - smooth(0.2, 0.75, u);
    } else if (B && mode === 'collapse') {
      const w = ease(clamp(u / 0.5)), rx = A.pos[A.root * 3], ry = A.pos[A.root * 3 + 1], rz = A.pos[A.root * 3 + 2];
      x += (rx - x) * w; y += (ry - y) * w; z += (rz - z) * w; a *= 1 - smooth(0.3, 0.5, u);
    }
    sa.px[k * 3] = x; sa.px[k * 3 + 1] = y; sa.px[k * 3 + 2] = z; sa.a[k] = a;
    sa.c[k * 3] = r; sa.c[k * 3 + 1] = g; sa.c[k * 3 + 2] = b;
  }
  layers.push({ S: A, st: sa, w: B ? (mode === 'collapse' ? 1 - smooth(0.3, 0.5, u) : 1 - smooth(0.25, 0.9, u)) : 1 });
  if (B) {
    const sb = nodeState(B);
    for (let j = 0; j < B.N; j++) {
      let x = B.pos[j * 3], y = B.pos[j * 3 + 1], z = B.pos[j * 3 + 2];
      let a = 1, r = B.col[j * 3], g = B.col[j * 3 + 1], b = B.col[j * 3 + 2];
      if (mode === 'collapse') {
        const gU = clamp((u - 0.5) / 0.5), f = B.depth[j] / B.depthMax, ra = smooth(f - 0.08, f, gU * 1.08), s = ease(ra);
        const rx = B.pos[B.root * 3], ry = B.pos[B.root * 3 + 1], rz = B.pos[B.root * 3 + 2];
        x = rx + (x - rx) * s; y = ry + (y - ry) * s; z = rz + (z - rz) * s; a *= ra;
      } else {
        const i0 = B.prev ? B.prev[j] : -1;
        if (i0 >= 0) { x = sa.px[i0 * 3]; y = sa.px[i0 * 3 + 1]; z = sa.px[i0 * 3 + 2]; }
        else if (mode === 'soft') a *= smooth(0.35, 0.9, u);
        else { const hot = 1 - smooth(0.5, 1, u); r += (COL.cyan[0] - r) * hot; g += (COL.cyan[1] - g) * hot; b += (COL.cyan[2] - b) * hot; a *= smooth(0.3, 0.8, u); }
      }
      sb.px[j * 3] = x; sb.px[j * 3 + 1] = y; sb.px[j * 3 + 2] = z; sb.a[j] = a;
      sb.c[j * 3] = r; sb.c[j * 3 + 1] = g; sb.c[j * 3 + 2] = b;
    }
    layers.push({ S: B, st: sb, w: mode === 'collapse' ? smooth(0.5, 0.6, u) : smooth(0.25, 0.9, u) });
  }
  return layers;
}

function fill(layers, pxPerUnit, beadLines) {
  let ns = 0, np = 0, nl = 0;
  const { segF, segC, ptF, ptC, lnF, lnC } = R;
  const line = (px, i, j, r, g, b, a) => {
    const o = nl * 6;
    lnF[o] = px[i * 3]; lnF[o + 1] = px[i * 3 + 1]; lnF[o + 2] = px[i * 3 + 2];
    lnF[o + 3] = px[j * 3]; lnF[o + 4] = px[j * 3 + 1]; lnF[o + 5] = px[j * 3 + 2];
    const q = nl * 8, A = Math.min(255, 255 * a), R_ = Math.min(255, 255 * r), G = Math.min(255, 255 * g), B = Math.min(255, 255 * b);
    lnC[q] = R_; lnC[q + 1] = G; lnC[q + 2] = B; lnC[q + 3] = A; lnC[q + 4] = R_; lnC[q + 5] = G; lnC[q + 6] = B; lnC[q + 7] = A;
    nl++;
  };
  for (const L of layers) {
    const { S, st, w } = L;
    if (w <= 0.002) continue;
    const k = Math.min(1, 0.85 * 9 / Math.sqrt(S.N)), kb = 0.85 * 30 / Math.sqrt(S.N);
    const px = st.px, al = st.a, cc = st.c;
    const hA = 0.55 * k * 0.1 * w * 0.6;
    for (let e = 0; e < S.hazeN; e++) {
      const i = S.haze[2 * e], j = S.haze[2 * e + 1], a = hA * Math.min(al[i], al[j]);
      if (a >= 0.003) line(px, i, j, COL.haze[0], COL.haze[1], COL.haze[2], a);
    }
    for (let i = 0; i < S.N; i++) {
      const p = S.par[i]; if (p < 0) continue;
      const a0 = Math.min(al[i], al[p]) * w; if (a0 < 0.003) continue;
      const lw = Math.log2(1 + S.size[i]);
      const a = Math.min(1, (0.22 + 0.16 * lw) * k) * a0;
      const wd = 0.05 + 0.16 * lw;
      if (wd * pxPerUnit < 2.5 || ns >= R.maxQuad) { line(px, i, p, cc[i * 3], cc[i * 3 + 1], cc[i * 3 + 2], a * Math.max(0.35, Math.min(1, wd * pxPerUnit))); continue; }
      const w1 = 0.05 + 0.16 * Math.log2(1 + S.size[p]);
      const R_ = Math.min(255, 255 * cc[i * 3]), G = Math.min(255, 255 * cc[i * 3 + 1]), B = Math.min(255, 255 * cc[i * 3 + 2]), A = Math.min(255, 255 * a);
      for (let v = 0; v < 6; v++) {
        const o = (ns * 6 + v) * 9;
        segF[o] = px[i * 3]; segF[o + 1] = px[i * 3 + 1]; segF[o + 2] = px[i * 3 + 2];
        segF[o + 3] = px[p * 3]; segF[o + 4] = px[p * 3 + 1]; segF[o + 5] = px[p * 3 + 2];
        segF[o + 6] = wd; segF[o + 7] = w1; segF[o + 8] = v;
        const q = (ns * 6 + v) * 4; segC[q] = R_; segC[q + 1] = G; segC[q + 2] = B; segC[q + 3] = A;
      }
      ns++;
    }
    for (let i = 0; i < S.N; i++) {
      const a = al[i] * w; if (a < 0.003) continue;
      const isRoot = i === S.root;
      let rad, bb;
      if (beadLines) { rad = 0.02 * Math.sqrt(S.flines[i]); bb = 0.9; }
      else { const d = S.indeg[i]; rad = 0.05 + 0.045 * Math.pow(d, 0.45); bb = Math.min(1, (0.12 + 0.1 * Math.log2(1 + d)) * Math.min(1, kb)); }
      if (isRoot) { bb = 1; rad = Math.max(rad, 1.6); }
      if (a * bb < 0.004) continue;
      const o = np * 4;
      ptF[o] = px[i * 3]; ptF[o + 1] = px[i * 3 + 1]; ptF[o + 2] = px[i * 3 + 2]; ptF[o + 3] = rad;
      ptC[o] = Math.min(255, 255 * (isRoot ? 1 : cc[i * 3])); ptC[o + 1] = Math.min(255, 255 * (isRoot ? 1 : cc[i * 3 + 1]));
      ptC[o + 2] = Math.min(255, 255 * (isRoot ? 1 : cc[i * 3 + 2])); ptC[o + 3] = Math.min(255, 255 * Math.min(1, a * bb));
      np++;
    }
  }
  const gl = R.gl;
  const up = (buf, data) => { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW); };
  up(R.seg.bufs[0], segF.subarray(0, ns * 54)); up(R.seg.bufs[1], segC.subarray(0, ns * 24));
  up(R.ln.bufs[0], lnF.subarray(0, nl * 6)); up(R.ln.bufs[1], lnC.subarray(0, nl * 8));
  up(R.pt.bufs[0], ptF.subarray(0, np * 4)); up(R.pt.bufs[1], ptC.subarray(0, np * 4));
  R.counts = { ns, np, nl };
}

function camMatrix(c, w, h) {
  const fov = 30 * Math.PI / 180, asp = w / h;
  const ex = c.tx + c.dist * Math.cos(c.pitch) * Math.sin(c.yaw), ey = c.ty + c.dist * Math.sin(c.pitch), ez = c.tz + c.dist * Math.cos(c.pitch) * Math.cos(c.yaw);
  let fx = c.tx - ex, fy = c.ty - ey, fz = c.tz - ez; const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
  let sx = -fz, sy = 0, sz = fx; const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
  const ux = sy * fz - sz * fy, uy = sz * fx - sx * fz, uz = sx * fy - sy * fx;
  const V = [sx, ux, -fx, 0, sy, uy, -fy, 0, sz, uz, -fz, 0, -(sx * ex + sy * ey + sz * ez), -(ux * ex + uy * ey + uz * ez), (fx * ex + fy * ey + fz * ez), 1];
  const f = 1 / Math.tan(fov / 2), n = 0.5, fr = 5000;
  const P = [f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (fr + n) / (n - fr), -1, 0, 0, 2 * fr * n / (n - fr), 0];
  P[8] -= c.shiftX || 0; P[9] -= c.shiftY || 0;
  const M = new Float32Array(16);
  for (let col = 0; col < 4; col++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += P[k * 4 + r] * V[col * 4 + k]; M[col * 4 + r] = s; }
  return { M, focal: (h / 2) * f, right: [sx, sy, sz], up: [ux, uy, uz] };
}

function render(cam, w, h) {
  const gl = R.gl, { M, focal } = camMatrix(cam, w, h);
  targets(w, h);
  const T = R.rt, { ns, np, nl } = R.counts;
  gl.bindFramebuffer(gl.FRAMEBUFFER, T.scene.fb); gl.viewport(0, 0, T.scene.w, T.scene.h);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  gl.useProgram(R.pLine); gl.uniformMatrix4fv(gl.getUniformLocation(R.pLine, 'vp'), false, M);
  gl.bindVertexArray(R.ln.v); if (nl) gl.drawArrays(gl.LINES, 0, nl * 2);
  gl.useProgram(R.pSeg); gl.uniformMatrix4fv(gl.getUniformLocation(R.pSeg, 'vp'), false, M);
  gl.uniform2f(gl.getUniformLocation(R.pSeg, 'res'), w, h); gl.uniform1f(gl.getUniformLocation(R.pSeg, 'focal'), focal);
  gl.bindVertexArray(R.seg.v); if (ns) gl.drawArrays(gl.TRIANGLES, 0, ns * 6);
  gl.useProgram(R.pPt); gl.uniformMatrix4fv(gl.getUniformLocation(R.pPt, 'vp'), false, M); gl.uniform1f(gl.getUniformLocation(R.pPt, 'focal'), focal);
  gl.bindVertexArray(R.pt.v); if (np) gl.drawArrays(gl.POINTS, 0, np);
  gl.bindVertexArray(R.quad); gl.disable(gl.BLEND);
  const pass = (p, src, dst, set) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null); gl.viewport(0, 0, dst ? dst.w : w, dst ? dst.h : h);
    gl.useProgram(p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex); gl.uniform1i(gl.getUniformLocation(p, 't'), 0);
    set && set(p); gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  pass(R.pDown, T.scene, T.h2, p => gl.uniform2f(gl.getUniformLocation(p, 'px'), 0.5 / w, 0.5 / h));
  pass(R.pDown, T.h2, T.q, p => gl.uniform2f(gl.getUniformLocation(p, 'px'), 1 / w, 1 / h));
  for (let k = 0; k < 2; k++) {
    pass(R.pBlur, T.q, T.q2, p => gl.uniform2f(gl.getUniformLocation(p, 'dir'), 1.5 / T.q.w, 0));
    pass(R.pBlur, T.q2, T.q, p => gl.uniform2f(gl.getUniformLocation(p, 'dir'), 0, 1.5 / T.q.h));
  }
  pass(R.pDown, T.q, T.e, p => gl.uniform2f(gl.getUniformLocation(p, 'px'), 2 / w, 2 / h));
  pass(R.pBlur, T.e, T.e2, p => gl.uniform2f(gl.getUniformLocation(p, 'dir'), 2 / T.e.w, 0));
  pass(R.pBlur, T.e2, T.e, p => gl.uniform2f(gl.getUniformLocation(p, 'dir'), 0, 2 / T.e.h));
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
  const pc = R.pComp; gl.useProgram(pc);
  const tex = (unit, t, name) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t.tex); gl.uniform1i(gl.getUniformLocation(pc, name), unit); };
  tex(0, T.scene, 'sc'); tex(1, T.q, 'b1'); tex(2, T.e, 'b2');
  gl.uniform1f(gl.getUniformLocation(pc, 'glow'), 0.18); gl.uniform1f(gl.getUniformLocation(pc, 'halo'), 0.2);
  gl.uniform1f(gl.getUniformLocation(pc, 'expo'), 1.0); gl.uniform3f(gl.getUniformLocation(pc, 'bg'), 0.0, 0.004, 0.012);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// ------------------------------------------------------------------ UI ----
const view = { v: 0, yaw: 0.5, pitch: 0.14, zoom: 1, panX: 0, panY: 0, playing: false, playT: 0, idle: 0, dirty: true };
let lastBuilt = null, lastPx = 0;

function framing(v, aspect, narrow) {
  // Frame each stage to fit, and blend between neighbours as the slider moves.
  const fit = S => {
    const hgt = S.depthMax, wid = 2 * S.rmax;
    const tanH = Math.tan(15 * Math.PI / 180);
    const dist = Math.max(hgt * (narrow ? 1.7 : 1.2) / (2 * tanH), wid * 1.2 / (2 * tanH * aspect));
    return { ty: -hgt / 2, dist };
  };
  const i = Math.min(Math.floor(v), D.st.length - 1), A = D.st[i], B = D.st[i + 1];
  const a = fit(A);
  if (!B || v <= i) return a;
  const b = fit(B), u = v - i;
  const t = MODES[i] === 'collapse' ? smooth(0.35, 0.95, u) : ease(u);
  return { ty: lerp(a.ty, b.ty, t), dist: Math.exp(lerp(Math.log(a.dist), Math.log(b.dist), t)) };
}

function camera(w, h) {
  const narrow = w / (window.devicePixelRatio || 1) < 760 || w < h;
  const f = framing(view.v, w / h, narrow);
  return { yaw: view.yaw, pitch: view.pitch, dist: f.dist / view.zoom, tx: view.panX, ty: f.ty + view.panY, tz: 0,
    shiftX: narrow ? 0 : 0.18, shiftY: narrow ? -0.12 : 0 };
}

function counters(v) {
  const i = Math.min(Math.floor(v), D.st.length - 1), A = D.st[i], B = D.st[i + 1];
  const u = B && v > i ? ease(v - i) : 0;
  const lg = (x, y) => Math.exp(lerp(Math.log(Math.max(1, x)), Math.log(Math.max(1, y)), u));
  const pick = k => B ? lg(A[k], B[k]) : A[k];
  return { files: pick('files'), lines: pick('lines'), code: pick('code'), imports: pick('imports'), chain: B ? lerp(A.chain, B.chain, u) : A.chain };
}

function updateHUD() {
  const v = view.v, i = Math.min(Math.round(v), STAGES.length - 1);
  const I = STAGES[i];
  $('stage').textContent = `${I.date} · ${I.title}`;
  $('who').textContent = I.who;
  const c = counters(v);
  $('c-files').textContent = fmt(c.files);
  $('c-lines').textContent = fmt(c.lines);
  $('c-code').textContent = fmt(c.code);
  $('c-imports').textContent = fmt(c.imports);
  $('c-chain').textContent = fmt(c.chain);
  const s0 = D.st[0];
  const ratio = s0.lines / c.lines;
  $('ratio').textContent = ratio >= 1.05 ? `${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}× fewer lines than Nov 20` : 'the original';
  $('beadnote').hidden = v < 4.5;
  $('slider').value = v;
  $('slider').setAttribute('aria-valuetext', `${I.date}, ${I.title}`);
  document.querySelectorAll('.tick').forEach((t, k) => t.classList.toggle('on', k === i));
}

function frame(canvas, now) {
  const dt = Math.min(0.1, (now - (frame.last || now)) / 1000); frame.last = now;
  if (view.playing) {
    view.playT += dt;
    const per = 4.2, k = Math.floor(view.playT / per), f = view.playT % per;
    view.v = Math.min(D.loaded - 1, D.st.length - 1, k + (f < 1.2 ? 0 : ease(Math.min(1, (f - 1.2) / 3.0))));
    if (view.v >= D.st.length - 1 && view.playT > (D.st.length - 1) * per + 1) setPlaying(false);
    view.dirty = true;
  }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  view.idle += dt;
  if (!reduce && view.idle > 2.5 && !drag.active) { view.yaw += dt * 0.12; view.dirty = true; }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  const cap = 2.6e6; if (w * h > cap) { const s = Math.sqrt(cap / (w * h)); w = Math.round(w * s); h = Math.round(h * s); }
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; view.dirty = true; }
  if (view.dirty) {
    const cam = camera(w, h), pxPerUnit = (h / 2) / Math.tan(15 * Math.PI / 180) / cam.dist;
    const key = view.v.toFixed(4);
    if (key !== lastBuilt || Math.abs(Math.log(pxPerUnit / (lastPx || 1))) > 0.25) {
      fill(build(view.v), pxPerUnit, view.v >= 4.5);
      lastBuilt = key; lastPx = pxPerUnit;
      updateHUD();
    }
    render(cam, w, h);
    view.dirty = false;
  }
  requestAnimationFrame(t => frame(canvas, t));
}

function setPlaying(p) {
  view.playing = p;
  const b = $('play');
  b.textContent = p ? '❚❚' : '▶';
  b.setAttribute('aria-label', p ? 'Pause' : 'Play the five days');
  if (p) { if (view.v >= D.st.length - 1.001) view.v = 0; view.playT = view.v * 4.2 + (view.v % 1 ? 1.2 : 0); }
}

const drag = { active: false, pts: new Map(), lastDist: 0, lastMid: null };
function bindControls(canvas) {
  const slider = $('slider');
  slider.addEventListener('input', () => { setPlaying(false); view.v = Math.min(+slider.value, D.loaded - 1); view.dirty = true; view.idle = 0; });
  $('play').addEventListener('click', () => { setPlaying(!view.playing); view.dirty = true; });
  document.querySelectorAll('.tick').forEach((t, k) => t.addEventListener('click', () => { setPlaying(false); view.v = Math.min(k, D.loaded - 1); view.dirty = true; }));
  $('reset').addEventListener('click', () => { Object.assign(view, { yaw: 0.5, pitch: 0.14, zoom: 1, panX: 0, panY: 0, dirty: true }); });
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' && e.target.type === 'range') return;
    if (e.key === ' ') { e.preventDefault(); setPlaying(!view.playing); }
    if (e.key === 'ArrowRight') { view.v = Math.min(D.loaded - 1, Math.floor(view.v) + 1); view.dirty = true; }
    if (e.key === 'ArrowLeft') { view.v = Math.max(0, Math.ceil(view.v) - 1); view.dirty = true; }
  });
  const worldPerPx = () => { const cam = camera(canvas.width, canvas.height); return 2 * cam.dist * Math.tan(15 * Math.PI / 180) / canvas.clientHeight; };
  const pan = (dx, dy) => {
    const s = worldPerPx();
    view.panX -= Math.cos(view.yaw) * dx * s; view.panY += dy * s;
    view.panX = clamp(view.panX, -120, 120); view.panY = clamp(view.panY, -150, 150);
  };
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); drag.pts.set(e.pointerId, [e.clientX, e.clientY]); drag.active = true; drag.button = e.button; drag.shift = e.shiftKey; drag.lastDist = 0; drag.lastMid = null; view.idle = 0; });
  canvas.addEventListener('pointermove', e => {
    if (!drag.pts.has(e.pointerId)) return;
    const [px, py] = drag.pts.get(e.pointerId); const dx = e.clientX - px, dy = e.clientY - py;
    drag.pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (drag.pts.size === 1) {
      if (drag.button === 2 || drag.shift) pan(dx, dy);
      else { view.yaw -= dx * 0.006; view.pitch = clamp(view.pitch + dy * 0.005, -1.2, 1.3); }
    } else if (drag.pts.size === 2) {
      const [a, b] = [...drag.pts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (drag.lastDist) view.zoom = clamp(view.zoom * d / drag.lastDist, 0.4, 25);
      if (drag.lastMid) pan(mid[0] - drag.lastMid[0], mid[1] - drag.lastMid[1]);
      drag.lastDist = d; drag.lastMid = mid;
    }
    view.dirty = true; view.idle = 0;
  });
  const up = e => { drag.pts.delete(e.pointerId); drag.lastDist = 0; drag.lastMid = null; if (!drag.pts.size) drag.active = false; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => { e.preventDefault(); view.zoom = clamp(view.zoom * Math.exp(-e.deltaY * 0.0015), 0.4, 25); view.dirty = true; view.idle = 0; }, { passive: false });
  canvas.addEventListener('dblclick', () => $('reset').click());
  window.addEventListener('resize', () => { view.dirty = true; });
}

async function main() {
  const canvas = $('map');
  let gl;
  try { gl = initGL(canvas); } catch (e) { console.error(e); }
  if (!gl) { $('loading').textContent = 'This page needs WebGL2, which this browser does not offer. The video on the Projects page shows the same thing.'; return; }
  const ticks = $('ticks');
  STAGES.forEach((s, k) => {
    const b = document.createElement('button');
    b.className = 'tick'; b.type = 'button'; b.textContent = s.tick; b.title = `${s.date} · ${s.title}`;
    b.style.left = `${(k / (STAGES.length - 1)) * 100}%`;
    ticks.appendChild(b);
  });
  bindControls(canvas);
  let started = false;
  await loadAll((p, first) => {
    $('bar').style.width = `${(p * 100).toFixed(1)}%`;
    if (first && !started) {
      started = true;
      $('loading').hidden = true;
      requestAnimationFrame(t => frame(canvas, t));
    }
  });
  $('loadnote').hidden = true;
  $('play').disabled = false;
  view.dirty = true;
}
main();
