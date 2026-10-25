import * as THREE from 'three';
import {
  canvas, ctx2d, toTexture, grain, overlayNoise, fbmCanvas, fbm, normalFromHeight, grayFrom,
  roundRect, polygon, clamp, mulberry32, rngFactory, shade, mixHex,
} from './utils.js';

/* ==================================================================== *
 *  TEXTURE LIBRARY
 *  Everything is painted procedurally at load time — no external files,
 *  so the room keeps the exact same colours as the reference art.
 * ==================================================================== */

const R = rngFactory(20261025);

/* ---------------------------------------------------------------- *
 * floor — staggered wood planks, long axis along +V (world Z)
 * ---------------------------------------------------------------- */
export function floorTextures() {
  const S = 1024;
  const c = canvas(S, S);
  const g = ctx2d(c);
  const plankColors = ['#D9B98D', '#C9A878', '#E0C39A', '#BE9D70', '#D3B183', '#E4CBA4'];
  const seam = '#8A6A48';

  g.fillStyle = '#C9A878';
  g.fillRect(0, 0, S, S);

  const cols = 6;                // 6 planks across → ~18 cm each in world space
  const cw = S / cols;
  const jointChance = 0.62;

  for (let i = 0; i < cols; i++) {
    const x = i * cw;
    // each column is split into 2-3 boards lengthwise (staggered butt joints)
    const cuts = [0];
    if (R.next() < jointChance) cuts.push(R.range(0.28, 0.72) * S);
    cuts.push(S);
    for (let k = 0; k < cuts.length - 1; k++) {
      const y0 = cuts[k];
      const y1 = cuts[k + 1];
      const base = R.pick(plankColors);
      g.fillStyle = base;
      g.fillRect(x, y0, cw, y1 - y0);

      // grain: long soft streaks running with the plank
      const streaks = 26;
      for (let s = 0; s < streaks; s++) {
        const sx = x + R.range(1, cw - 1);
        const tone = R.next() < 0.5 ? shade(base, -R.range(0.02, 0.16)) : shade(base, R.range(0.02, 0.13));
        g.strokeStyle = tone;
        g.globalAlpha = R.range(0.05, 0.24);
        g.lineWidth = R.range(0.7, 2.6);
        g.beginPath();
        let px = sx;
        g.moveTo(px, y0);
        const segs = 7;
        for (let q = 1; q <= segs; q++) {
          px += R.range(-2.1, 2.1);
          g.lineTo(px, y0 + ((y1 - y0) * q) / segs);
        }
        g.stroke();
      }
      g.globalAlpha = 1;

      // occasional knot
      if (R.next() < 0.28) {
        const kx = x + R.range(cw * 0.25, cw * 0.75);
        const ky = y0 + R.range(40, Math.max(60, y1 - y0 - 40));
        const rad = R.range(5, 13);
        const grad = g.createRadialGradient(kx, ky, 1, kx, ky, rad * 2.2);
        grad.addColorStop(0, shade(base, -0.34));
        grad.addColorStop(0.45, shade(base, -0.14));
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.ellipse(kx, ky, rad * 2.2, rad * 1.15, 0, 0, Math.PI * 2);
        g.fill();
      }

      // butt joint line
      g.strokeStyle = seam;
      g.globalAlpha = 0.55;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, y1);
      g.lineTo(x + cw, y1);
      g.stroke();
      g.globalAlpha = 1;
    }

    // long seam between planks (groove)
    g.strokeStyle = seam;
    g.globalAlpha = 0.75;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x + 0.5, 0);
    g.lineTo(x + 0.5, S);
    g.stroke();
    g.globalAlpha = 0.35;
    g.strokeStyle = shade(seam, 0.35);
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(x + 2.6, 0);
    g.lineTo(x + 2.6, S);
    g.stroke();
    g.globalAlpha = 1;
  }

  overlayNoise(c, S, S, { strength: 0.05, octaves: 5, base: 8, seed: 11 });
  grain(c, S, S, 9, 0.05, 21);

  // height map: grooves + subtle grain → normal map
  const height = canvas(S, S);
  const hg = ctx2d(height);
  hg.drawImage(c, 0, 0);
  // exaggerate seams in the height field
  hg.globalAlpha = 1;
  for (let i = 0; i < cols; i++) {
    hg.fillStyle = 'rgba(0,0,0,0.85)';
    hg.fillRect(i * cw - 2, 0, 4, S);
  }
  const hd = hg.getImageData(0, 0, S, S).data;
  const hi = hg.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const l = (0.2126 * hd[i * 4] + 0.7152 * hd[i * 4 + 1] + 0.0722 * hd[i * 4 + 2]) / 255;
    const v = clamp(0.35 + l * 0.65, 0, 1) * 255;
    hi.data[i * 4] = hi.data[i * 4 + 1] = hi.data[i * 4 + 2] = v;
    hi.data[i * 4 + 3] = 255;
  }
  hg.putImageData(hi, 0, 0);

  return {
    color: c,
    normal: normalFromHeight(height, 1.5),
    rough: grayFrom(height, 0.72, 0.5),
  };
}

/* ---------------------------------------------------------------- *
 * painted interior wall — flat pastel with faint roller mottling
 * ---------------------------------------------------------------- */
export function wallTextures(base = '#C7E4F2', seed = 31) {
  const S = 512;
  const c = canvas(S, S);
  const g = ctx2d(c);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  overlayNoise(c, S, S, { strength: 0.014, octaves: 4, base: 12, seed });
  // tiny roller stipple
  const r = mulberry32(seed + 5);
  g.globalAlpha = 0.035;
  for (let i = 0; i < 2600; i++) {
    const x = r() * S;
    const y = r() * S;
    g.fillStyle = r() < 0.5 ? '#ffffff' : '#a9c9da';
    g.fillRect(x, y, 1.4, 1.4);
  }
  g.globalAlpha = 1;
  grain(c, S, S, 3, 0.02, seed + 2);
  const height = fbmCanvas(S, S, { octaves: 4, base: 14, seed: seed + 9, lo: 0.47, hi: 0.53 });
  return { color: c, normal: normalFromHeight(height, 0.35), rough: grayFrom(height, 0.95, 0.92) };
}

export function ceilingTextures() {
  const S = 256;
  const c = canvas(S, S);
  const g = ctx2d(c);
  g.fillStyle = '#F7F5F1';
  g.fillRect(0, 0, S, S);
  overlayNoise(c, S, S, { strength: 0.013, octaves: 4, base: 12, seed: 77 });
  grain(c, S, S, 3, 0.02, 78);
  const height = fbmCanvas(S, S, { octaves: 4, base: 14, seed: 79, lo: 0.48, hi: 0.52 });
  return { color: c, normal: normalFromHeight(height, 0.3), rough: grayFrom(height, 0.97, 0.94) };
}

/* ---------------------------------------------------------------- *
 * furniture timber — vertical grain, any tone
 * ---------------------------------------------------------------- */
export function woodTextures(base = '#C79A63', { streaks = 70, seed = 41, scale = 512 } = {}) {
  const S = scale;
  const c = canvas(S, S);
  const g = ctx2d(c);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  const r = mulberry32(seed);
  for (let i = 0; i < streaks; i++) {
    const x = r() * S;
    g.strokeStyle = r() < 0.5 ? shade(base, -r() * 0.22 - 0.03) : shade(base, r() * 0.16 + 0.02);
    g.globalAlpha = r() * 0.3 + 0.05;
    g.lineWidth = r() * 3.4 + 0.6;
    g.beginPath();
    let px = x;
    g.moveTo(px, 0);
    for (let q = 1; q <= 9; q++) {
      px += (r() - 0.5) * 7;
      g.lineTo(px, (S * q) / 9);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
  // cathedral grain arcs
  for (let i = 0; i < 5; i++) {
    const cx = r() * S;
    const cy = r() * S;
    g.strokeStyle = shade(base, -0.16);
    g.globalAlpha = 0.075;
    g.lineWidth = 1.2;
    for (let k = 1; k <= 5; k++) {
      g.beginPath();
      g.ellipse(cx, cy, 14 * k + r() * 5, 40 * k + r() * 10, r() * 0.5 - 0.25, 0, Math.PI * 2);
      g.stroke();
    }
  }
  g.globalAlpha = 1;
  overlayNoise(c, S, S, { strength: 0.05, octaves: 4, base: 6, seed: seed + 3 });
  grain(c, S, S, 6, 0.04, seed + 4);
  const height = fbmCanvas(S, S, { octaves: 4, base: 5, seed: seed + 8, lo: 0.46, hi: 0.54 });
  return { color: c, normal: normalFromHeight(height, 0.5), rough: grayFrom(c, 0.5, 0.38) };
}

/* ---------------------------------------------------------------- *
 * fabric weave
 * ---------------------------------------------------------------- */
export function fabricTextures(base = '#FFFFFF', { seed = 61, weave = 1.0, tone = 0.07 } = {}) {
  const S = 256;
  const c = canvas(S, S);
  const g = ctx2d(c);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  const r = mulberry32(seed);
  // plain weave: alternating light dashes
  const step = 3;
  g.globalAlpha = 0.16 * weave;
  for (let y = 0; y < S; y += step) {
    for (let x = 0; x < S; x += step) {
      const on = ((x / step) | 0) % 2 === ((y / step) | 0) % 2;
      g.fillStyle = on ? shade(base, tone) : shade(base, -tone);
      g.fillRect(x, y, step - 0.6, step - 0.6);
    }
  }
  g.globalAlpha = 1;
  // slubs
  for (let i = 0; i < 220; i++) {
    g.strokeStyle = shade(base, r() < 0.5 ? 0.09 : -0.09);
    g.globalAlpha = r() * 0.2 + 0.04;
    g.lineWidth = r() * 1.6 + 0.5;
    const x = r() * S;
    const y = r() * S;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + r() * 18 - 9, y + r() * 4 - 2);
    g.stroke();
  }
  g.globalAlpha = 1;
  overlayNoise(c, S, S, { strength: 0.03, octaves: 4, base: 8, seed: seed + 2 });
  const height = canvas(S, S);
  const hg = ctx2d(height);
  hg.fillStyle = '#808080';
  hg.fillRect(0, 0, S, S);
  hg.globalAlpha = 0.5;
  for (let y = 0; y < S; y += step) {
    for (let x = 0; x < S; x += step) {
      const on = ((x / step) | 0) % 2 === ((y / step) | 0) % 2;
      hg.fillStyle = on ? '#ffffff' : '#303030';
      hg.fillRect(x, y, step - 0.6, step - 0.6);
    }
  }
  hg.globalAlpha = 1;
  return { color: c, normal: normalFromHeight(height, 1.1), rough: grayFrom(c, 0.92, 0.78) };
}

/* small floral print for the pillow */
export function floralTexture(base = '#FCFAF6') {
  const S = 512;
  const c = canvas(S, S);
  const g = ctx2d(c);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  const r = mulberry32(909);
  const cols = 7;
  const cell = S / cols;
  for (let iy = 0; iy < cols; iy++) {
    for (let ix = 0; ix < cols; ix++) {
      const cx = ix * cell + cell / 2 + (r() - 0.5) * 7;
      const cy = iy * cell + cell / 2 + (r() - 0.5) * 7;
      const kind = r();
      const petal = kind < 0.55 ? '#F3B9C6' : kind < 0.8 ? '#F7D3A8' : '#C9E2C0';
      const core = kind < 0.55 ? '#E88BA3' : '#E9B26B';
      // five soft petals
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2 + r() * 0.3;
        const px = cx + Math.cos(a) * cell * 0.15;
        const py = cy + Math.sin(a) * cell * 0.15;
        const grad = g.createRadialGradient(px, py, 0.5, px, py, cell * 0.17);
        grad.addColorStop(0, petal);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(px, py, cell * 0.17, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = core;
      g.globalAlpha = 0.85;
      g.beginPath();
      g.arc(cx, cy, cell * 0.06, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      // tiny leaf
      if (r() < 0.6) {
        g.fillStyle = 'rgba(150,190,150,0.55)';
        g.beginPath();
        g.ellipse(cx + cell * 0.22, cy + cell * 0.18, cell * 0.09, cell * 0.045, r() * 2, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  grain(c, S, S, 6, 0.05, 911);
  const height = fbmCanvas(S, S, { octaves: 4, base: 8, seed: 913, lo: 0.45, hi: 0.55 });
  return { color: c, normal: normalFromHeight(height, 0.55), rough: grayFrom(c, 0.93, 0.82) };
}

/* soft knit for the mint throw */
export function knitTexture(base = '#9FD9C2') {
  const S = 256;
  const c = canvas(S, S);
  const g = ctx2d(c);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  const r = mulberry32(451);
  g.lineWidth = 3.2;
  g.lineCap = 'round';
  for (let y = -10; y < S + 10; y += 7) {
    for (let x = -10; x < S + 10; x += 7) {
      const up = (((x / 7) | 0) + ((y / 7) | 0)) % 2 === 0;
      g.strokeStyle = up ? shade(base, 0.16) : shade(base, -0.16);
      g.globalAlpha = 0.55;
      g.beginPath();
      g.moveTo(x, y + 3.4);
      g.lineTo(x + 3.4, y);
      g.lineTo(x + 7, y + 3.4);
      g.stroke();
    }
  }
  g.globalAlpha = 1;
  overlayNoise(c, S, S, { strength: 0.04, octaves: 4, base: 8, seed: 453 });
  const height = canvas(S, S);
  const hg = ctx2d(height);
  hg.fillStyle = '#3a3a3a';
  hg.fillRect(0, 0, S, S);
  for (let y = -10; y < S + 10; y += 7) {
    for (let x = -10; x < S + 10; x += 7) {
      const up = (((x / 7) | 0) + ((y / 7) | 0)) % 2 === 0;
      hg.strokeStyle = up ? '#ffffff' : '#9a9a9a';
      hg.lineWidth = 3.2;
      hg.beginPath();
      hg.moveTo(x, y + 3.4);
      hg.lineTo(x + 3.4, y);
      hg.lineTo(x + 7, y + 3.4);
      hg.stroke();
    }
  }
  return { color: c, normal: normalFromHeight(height, 1.0), rough: grayFrom(c, 0.9, 0.74) };
}

/* small woven rug */
export function rugTexture(base = '#F2C94C') {
  const S = 512;
  const c = canvas(S, S);
  const g = ctx2d(c);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  const r = mulberry32(515);
  // weave rows
  for (let y = 0; y < S; y += 4) {
    g.fillStyle = y % 8 === 0 ? shade(base, 0.07) : shade(base, -0.05);
    g.globalAlpha = 0.5;
    g.fillRect(0, y, S, 2);
  }
  g.globalAlpha = 1;
  // little tufts
  for (let i = 0; i < 9000; i++) {
    const x = r() * S;
    const y = r() * S;
    g.fillStyle = r() < 0.5 ? shade(base, 0.12) : shade(base, -0.12);
    g.globalAlpha = r() * 0.3 + 0.05;
    g.fillRect(x, y, 2.4, 2.4);
  }
  g.globalAlpha = 1;
  // thin border line
  g.strokeStyle = shade(base, -0.3);
  g.lineWidth = 5;
  g.globalAlpha = 0.85;
  g.strokeRect(12, 12, S - 24, S - 24);
  g.globalAlpha = 0.5;
  g.lineWidth = 2;
  g.strokeRect(22, 22, S - 44, S - 44);
  g.globalAlpha = 1;
  const height = canvas(S, S);
  const hg = ctx2d(height);
  hg.fillStyle = '#6a6a6a';
  hg.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const x = r() * S;
    const y = r() * S;
    hg.fillStyle = r() < 0.5 ? '#ffffff' : '#333333';
    hg.fillRect(x, y, 2.4, 2.4);
  }
  return { color: c, normal: normalFromHeight(height, 0.9), rough: grayFrom(c, 0.97, 0.86) };
}

/* ---------------------------------------------------------------- *
 * wall art — the three posters, painted from the reference
 * ---------------------------------------------------------------- */
export function posterPink() {
  const S = 512;
  const c = canvas(S, S * 1.32);
  const g = ctx2d(c);
  const W = c.width;
  const H = c.height;
  // frame
  g.fillStyle = '#F8B6C8';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#FFD7E1';
  g.fillRect(26, 26, W - 52, H - 52);
  g.fillStyle = '#F4A6BC';
  g.fillRect(40, 40, W - 80, H - 80);
  // white abstract figure — a stylised dancer with a long brush stroke
  g.save();
  g.translate(W / 2, H * 0.5);
  g.fillStyle = '#FFFDFB';
  g.beginPath();
  g.ellipse(0, -H * 0.2, W * 0.075, H * 0.075, 0, 0, Math.PI * 2); // head
  g.fill();
  g.lineCap = 'round';
  g.strokeStyle = '#FFFDFB';
  g.lineWidth = W * 0.085;
  g.beginPath(); // torso + legs
  g.moveTo(0, -H * 0.11);
  g.quadraticCurveTo(W * 0.05, H * 0.02, -W * 0.01, H * 0.14);
  g.stroke();
  g.lineWidth = W * 0.05;
  g.beginPath();
  g.moveTo(-W * 0.01, H * 0.13);
  g.lineTo(-W * 0.12, H * 0.3);
  g.moveTo(-W * 0.01, H * 0.13);
  g.lineTo(W * 0.08, H * 0.31);
  g.stroke();
  g.lineWidth = W * 0.042;
  g.beginPath(); // arms
  g.moveTo(W * 0.01, -H * 0.09);
  g.quadraticCurveTo(W * 0.16, -H * 0.14, W * 0.2, -H * 0.26);
  g.moveTo(-W * 0.005, -H * 0.08);
  g.quadraticCurveTo(-W * 0.14, -H * 0.02, -W * 0.19, -H * 0.12);
  g.stroke();
  // sweeping arc behind
  g.lineWidth = W * 0.02;
  g.globalAlpha = 0.65;
  g.beginPath();
  g.arc(0, H * 0.06, W * 0.3, Math.PI * 1.05, Math.PI * 1.95);
  g.stroke();
  g.restore();
  grain(c, W, H, 5, 0.04, 1101);
  return c;
}

export function posterBlue() {
  const S = 512;
  const c = canvas(S, S);
  const g = ctx2d(c);
  const W = S;
  const H = S;
  g.fillStyle = '#2F5FC4';
  g.fillRect(0, 0, W, H);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)');
  grad.addColorStop(1, 'rgba(0,0,0,0.12)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // radiating spokes, sun-burst style
  g.save();
  g.translate(W / 2, H / 2);
  g.strokeStyle = '#BFD8FF';
  g.lineWidth = W * 0.017;
  const spokes = 26;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const r0 = W * 0.16 + (i % 2 ? W * 0.05 : 0);
    const r1 = W * 0.44 + (i % 3 ? 0 : W * 0.05);
    g.beginPath();
    g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    g.stroke();
  }
  g.fillStyle = '#EAF1FF';
  g.beginPath();
  g.arc(0, 0, W * 0.11, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#7FA8EE';
  g.beginPath();
  g.arc(0, 0, W * 0.07, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // thin dark frame
  g.strokeStyle = 'rgba(30,40,70,0.75)';
  g.lineWidth = W * 0.02;
  g.strokeRect(W * 0.01, H * 0.01, W * 0.98, H * 0.98);
  grain(c, W, H, 5, 0.04, 1102);
  return c;
}

export function posterGreen() {
  const S = 512;
  const c = canvas(S, S * 1.25);
  const g = ctx2d(c);
  const W = c.width;
  const H = c.height;
  g.fillStyle = '#5FAF6A';
  g.fillRect(0, 0, W, H);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(255,255,255,0.14)');
  grad.addColorStop(1, 'rgba(20,60,30,0.16)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // white cloud / blob
  g.fillStyle = '#F4FBF5';
  g.beginPath();
  g.ellipse(W * 0.48, H * 0.46, W * 0.28, H * 0.18, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(W * 0.33, H * 0.52, W * 0.17, H * 0.12, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(W * 0.63, H * 0.55, W * 0.13, H * 0.1, 0, 0, Math.PI * 2);
  g.fill();
  // accents
  g.fillStyle = '#F2C94C';
  g.beginPath();
  g.arc(W * 0.72, H * 0.28, W * 0.055, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#3E7BC8';
  g.beginPath();
  g.arc(W * 0.24, H * 0.3, W * 0.038, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(30,50,35,0.6)';
  g.lineWidth = W * 0.018;
  g.strokeRect(W * 0.012, H * 0.012, W * 0.976, H * 0.976);
  grain(c, W, H, 5, 0.04, 1103);
  return c;
}

/* white closet door panel with a fine square grid (as in the reference) */
export function closetPanelTexture() {
  const S = 512;
  const c = canvas(S, S);
  const g = ctx2d(c);
  g.fillStyle = '#F2F0EA';
  g.fillRect(0, 0, S, S);
  // fine grid of small squares
  const n = 16;
  const step = S / n;
  g.lineCap = 'round';
  for (let i = 0; i <= n; i++) {
    g.strokeStyle = 'rgba(126,138,152,0.95)';
    g.lineWidth = 2.1;
    g.beginPath();
    g.moveTo(i * step, 0);
    g.lineTo(i * step, S);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i * step);
    g.lineTo(S, i * step);
    g.stroke();
  }
  // little studs at the intersections
  for (let iy = 0; iy <= n; iy++) {
    for (let ix = 0; ix <= n; ix++) {
      g.fillStyle = 'rgba(120,132,146,0.35)';
      g.beginPath();
      g.arc(ix * step, iy * step, 1.7, 0, Math.PI * 2);
      g.fill();
    }
  }
  // outer outline
  g.strokeStyle = 'rgba(176,186,196,0.95)';
  g.lineWidth = 9;
  g.strokeRect(4.5, 4.5, S - 9, S - 9);
  grain(c, S, S, 4, 0.03, 1201);
  const height = canvas(S, S);
  const hg = ctx2d(height);
  hg.fillStyle = '#6d6d6d';
  hg.fillRect(0, 0, S, S);
  hg.strokeStyle = '#ffffff';
  hg.lineWidth = 2.4;
  for (let i = 0; i <= n; i++) {
    hg.beginPath();
    hg.moveTo(i * step, 0);
    hg.lineTo(i * step, S);
    hg.stroke();
    hg.beginPath();
    hg.moveTo(0, i * step);
    hg.lineTo(S, i * step);
    hg.stroke();
  }
  return { color: c, normal: normalFromHeight(height, 0.7) };
}

/* ---------------------------------------------------------------- *
 * small props
 * ---------------------------------------------------------------- */
export function paperTexture(base = '#FFFDF7', lines = true) {
  const S = 256;
  const c = canvas(S, S);
  const g = ctx2d(c);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  if (lines) {
    g.strokeStyle = 'rgba(120,140,170,0.35)';
    g.lineWidth = 1;
    for (let i = 1; i < 14; i++) {
      g.beginPath();
      g.moveTo(18, (S / 14) * i);
      g.lineTo(S - 18, (S / 14) * i);
      g.stroke();
    }
    g.strokeStyle = 'rgba(220,140,160,0.4)';
    g.beginPath();
    g.moveTo(24, 0);
    g.lineTo(24, S);
    g.stroke();
  }
  grain(c, S, S, 4, 0.03, 1301);
  return c;
}

export function bookCoverTexture(base = '#8C5A46', accent = '#F3E4C8') {
  const S = 256;
  const c = canvas(S, S);
  const g = ctx2d(c);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  g.fillStyle = accent;
  g.globalAlpha = 0.9;
  roundRect(g, S * 0.16, S * 0.18, S * 0.68, S * 0.1, 6);
  g.fill();
  g.globalAlpha = 0.55;
  g.fillStyle = shade(accent, -0.15);
  roundRect(g, S * 0.16, S * 0.36, S * 0.42, S * 0.06, 4);
  g.fill();
  g.globalAlpha = 0.35;
  g.beginPath();
  g.arc(S * 0.68, S * 0.68, S * 0.13, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
  // spine shading
  const grad = g.createLinearGradient(0, 0, S, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0.22)');
  grad.addColorStop(0.12, 'rgba(0,0,0,0.02)');
  grad.addColorStop(1, 'rgba(0,0,0,0.06)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  grain(c, S, S, 5, 0.05, 1302);
  return c;
}

/* a single leaf, cut out with alpha — used for the pot plants */
export function leafTexture(base = '#4E9A5A', { width = 128, height = 512, tip = 'point' } = {}) {
  const c = canvas(width, height);
  const g = ctx2d(c);
  const W = width;
  const H = height;
  g.clearRect(0, 0, W, H);
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, shade(base, 0.22));
  grad.addColorStop(0.45, base);
  grad.addColorStop(1, shade(base, -0.24));
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(W / 2, 0);
  g.bezierCurveTo(W * 1.02, H * 0.22, W * 1.0, H * 0.72, W / 2, H);
  g.bezierCurveTo(W * 0.0, H * 0.72, -W * 0.02, H * 0.22, W / 2, 0);
  g.closePath();
  g.fill();
  // midrib + veins
  g.strokeStyle = shade(base, 0.32);
  g.globalAlpha = 0.8;
  g.lineWidth = W * 0.035;
  g.beginPath();
  g.moveTo(W / 2, H * 0.04);
  g.lineTo(W / 2, H * 0.96);
  g.stroke();
  g.lineWidth = W * 0.014;
  g.globalAlpha = 0.45;
  for (let i = 1; i < 12; i++) {
    const y = (H * i) / 12;
    const spread = W * 0.36 * Math.sin((i / 12) * Math.PI) + W * 0.05;
    g.beginPath();
    g.moveTo(W / 2, y);
    g.quadraticCurveTo(W / 2 + spread * 0.6, y + H * 0.02, W / 2 + spread, y + H * 0.045);
    g.stroke();
    g.beginPath();
    g.moveTo(W / 2, y);
    g.quadraticCurveTo(W / 2 - spread * 0.6, y + H * 0.02, W / 2 - spread, y + H * 0.045);
    g.stroke();
  }
  g.globalAlpha = 1;
  return { color: c };
}

/* cactus skin: soft vertical ribs + speckles */
export function cactusTexture(base = '#4E9A5A') {
  const S = 256;
  const c = canvas(S, S);
  const g = ctx2d(c);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  g.globalAlpha = 0.35;
  for (let i = 0; i < 14; i++) {
    const x = (S / 14) * i;
    g.strokeStyle = shade(base, i % 2 ? 0.14 : -0.18);
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + (i % 3) * 2, S);
    g.stroke();
  }
  g.globalAlpha = 1;
  const r = mulberry32(777);
  for (let i = 0; i < 900; i++) {
    const x = r() * S;
    const y = r() * S;
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(x, y, 1.4, 1.4);
    g.fillStyle = 'rgba(30,70,40,0.35)';
    g.fillRect(x + 1.2, y + 1.2, 1.2, 1.2);
  }
  overlayNoise(c, S, S, { strength: 0.06, octaves: 4, base: 6, seed: 779 });
  const height = canvas(S, S);
  const hg = ctx2d(height);
  hg.fillStyle = '#7a7a7a';
  hg.fillRect(0, 0, S, S);
  for (let i = 0; i < 14; i++) {
    const x = (S / 14) * i;
    hg.strokeStyle = i % 2 ? '#ffffff' : '#404040';
    hg.lineWidth = 5;
    hg.beginPath();
    hg.moveTo(x, 0);
    hg.lineTo(x + (i % 3) * 2, S);
    hg.stroke();
  }
  return { color: c, normal: normalFromHeight(height, 0.9) };
}

/* terracotta / ceramic glazed pot */
export function terracottaTexture(base = '#C0603A') {
  const S = 256;
  const c = canvas(S, S);
  const g = ctx2d(c);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  overlayNoise(c, S, S, { strength: 0.09, octaves: 5, base: 5, seed: 881 });
  grain(c, S, S, 7, 0.06, 882);
  const height = fbmCanvas(S, S, { octaves: 4, base: 7, seed: 883, lo: 0.44, hi: 0.56 });
  return { color: c, normal: normalFromHeight(height, 0.6), rough: grayFrom(c, 0.72, 0.5) };
}

export function ceramicTexture(base = '#F4F1EA') {
  const S = 256;
  const c = canvas(S, S);
  const g = ctx2d(c);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  overlayNoise(c, S, S, { strength: 0.04, octaves: 4, base: 6, seed: 891 });
  const height = fbmCanvas(S, S, { octaves: 3, base: 8, seed: 893, lo: 0.47, hi: 0.53 });
  return { color: c, normal: normalFromHeight(height, 0.35), rough: grayFrom(c, 0.28, 0.16) };
}

export function plasticTexture(base = '#F2F0EA') {
  const S = 128;
  const c = canvas(S, S);
  const g = ctx2d(c);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  overlayNoise(c, S, S, { strength: 0.02, octaves: 3, base: 6, seed: 895 });
  grain(c, S, S, 3, 0.02, 896);
  const height = fbmCanvas(S, S, { octaves: 3, base: 8, seed: 897, lo: 0.47, hi: 0.53 });
  return { color: c, normal: normalFromHeight(height, 0.25), rough: grayFrom(c, 0.42, 0.3) };
}

export function paintedMetalTexture(base = '#FFFFFF') {
  const S = 128;
  const c = canvas(S, S);
  const g = ctx2d(c);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  overlayNoise(c, S, S, { strength: 0.018, octaves: 3, base: 5, seed: 898 });
  return { color: c, rough: grayFrom(c, 0.36, 0.26) };
}

/* ---------------------------------------------------------------- *
 * sky seen through the windows
 * ---------------------------------------------------------------- */
export function skyTexture(top = '#2F7CC4', mid = '#7FBCE8', bottom = '#C6DAE8') {
  const W = 1024;
  const H = 512;
  const c = canvas(W, H);
  const g = ctx2d(c);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, top);
  grad.addColorStop(0.22, '#3D84C9');
  grad.addColorStop(0.45, '#4E97D6');
  grad.addColorStop(0.66, '#7FB4DE');
  grad.addColorStop(0.85, '#AFCEE4');
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // soft clouds
  const r = mulberry32(2024);
  for (let i = 0; i < 22; i++) {
    const cx = r() * W;
    const cy = H * (0.14 + r() * 0.42);
    const scale = 50 + r() * 130;
    const alpha = 0.045 + r() * 0.1;
    const cg = g.createRadialGradient(cx, cy, 1, cx, cy, scale * 1.6);
    cg.addColorStop(0, `rgba(255,255,255,${alpha})`);
    cg.addColorStop(0.55, `rgba(255,255,255,${alpha * 0.5})`);
    cg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = cg;
    g.beginPath();
    g.ellipse(cx, cy, scale * 1.7, scale * 0.55, 0, 0, Math.PI * 2);
    g.fill();
  }
  // faint horizon haze + a soft distant hill line
  const hz = g.createLinearGradient(0, H * 0.76, 0, H);
  hz.addColorStop(0, 'rgba(255,248,236,0)');
  hz.addColorStop(1, 'rgba(255,246,232,0.42)');
  g.fillStyle = hz;
  g.fillRect(0, H * 0.76, W, H * 0.24);

  const hr = mulberry32(31337);
  g.globalAlpha = 0.34;
  for (let i = 0; i < 7; i++) {
    const cx = (i / 6) * W + (hr() - 0.5) * 90;
    const hw = 90 + hr() * 200;
    const hh = 26 + hr() * 40;
    const hg = g.createLinearGradient(0, H * 0.96 - hh, 0, H * 0.96);
    hg.addColorStop(0, '#7C97A6');
    hg.addColorStop(1, '#AEC1CB');
    g.fillStyle = hg;
    g.beginPath();
    g.ellipse(cx, H * 0.96, hw, hh, 0, Math.PI, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  grain(c, W, H, 4, 0.03, 2025);
  return c;
}
