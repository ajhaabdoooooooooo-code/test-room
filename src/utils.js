import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 * small math helpers
 * ------------------------------------------------------------------ */
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const DEG = Math.PI / 180;

/* frame-rate independent damping */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/* deterministic rng so the room looks identical on every load */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function rngFactory(seed) {
  const r = mulberry32(seed);
  return {
    next: r,
    range: (a, b) => a + r() * (b - a),
    int: (a, b) => Math.floor(a + r() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(r() * arr.length)],
  };
}

/* ------------------------------------------------------------------ *
 * colour helpers (hex in, hex out)
 * ------------------------------------------------------------------ */
export function shade(hex, amt) {
  const c = new THREE.Color(hex);
  if (amt >= 0) c.lerp(new THREE.Color(0xffffff), amt);
  else c.lerp(new THREE.Color(0x000000), -amt);
  return '#' + c.getHexString();
}
export function mixHex(a, b, t) {
  return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}

/* ------------------------------------------------------------------ *
 * canvas helpers
 * ------------------------------------------------------------------ */
export function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
export function ctx2d(c) {
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingEnabled = true;
  return x;
}

export function toTexture(c, { repeat = [1, 1], srgb = true, aniso = 8, wrap = THREE.RepeatWrapping } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = wrap;
  t.repeat.set(repeat[0], repeat[1]);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

export function cloneTex(tex, repeat, offset = [0, 0]) {
  const t = tex.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.offset.set(offset[0], offset[1]);
  t.needsUpdate = true;
  return t;
}

export function roundRect(c, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

export function polygon(c, pts) {
  c.beginPath();
  pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
  c.closePath();
}

/* fine random speckle over the whole canvas (adds "material" to flat fills) */
export function grain(c, w, h, amount = 5, alpha = 0.05, seed = 7) {
  const r = mulberry32(seed);
  const ctx = ctx2d(c);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d[i] = clamp(d[i] + n, 0, 255);
    d[i + 1] = clamp(d[i + 1] + n, 0, 255);
    d[i + 2] = clamp(d[i + 2] + n, 0, 255);
  }
  ctx.putImageData(img, 0, 0);
}

/* ------------------------------------------------------------------ *
 * fractal value noise (seamless, tileable lattice)
 * ------------------------------------------------------------------ */
function lattice(n, rnd) {
  const g = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) g[i] = rnd();
  return g;
}
function sampleLattice(g, n, u, v) {
  const x = u * n;
  const y = v * n;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const x0 = ((xi % n) + n) % n;
  const y0 = ((yi % n) + n) % n;
  const x1 = (x0 + 1) % n;
  const y1 = (y0 + 1) % n;
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = g[y0 * n + x0];
  const b = g[y0 * n + x1];
  const cc = g[y1 * n + x0];
  const dd = g[y1 * n + x1];
  const top = a + (b - a) * sx;
  const bot = cc + (dd - cc) * sx;
  return top + (bot - top) * sy;
}

/* returns a Float32Array of w*h values in 0..1 */
export function fbm(w, h, { octaves = 4, base = 4, gain = 0.5, seed = 1 } = {}) {
  const rnd = mulberry32(seed);
  const layers = [];
  let amp = 1;
  let n = base;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    layers.push({ g: lattice(n, rnd), n, amp });
    norm += amp;
    amp *= gain;
    n *= 2;
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      let s = 0;
      for (let i = 0; i < layers.length; i++) {
        const L = layers[i];
        s += L.amp * sampleLattice(L.g, L.n, u, v);
      }
      out[y * w + x] = s / norm;
    }
  }
  return out;
}

/* grey fbm canvas — handy as a height/detail map */
export function fbmCanvas(w, h, opts = {}) {
  const data = fbm(w, h, opts);
  const { lo = 0, hi = 1, gamma = 1 } = opts;
  const c = canvas(w, h);
  const ctx = ctx2d(c);
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    let v = lo + (hi - lo) * data[i];
    v = Math.pow(clamp(v, 0, 1), gamma) * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* paint an fbm field over an existing canvas as a soft multiply/overlay layer */
export function overlayNoise(c, w, h, { strength = 0.12, octaves = 4, base = 6, seed = 3, mode = 'multiply' } = {}) {
  const data = fbm(w, h, { octaves, base, seed });
  const ctx = ctx2d(c);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < w * h; i++) {
    const n = 1 + (data[i] - 0.5) * 2 * strength;
    for (let k = 0; k < 3; k++) {
      const idx = i * 4 + k;
      d[idx] = clamp(mode === 'multiply' ? d[idx] * n : d[idx] + (data[i] - 0.5) * 255 * strength, 0, 255);
    }
  }
  ctx.putImageData(img, 0, 0);
}

/* ------------------------------------------------------------------ *
 * map generation from a height canvas
 * ------------------------------------------------------------------ */
export function normalFromHeight(src, strength = 2.0) {
  const w = src.width;
  const h = src.height;
  const s = ctx2d(src).getImageData(0, 0, w, h).data;
  const c = canvas(w, h);
  const ctx = ctx2d(c);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const at = (x, y) => s[((((y % h) + h) % h) * w + (((x % w) + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * w + x) * 4;
      d[i] = (-dx / len) * 127.5 + 127.5;
      d[i + 1] = (dy / len) * 127.5 + 127.5;
      d[i + 2] = (1 / len) * 127.5 + 127.5;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* grey canvas from a colour canvas: value = lerp(dark, light, luma) */
export function grayFrom(c, dark = 0.55, light = 1.0, gamma = 1) {
  const w = c.width;
  const h = c.height;
  const s = ctx2d(c).getImageData(0, 0, w, h).data;
  const out = canvas(w, h);
  const ctx = ctx2d(out);
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const l = (0.2126 * s[i * 4] + 0.7152 * s[i * 4 + 1] + 0.0722 * s[i * 4 + 2]) / 255;
    const v = Math.pow(clamp(dark + (light - dark) * l, 0, 1), gamma) * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/* ------------------------------------------------------------------ *
 * geometry helpers
 * ------------------------------------------------------------------ */

/* Superellipsoid "rounded box" with smooth normals: e≈1 sphere, e≈0.3 boxy.
   Great for plush, cute-but-solid volumes (mattress, pillows, cushions). */
export function superBox(w, h, d, e = 0.32, segU = 28, segV = 18) {
  const pos = [];
  const uvs = [];
  const idx = [];
  const su = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
  for (let j = 0; j <= segV; j++) {
    const v = -Math.PI / 2 + (Math.PI * j) / segV;
    for (let i = 0; i <= segU; i++) {
      const u = -Math.PI + (2 * Math.PI * i) / segU;
      const cv = Math.cos(v);
      const sv = Math.sin(v);
      const cu = Math.cos(u);
      const suu = Math.sin(u);
      const x = 0.5 * su(cv, e) * su(cu, e);
      const y = 0.5 * su(sv, e);
      const z = 0.5 * su(cv, e) * su(suu, e);
      pos.push(x * w, y * h, z * d);
      uvs.push(i / segU, j / segV);
    }
  }
  const row = segU + 1;
  for (let j = 0; j < segV; j++) {
    for (let i = 0; i < segU; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const dd = c + 1;
      idx.push(a, c, b, b, c, dd);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* soft-edged slab: a box whose vertices bulge slightly (cushion / pad) */
export function puffBox(w, h, d, bulge = 0.06, seg = 6) {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.multiplyScalar(1 + bulge);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/* parallel-transport frames along a poly-line (stable sweep frames) */
function transportFrames(path) {
  const n = path.length;
  const tangents = [];
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(n - 1, i + 1)];
    const t = new THREE.Vector3().subVectors(b, a);
    if (t.lengthSq() < 1e-12) t.set(0, 0, 1);
    tangents.push(t.normalize());
  }
  const out = [];
  let normal = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const t = tangents[i];
    if (i > 0) {
      const prev = tangents[i - 1];
      const axis = new THREE.Vector3().crossVectors(prev, t);
      const len = axis.length();
      if (len > 1e-7) {
        axis.divideScalar(len);
        const ang = Math.acos(clamp(prev.dot(t), -1, 1));
        normal.applyAxisAngle(axis, ang);
      }
    }
    normal.addScaledVector(t, -normal.dot(t));
    if (normal.lengthSq() < 1e-9) {
      normal.set(1, 0, 0).addScaledVector(t, -t.x);
    }
    normal.normalize();
    const binormal = new THREE.Vector3().crossVectors(t, normal).normalize();
    out.push({ t, n: normal.clone(), b: binormal });
  }
  return out;
}

/* sweep a closed 2D profile [[x,y],...] along a 3D path — cloth, cables, rims */
export function sweepProfile(path, profile, { cap = true, arc = null } = {}) {
  const P = path.length;
  const Q = profile.length;
  const frames = transportFrames(path);
  const lengths = [0];
  for (let i = 1; i < P; i++) lengths.push(lengths[i - 1] + path[i].distanceTo(path[i - 1]));
  const total = lengths[P - 1] || 1;

  const pos = [];
  const uvs = [];
  const idx = [];
  for (let i = 0; i < P; i++) {
    const { n, b } = frames[i];
    for (let j = 0; j < Q; j++) {
      const [u, v] = profile[j];
      pos.push(
        path[i].x + b.x * u + n.x * v,
        path[i].y + b.y * u + n.y * v,
        path[i].z + b.z * u + n.z * v
      );
      uvs.push(j / Q, arc ? arc(lengths[i] / total) : lengths[i] / total);
    }
  }
  for (let i = 0; i < P - 1; i++) {
    for (let j = 0; j < Q; j++) {
      const j2 = (j + 1) % Q;
      const a = i * Q + j;
      const b = i * Q + j2;
      const c = (i + 1) * Q + j;
      const d = (i + 1) * Q + j2;
      idx.push(a, c, b, b, c, d);
    }
  }
  if (cap) {
    // simple fan caps
    for (let j = 1; j < Q - 1; j++) {
      idx.push(0, j + 1, j);
      const base = (P - 1) * Q;
      idx.push(base, base + j, base + j + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function roundedProfile(halfW, halfH, r = Math.min(halfW, halfH) * 0.6, seg = 4) {
  const pts = [];
  const cx = halfW - r;
  const cy = halfH - r;
  const corners = [
    [cx, cy, 0],
    [-cx, cy, Math.PI / 2],
    [-cx, -cy, Math.PI],
    [cx, -cy, -Math.PI / 2],
  ];
  for (const [x, y, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (Math.PI / 2) * (i / seg);
      pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
    }
  }
  return pts;
}

export function circleProfile(r, seg = 10) {
  const pts = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

/* a cloth strip: hangs over an edge with thickness (blanket / throw) */
export function clothGeometry(profile, { width = 1, length = 1, segU = 6 } = {}) {
  return profile;
}

export function setShadow(root, cast = true, receive = true) {
  root.traverse((o) => {
    // layer 1 holds FX geometry (glass, sky, shafts, dust) — never shadow casters
    if (o.isMesh && (o.layers.mask & 2) === 0) {
      o.castShadow = cast;
      o.receiveShadow = receive;
    }
  });
  return root;
}

export function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function group(name, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  return g;
}
