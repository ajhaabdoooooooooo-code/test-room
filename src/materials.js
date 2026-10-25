import * as THREE from 'three';
import * as TX from './textures.js';
import { toTexture, grayFrom } from './utils.js';

/* ==================================================================== *
 *  PALETTE — sampled straight off the reference render
 * ==================================================================== */
export const PALETTE = {
  wall: '#C7E4F2',
  wallEdge: '#A8CFE0',
  wallSlab: '#7FA6BC',
  ceiling: '#F6F3EE',
  floorTones: ['#D9B98D', '#C9A878', '#E0C39A', '#BE9D70'],
  seam: '#8A6A48',

  bedFrame: '#8A93A3',
  bedCubby: '#C79A63',
  mattress: '#FCFCFC',
  duvetBase: '#F2F7FB',
  duvetStripe: '#A9CBE8',
  pillowPink: '#EFB6C0',
  throwMint: '#9FD9C2',

  nightstand: '#B98A57',
  potTerracotta: '#C0603A',
  plantGreen: '#4E9A5A',
  potMauve: '#8E5A8B',

  deskTop: '#C9CDD4',
  deskWood: '#C79A63',
  rug: '#F2C94C',
  sticker: '#F2C94C',

  white: '#FFFFFF',
  curtain: '#F7F7F5',
  ac: '#F2F0EA',
  glass: '#EAF3F8',
  ink: '#2A2A33',
};

/* world-space triplanar-ish UVs (metres) so every material tiles consistently */
export function worldUV(geo, scale = 1, offset = [0, 0]) {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nrm.getX(i));
    const ny = Math.abs(nrm.getY(i));
    const nz = Math.abs(nrm.getZ(i));
    let u;
    let v;
    if (nx >= ny && nx >= nz) {
      u = pos.getZ(i);
      v = pos.getY(i);
    } else if (ny >= nx && ny >= nz) {
      u = pos.getX(i);
      v = pos.getZ(i);
    } else {
      u = pos.getX(i);
      v = pos.getY(i);
    }
    uv[i * 2] = u / scale + offset[0];
    uv[i * 2 + 1] = v / scale + offset[1];
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/* planar UVs (metres) — for floors, rugs, posters */
export function planarUV(geo, scale = 1, axes = 'xz') {
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let u = x;
    let v = z;
    if (axes === 'xy') { u = x; v = y; }
    if (axes === 'zy') { u = z; v = y; }
    uv[i * 2] = u / scale;
    uv[i * 2 + 1] = v / scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/* seamless banded fabric shader (stripes in local space — no UV seams) */
export function bandedFabric({ a, b, bands, axis = 'z', rough = 0.92, offset = 0 }) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: rough, metalness: 0 });
  const ai = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  mat.userData.banded = true;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uA = { value: new THREE.Color(a) };
    shader.uniforms.uB = { value: new THREE.Color(b) };
    shader.uniforms.uBands = { value: bands };
    shader.uniforms.uAxisIdx = { value: ai };
    shader.uniforms.uOffset = { value: offset };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocalPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocalPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vLocalPos;
         uniform vec3 uA; uniform vec3 uB; uniform float uBands; uniform float uAxisIdx; uniform float uOffset;`
      )
      .replace(
        '#include <map_fragment>',
        `{
           float coord = (uAxisIdx < 0.5 ? vLocalPos.x : (uAxisIdx < 1.5 ? vLocalPos.y : vLocalPos.z));
           float bc = coord * uBands + uOffset;
           float w = max(fwidth(bc) * 1.1, 0.0015);
           float tri = abs(fract(bc) - 0.5) * 2.0;             // 0 at band centre
           float m = smoothstep(0.42 - w, 0.42 + w, tri);       // soft edge
           vec3 fab = mix(uA, uB, m);
           // woven micro variation
           float weave = sin(vLocalPos.y * 420.0) * sin(vLocalPos.x * 260.0 + vLocalPos.z * 300.0);
           fab *= 1.0 + weave * 0.022;
           diffuseColor.rgb *= fab;
         }`
      );
  };
  mat.customProgramCacheKey = () => `banded_${a}_${b}_${bands}_${ai}_${offset}`;
  return mat;
}

/* ---------------------------------------------------------------- *
 * library
 * ---------------------------------------------------------------- */
export function createMaterials() {
  const tex = {};
  const m = {};

  /* ---------- architecture ---------- */
  const floor = TX.floorTextures();
  tex.floorColor = toTexture(floor.color, { repeat: [1, 1] });
  tex.floorNormal = toTexture(floor.normal, { srgb: false });
  tex.floorRough = toTexture(floor.rough, { srgb: false });

  const wall = TX.wallTextures(PALETTE.wall);
  tex.wallColor = toTexture(wall.color);
  tex.wallNormal = toTexture(wall.normal, { srgb: false });
  tex.wallRough = toTexture(wall.rough, { srgb: false });

  const ceil = TX.ceilingTextures();
  tex.ceilColor = toTexture(ceil.color);
  tex.ceilNormal = toTexture(ceil.normal, { srgb: false });

  m.floor = new THREE.MeshStandardMaterial({
    map: tex.floorColor,
    normalMap: tex.floorNormal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: tex.floorRough,
    roughness: 0.72,
    metalness: 0,
    envMapIntensity: 0.5,
  });

  m.wall = new THREE.MeshStandardMaterial({
    map: tex.wallColor,
    normalMap: tex.wallNormal,
    normalScale: new THREE.Vector2(0.1, 0.1),
    roughnessMap: tex.wallRough,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.35,
  });
  m.wallSlab = new THREE.MeshStandardMaterial({ color: PALETTE.wallSlab, roughness: 0.9, metalness: 0 });
  m.wallEdge = new THREE.MeshStandardMaterial({ color: PALETTE.wallEdge, roughness: 0.9, metalness: 0 });
  m.ceiling = new THREE.MeshStandardMaterial({
    map: tex.ceilColor,
    normalMap: tex.ceilNormal,
    normalScale: new THREE.Vector2(0.08, 0.08),
    roughness: 0.96,
    metalness: 0,
  });

  /* ---------- painted wood / white joinery ---------- */
  const paint = TX.paintedMetalTexture(PALETTE.white);
  tex.paint = toTexture(paint.color);
  tex.paintRough = toTexture(paint.rough, { srgb: false });
  m.paint = new THREE.MeshStandardMaterial({
    map: tex.paint,
    roughnessMap: tex.paintRough,
    roughness: 0.48,
    metalness: 0,
    envMapIntensity: 0.6,
  });

  const plastic = TX.plasticTexture(PALETTE.ac);
  tex.plastic = toTexture(plastic.color);
  tex.plasticNormal = toTexture(plastic.normal, { srgb: false });
  tex.plasticRough = toTexture(plastic.rough, { srgb: false });
  m.plastic = new THREE.MeshStandardMaterial({
    map: tex.plastic,
    normalMap: tex.plasticNormal,
    normalScale: new THREE.Vector2(0.2, 0.2),
    roughnessMap: tex.plasticRough,
    roughness: 0.52,
    metalness: 0,
    envMapIntensity: 0.5,
  });
  m.plasticDark = new THREE.MeshStandardMaterial({ color: '#3A3D45', roughness: 0.45, metalness: 0.1 });
  m.cableDark = new THREE.MeshStandardMaterial({ color: '#25262B', roughness: 0.62, metalness: 0.02 });

  /* ---------- timber ---------- */
  const woodLight = TX.woodTextures(PALETTE.deskWood, { seed: 41 });
  tex.woodLight = toTexture(woodLight.color);
  tex.woodLightNormal = toTexture(woodLight.normal, { srgb: false });
  tex.woodLightRough = toTexture(woodLight.rough, { srgb: false });
  m.woodLight = new THREE.MeshStandardMaterial({
    map: tex.woodLight,
    normalMap: tex.woodLightNormal,
    normalScale: new THREE.Vector2(0.3, 0.3),
    roughnessMap: tex.woodLightRough,
    roughness: 0.55,
    metalness: 0,
    envMapIntensity: 0.55,
  });
  m.woodLightEnv = m.woodLight;

  const woodMid = TX.woodTextures(PALETTE.nightstand, { seed: 43 });
  tex.woodMid = toTexture(woodMid.color);
  tex.woodMidNormal = toTexture(woodMid.normal, { srgb: false });
  m.woodMid = new THREE.MeshStandardMaterial({
    map: tex.woodMid,
    normalMap: tex.woodMidNormal,
    normalScale: new THREE.Vector2(0.3, 0.3),
    roughness: 0.6,
    metalness: 0,
    envMapIntensity: 0.5,
  });

  const woodDoor = TX.woodTextures('#CDAE84', { seed: 47, streaks: 40 });
  tex.woodDoor = toTexture(woodDoor.color);
  tex.woodDoorNormal = toTexture(woodDoor.normal, { srgb: false });
  m.woodDoor = new THREE.MeshStandardMaterial({
    map: tex.woodDoor,
    normalMap: tex.woodDoorNormal,
    normalScale: new THREE.Vector2(0.25, 0.25),
    roughness: 0.6,
    metalness: 0,
  });

  m.deskTop = new THREE.MeshStandardMaterial({
    color: PALETTE.deskTop,
    roughness: 0.42,
    metalness: 0,
    envMapIntensity: 0.7,
  });

  /* ---------- soft goods ---------- */
  const fabricWhite = TX.fabricTextures('#FCFCFC', { seed: 61, weave: 1.0, tone: 0.05 });
  tex.fabricWhite = toTexture(fabricWhite.color);
  tex.fabricWhiteNormal = toTexture(fabricWhite.normal, { srgb: false });
  tex.fabricWhiteRough = toTexture(fabricWhite.rough, { srgb: false });

  const curtainFabric = TX.fabricTextures('#F7F7F5', { seed: 63, weave: 0.7, tone: 0.045 });
  tex.curtain = toTexture(curtainFabric.color);
  tex.curtainNormal = toTexture(curtainFabric.normal, { srgb: false });
  tex.curtainRough = toTexture(curtainFabric.rough, { srgb: false });

  m.curtain = new THREE.MeshStandardMaterial({
    map: tex.curtain,
    normalMap: tex.curtainNormal,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughness: 0.94,
    metalness: 0,
    side: THREE.DoubleSide,
    envMapIntensity: 0.4,
  });

  const floral = TX.floralTexture();
  tex.floral = toTexture(floral.color);
  tex.floralNormal = toTexture(floral.normal, { srgb: false });
  m.pillowFloral = new THREE.MeshStandardMaterial({
    map: tex.floral,
    normalMap: tex.floralNormal,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughness: 0.93,
    metalness: 0,
  });

  m.pillowPink = new THREE.MeshStandardMaterial({ map: tex.fabricWhite, roughness: 0.94, color: PALETTE.pillowPink });
  m.pillowPink.map = tex.fabricWhite;
  m.pillowStripe = bandedFabric({ a: '#FDFDFD', b: '#F0A8B8', bands: 9, axis: 'y', rough: 0.94 });

  const knit = TX.knitTexture(PALETTE.throwMint);
  tex.knit = toTexture(knit.color);
  tex.knitNormal = toTexture(knit.normal, { srgb: false });
  tex.knitRough = toTexture(knit.rough, { srgb: false });
  m.throwMint = new THREE.MeshStandardMaterial({
    map: tex.knit,
    normalMap: tex.knitNormal,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughnessMap: tex.knitRough,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  m.mattress = new THREE.MeshStandardMaterial({
    map: tex.fabricWhite,
    normalMap: tex.fabricWhiteNormal,
    normalScale: new THREE.Vector2(0.5, 0.5),
    color: PALETTE.mattress,
    roughness: 0.9,
    metalness: 0,
  });
  m.sheet = new THREE.MeshStandardMaterial({
    map: tex.fabricWhite,
    normalMap: tex.fabricWhiteNormal,
    normalScale: new THREE.Vector2(0.45, 0.45),
    color: '#FFFFFF',
    roughness: 0.88,
  });
  m.duvet = bandedFabric({
    a: PALETTE.duvetStripe,
    b: PALETTE.duvetBase,
    bands: 7.5,
    axis: 'z',
    rough: 0.9,
  });

  m.bedFrame = new THREE.MeshStandardMaterial({ color: PALETTE.bedFrame, roughness: 0.72, metalness: 0.04 });
  m.bedCubby = new THREE.MeshStandardMaterial({ map: tex.woodLight, roughness: 0.6, color: '#E6D3B6' });

  const rug = TX.rugTexture(PALETTE.rug);
  tex.rug = toTexture(rug.color);
  tex.rugNormal = toTexture(rug.normal, { srgb: false });
  tex.rugRough = toTexture(rug.rough, { srgb: false });
  m.rug = new THREE.MeshStandardMaterial({
    map: tex.rug,
    normalMap: tex.rugNormal,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughnessMap: tex.rugRough,
    roughness: 0.97,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  /* ---------- glass ---------- */
  m.glass = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.045,
    metalness: 0,
    transparent: true,
    opacity: 0.12,
    envMapIntensity: 1.4,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  m.glassEnvOnly = m.glass;

  /* ---------- ceramics / plants ---------- */
  const terra = TX.terracottaTexture(PALETTE.potTerracotta);
  tex.terra = toTexture(terra.color);
  tex.terraNormal = toTexture(terra.normal, { srgb: false });
  tex.terraRough = toTexture(terra.rough, { srgb: false });
  m.terracotta = new THREE.MeshStandardMaterial({
    map: tex.terra,
    normalMap: tex.terraNormal,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughnessMap: tex.terraRough,
    roughness: 0.8,
    metalness: 0,
  });

  const cer = TX.ceramicTexture();
  tex.ceramic = toTexture(cer.color);
  tex.ceramicNormal = toTexture(cer.normal, { srgb: false });
  tex.ceramicRough = toTexture(cer.rough, { srgb: false });
  m.ceramic = new THREE.MeshStandardMaterial({
    map: tex.ceramic,
    normalMap: tex.ceramicNormal,
    normalScale: new THREE.Vector2(0.2, 0.2),
    roughnessMap: tex.ceramicRough,
    roughness: 0.24,
    metalness: 0.02,
    envMapIntensity: 1.1,
  });

  m.potMauve = new THREE.MeshStandardMaterial({ color: PALETTE.potMauve, roughness: 0.5, metalness: 0.02, envMapIntensity: 1.0 });

  const cactus = TX.cactusTexture(PALETTE.plantGreen);
  tex.cactus = toTexture(cactus.color);
  tex.cactusNormal = toTexture(cactus.normal, { srgb: false });
  m.cactus = new THREE.MeshStandardMaterial({
    map: tex.cactus,
    normalMap: tex.cactusNormal,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.78,
    metalness: 0,
  });

  const leaf = TX.leafTexture(PALETTE.plantGreen);
  tex.leaf = toTexture(leaf.color, { wrap: THREE.ClampToEdgeWrapping });
  m.leaf = new THREE.MeshStandardMaterial({
    map: tex.leaf,
    transparent: true,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 0.72,
    metalness: 0,
    color: '#FFFFFF',
  });
  m.leafDeep = new THREE.MeshStandardMaterial({
    map: tex.leaf,
    transparent: true,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 0.76,
    color: '#8FB79A',
  });
  m.stem = new THREE.MeshStandardMaterial({ color: '#4E8F55', roughness: 0.8 });

  /* ---------- wall art ---------- */
  tex.posterPink = toTexture(TX.posterPink(), { wrap: THREE.ClampToEdgeWrapping });
  tex.posterBlue = toTexture(TX.posterBlue(), { wrap: THREE.ClampToEdgeWrapping });
  tex.posterGreen = toTexture(TX.posterGreen(), { wrap: THREE.ClampToEdgeWrapping });
  m.posterPink = new THREE.MeshStandardMaterial({ map: tex.posterPink, roughness: 0.82 });
  m.posterBlue = new THREE.MeshStandardMaterial({ map: tex.posterBlue, roughness: 0.8 });
  m.posterGreen = new THREE.MeshStandardMaterial({ map: tex.posterGreen, roughness: 0.82 });
  m.posterBack = new THREE.MeshStandardMaterial({ color: '#EDE7DC', roughness: 0.85 });

  const closet = TX.closetPanelTexture();
  tex.closet = toTexture(closet.color, { wrap: THREE.ClampToEdgeWrapping });
  tex.closetNormal = toTexture(closet.normal, { srgb: false });
  m.closetPanel = new THREE.MeshStandardMaterial({
    map: tex.closet,
    normalMap: tex.closetNormal,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughness: 0.72,
    metalness: 0,
  });

  m.sticker = new THREE.MeshStandardMaterial({ color: PALETTE.sticker, roughness: 0.62, metalness: 0 });
  m.stickerPale = new THREE.MeshStandardMaterial({ color: '#EFE2C8', roughness: 0.66 });

  /* ---------- small props ---------- */
  tex.paper = toTexture(TX.paperTexture());
  m.paper = new THREE.MeshStandardMaterial({ map: tex.paper, roughness: 0.88, side: THREE.DoubleSide });
  m.paperPlain = new THREE.MeshStandardMaterial({ color: '#FFFDF7', roughness: 0.9, side: THREE.DoubleSide });

  tex.bookA = toTexture(TX.bookCoverTexture('#8C5A46'));
  tex.bookB = toTexture(TX.bookCoverTexture('#5E7B8C', '#E7EEF2'));
  tex.bookC = toTexture(TX.bookCoverTexture('#C08A9A', '#FBF0F3'));
  m.bookA = new THREE.MeshStandardMaterial({ map: tex.bookA, roughness: 0.66 });
  m.bookB = new THREE.MeshStandardMaterial({ map: tex.bookB, roughness: 0.62 });
  m.bookC = new THREE.MeshStandardMaterial({ map: tex.bookC, roughness: 0.64 });
  m.bookPages = new THREE.MeshStandardMaterial({ color: '#FBF6EC', roughness: 0.92 });

  m.cupGreen = new THREE.MeshStandardMaterial({ color: '#6BAF7A', roughness: 0.44, envMapIntensity: 0.8 });
  m.pencilWood = new THREE.MeshStandardMaterial({ color: '#E8C07A', roughness: 0.7 });
  m.pencilYellow = new THREE.MeshStandardMaterial({ color: '#F2C94C', roughness: 0.6 });

  m.metalBright = new THREE.MeshStandardMaterial({ color: '#D8DCE0', roughness: 0.22, metalness: 0.9, envMapIntensity: 1.4 });
  m.lampShade = new THREE.MeshStandardMaterial({ color: '#F6EFE0', roughness: 0.6, side: THREE.DoubleSide });
  m.lampBulb = new THREE.MeshStandardMaterial({
    color: '#FFF3D8',
    emissive: new THREE.Color('#FFE0A8'),
    emissiveIntensity: 0.0,
    roughness: 0.4,
  });

  m.yellowBox = new THREE.MeshStandardMaterial({ color: '#F2C94C', roughness: 0.5 });
  m.pinkStripe = new THREE.MeshStandardMaterial({ color: '#F0A8B8', roughness: 0.5 });
  m.tissueBox = new THREE.MeshStandardMaterial({ color: '#F4E7D8', roughness: 0.6 });
  m.tissue = new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.95 });
  m.plantPotSmall = new THREE.MeshStandardMaterial({ color: '#E4DCCB', roughness: 0.55 });
  m.flowerPink = new THREE.MeshStandardMaterial({ color: '#F0B7C6', roughness: 0.7 });

  m.doorFrame = m.paint;
  m.doorHandle = m.metalBright;

  /* materials that should pick up the environment map */
  const envTargets = [m.glass, m.metalBright, m.ceramic, m.potMauve, m.deskTop, m.paint, m.plastic, m.woodLight, m.woodMid];

  return {
    m,
    tex,
    applyEnv(env, intensity = 1) {
      for (const mat of envTargets) {
        mat.envMap = env;
        if (mat.envMapIntensity !== undefined && mat.envMapIntensity > 1.05) mat.envMapIntensity *= 1;
      }
      m.glass.envMapIntensity = 1.0 * intensity;
      m.metalBright.envMapIntensity = 1.5 * intensity;
      m.deskTop.envMapIntensity = 0.75 * intensity;
    },
  };
}
