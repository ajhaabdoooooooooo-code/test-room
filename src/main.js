import * as THREE from 'three';
import { createMaterials } from './materials.js';
import { buildRoom, ROOM } from './room.js';
import { buildFurniture } from './furniture.js';
import { buildSky, buildExterior, buildShafts, buildDust } from './fx.js';
import { createLighting } from './lighting.js';
import { PostFX } from './postfx.js';
import { FirstPersonControls } from './controls.js';
import { RoomAudio } from './audio.js';
import { clamp, damp } from './utils.js';

/* ------------------------------------------------------------------ *
 *  DOM
 * ------------------------------------------------------------------ */
const canvas = document.getElementById('scene');
const elLoading = document.getElementById('loading');
const elStart = document.getElementById('start');
const elHud = document.getElementById('hud');
const elLabel = document.getElementById('label');
const elLabelName = elLabel.querySelector('.name');
const elLabelNote = elLabel.querySelector('.note');
const elLabelAct = elLabel.querySelector('.act');
const elToast = document.getElementById('toast');
const elFps = document.getElementById('fps');
const elCross = document.getElementById('crosshair');
const chipStyle = document.getElementById('chipStyle');
const chipLight = document.getElementById('chipLight');
const playBtn = document.getElementById('playBtn');

/* ------------------------------------------------------------------ *
 *  RENDERER
 * ------------------------------------------------------------------ */
const DPR = Math.min(window.devicePixelRatio || 1, 2);
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.setPixelRatio(DPR);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // the room is static — shadows update on demand
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(63, window.innerWidth / window.innerHeight, 0.05, 70);
camera.layers.enable(1);

/* ------------------------------------------------------------------ *
 *  WORLD
 * ------------------------------------------------------------------ */
const mats = createMaterials();
const ctx = {
  scene,
  renderer,
  camera,
  mats,
  colliders: [],
  pickables: [],
  exposure: 1.0,
};

buildRoom(ctx);
buildFurniture(ctx);
buildSky(ctx);
buildExterior(ctx);
buildShafts(ctx);
buildDust(ctx);
const lighting = createLighting(ctx);

/* ------------------------------------------------------------------ *
 *  SYSTEMS
 * ------------------------------------------------------------------ */
const audio = new RoomAudio();
const post = new PostFX(renderer, scene, camera);
post.ss = clamp(Math.sqrt(4200000 / (window.innerWidth * DPR * window.innerHeight * DPR)), 1.0, 1.4);

const controls = new FirstPersonControls(camera, canvas, {
  colliders: ctx.colliders,
  onStep: (run, crouch) => audio.step(run, crouch),
});

const state = {
  style: 'cel',
  preset: 'golden',
  lampOn: true,
  lampLevel: 0,
  curtainsClosed: false,
  curtainMix: 0,
  acOn: true,
  muted: false,
  shadowRefresh: 2, // seconds of shadow-map updating after a change
};

function refreshShadows(seconds = 1.6) {
  state.shadowRefresh = Math.max(state.shadowRefresh, seconds);
}

const SPAWN = { x: -0.35, z: -1.72, yaw: Math.PI + 0.16, pitch: -0.03 };
function resetView() {
  controls.position.set(SPAWN.x, 0, SPAWN.z);
  controls.yaw = SPAWN.yaw;
  controls.pitch = SPAWN.pitch;
  controls.velocity.set(0, 0, 0);
}

/* desk lamp starts on — a warm little welcome */
function applyLamp(dt) {
  state.lampLevel = damp(state.lampLevel, state.lampOn ? 1 : 0, 7, dt);
  const l = state.lampLevel;
  ctx.lampLight.intensity = l * 0.65;
  ctx.lampBulb.emissiveIntensity = l * 0.5;
}

function applyCurtains(dt) {
  state.curtainMix = damp(state.curtainMix, state.curtainsClosed ? 1 : 0, 3.4, dt);
  const moving = Math.abs(state.curtainMix - (state.curtainsClosed ? 1 : 0)) > 0.002;
  if (moving) refreshShadows(0.25);
  for (const p of ctx.curtainPanels) {
    p.mesh.position.z = p.openZ + (p.closedZ - p.openZ) * state.curtainMix;
  }
}

function applyAc() {
  const dot = ctx.ac.userData.dot;
  if (!dot) return;
  dot.material.emissiveIntensity = state.acOn ? 0.85 : 0.02;
  dot.material.color.set(state.acOn ? '#4CD07D' : '#8A8F98');
}

/* ------------------------------------------------------------------ *
 *  RESIZE
 * ------------------------------------------------------------------ */
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(DPR);
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post.ss = clamp(Math.sqrt(4200000 / (w * DPR * h * DPR)), 1.0, 1.4);
  post.setSize(w, h, DPR);
  if (ctx.shaftMaterial) {
    ctx.shaftMaterial.uniforms.uResolution.value.set(post.internalW, post.internalH);
  }
}
window.addEventListener('resize', resize);

/* ------------------------------------------------------------------ *
 *  INTERACTION
 * ------------------------------------------------------------------ */
const raycaster = new THREE.Raycaster();
raycaster.far = 3.6;
let current = null;
let pickTimer = 0;

const ACTION_VERB = {
  lamp: () => (state.lampOn ? 'E · switch off' : 'E · switch on'),
  curtain: () => (state.curtainsClosed ? 'E · open curtains' : 'E · close curtains'),
  ac: () => (state.acOn ? 'E · switch off' : 'E · switch on'),
};

function updatePick() {
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const hits = raycaster.intersectObjects(ctx.pickables, true);
  let found = null;
  if (hits.length) {
    let o = hits[0].object;
    while (o && !o.userData.pick) o = o.parent;
    if (o) found = o;
  }
  if (found === current) {
    if (found && found.userData.pick.action && ACTION_VERB[found.userData.pick.action]) {
      elLabelAct.textContent = ACTION_VERB[found.userData.pick.action]();
    }
    return;
  }
  current = found;
  if (found) {
    const d = found.userData.pick;
    elLabelName.textContent = d.name;
    elLabelNote.textContent = d.note;
    elLabelAct.textContent = d.action && ACTION_VERB[d.action] ? ACTION_VERB[d.action]() : '';
    elLabel.classList.add('on');
    elCross.classList.add('active');
  } else {
    elLabel.classList.remove('on');
    elCross.classList.remove('active');
  }
}

let toastTimer = 0;
function toast(msg) {
  elToast.textContent = msg;
  elToast.classList.add('on');
  toastTimer = 2.1;
}

function use() {
  if (!current || !current.userData.pick) return;
  const { action } = current.userData.pick;
  if (action === 'lamp') {
    state.lampOn = !state.lampOn;
    audio.click(state.lampOn);
    toast(state.lampOn ? 'Desk lamp — on' : 'Desk lamp — off');
  } else if (action === 'curtain') {
    state.curtainsClosed = !state.curtainsClosed;
    audio.swish();
    toast(state.curtainsClosed ? 'Curtains closed' : 'Curtains opened');
  } else if (action === 'ac') {
    state.acOn = !state.acOn;
    applyAc();
    audio.beep(state.acOn);
    toast(state.acOn ? 'Air conditioner — on (22°C)' : 'Air conditioner — off');
  }
}

/* ------------------------------------------------------------------ *
 *  MODES
 * ------------------------------------------------------------------ */
function setStyle(style) {
  state.style = style;
  post.setStyle(style === 'cel' ? 'cel' : 'realistic');
  renderer.toneMapping = THREE.NoToneMapping;
  chipStyle.textContent = style === 'cel' ? 'Cute Cel' : 'Realistic PBR';
  toast(style === 'cel' ? 'Style — cute cel shading' : 'Style — realistic PBR');
}

function setPreset(name) {
  lighting.apply(name);
  state.preset = name;
  chipLight.textContent = lighting.label;
  audio.setPreset(name);
  post.uniforms.composite.uExposure.value = ctx.exposure;
  post.uniforms.composite.uWarm.value = name === 'golden' ? 1 : 0;
  refreshShadows(2.5);
  toast(name === 'golden' ? 'Light — golden hour' : 'Light — daylight');
}

/* ------------------------------------------------------------------ *
 *  INPUT
 * ------------------------------------------------------------------ */
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  switch (e.code) {
    case 'KeyE': use(); break;
    case 'KeyL':
      state.lampOn = !state.lampOn;
      audio.click(state.lampOn);
      toast(state.lampOn ? 'Desk lamp — on' : 'Desk lamp — off');
      break;
    case 'KeyT':
      setStyle(state.style === 'cel' ? 'realistic' : 'cel');
      break;
    case 'KeyN':
      setPreset(state.preset === 'golden' ? 'day' : 'golden');
      break;
    case 'KeyM':
      state.muted = !state.muted;
      audio.setEnabled(!state.muted);
      toast(state.muted ? 'Sound off' : 'Sound on');
      break;
    case 'KeyR':
      resetView();
      toast('Back to the start');
      break;
    default:
      break;
  }
});

function enter() {
  audio.init();
  controls.requestLock();
  elStart.classList.add('hidden');
  elHud.classList.add('on');
}

playBtn.addEventListener('click', enter);
canvas.addEventListener('click', () => {
  if (!controls.locked) enter();
});

controls.onLockChange = (locked) => {
  if (!locked) {
    elStart.classList.remove('hidden');
    elHud.classList.remove('on');
    elLabel.classList.remove('on');
  }
};

/* ------------------------------------------------------------------ *
 *  LOOP
 * ------------------------------------------------------------------ */
let prevT = performance.now();
let fpsAcc = 0;
let fpsCount = 0;
let fpsTimer = 0;
let frames = 0;

function frame() {
  const now = performance.now();
  let dt = (now - prevT) / 1000;
  prevT = now;
  if (dt > 0.25) dt = 0.016;

  controls.update(dt);

  const time = now / 1000;
  applyLamp(dt);
  applyCurtains(dt);

  if (state.shadowRefresh > 0) {
    state.shadowRefresh -= dt;
    renderer.shadowMap.needsUpdate = true;
  }

  if (ctx.shaftMaterial) {
    ctx.shaftMaterial.uniforms.uTime.value = time;
    ctx.shaftMaterial.uniforms.uNear.value = camera.near;
    ctx.shaftMaterial.uniforms.uFar.value = camera.far;
    if (ctx.sunTravelDir) ctx.shaftMaterial.uniforms.uLightDir.value.copy(ctx.sunTravelDir);
    const warm = state.preset === 'golden';
    ctx.shaftMaterial.uniforms.uColor.value.set(warm ? '#FFD9A8' : '#FFF4DE');
  }
  if (ctx.dust) ctx.dust.update(time, dt);

  audio.update(dt);

  pickTimer -= dt;
  if (pickTimer <= 0) {
    pickTimer = 0.08;
    updatePick();
  }
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) elToast.classList.remove('on');
  }

  post.render(dt, time);

  /* fps readout */
  frames++;
  fpsAcc += dt;
  if (fpsAcc > 0.5) {
    elFps.textContent = `${Math.round(frames / fpsAcc)} fps`;
    fpsAcc = 0;
    frames = 0;
  }
}

renderer.setAnimationLoop(frame);

/* ------------------------------------------------------------------ *
 *  BOOT
 * ------------------------------------------------------------------ */
resize();
post.uniforms.composite.uExposure.value = ctx.exposure;
chipLight.textContent = lighting.label;
applyAc();

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    elLoading.classList.add('hidden');
    elStart.classList.remove('hidden');
  });
});

window.__room = { scene, camera, renderer, ctx, post, controls, lighting, state, setStyle, setPreset, refreshShadows };
window.THREE = THREE;

/* debug helper: render and read exact framebuffer pixels (screen coords, top-left origin) */
window.__grab = (points) => {
  post.render(0.016, performance.now() / 1000);
  const gl = renderer.getContext();
  const h = renderer.domElement.height;
  const buf = new Uint8Array(4);
  return points.map(([x, y]) => {
    gl.readPixels(Math.round(x), Math.round(h - y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return `${x},${y} = ${buf[0]},${buf[1]},${buf[2]}`;
  });
};
