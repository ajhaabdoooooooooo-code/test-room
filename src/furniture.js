import * as THREE from 'three';
import {
  mesh, group, setShadow, superBox, puffBox, sweepProfile, roundedProfile, circleProfile,
  rand, DEG, clothGeometry,
} from './utils.js';
import { worldUV, planarUV } from './materials.js';

/* ------------------------------------------------------------------ *
 *  small building blocks
 * ------------------------------------------------------------------ */
function potGeometry({ rTop = 0.08, rBottom = 0.06, height = 0.1, seg = 26 }) {
  const pts = [];
  pts.push(new THREE.Vector2(0.002, 0));
  pts.push(new THREE.Vector2(rBottom, 0));
  pts.push(new THREE.Vector2(rBottom * 1.03, height * 0.14));
  pts.push(new THREE.Vector2(rTop * 0.97, height * 0.88));
  pts.push(new THREE.Vector2(rTop, height * 0.93));
  pts.push(new THREE.Vector2(rTop * 1.04, height));
  pts.push(new THREE.Vector2(rTop * 0.9, height * 0.995));
  pts.push(new THREE.Vector2(rTop * 0.86, height * 0.8));
  const g = new THREE.LatheGeometry(pts, seg);
  g.computeVertexNormals();
  return g;
}

function soilGeometry(r, y) {
  const g = new THREE.CircleGeometry(r, 24);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

/* a curved leaf blade built from the leaf texture */
function leafBlade({ w = 0.09, h = 0.42, bend = 0.25, twist = 0, tipNarrow = 0.45 }) {
  const geo = new THREE.PlaneGeometry(w, h, 3, 12);
  const pos = geo.attributes.position;
  const v3 = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v3.fromBufferAttribute(pos, i);
    const t = (v3.y + h / 2) / h;              // 0 at base → 1 at tip
    v3.z += bend * t * t * h;
    v3.x *= 1 - tipNarrow * t * t;
    v3.y += t * h * 0.06;
    pos.setXYZ(i, v3.x, v3.y, v3.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function taperedLeg(w, h, taper = 0.55) {
  const g = new THREE.CylinderGeometry(w * 0.5 * taper, w * 0.5, h, 10);
  g.translate(0, h / 2, 0);
  return g;
}

/* ==================================================================== *
 *  FURNITURE
 * ==================================================================== */
export function buildFurniture(ctx) {
  const { mats } = ctx;
  const { m } = mats;
  const root = group('furniture');

  /* ============================ BED ============================ */
  const bed = group('bed');
  const BED = { x: -0.1, z: 1.45, w: 1.5, len: 2.05, deck: 0.3 };

  // base deck
  const deck = mesh(new THREE.BoxGeometry(BED.w, 0.16, BED.len), m.bedFrame, BED.x, BED.deck - 0.08, BED.z);
  bed.add(deck);
  // legs
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = mesh(taperedLeg(0.075, 0.16), m.woodMid, BED.x + sx * (BED.w / 2 - 0.09), 0, BED.z + sz * (BED.len / 2 - 0.09));
      bed.add(leg);
    }
  }
  // mattress
  const mattressGeo = superBox(BED.w, 0.28, BED.len, 0.5, 30, 20);
  const mattress = mesh(mattressGeo, m.mattress, BED.x, BED.deck + 0.14, BED.z);
  bed.add(mattress);

  // headboard with a shelf slot and two timber cubbies
  const hb = group('headboard');
  const hbW = BED.w + 0.02;
  const hbH = 0.72;
  const head = mesh(new THREE.BoxGeometry(hbW, hbH, 0.085), m.bedFrame, BED.x, BED.deck + hbH / 2 - 0.02, 2.5 - 0.055);
  hb.add(head);
  // shelf slot line
  const slot = mesh(new THREE.BoxGeometry(hbW - 0.1, 0.022, 0.02), m.plasticDark, BED.x, BED.deck + 0.46, 2.5 - 0.105);
  hb.add(slot);
  // two cubbies
  for (const s of [-1, 1]) {
    const cx = BED.x + s * 0.32;
    const recess = mesh(new THREE.BoxGeometry(0.3, 0.2, 0.11), m.bedCubby, cx, BED.deck + 0.17, 2.5 - 0.1);
    hb.add(recess);
    const lip = mesh(new THREE.BoxGeometry(0.32, 0.016, 0.02), m.bedFrame, cx, BED.deck + 0.28, 2.5 - 0.045);
    hb.add(lip);
  }
  // top rail
  const rail = mesh(new THREE.BoxGeometry(hbW, 0.05, 0.11), m.bedFrame, BED.x, BED.deck + hbH - 0.045, 2.5 - 0.055);
  hb.add(rail);
  bed.add(hb);

  // duvet with soft stripes (lower two thirds of the mattress)
  const duvetGeo = superBox(BED.w - 0.02, 0.17, 1.22, 0.34, 34, 18);
  const duvet = mesh(duvetGeo, m.duvet, BED.x, BED.deck + 0.3, BED.z - 0.42);
  bed.add(duvet);

  // turned-back top sheet
  const sheetGeo = superBox(BED.w - 0.015, 0.075, 0.3, 0.5, 26, 12);
  const sheet = mesh(sheetGeo, m.sheet, BED.x, BED.deck + 0.275, BED.z + 0.28);
  bed.add(sheet);

  // pillows
  const pillow = (mat, w, h, d, x, z, rot, y, e = 0.85) => {
    const p = mesh(superBox(w, h, d, e, 24, 14), mat, x, y, z);
    p.rotation.set(rot[0], rot[1], rot[2]);
    return p;
  };
  const headY = BED.deck + 0.34;
  const p1 = pillow(m.pillowFloral, 0.68, 0.14, 0.44, BED.x - 0.36, BED.z + 0.63, [-0.34, 0.06, 0.03], headY + 0.05, 0.44);
  const p2 = pillow(m.pillowPink, 0.66, 0.135, 0.42, BED.x + 0.34, BED.z + 0.63, [-0.36, -0.07, -0.04], headY + 0.05, 0.44);
  const p3 = pillow(m.pillowStripe, 0.46, 0.115, 0.32, BED.x - 0.34, BED.z + 0.42, [-0.32, 0.12, 0.02], headY - 0.04, 0.5);
  bed.add(p1, p2, p3);

  // mint throw — sweeps off the foot of the bed onto the floor
  const throwPath = [
    new THREE.Vector3(BED.x, 0.848, BED.z - 0.62),
    new THREE.Vector3(BED.x, 0.85, BED.z - 0.8),
    new THREE.Vector3(BED.x, 0.836, BED.z - 0.95),
    new THREE.Vector3(BED.x, 0.79, BED.z - 1.015),
    new THREE.Vector3(BED.x, 0.62, BED.z - 1.05),
    new THREE.Vector3(BED.x, 0.42, BED.z - 1.07),
    new THREE.Vector3(BED.x, 0.22, BED.z - 1.08),
    new THREE.Vector3(BED.x, 0.05, BED.z - 1.09),
    new THREE.Vector3(BED.x, 0.03, BED.z - 1.2),
    new THREE.Vector3(BED.x, 0.022, BED.z - 1.4),
  ];
  const throwGeo = sweepProfile(throwPath, roundedProfile(BED.w / 2 - 0.03, 0.016, 0.014, 3), { cap: true });
  const throwMesh = mesh(throwGeo, m.throwMint);
  bed.add(throwMesh);
  // the folded top layer of the throw
  const foldPath = [
    new THREE.Vector3(BED.x, 0.878, BED.z - 0.58),
    new THREE.Vector3(BED.x, 0.884, BED.z - 0.72),
    new THREE.Vector3(BED.x, 0.874, BED.z - 0.84),
    new THREE.Vector3(BED.x, 0.856, BED.z - 0.9),
  ];
  const foldGeo = sweepProfile(foldPath, roundedProfile(BED.w / 2 - 0.07, 0.02, 0.017, 3), { cap: true });
  bed.add(mesh(foldGeo, m.throwMint));

  setShadow(bed, true, true);
  root.add(bed);

  ctx.colliders.push(
    new THREE.Box3(
      new THREE.Vector3(BED.x - BED.w / 2 - 0.02, 0, BED.z - BED.len / 2 - 0.05),
      new THREE.Vector3(BED.x + BED.w / 2 + 0.02, 0.95, 2.5)
    )
  );

  /* ======================= NIGHTSTAND + CACTUS ======================= */
  const night = group('nightstand');
  const NST = { x: -1.62, z: 2.22, w: 0.58, h: 0.5, d: 0.44 };
  const nstTop = 0.52;
  const body = mesh(new THREE.BoxGeometry(NST.w, NST.h, NST.d), m.woodMid, NST.x, nstTop - NST.h / 2, NST.z);
  night.add(body);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      night.add(mesh(taperedLeg(0.05, 0.09), m.woodMid, NST.x + sx * (NST.w / 2 - 0.055), 0, NST.z + sz * (NST.d / 2 - 0.055)));
    }
  }
  const nstTopPlate = mesh(new THREE.BoxGeometry(NST.w + 0.03, 0.028, NST.d + 0.03), m.woodMid, NST.x, nstTop + 0.014, NST.z);
  night.add(nstTopPlate);
  const drawer = mesh(new THREE.BoxGeometry(NST.w - 0.07, 0.2, 0.02), m.woodMid, NST.x, nstTop - 0.16, NST.z + NST.d / 2 + 0.008);
  night.add(drawer);
  const knob = mesh(new THREE.SphereGeometry(0.017, 14, 10), m.woodLight, NST.x, nstTop - 0.16, NST.z + NST.d / 2 + 0.025);
  night.add(knob);
  const shelfLine = mesh(new THREE.BoxGeometry(NST.w - 0.04, 0.012, 0.016), m.plasticDark, NST.x, nstTop - 0.29, NST.z + NST.d / 2 + 0.006);
  night.add(shelfLine);

  // terracotta pot + cactus
  const pot = mesh(potGeometry({ rTop: 0.075, rBottom: 0.055, height: 0.1 }), m.terracotta, NST.x - 0.15, nstTop + 0.028, NST.z - 0.02);
  night.add(pot);
  night.add(mesh(soilGeometry(0.07, 0.086), new THREE.MeshStandardMaterial({ color: '#4A3A2E', roughness: 1 }), NST.x - 0.15, nstTop + 0.028, NST.z - 0.02));
  const cactusGroup = group('cactus', NST.x - 0.15, nstTop + 0.11, NST.z - 0.02);
  const bodyC = mesh(new THREE.CapsuleGeometry(0.036, 0.13, 6, 18), m.cactus);
  cactusGroup.add(bodyC);
  const arm = (sx, sy, rot) => {
    const a = mesh(new THREE.CapsuleGeometry(0.023, 0.06, 5, 14), m.cactus, sx, sy, 0);
    a.rotation.z = rot;
    cactusGroup.add(a);
    const elbow = mesh(new THREE.SphereGeometry(0.024, 12, 10), m.cactus, sx * 0.62, sy - 0.045, 0);
    cactusGroup.add(elbow);
  };
  arm(-0.055, 0.02, 0.55);
  arm(0.055, 0.05, -0.5);
  // cheeky little flower
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const petal = mesh(new THREE.SphereGeometry(0.011, 10, 8), m.flowerPink, Math.cos(a) * 0.014, 0.1, Math.sin(a) * 0.014);
    petal.scale.set(1, 0.6, 1);
    cactusGroup.add(petal);
  }
  cactusGroup.add(mesh(new THREE.SphereGeometry(0.008, 10, 8), m.pencilYellow, 0, 0.103, 0));
  night.add(cactusGroup);

  // tissue box + a little yellow gift cube with a pink stripe
  const tissue = mesh(new THREE.BoxGeometry(0.13, 0.06, 0.09), m.tissueBox, NST.x + 0.05, nstTop + 0.058, NST.z + 0.02);
  night.add(tissue);
  const puff = mesh(superBox(0.07, 0.05, 0.05, 0.7, 12, 8), m.tissue, NST.x + 0.05, nstTop + 0.1, NST.z + 0.02);
  night.add(puff);

  const gift = group('gift', NST.x + 0.19, nstTop + 0.062, NST.z - 0.13);
  gift.add(mesh(new THREE.BoxGeometry(0.085, 0.085, 0.085), m.yellowBox));
  const band = mesh(new THREE.BoxGeometry(0.088, 0.026, 0.088), m.pinkStripe);
  gift.add(band);
  const band2 = mesh(new THREE.BoxGeometry(0.026, 0.088, 0.088), m.pinkStripe);
  gift.add(band2);
  const bow = mesh(new THREE.TorusGeometry(0.016, 0.007, 8, 14), m.pinkStripe, 0, 0.05, 0);
  bow.rotation.x = Math.PI / 2;
  gift.add(bow);
  night.add(gift);

  setShadow(night, true, true);
  root.add(night);

  ctx.colliders.push(
    new THREE.Box3(new THREE.Vector3(NST.x - NST.w / 2, 0, NST.z - NST.d / 2), new THREE.Vector3(NST.x + NST.w / 2, nstTop + 0.1, NST.z + NST.d / 2))
  );

  /* ========================= FLOOR PLANT ========================= */
  const plant = group('floor-plant');
  const PL = { x: -2.28, z: 2.12 };
  const bigPot = mesh(potGeometry({ rTop: 0.155, rBottom: 0.12, height: 0.22 }), m.potMauve, PL.x, 0, PL.z);
  plant.add(bigPot);
  plant.add(mesh(soilGeometry(0.145, 0.19), new THREE.MeshStandardMaterial({ color: '#3F3227', roughness: 1 }), PL.x, 0, PL.z));
  const leafSpecs = [
    [0.16, 0.62, 0.22, 0.0, 0.0],
    [0.14, 0.55, -0.24, 0.5, 0.1],
    [0.15, 0.68, 0.16, 1.05, -0.08],
    [0.13, 0.5, -0.2, 1.6, 0.06],
    [0.15, 0.6, 0.28, 2.1, -0.04],
    [0.14, 0.52, -0.16, 2.65, 0.12],
    [0.16, 0.72, 0.1, 3.2, 0.02],
    [0.13, 0.46, -0.26, 3.75, -0.1],
    [0.14, 0.58, 0.2, 4.3, 0.05],
  ];
  for (const [w, h, bend, rot, lean] of leafSpecs) {
    const leaf = mesh(leafBlade({ w, h, bend, tipNarrow: 0.5 }), m.leaf);
    leaf.castShadow = true;
    leaf.position.set(PL.x + Math.cos(rot) * 0.05, 0.18, PL.z + Math.sin(rot) * 0.05);
    leaf.rotation.set(lean, -rot + Math.PI / 2, 0, 'YXZ');
    plant.add(leaf);
  }
  setShadow(plant, true, true);
  root.add(plant);
  ctx.colliders.push(new THREE.Box3(new THREE.Vector3(PL.x - 0.2, 0, PL.z - 0.2), new THREE.Vector3(PL.x + 0.2, 0.7, PL.z + 0.2)));

  /* ============================ RUG ============================ */
  const rugGeo = new THREE.BoxGeometry(1.4, 0.014, 2.05, 6, 1, 6);
  planarUV(rugGeo, 1.45, 'xz');
  const rug = mesh(rugGeo, m.rug, -1.62, 0.008, -0.35);
  rug.castShadow = false;
  rug.receiveShadow = true;
  root.add(rug);

  /* ============================ DESK ============================ */
  const desk = group('desk');
  const DK = { x: 1.72, z: 2.1, w: 1.56, d: 0.62, h: 0.74 };
  const topPlate = mesh(new THREE.BoxGeometry(DK.w, 0.042, DK.d), m.deskTop, DK.x, DK.h, DK.z);
  desk.add(topPlate);
  const apronFront = mesh(new THREE.BoxGeometry(DK.w - 0.12, 0.075, 0.022), m.woodLight, DK.x, DK.h - 0.06, DK.z - DK.d / 2 + 0.02);
  desk.add(apronFront);
  for (const s of [-1, 1]) {
    desk.add(mesh(taperedLeg(0.05, DK.h - 0.02), m.woodLight, DK.x + s * (DK.w / 2 - 0.035), 0, DK.z - DK.d / 2 + 0.045));
  }
  // right hand side panel
  const sidePanel = mesh(new THREE.BoxGeometry(0.022, DK.h - 0.04, DK.d - 0.05), m.woodLight, DK.x + DK.w / 2 - 0.03, (DK.h - 0.04) / 2, DK.z);
  desk.add(sidePanel);

  // drawer unit under the left end
  const du = group('drawer-unit', DK.x - DK.w / 2 + 0.24, 0, DK.z + 0.01);
  const duW = 0.44;
  const duH = 0.62;
  const duD = 0.5;
  du.add(mesh(new THREE.BoxGeometry(duW, duH - 0.06, duD), m.woodLight, 0, 0.06 + (duH - 0.06) / 2, 0));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      du.add(mesh(taperedLeg(0.045, 0.07), m.woodLight, sx * (duW / 2 - 0.05), 0, sz * (duD / 2 - 0.05)));
    }
  }
  for (let i = 0; i < 2; i++) {
    const y = 0.2 + i * 0.26;
    du.add(mesh(new THREE.BoxGeometry(duW - 0.06, 0.22, 0.018), m.woodLight, 0, y, duD / 2 + 0.008));
    du.add(mesh(new THREE.SphereGeometry(0.014, 12, 10), m.woodMid, 0, y, duD / 2 + 0.024));
    du.add(mesh(new THREE.BoxGeometry(duW - 0.03, 0.012, 0.014), m.plasticDark, 0, y + 0.12, duD / 2 + 0.004));
  }
  desk.add(du);

  /* -------- desk props -------- */
  const props = group('desk-props');

  // open book
  const bookG = group('open-book', DK.x - 0.32, DK.h + 0.022, DK.z - 0.06);
  bookG.rotation.y = -0.24;
  for (const s of [-1, 1]) {
    const page = mesh(new THREE.BoxGeometry(0.145, 0.012, 0.2, 1, 1, 1), m.paperPlain, s * 0.075, 0.004, 0);
    page.rotation.z = -s * 0.055;
    bookG.add(page);
    const cover = mesh(new THREE.BoxGeometry(0.15, 0.008, 0.205), m.bookA, s * 0.075, -0.004, 0);
    cover.rotation.z = -s * 0.055;
    bookG.add(cover);
  }
  bookG.add(mesh(new THREE.BoxGeometry(0.02, 0.026, 0.2), m.bookA, 0, 0.0, 0));
  props.add(bookG);

  // book stack
  const stack = group('book-stack', DK.x + 0.44, DK.h + 0.02, DK.z + 0.02);
  const matsStack = [m.bookB, m.bookC, m.bookA];
  let y = 0;
  matsStack.forEach((mat, i) => {
    const h = 0.032 + i * 0.006;
    const b = mesh(new THREE.BoxGeometry(0.2 - i * 0.012, h, 0.14), mat, 0, y + h / 2, (i % 2) * 0.012);
    b.rotation.y = (i - 1) * 0.14;
    stack.add(b);
    y += h;
  });
  props.add(stack);

  // green pen cup with pencils and a sprig
  const cup = group('pen-cup', DK.x - 0.02, DK.h + 0.02, DK.z + 0.14);
  cup.add(mesh(new THREE.CylinderGeometry(0.042, 0.036, 0.1, 18, 1, true), m.cupGreen, 0, 0.05, 0));
  cup.add(mesh(new THREE.CircleGeometry(0.036, 18).rotateX(-Math.PI / 2), m.cupGreen, 0, 0.001, 0));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const pen = mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.17, 8), i % 2 ? m.pencilYellow : m.pencilWood, Math.cos(a) * 0.014, 0.13, Math.sin(a) * 0.014);
    pen.rotation.set(Math.sin(a) * 0.16, 0, -Math.cos(a) * 0.16);
    cup.add(pen);
  }
  const sprig = mesh(new THREE.PlaneGeometry(0.07, 0.14), m.leaf, 0, 0.16, 0);
  sprig.rotation.y = 0.7;
  cup.add(sprig);
  props.add(cup);

  // little desk lamp, pale gooseneck
  const lamp = group('lamp', DK.x - 0.58, DK.h + 0.02, DK.z + 0.02);
  lamp.add(mesh(new THREE.CylinderGeometry(0.062, 0.07, 0.022, 20), m.metalBright, 0, 0.011, 0));
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.02, 0),
    new THREE.Vector3(0.01, 0.15, -0.01),
    new THREE.Vector3(0.03, 0.26, -0.03),
    new THREE.Vector3(0.1, 0.3, -0.06),
  ]);
  lamp.add(mesh(new THREE.TubeGeometry(curve, 22, 0.008, 8, false), m.metalBright));
  const shadeG = group('shade', 0.135, 0.28, -0.075);
  shadeG.rotation.set(0.5, 0, 0.35);
  const shade = mesh(new THREE.ConeGeometry(0.078, 0.1, 22, 1, true), m.lampShade, 0, 0, 0);
  shadeG.add(shade);
  const bulb = mesh(new THREE.SphereGeometry(0.028, 14, 12), m.lampBulb, 0, -0.03, 0);
  shadeG.add(bulb);
  lamp.add(shadeG);
  props.add(lamp);

  desk.add(props);
  setShadow(desk, true, true);
  root.add(desk);

  const lampLight = new THREE.PointLight(0xffd9a0, 0, 2.4, 2);
  lampLight.position.set(DK.x - 0.58 + 0.14, DK.h + 0.19, DK.z + 0.02 - 0.07);
  lampLight.castShadow = false;
  root.add(lampLight);
  ctx.lampLight = lampLight;
  ctx.lampBulb = m.lampBulb;

  ctx.colliders.push(
    new THREE.Box3(new THREE.Vector3(DK.x - DK.w / 2, 0, DK.z - DK.d / 2), new THREE.Vector3(DK.x + DK.w / 2, DK.h + 0.05, DK.z + DK.d / 2))
  );

  /* ============================ STOOL ============================ */
  const stool = group('stool');
  const ST = { x: 1.68, z: 1.33, h: 0.45 };
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = mesh(taperedLeg(0.042, ST.h), m.woodLight, sx * 0.15, 0, sz * 0.14);
      leg.rotation.set(sz * 0.035, 0, -sx * 0.035);
      stool.add(leg);
    }
  }
  for (const sz of [-1, 1]) {
    const rail = mesh(new THREE.BoxGeometry(0.3, 0.018, 0.018), m.woodLight, 0, 0.14, sz * 0.14);
    stool.add(rail);
  }
  const seat = mesh(superBox(0.38, 0.075, 0.36, 0.34, 20, 12), m.woodLight, 0, ST.h + 0.02, 0);
  stool.add(seat);
  const cushion = mesh(superBox(0.33, 0.06, 0.3, 0.6, 20, 12), m.sheet, 0, ST.h + 0.08, 0);
  stool.add(cushion);
  // small back rest
  const back = group('back', 0, ST.h + 0.05, -0.17);
  back.rotation.x = -0.14;
  back.add(mesh(new THREE.BoxGeometry(0.32, 0.26, 0.03), m.woodLight, 0, 0.2, 0));
  back.add(mesh(superBox(0.29, 0.2, 0.05, 0.55, 18, 12), m.sheet, 0, 0.2, 0.03));
  stool.add(back);
  stool.position.set(ST.x, 0, ST.z);
  stool.rotation.y = Math.PI + 0.06;
  setShadow(stool, true, true);
  root.add(stool);
  ctx.colliders.push(new THREE.Box3(new THREE.Vector3(ST.x - 0.24, 0, ST.z - 0.24), new THREE.Vector3(ST.x + 0.24, 0.95, ST.z + 0.24)));

  /* ===================== CABLE + FLOOR CLUTTER ===================== */
  const cableCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(DK.x + DK.w / 2 - 0.2, DK.h - 0.09, DK.z + DK.d / 2 - 0.05),
    new THREE.Vector3(DK.x + DK.w / 2 - 0.06, DK.h - 0.3, 2.42),
    new THREE.Vector3(DK.x + DK.w / 2 + 0.02, 0.34, 2.44),
    new THREE.Vector3(DK.x + DK.w / 2 + 0.05, 0.05, 2.4),
    new THREE.Vector3(DK.x + DK.w / 2 + 0.02, 0.012, 2.1),
    new THREE.Vector3(DK.x + DK.w / 2 - 0.12, 0.008, 1.78),
  ]);
  const cable = mesh(new THREE.TubeGeometry(cableCurve, 60, 0.0075, 7, false), m.cableDark);
  cable.castShadow = true;
  root.add(cable);

  // two small books dropped near the desk
  const fb1 = mesh(new THREE.BoxGeometry(0.19, 0.028, 0.13), m.bookC, 1.05, 0.016, 1.62);
  fb1.rotation.y = 0.5;
  root.add(fb1);
  const fb2 = mesh(new THREE.BoxGeometry(0.17, 0.024, 0.12), m.bookB, 1.28, 0.014, 1.5);
  fb2.rotation.y = -0.25;
  root.add(fb2);

  /* ========================= labels ========================= */
  const pick = (obj, name, note, action = null) => {
    obj.userData.pick = { name, note, action };
    ctx.pickables.push(obj);
  };
  pick(bed, 'The bed', 'Made this morning. Barely.');
  pick(duvet, 'Striped duvet', 'Soft blue bands. Impossible to leave.');
  pick(p1, 'Floral pillow', 'Tiny flowers, huge responsibility.');
  pick(p2, 'Pink pillow', 'The pink one wins every argument.');
  pick(p3, 'Striped pillow', 'The little one in the middle.');
  pick(throwMesh, 'Mint throw', 'Folded at the foot, exactly at the right fluffiness.');
  pick(night, 'Nightstand', 'One drawer, one knob, one purpose.');
  pick(cactusGroup, 'Potted cactus', 'Prickly, but politely so.');
  pick(gift, 'Tiny gift box', 'Yellow with a pink ribbon. Contents: nothing. Value: high.');
  pick(plant, 'Snake plant', 'Nine leaves, no opinions.');
  pick(rug, 'Yellow rug', 'Warm underfoot, bright everywhere else.');
  pick(desk, 'The desk', 'Workspace, snack shelf, lamp parking.');
  pick(du, 'Drawer unit', 'Two drawers of pencils and secrets.');
  pick(bookG, 'Open book', 'Left open on purpose, mid-page.');
  pick(stack, 'Book stack', 'Three deep, alphabetically unbothered.');
  pick(cup, 'Pen cup', 'Four pencils and a sprig of ambition.');
  pick(lamp, 'Desk lamp', 'A pale gooseneck that likes being switched on.', 'lamp');
  pick(stool, 'Wooden stool', 'Tucked in, ready for a friendly sit.');
  pick(cable, 'The cable', 'It reaches. It never quite hides.');

  ctx.scene.add(root);
  return root;
}
