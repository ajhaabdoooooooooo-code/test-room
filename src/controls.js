import * as THREE from 'three';
import { clamp, damp } from './utils.js';

/* ==================================================================== *
 *  FIRST PERSON CONTROLLER
 *  pointer-lock look, WASD walk/run, crouch, head bob, footstep events
 *  and circle-vs-AABB sliding collision against the furniture.
 * ==================================================================== */
export class FirstPersonControls {
  constructor(camera, domElement, { colliders = [], onStep = null, onFoot = null } = {}) {
    this.camera = camera;
    this.dom = domElement;
    this.colliders = colliders;
    this.onStep = onStep;

    this.enabled = true;
    this.locked = false;

    this.position = new THREE.Vector3(-0.35, 0, -1.72); // feet position
    this.eyeHeight = 1.66;
    this.standHeight = 1.66;
    this.crouchHeight = 1.06;
    this.radius = 0.32;

    this.yaw = Math.PI + 0.16;
    this.pitch = -0.03;
    this.velocity = new THREE.Vector3();

    this.walkSpeed = 2.05;
    this.runSpeed = 3.85;
    this.crouchSpeed = 1.15;

    this.keys = Object.create(null);
    this.running = false;
    this.crouching = false;

    this.bobTime = 0;
    this.stepPhase = 0;
    this.roll = 0;
    this.sway = 0;
    this.dtSmooth = 1 / 60;

    this._bind();
  }

  _bind() {
    const onKey = (e, down) => {
      if (!this.enabled) return;
      this.keys[e.code] = down;
      if (down && (e.code === 'ShiftLeft' || e.code === 'ShiftRight')) this.running = true;
      if (!down && (e.code === 'ShiftLeft' || e.code === 'ShiftRight')) this.running = false;
      if (down && (e.code === 'KeyC' || e.code === 'ControlLeft')) this.crouching = !this.crouching;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)) e.preventDefault();
    };
    this._onKeyDown = (e) => onKey(e, true);
    this._onKeyUp = (e) => onKey(e, false);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);

    this._onMouseMove = (e) => {
      if (!this.locked || !this.enabled) return;
      const s = 0.0021;
      this.yaw -= e.movementX * s;
      this.pitch -= e.movementY * s;
      this.pitch = clamp(this.pitch, -1.45, 1.45);
    };
    document.addEventListener('mousemove', this._onMouseMove);

    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.dom;
      if (this.onLockChange) this.onLockChange(this.locked);
    };
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  requestLock() {
    if (this.dom.requestPointerLock) this.dom.requestPointerLock();
  }

  release() {
    if (document.exitPointerLock) document.exitPointerLock();
  }

  /* -------------------------------------------------------------- */
  _resolve(pos) {
    const r = this.radius;
    const feet = pos.y;
    const head = pos.y + this.eyeHeight;
    for (let i = 0; i < this.colliders.length; i++) {
      const b = this.colliders[i];
      if (b.max.y < 0.12) continue;          // rugs / floor plates
      if (b.min.y > head - 0.22) continue;   // anything above the head
      const cx = clamp(pos.x, b.min.x, b.max.x);
      const cz = clamp(pos.z, b.min.z, b.max.z);
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > r * r) continue;
      if (d2 > 1e-7) {
        const d = Math.sqrt(d2);
        const push = (r - d) / d;
        pos.x += dx * push;
        pos.z += dz * push;
      } else {
        const p1 = pos.x - b.min.x;
        const p2 = b.max.x - pos.x;
        const p3 = pos.z - b.min.z;
        const p4 = b.max.z - pos.z;
        const m = Math.min(p1, p2, p3, p4);
        if (m === p1) pos.x = b.min.x - r;
        else if (m === p2) pos.x = b.max.x + r;
        else if (m === p3) pos.z = b.min.z - r;
        else pos.z = b.max.z + r;
      }
    }
  }

  update(dtRaw) {
    const dt = Math.min(dtRaw, 0.06);
    this.dtSmooth = this.dtSmooth * 0.9 + dt * 0.1;

    const k = this.keys;
    const fwd = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
    const str = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let wx = -sin * fwd + cos * str;
    let wz = -cos * fwd - sin * str;
    const len = Math.hypot(wx, wz);
    if (len > 1e-4) {
      wx /= len;
      wz /= len;
    }

    const moving = len > 1e-4;
    const speed = this.running && !this.crouching ? this.runSpeed : this.crouching ? this.crouchSpeed : this.walkSpeed;

    const targetVX = wx * speed;
    const targetVZ = wz * speed;
    const accel = moving ? 12 : 14;
    this.velocity.x = damp(this.velocity.x, targetVX, accel, dt);
    this.velocity.z = damp(this.velocity.z, targetVZ, accel, dt);

    const p = this.position;
    p.x += this.velocity.x * dt;
    p.z += this.velocity.z * dt;
    this._resolve(p);

    /* crouch + bob */
    this.eyeHeight = damp(this.eyeHeight, this.crouching ? this.crouchHeight : this.standHeight, 9, dt);
    const vlen = Math.hypot(this.velocity.x, this.velocity.z);
    const norm = clamp(vlen / this.runSpeed, 0, 1);
    this.bobTime += dt * (5.4 + norm * 6.4) * (moving ? 1 : 0.25);
    const bobAmp = norm * 0.026;
    const bobY = Math.sin(this.bobTime * 2) * bobAmp;
    const bobX = Math.sin(this.bobTime) * bobAmp * 0.9;
    this.roll = damp(this.roll, clamp(-str * 0.022 - this.velocity.x * 0.0, -0.05, 0.05), 6, dt);
    this.sway = damp(this.sway, clamp(fwd * norm * 0.012, -0.02, 0.02), 5, dt);

    /* footsteps */
    if (moving) {
      const stride = this.running ? 1.55 : 1.9;
      this.stepPhase += (vlen * dt) / 0.72;
      if (this.stepPhase >= 1) {
        this.stepPhase -= 1;
        if (this.onStep) this.onStep(this.running, this.crouching);
      }
    } else {
      this.stepPhase = 0.5;
    }

    /* camera */
    const cam = this.camera;
    const rightX = cos;
    const rightZ = -sin;
    cam.position.set(
      p.x + rightX * bobX,
      p.y + this.eyeHeight + bobY + this.sway,
      p.z + rightZ * bobX
    );
    cam.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
  }

  /** unit forward vector (world space) */
  forward(out = new THREE.Vector3()) {
    out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    return out;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }
}
