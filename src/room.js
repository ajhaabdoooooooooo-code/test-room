import * as THREE from 'three';
import { mesh, group, setShadow, clamp, rand, DEG } from './utils.js';
import { worldUV, planarUV } from './materials.js';
import { PALETTE } from './materials.js';

/* ------------------------------------------------------------------ *
 *  ROOM METRICS  (interior box, metres)
 *     x: -2.7 (window wall)  →  +2.7 (right wall)
 *     z: -2.5 (front wall)   →  +2.5 (back wall, the one with the posters)
 *     y:  0    (floor)       →  2.75 (ceiling)
 * ------------------------------------------------------------------ */
export const ROOM = {
  minX: -2.7,
  maxX: 2.7,
  minZ: -2.5,
  maxZ: 2.5,
  h: 2.75,
  t: 0.22,
};

/* the tall window on the back wall (behind the bed) */
export const BACK_WINDOW = {
  x0: -1.15,
  x1: 1.0,
  y0: 0.42,
  y1: 2.62,
  cols: 2,
  rows: 4,
};

/* the smaller window on the window wall */
export const SIDE_WINDOW = {
  z0: 0.0,
  z1: 1.2,
  y0: 1.0,
  y1: 2.28,
  cols: 2,
  rows: 2,
};

/* a door on the front wall — the cutaway never showed this wall, a bedroom needs one */
const DOOR = { x0: -0.62, x1: 0.32, y0: 0, y1: 2.06 };

function slabGeometry({ length, height, thickness, holes = [], segments = 1 }) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(length, 0);
  shape.lineTo(length, height);
  shape.lineTo(0, height);
  shape.closePath();
  for (const h of holes) {
    const path = new THREE.Path();
    path.moveTo(h.x0, h.y0);
    path.lineTo(h.x1, h.y0);
    path.lineTo(h.x1, h.y1);
    path.lineTo(h.x0, h.y1);
    path.closePath();
    shape.holes.push(path);
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: segments,
  });
  geo.computeVertexNormals();
  return geo;
}

/* window joinery: outer frame + muntin grid + glass + sill */
function buildWindow(ctx, {
  width, height, cols, rows, mullionPattern = 'even', transomTop = 0,
}) {
  const g = group('window');
  const frameW = 0.075;   // frame thickness in the plane
  const frameD = 0.16;    // depth of the frame
  const barT = 0.035;     // muntin size
  const { m } = ctx.mats;

  const mk = (w, h, d, x, y, z) => {
    const g2 = new THREE.BoxGeometry(w, h, d);
    const mm = mesh(g2, m.paint, x, y, z);
    g.add(mm);
    return mm;
  };

  // frame (the opening is the glass area)
  const iw = width;
  const ih = height;
  mk(frameW, ih + frameW * 2, frameD, -iw / 2 - frameW / 2, ih / 2, 0);
  mk(frameW, ih + frameW * 2, frameD, iw / 2 + frameW / 2, ih / 2, 0);
  mk(iw, frameW, frameD, 0, -frameW / 2, 0);
  mk(iw, frameW, frameD, 0, ih + frameW / 2, 0);

  // horizontal muntins
  const rowYs = [];
  if (transomTop > 0) {
    const lower = ih - transomTop;
    rowYs.push(lower);
  } else {
    for (let r = 1; r < rows; r++) rowYs.push((ih * r) / rows);
  }
  for (const y of rowYs) mk(iw, barT, frameD * 0.72, 0, y, 0);

  // vertical muntins
  for (let c = 1; c < cols; c++) mk(barT, ih, frameD * 0.72, (iw * c) / cols - iw / 2, ih / 2, 0);

  // glass
  const glass = mesh(new THREE.PlaneGeometry(iw, ih), m.glass, 0, ih / 2, -frameD * 0.22);
  glass.castShadow = false;
  glass.receiveShadow = false;
  glass.layers.set(1);
  g.add(glass);

  // sill ledge
  const sill = mk(iw + frameW * 2.6, 0.045, frameD + 0.12, 0, -frameW - 0.02, 0.05);
  sill.name = 'sill';

  return { group: g, glass };
}

export function buildRoom(ctx) {
  const { scene, mats } = ctx;
  const { m } = mats;
  const root = group('room');
  const W = ROOM.maxX - ROOM.minX;
  const D = ROOM.maxZ - ROOM.minZ;
  const H = ROOM.h;
  const T = ROOM.t;

  /* ---------------- floor ---------------- */
  const floorGeo = new THREE.BoxGeometry(W + T * 2, 0.12, D + T * 2);
  floorGeo.translate(0, -0.06, 0);
  worldUV(floorGeo, 1.2);
  const floor = mesh(floorGeo, m.floor);
  floor.castShadow = false;
  floor.receiveShadow = true;
  floor.position.set(0, 0, 0);
  floor.name = 'floor';
  root.add(floor);

  /* ---------------- ceiling ---------------- */
  const ceilGeo = new THREE.BoxGeometry(W + T * 2, 0.2, D + T * 2);
  ceilGeo.translate(0, H + 0.1, 0);
  worldUV(ceilGeo, 2.0);
  const ceil = mesh(ceilGeo, m.ceiling);
  ceil.castShadow = true;
  ceil.receiveShadow = true;
  ceil.name = 'ceiling';
  root.add(ceil);

  /* ---------------- walls ---------------- */
  const wallGroup = group('walls');

  // back wall (z = maxZ) — carries the tall window
  const backGeo = slabGeometry({
    length: W,
    height: H,
    thickness: T,
    holes: [{ x0: BACK_WINDOW.x0 - ROOM.minX, x1: BACK_WINDOW.x1 - ROOM.minX, y0: BACK_WINDOW.y0, y1: BACK_WINDOW.y1 }],
  });
  backGeo.translate(ROOM.minX, 0, ROOM.maxZ);
  worldUV(backGeo, 2.0);
  const backWall = mesh(backGeo, m.wall);
  backWall.name = 'wall-back';
  wallGroup.add(backWall);

  // window wall (x = minX)
  const sideGeo = slabGeometry({
    length: D,
    height: H,
    thickness: T,
    holes: [{ x0: SIDE_WINDOW.z0 - ROOM.minZ, x1: SIDE_WINDOW.z1 - ROOM.minZ, y0: SIDE_WINDOW.y0, y1: SIDE_WINDOW.y1 }],
  });
  sideGeo.rotateY(-Math.PI / 2);
  sideGeo.translate(ROOM.minX, 0, ROOM.minZ);
  worldUV(sideGeo, 2.0);
  const sideWall = mesh(sideGeo, m.wall);
  sideWall.name = 'wall-window';
  wallGroup.add(sideWall);

  // right wall (x = maxX) — plain, the cutaway never showed it
  const rightGeo = slabGeometry({ length: D, height: H, thickness: T });
  rightGeo.rotateY(Math.PI / 2);
  rightGeo.translate(ROOM.maxX, 0, ROOM.maxZ);
  worldUV(rightGeo, 2.0);
  const rightWall = mesh(rightGeo, m.wall);
  rightWall.name = 'wall-right';
  wallGroup.add(rightWall);

  // front wall (z = minZ) — carries the door
  const frontGeo = slabGeometry({
    length: W,
    height: H,
    thickness: T,
    holes: [{ x0: DOOR.x0 - ROOM.minX, x1: DOOR.x1 - ROOM.minX, y0: 0, y1: DOOR.y1 }],
  });
  frontGeo.translate(ROOM.minX, 0, ROOM.minZ - T);
  worldUV(frontGeo, 2.0);
  const frontWall = mesh(frontGeo, m.wall);
  frontWall.name = 'wall-front';
  wallGroup.add(frontWall);

  setShadow(wallGroup, true, true);
  root.add(wallGroup);

  /* ---------------- door ---------------- */
  const doorGroup = group('door');
  const df = 0.075;
  const dw = DOOR.x1 - DOOR.x0;
  const dz = ROOM.minZ - 0.02;
  const dFrameParts = [
    [dw + df * 2, df, 0.16, (DOOR.x0 + DOOR.x1) / 2, DOOR.y1 + df / 2, ROOM.minZ + 0.04],
    [df, DOOR.y1, 0.16, DOOR.x0 - df / 2, DOOR.y1 / 2, ROOM.minZ + 0.04],
    [df, DOOR.y1, 0.16, DOOR.x1 + df / 2, DOOR.y1 / 2, ROOM.minZ + 0.04],
  ];
  for (const [w, h, d, x, y, z] of dFrameParts) {
    doorGroup.add(mesh(new THREE.BoxGeometry(w, h, d), m.paint, x, y, z));
  }
  const leaf = mesh(new THREE.BoxGeometry(dw - 0.006, DOOR.y1 - 0.03, 0.045), m.woodDoor, (DOOR.x0 + DOOR.x1) / 2, (DOOR.y1 - 0.03) / 2, dz - 0.03);
  doorGroup.add(leaf);
  // recessed panels
  for (let i = 0; i < 2; i++) {
    const py = 0.42 + i * 0.92;
    const panel = mesh(new THREE.BoxGeometry(dw - 0.22, 0.7, 0.012), m.woodDoor, (DOOR.x0 + DOOR.x1) / 2, py + 0.35, dz - 0.006);
    doorGroup.add(panel);
  }
  const handle = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.13, 12), m.doorHandle, DOOR.x1 - 0.12, 1.02, dz + 0.02);
  handle.rotation.x = Math.PI / 2;
  doorGroup.add(handle);
  const rose = mesh(new THREE.SphereGeometry(0.022, 12, 10), m.doorHandle, DOOR.x1 - 0.12, 1.02, dz + 0.012);
  doorGroup.add(rose);
  setShadow(doorGroup, true, true);
  root.add(doorGroup);

  /* ---------------- back window ---------------- */
  const bw = buildWindow(ctx, {
    width: BACK_WINDOW.x1 - BACK_WINDOW.x0,
    height: BACK_WINDOW.y1 - BACK_WINDOW.y0,
    cols: BACK_WINDOW.cols,
    rows: BACK_WINDOW.rows,
  });
  bw.group.rotation.y = Math.PI;
  bw.group.position.set((BACK_WINDOW.x0 + BACK_WINDOW.x1) / 2, BACK_WINDOW.y0, ROOM.maxZ + ROOM.t / 2);
  bw.group.name = 'window-back';
  root.add(bw.group);
  ctx.windowBack = bw.group;

  /* ---------------- side window ---------------- */
  const sw = buildWindow(ctx, {
    width: SIDE_WINDOW.z1 - SIDE_WINDOW.z0,
    height: SIDE_WINDOW.y1 - SIDE_WINDOW.y0,
    cols: SIDE_WINDOW.cols,
    rows: SIDE_WINDOW.rows,
    transomTop: (SIDE_WINDOW.y1 - SIDE_WINDOW.y0) * 0.46,
  });
  sw.group.rotateY(Math.PI / 2);
  sw.group.position.set(ROOM.minX + ROOM.t / 2, SIDE_WINDOW.y0, (SIDE_WINDOW.z0 + SIDE_WINDOW.z1) / 2);
  sw.group.name = 'window-side';
  root.add(sw.group);

  /* ---------------- curtains + rod (window wall) ---------------- */
  const curtainGroup = group('curtains');

  const rodLen = (SIDE_WINDOW.z1 - SIDE_WINDOW.z0) + 0.7;
  const rodZ = (SIDE_WINDOW.z0 + SIDE_WINDOW.z1) / 2;
  const rodY = SIDE_WINDOW.y1 + 0.16;
  const rod = mesh(new THREE.CylinderGeometry(0.016, 0.016, rodLen, 14), m.paint, ROOM.minX + 0.09, rodY, rodZ);
  rod.rotation.x = Math.PI / 2;
  curtainGroup.add(rod);
  for (const s of [-1, 1]) {
    const cap = mesh(new THREE.SphereGeometry(0.028, 14, 10), m.paint, ROOM.minX + 0.09, rodY, rodZ + (s * rodLen) / 2);
    curtainGroup.add(cap);
    const bracket = mesh(new THREE.BoxGeometry(0.08, 0.03, 0.03), m.paint, ROOM.minX + 0.045, rodY - 0.02, rodZ + s * (rodLen / 2 - 0.1));
    curtainGroup.add(bracket);
  }

  // pleated panels hanging either side of the window
  const makePleated = (w, h, colsCount) => {
    const geo = new THREE.PlaneGeometry(w, h, 56, 14);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const u = (x + w / 2) / w;
      const v = (y + h / 2) / h;
      const folds = Math.sin(u * Math.PI * colsCount);
      const flare = 0.5 + 0.5 * (1 - v);
      // slightly wavy hem so the panel reads as cloth, not a plane
      const hem = Math.pow(1 - v, 6) * Math.sin(u * Math.PI * colsCount * 0.5) * h * 0.035;
      pos.setY(i, y - hem);
      pos.setZ(i, folds * 0.055 * flare);
      pos.setX(i, x + folds * 0.01);
    }
    geo.computeVertexNormals();
    return geo;
  };

  const panelH = SIDE_WINDOW.y0 + 0.04;
  const side = [-1, 1];
  ctx.curtainPanels = [];
  for (const s of side) {
    const w = 0.56;
    const openZ = rodZ + s * 0.76;
    const panel = mesh(makePleated(w, panelH, 4), m.curtain, ROOM.minX + 0.11, rodY - 0.03 - panelH / 2, openZ);
    panel.rotation.y = Math.PI / 2;
    panel.name = 'curtain-panel';
    curtainGroup.add(panel);
    ctx.curtainPanels.push({ mesh: panel, openZ, closedZ: rodZ + s * 0.29 });
  }
  // rod rings
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    const ring = mesh(new THREE.TorusGeometry(0.022, 0.005, 6, 14), m.paint, ROOM.minX + 0.09, rodY - 0.005, rodZ - rodLen / 2 + 0.12 + t * (rodLen - 0.24));
    curtainGroup.add(ring);
  }
  setShadow(curtainGroup, true, true);
  curtainGroup.traverse((o) => {
    if (o.isMesh && o.name === 'curtain-panel') o.castShadow = true;
  });
  root.add(curtainGroup);

  /* ---------------- split air conditioner (window wall, high) ---------------- */
  const acGroup = group('aircon');
  const acW = 0.9;   // along z
  const acH = 0.29;
  const acD = 0.21;
  const acBody = mesh(new THREE.BoxGeometry(acD, acH, acW, 2, 2, 4), m.plastic, 0, 0, 0);
  {
    const pos = acBody.geometry.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const ny = Math.abs(v.y) / (acH / 2);
      const nz = Math.abs(v.z) / (acW / 2);
      const bulge = 1 - Math.max(ny, nz) * 0.0;
      v.x += Math.sign(v.x || 1) * 0.004 * bulge;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    acBody.geometry.computeVertexNormals();
  }
  acGroup.add(acBody);
  // bottom grille
  const grille = mesh(new THREE.BoxGeometry(0.008, 0.085, acW - 0.06), m.plasticDark, acD / 2 - 0.005, -acH / 2 + 0.075, 0);
  acGroup.add(grille);
  for (let i = 0; i < 9; i++) {
    const slat = mesh(new THREE.BoxGeometry(0.006, 0.075, 0.055), m.plastic, acD / 2 + 0.002, -acH / 2 + 0.075, -acW / 2 + 0.07 + i * 0.09);
    acGroup.add(slat);
  }
  // per-window air outlet slot
  const lip = mesh(new THREE.BoxGeometry(0.03, 0.03, acW - 0.05), m.plastic, acD / 2 + 0.008, -acH / 2 - 0.008, 0);
  acGroup.add(lip);
  // tiny indicator light
  const dotGeo = new THREE.CircleGeometry(0.008, 12);
  const dot = new THREE.Mesh(dotGeo, new THREE.MeshStandardMaterial({ color: '#4CD07D', emissive: new THREE.Color('#4CD07D'), emissiveIntensity: 0.6, roughness: 0.4 }));
  dot.position.set(acD / 2 + 0.001, 0.02, acW / 2 - 0.06);
  dot.rotation.y = Math.PI / 2;
  acGroup.add(dot);
  acGroup.userData.dot = dot;
  acGroup.position.set(ROOM.minX + acD / 2 + 0.005, 2.42, 1.72);
  setShadow(acGroup, true, true);
  root.add(acGroup);

  // drain pipe + cable running down to the corner (as in the reference)
  const pipeCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(ROOM.minX + 0.05, 2.4, 2.1),
    new THREE.Vector3(ROOM.minX + 0.045, 2.2, 2.28),
    new THREE.Vector3(ROOM.minX + 0.05, 1.5, 2.34),
    new THREE.Vector3(ROOM.minX + 0.055, 0.7, 2.33),
    new THREE.Vector3(ROOM.minX + 0.06, 0.06, 2.28),
    new THREE.Vector3(ROOM.minX + 0.09, 0.03, 2.05),
  ]);
  const pipe = mesh(new THREE.TubeGeometry(pipeCurve, 40, 0.012, 8, false), m.paint);
  pipe.name = 'ac-pipe';
  root.add(pipe);
  const cableCurve2 = new THREE.CatmullRomCurve3([
    new THREE.Vector3(ROOM.minX + 0.06, 2.36, 1.75),
    new THREE.Vector3(ROOM.minX + 0.07, 2.1, 1.9),
    new THREE.Vector3(ROOM.minX + 0.07, 1.3, 1.98),
    new THREE.Vector3(ROOM.minX + 0.08, 0.5, 2.0),
    new THREE.Vector3(ROOM.minX + 0.1, 0.04, 2.02),
  ]);
  const acCable = mesh(new THREE.TubeGeometry(cableCurve2, 34, 0.008, 7, false), m.cableDark);
  acCable.name = 'ac-cable';
  root.add(acCable);
  ctx.ac = acGroup;

  /* ---------------- wall art on the back wall ---------------- */
  const artGroup = group('wall-art');
  const wallZ = ROOM.maxZ - 0.001;

  const addPoster = (mat, w, h, x, y, mount = 0.03) => {
    const back = mesh(new THREE.BoxGeometry(w + 0.03, h + 0.03, mount * 0.7), m.posterBack, x, y, wallZ - mount * 0.35);
    artGroup.add(back);
    const face = mesh(new THREE.PlaneGeometry(w, h), mat, x, y, wallZ - mount);
    face.rotation.y = Math.PI;
    face.castShadow = false;
    artGroup.add(face);
    return face;
  };

  const poster1 = addPoster(m.posterPink, 0.62, 0.82, -2.32, 1.86);
  const poster2 = addPoster(m.posterBlue, 0.42, 0.42, -1.74, 1.98);
  const poster3 = addPoster(m.posterGreen, 0.48, 0.6, -1.28, 1.8);

  // closet door panel over the desk
  const closetBacking = mesh(new THREE.BoxGeometry(1.04, 0.9, 0.02), m.posterBack, 1.86, 1.98, wallZ - 0.011);
  artGroup.add(closetBacking);
  const closetFace = mesh(new THREE.PlaneGeometry(1.0, 0.86), m.closetPanel, 1.86, 1.98, wallZ - 0.023);
  closetFace.rotation.y = Math.PI;
  closetFace.castShadow = false;
  artGroup.add(closetFace);

  // two little yellow diamonds + a pale sticker, far right
  const diamond = (size, x, y, mat) => {
    const d = mesh(new THREE.BoxGeometry(size * 1.42, size * 1.42, 0.006), mat, x, y, wallZ - 0.004);
    d.rotation.z = Math.PI / 4;
    d.castShadow = false;
    artGroup.add(d);
    return d;
  };
  diamond(0.085, 2.42, 2.12, m.sticker);
  diamond(0.07, 2.26, 1.9, m.sticker);
  const pale = mesh(new THREE.BoxGeometry(0.05, 0.05, 0.005), m.stickerPale, 2.49, 1.76, wallZ - 0.004);
  pale.rotation.z = Math.PI / 4;
  pale.castShadow = false;
  artGroup.add(pale);

  root.add(artGroup);

  /* ---------------- colliders ---------------- */
  const cx = (ROOM.minX + ROOM.maxX) / 2;
  const cz = (ROOM.minZ + ROOM.maxZ) / 2;
  const wallBoxes = [
    [ROOM.minX - T, ROOM.minX, 0, H, ROOM.minZ - T, ROOM.maxZ + T],
    [ROOM.maxX, ROOM.maxX + T, 0, H, ROOM.minZ - T, ROOM.maxZ + T],
    [ROOM.minX, ROOM.maxX, 0, H, ROOM.minZ - T, ROOM.minZ],
    [ROOM.minX, ROOM.maxX, 0, H, ROOM.maxZ, ROOM.maxZ + T],
  ];
  for (const [x0, x1, y0, y1, z0, z1] of wallBoxes) {
    ctx.colliders.push(new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)));
  }

  /* ---------------- pickable labels ---------------- */
  const pick = (obj, name, note, action = null) => {
    obj.userData.pick = { name, note, action };
    ctx.pickables.push(obj);
  };
  pick(poster1, 'Pink poster', 'A dancer made of one white brush stroke.');
  pick(poster2, 'Blue poster', 'Sun-burst, spokes, and a lot of confidence.');
  pick(poster3, 'Green poster', 'A cloud that decided to live indoors.');
  pick(closetFace, 'Closet panel', 'A thousand tiny squares, no door behind them.');
  pick(acGroup, 'Air conditioner', 'Set to a very specific, very pleasant temperature.', 'ac');
  pick(curtainGroup, 'Curtains', 'Pleated, patient, and always slightly ajar.', 'curtain');
  pick(bw.group, 'Tall window', 'Floor to nearly-ceiling. The best light in the room.');
  pick(sw.group, 'Window', 'Two-by-two panes, perfectly friendly.');
  pick(doorGroup, 'The door', 'Someone could visit. Nobody will.');

  scene.add(root);
  setShadow(root, true, true);
  floor.castShadow = false;
  root.traverse((o) => {
    if (o.isMesh && (o.name === 'sill' || o.name === 'ceiling' || o.name === 'floor')) o.castShadow = o.castShadow && o.name !== 'floor';
  });

  return root;
}
