import * as THREE from 'three';
import { mesh, group, canvas, ctx2d, toTexture, rand, rngFactory } from './utils.js';
import { ROOM, BACK_WINDOW, SIDE_WINDOW } from './room.js';
import * as TX from './textures.js';

/* ==================================================================== *
 *  SKY + ENVIRONMENT
 * ==================================================================== */
export function buildSky(ctx) {
  const skyTexture = toTexture(TX.skyTexture(), { wrap: THREE.ClampToEdgeWrapping });
  const geo = new THREE.SphereGeometry(60, 48, 32);
  const mat = new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide, fog: false });
  const sky = new THREE.Mesh(geo, mat);
  sky.name = 'sky';
  sky.layers.set(1);
  sky.castShadow = false;
  sky.receiveShadow = false;
  ctx.scene.add(sky);

  // PMREM environment for the glass, metal and varnish
  const pmrem = new THREE.PMREMGenerator(ctx.renderer);
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 20), new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide }));
  envScene.add(envSky);
  // a soft ground disc so the env has a floor bounce
  const groundDisc = new THREE.Mesh(
    new THREE.CircleGeometry(50, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xd8c3a4 })
  );
  groundDisc.position.y = -2;
  envScene.add(groundDisc);
  const env = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();
  ctx.envTexture = env;
  ctx.mats.applyEnv(env, 1);

  ctx.sky = sky;
  ctx.skyMaterial = mat;
  return sky;
}

/* ==================================================================== *
 *  OUTSIDE: ground haze + the slim railing behind the tall window
 * ==================================================================== */
export function buildExterior(ctx) {
  const { m } = ctx.mats;
  const g = group('exterior');

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(140, 140).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#B3A68E', fog: false })
  );
  ground.position.set(0, -5.2, 0);
  ground.name = 'exterior-ground';
  ground.castShadow = false;
  ground.receiveShadow = false;
  ground.layers.set(1);
  g.add(ground);

  // a small exterior ledge with a slim railing, just outside the tall window
  const railMat = new THREE.MeshStandardMaterial({ color: '#4A4F57', roughness: 0.5, metalness: 0.55, envMapIntensity: 0.8 });
  const ledgeMat = new THREE.MeshStandardMaterial({ color: '#B9AE9C', roughness: 0.92, metalness: 0 });
  const z = ROOM.maxZ + 0.72;
  const x0 = BACK_WINDOW.x0 - 0.5;
  const x1 = BACK_WINDOW.x1 + 0.5;
  const rail = group('railing');

  const ledge = mesh(new THREE.BoxGeometry(x1 - x0 + 0.4, 0.16, 0.95), ledgeMat, (x0 + x1) / 2, 0.02, z - 0.3);
  rail.add(ledge);
  const fascia = mesh(new THREE.BoxGeometry(x1 - x0 + 0.4, 0.22, 0.06), ledgeMat, (x0 + x1) / 2, -0.16, z + 0.14);
  rail.add(fascia);

  const railTop = 1.02;
  const top = mesh(new THREE.BoxGeometry(x1 - x0, 0.05, 0.05), railMat, (x0 + x1) / 2, railTop, z);
  rail.add(top);
  const mid = mesh(new THREE.BoxGeometry(x1 - x0, 0.028, 0.028), railMat, (x0 + x1) / 2, railTop - 0.42, z);
  rail.add(mid);
  const n = Math.round((x1 - x0) / 0.16);
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    rail.add(mesh(new THREE.CylinderGeometry(0.011, 0.011, railTop - 0.1, 8), railMat, x, (railTop - 0.1) / 2 + 0.1, z));
  }
  g.add(rail);

  // the same ledge + railing wraps around the other window
  const rail2 = group('railing-side');
  const xw = ROOM.minX - 0.72;
  const z0 = SIDE_WINDOW.z0 - 0.55;
  const z1 = SIDE_WINDOW.z1 + 0.55;
  const ledge2 = mesh(new THREE.BoxGeometry(0.95, 0.16, z1 - z0 + 0.4), ledgeMat, xw + 0.3, 0.02, (z0 + z1) / 2);
  rail2.add(ledge2);
  const fascia2 = mesh(new THREE.BoxGeometry(0.06, 0.22, z1 - z0 + 0.4), ledgeMat, xw - 0.14, -0.16, (z0 + z1) / 2);
  rail2.add(fascia2);
  const top2 = mesh(new THREE.BoxGeometry(0.05, 0.05, z1 - z0), railMat, xw, railTop, (z0 + z1) / 2);
  rail2.add(top2);
  const mid2 = mesh(new THREE.BoxGeometry(0.028, 0.028, z1 - z0), railMat, xw, railTop - 0.42, (z0 + z1) / 2);
  rail2.add(mid2);
  const n2 = Math.round((z1 - z0) / 0.16);
  for (let i = 0; i <= n2; i++) {
    const zz = z0 + ((z1 - z0) * i) / n2;
    rail2.add(mesh(new THREE.CylinderGeometry(0.011, 0.011, railTop - 0.1, 8), railMat, xw, (railTop - 0.1) / 2 + 0.1, zz));
  }
  g.add(rail2);

  // distant, hazy hills — baked into the sky dome so nothing floats
  ctx.scene.add(g);
  return g;
}

/* ==================================================================== *
 *  LIGHT SHAFTS — one soft beam per window pane, faded against the
 *  scene depth so it dissolves where it lands on the floor or the bed.
 * ==================================================================== */
const BEAM_VERT = /* glsl */ `
  attribute vec3 aOrigin;
  attribute float aWidth;
  attribute float aBright;
  uniform vec3 uLightDir;
  uniform float uLength;
  uniform float uSpread;
  varying vec2 vUv;
  varying float vBright;
  varying vec3 vWorld;
  void main(){
    vUv = uv;
    vBright = aBright;
    vec3 dir = normalize(uLightDir);
    vec3 toCam = normalize(cameraPosition - aOrigin);
    vec3 side = normalize(cross(dir, toCam));
    vec3 along = dir;
    vec3 p = aOrigin
      + along * (uv.x * uLength)
      + side * ((uv.y - 0.5) * aWidth * uSpread)
      + normalize(cross(side, dir)) * ((uv.y - 0.5) * aWidth * 0.06);
    vWorld = p;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const BEAM_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tDepth;
  uniform vec2 uResolution;
  uniform float uNear;
  uniform float uFar;
  uniform vec3 uColor;
  uniform float uDensity;
  uniform float uTime;
  uniform float uSoft;
  varying vec2 vUv;
  varying float vBright;
  varying vec3 vWorld;

  float linDepth(float d){
    float z = d * 2.0 - 1.0;
    return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
  }
  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main(){
    vec2 suv = gl_FragCoord.xy / uResolution;
    float sceneD = linDepth(texture2D(tDepth, suv).r);
    float fragD  = linDepth(gl_FragCoord.z);
    float soft = clamp((sceneD - fragD) / max(uSoft, 0.001), 0.0, 1.0);
    soft = soft * soft * (3.0 - 2.0 * soft);

    float across = abs(vUv.y - 0.5) * 2.0;
    float col = 1.0 - smoothstep(0.25, 1.0, across);

    float along = smoothstep(0.0, 0.16, vUv.x) * (1.0 - smoothstep(0.55, 1.0, vUv.x));

    float turb = 0.86
      + 0.14 * sin(vUv.x * 7.0 + uTime * 0.35)
      + 0.08 * hash(floor(vWorld.xz * 90.0) + floor(uTime * 6.0)) * 1.0
      - 0.04;

    float a = col * along * soft * turb * vBright * uDensity;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

function paneGrid(spec, plane, planeValue, outward) {
  const panes = [];
  const w = spec.x1 - spec.x0;
  const h = spec.y1 - spec.y0;
  const transom = spec.transomTop || 0;
  const rowEdges = transom
    ? [0, (h - transom) / h, 1]
    : Array.from({ length: spec.rows + 1 }, (_, i) => i / spec.rows);
  for (let r = 0; r < rowEdges.length - 1; r++) {
    for (let c = 0; c < spec.cols; c++) {
      const u0 = c / spec.cols;
      const u1 = (c + 1) / spec.cols;
      const v0 = rowEdges[r];
      const v1 = rowEdges[r + 1];
      const cu = (u0 + u1) / 2;
      const cv = (v0 + v1) / 2;
      const center = new THREE.Vector3();
      if (plane === 'z') {
        center.set(spec.x0 + cu * w, spec.y0 + cv * h, planeValue);
      } else {
        center.set(planeValue, spec.y0 + cv * h, spec.z0 + cu * w);
      }
      center.addScaledVector(outward, 0.06);
      panes.push({
        center,
        width: (u1 - u0) * w,
        bright: ((v1 - v0) * (u1 - u0)) * 3.1,
      });
    }
  }
  return panes;
}

export function buildShafts(ctx) {
  const backPanes = paneGrid(BACK_WINDOW, 'z', ROOM.maxZ, new THREE.Vector3(0, 0, 1));
  const sidePanes = paneGrid(
    { x0: SIDE_WINDOW.z0, x1: SIDE_WINDOW.z1, y0: SIDE_WINDOW.y0, y1: SIDE_WINDOW.y1, cols: SIDE_WINDOW.cols, rows: SIDE_WINDOW.rows, transomTop: (SIDE_WINDOW.y1 - SIDE_WINDOW.y0) * 0.46 },
    'x', ROOM.minX, new THREE.Vector3(-1, 0, 0)
  );

  const beams = [...backPanes.map((p) => ({ ...p, bright: p.bright * 0.85 })), ...sidePanes.map((p) => ({ ...p, bright: p.bright * 0.75 }))];

  const verts = [];
  const uvs = [];
  const origins = [];
  const widths = [];
  const brights = [];
  const idx = [];
  beams.forEach((b, i) => {
    const quad = [
      [0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1],
    ];
    for (const [x, y] of quad) {
      verts.push(b.center.x, b.center.y, b.center.z);
      uvs.push(x, y);
      origins.push(b.center.x, b.center.y, b.center.z);
      widths.push(b.width);
      brights.push(b.bright);
    }
    const base = i * 6;
    idx.push(base, base + 1, base + 2, base + 3, base + 4, base + 5);
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('aOrigin', new THREE.Float32BufferAttribute(origins, 3));
  geo.setAttribute('aWidth', new THREE.Float32BufferAttribute(widths, 1));
  geo.setAttribute('aBright', new THREE.Float32BufferAttribute(brights, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  geo.boundingSphere.radius *= 6;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tDepth: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.05 },
      uFar: { value: 60 },
      uLightDir: { value: new THREE.Vector3(-1, -0.42, -0.3).normalize() },
      uColor: { value: new THREE.Color('#ffd9a8') },
      uDensity: { value: 0.5 },
      uLength: { value: 9 },
      uSpread: { value: 0.95 },
      uTime: { value: 0 },
      uSoft: { value: 1.15 },
    },
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });

  const shafts = new THREE.Mesh(geo, mat);
  shafts.name = 'light-shafts';
  shafts.frustumCulled = false;
  shafts.layers.set(1);
  shafts.castShadow = false;
  shafts.receiveShadow = false;
  shafts.renderOrder = 6;
  ctx.scene.add(shafts);
  ctx.shafts = shafts;
  ctx.shaftMaterial = mat;
  return shafts;
}

/* ==================================================================== *
 *  DUST MOTES
 * ==================================================================== */
export function buildDust(ctx) {
  const COUNT = 420;
  const sprite = canvas(64, 64);
  const g = ctx2d(sprite);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,250,240,0.45)');
  grad.addColorStop(1, 'rgba(255,245,230,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);

  const pos = new Float32Array(COUNT * 3);
  const col = new Float32Array(COUNT * 3);
  const r = rngFactory(4242);
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = r.range(ROOM.minX + 0.2, ROOM.maxX - 0.2);
    pos[i * 3 + 1] = r.range(0.05, ROOM.h - 0.1);
    pos[i * 3 + 2] = r.range(ROOM.minZ + 0.2, ROOM.maxZ - 0.2);
    const b = r.range(0.18, 0.55);
    col[i * 3] = b;
    col[i * 3 + 1] = b * r.range(0.94, 1);
    col[i * 3 + 2] = b * r.range(0.86, 1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const mat = new THREE.PointsMaterial({
    map: toTexture(sprite, { wrap: THREE.ClampToEdgeWrapping }),
    size: 0.011,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    fog: false,
  });

  const points = new THREE.Points(geo, mat);
  points.name = 'dust';
  points.frustumCulled = false;
  points.layers.set(1);
  points.renderOrder = 7;
  ctx.scene.add(points);

  const base = pos.slice();
  ctx.dust = {
    points,
    material: mat,
    update(t, dt) {
      const p = geo.attributes.position.array;
      for (let i = 0; i < COUNT; i++) {
        const i3 = i * 3;
        const drift = 0.05 + (i % 7) * 0.004;
        p[i3] = base[i3] + Math.sin(t * 0.11 * drift * 8 + i) * 0.14;
        p[i3 + 1] = base[i3 + 1] + Math.sin(t * 0.07 + i * 1.7) * 0.09 - ((t * 0.006) % 0.5);
        p[i3 + 2] = base[i3 + 2] + Math.cos(t * 0.09 * drift * 8 + i * 0.7) * 0.14;
        if (p[i3 + 1] < 0.03) p[i3 + 1] += 0.5;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
  return points;
}
