import * as THREE from 'three';

/* ==================================================================== *
 *  LIGHTING RIG
 *  Two daylight sources through the two windows + a soft sky fill and
 *  a couple of very low "bounce" fills that fake the indirect light.
 * ==================================================================== */

export const PRESETS = {
  golden: {
    label: 'Golden Hour',
    sun: {
      color: '#FFC481',
      intensity: 5.4,
      position: new THREE.Vector3(-9.0, 5.2, -2.2),
      target: new THREE.Vector3(1.1, 0.3, 1.4),
      shadowSize: 4096,
      radius: 2.6,
    },
    skyLight: {
      color: '#C6DAF2',
      intensity: 1.7,
      position: new THREE.Vector3(2.0, 5.2, 9.5),
      target: new THREE.Vector3(0.1, 0.6, 1.0),
      shadowSize: 2048,
    },
    hemi: { sky: '#CFE0F8', ground: '#E3DACE', intensity: 1.35 },
    ambient: { color: '#E6EAF6', intensity: 0.28 },
    fills: [
      { color: '#FFC79A', intensity: 0.55, distance: 10, pos: new THREE.Vector3(-1.9, 1.15, 0.55) },
      { color: '#BBD4F0', intensity: 0.5, distance: 10, pos: new THREE.Vector3(1.9, 1.9, -1.2) },
      { color: '#F6D6B0', intensity: 0.4, distance: 8, pos: new THREE.Vector3(0.4, 0.35, 1.2) },
      { color: '#DCE6FA', intensity: 0.3, distance: 7, pos: new THREE.Vector3(-0.2, 2.5, -1.6) },
    ],
    skyTint: '#FFF1E0',
    shaftColor: '#FFD7A4',
    shaftDensity: 0.26,
    exposure: 1.16,
    fog: { color: '#EAD6C2', density: 0.02 },
  },
  day: {
    label: 'Daylight',
    sun: {
      color: '#FFF4E2',
      intensity: 5.6,
      position: new THREE.Vector3(-8.5, 7.6, -1.2),
      target: new THREE.Vector3(1.2, 0.2, 1.2),
      shadowSize: 4096,
      radius: 2.2,
    },
    skyLight: {
      color: '#D8E8FF',
      intensity: 2.4,
      position: new THREE.Vector3(2.4, 6.2, 9.0),
      target: new THREE.Vector3(0.1, 0.8, 1.0),
      shadowSize: 2048,
    },
    hemi: { sky: '#DCEBFF', ground: '#E6E1D8', intensity: 1.7 },
    ambient: { color: '#EDF3FF', intensity: 0.36 },
    fills: [
      { color: '#FFE7C8', intensity: 0.6, distance: 10, pos: new THREE.Vector3(-1.9, 1.2, 0.55) },
      { color: '#CFE2FF', intensity: 0.7, distance: 10, pos: new THREE.Vector3(1.9, 1.9, -1.2) },
      { color: '#F2E6D6', intensity: 0.45, distance: 8, pos: new THREE.Vector3(0.4, 0.35, 1.2) },
      { color: '#E6EEFF', intensity: 0.42, distance: 7, pos: new THREE.Vector3(-0.2, 2.5, -1.6) },
    ],
    skyTint: '#FFFFFF',
    shaftColor: '#FFF3DA',
    shaftDensity: 0.2,
    exposure: 1.06,
    fog: { color: '#DFE9F2', density: 0.014 },
  },
};

export function createLighting(ctx) {
  const { scene } = ctx;

  /* -------- primary sun (through the window wall) -------- */
  const sun = new THREE.DirectionalLight(0xffc98e, 3.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 34;
  const S = 7.2;
  sun.shadow.camera.left = -S;
  sun.shadow.camera.right = S;
  sun.shadow.camera.top = S;
  sun.shadow.camera.bottom = -S;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.022;
  sun.shadow.radius = 2.6;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);

  /* -------- sky light (through the tall window) -------- */
  const skyLight = new THREE.DirectionalLight(0xbfd6f2, 1.25);
  skyLight.castShadow = true;
  skyLight.shadow.mapSize.set(2048, 2048);
  skyLight.shadow.camera.near = 0.5;
  skyLight.shadow.camera.far = 30;
  const S2 = 6.4;
  skyLight.shadow.camera.left = -S2;
  skyLight.shadow.camera.right = S2;
  skyLight.shadow.camera.top = S2;
  skyLight.shadow.camera.bottom = -S2;
  skyLight.shadow.bias = -0.0007;
  skyLight.shadow.normalBias = 0.025;
  skyLight.shadow.radius = 3.0;
  skyLight.shadow.camera.updateProjectionMatrix();
  scene.add(skyLight);
  scene.add(skyLight.target);

  /* -------- ambient / fills -------- */
  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0xe9cdae, 0.5);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0xffffff, 0);
  scene.add(ambient);

  const fills = [];
  for (let i = 0; i < 4; i++) {
    const p = new THREE.PointLight(0xffffff, 0, 6, 2);
    p.castShadow = false;
    scene.add(p);
    fills.push(p);
  }

  scene.fog = new THREE.FogExp2(0xead6c2, 0.022);

  /* -------- preset application -------- */
  let current = 'golden';
  function apply(name, { immediate = false } = {}) {
    const p = PRESETS[name];
    if (!p) return;
    current = name;

    sun.color.set(p.sun.color);
    sun.intensity = p.sun.intensity;
    sun.position.copy(p.sun.position);
    sun.target.position.copy(p.sun.target);
    sun.shadow.radius = p.sun.radius;
    sun.target.updateMatrixWorld();

    skyLight.color.set(p.skyLight.color);
    skyLight.intensity = p.skyLight.intensity;
    skyLight.position.copy(p.skyLight.position);
    skyLight.target.position.copy(p.skyLight.target);
    skyLight.target.updateMatrixWorld();

    hemi.color.set(p.hemi.sky);
    hemi.groundColor.set(p.hemi.ground);
    hemi.intensity = p.hemi.intensity;

    if (p.ambient) {
      ambient.color.set(p.ambient.color);
      ambient.intensity = p.ambient.intensity;
    }

    p.fills.forEach((f, i) => {
      const pl = fills[i];
      pl.color.set(f.color);
      pl.intensity = f.intensity;
      pl.distance = f.distance;
      pl.position.copy(f.pos);
    });

    if (scene.fog) {
      scene.fog.color.set(p.fog.color);
      scene.fog.density = p.fog.density;
    }
    if (ctx.skyMaterial) ctx.skyMaterial.color.set(p.skyTint);

    // shafts follow the sun
    const dir = new THREE.Vector3().subVectors(sun.position, sun.target.position).normalize();
    const travel = dir.clone().negate();
    if (ctx.shaftMaterial) {
      ctx.shaftMaterial.uniforms.uLightDir.value.copy(travel);
      ctx.shaftMaterial.uniforms.uColor.value.set(p.shaftColor);
      ctx.shaftMaterial.uniforms.uDensity.value = p.shaftDensity;
    }
    ctx.sunTravelDir = travel;
    ctx.exposure = p.exposure;
    ctx.presetName = p.label;
    return p;
  }

  apply('golden');

  return {
    sun,
    skyLight,
    hemi,
    ambient,
    fills,
    apply,
    get current() {
      return current;
    },
    get label() {
      return PRESETS[current].label;
    },
  };
}
