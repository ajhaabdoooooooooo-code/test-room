import * as THREE from 'three';

/* ==================================================================== *
 *  POST PIPELINE
 *   pass 1  depth + view normals        → rtNormal (+ depthTexture)
 *   pass 2  beauty render              → rtScene (HDR)
 *   pass 3  bright pass                → half res
 *   pass 4  separable blur  (x2 mips)  → bloom + wide bloom
 *   pass 5  composite                  → screen
 *     · 2x2 supersampled down-sample (anti-aliasing)
 *     · cel shading: banded luminance + pastel shadow/highlight grade
 *     · outline: roberts cross on linear depth + normals
 *     · bloom, ACES tone map, vignette, grain, sRGB encode
 * ==================================================================== */

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const BRIGHT_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform float uThreshold;
  uniform float uKnee;
  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb;
    float l = max(c.r, max(c.g, c.b));
    float w = smoothstep(uThreshold, uThreshold + uKnee, l);
    gl_FragColor = vec4(c * w, 1.0);
  }
`;

const BLUR_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform vec2 uDir;
  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb * 0.227027;
    c += (texture2D(tDiffuse, vUv + uDir * 1.3846).rgb + texture2D(tDiffuse, vUv - uDir * 1.3846).rgb) * 0.3162162;
    c += (texture2D(tDiffuse, vUv + uDir * 3.2307).rgb + texture2D(tDiffuse, vUv - uDir * 3.2307).rgb) * 0.0702702;
    gl_FragColor = vec4(c, 1.0);
  }
`;

const COMPOSITE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D tDiffuse;
  uniform sampler2D tBloom;
  uniform sampler2D tWide;
  uniform sampler2D tNormal;
  uniform sampler2D tDepth;

  uniform vec2 uTexel;
  uniform float uNear;
  uniform float uFar;
  uniform float uTime;
  uniform float uSS;

  uniform float uToon;
  uniform float uBands;
  uniform float uSat;
  uniform float uExposure;
  uniform vec3 uShadowTint;
  uniform vec3 uHighTint;

  uniform float uEdge;
  uniform float uEdgeWidth;
  uniform float uEdgeThreshold;
  uniform vec3 uOutlineColor;

  uniform float uBloomStrength;
  uniform float uVignette;
  uniform float uGrain;
  uniform float uWarm;

  uniform float uAO;
  uniform float uAORadius;
  uniform float uAOFar;
  uniform float uTanHalfFov;
  uniform float uAspect;

  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

  float linDepth(float d) {
    float z = d * 2.0 - 1.0;
    return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
  }
  float depthAt(vec2 uv) { return linDepth(texture2D(tDepth, uv).r); }
  vec3 sceneAt(vec2 uv) { return texture2D(tDiffuse, uv).rgb; }

  vec3 sampleScene(vec2 uv) {
    if (uSS < 0.5) return sceneAt(uv);
    vec3 c = sceneAt(uv + uTexel * vec2(-0.25, -0.25));
    c += sceneAt(uv + uTexel * vec2(0.25, -0.25));
    c += sceneAt(uv + uTexel * vec2(-0.25, 0.25));
    c += sceneAt(uv + uTexel * vec2(0.25, 0.25));
    return c * 0.25;
  }
  vec3 sampleNormal(vec2 uv) {
    if (uSS < 0.5) return texture2D(tNormal, uv).xyz;
    vec3 c = texture2D(tNormal, uv + uTexel * vec2(-0.25, -0.25)).xyz;
    c += texture2D(tNormal, uv + uTexel * vec2(0.25, -0.25)).xyz;
    c += texture2D(tNormal, uv + uTexel * vec2(-0.25, 0.25)).xyz;
    c += texture2D(tNormal, uv + uTexel * vec2(0.25, 0.25)).xyz;
    return c * 0.25;
  }
  float sampleDepth(vec2 uv) {
    if (uSS < 0.5) return depthAt(uv);
    float d = depthAt(uv + uTexel * vec2(-0.25, -0.25));
    d += depthAt(uv + uTexel * vec2(0.25, -0.25));
    d += depthAt(uv + uTexel * vec2(-0.25, 0.25));
    d += depthAt(uv + uTexel * vec2(0.25, 0.25));
    return d * 0.25;
  }

  vec3 aces(vec3 x) {
    const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
  }
  vec3 toSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(0.41666)) - 0.055, step(vec3(0.0031308), c));
  }
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  vec3 viewPosFromDepth(vec2 uv, float viewZ) {
    vec2 ndc = uv * 2.0 - 1.0;
    return vec3(ndc.x * uAspect * uTanHalfFov * viewZ, ndc.y * uTanHalfFov * viewZ, -viewZ);
  }

  /* compact screen-space ambient occlusion — grounds every object */
  float computeAO(vec2 uv, float centerDepth, vec3 centerNormal) {
    if (centerDepth > uAOFar) return 1.0;
    float rnd = hash12(gl_FragCoord.xy);
    float radius = uAORadius * (1.0 + centerDepth * 0.05);
    float sx = 1.0 / (uAspect * uTanHalfFov * centerDepth * 2.0);
    float sy = 1.0 / (uTanHalfFov * centerDepth * 2.0);
    vec3 cp = viewPosFromDepth(uv, centerDepth);
    float occ = 0.0;
    for (int i = 0; i < 9; i++) {
      float fi = float(i);
      float a = (fi + rnd) * 0.6981317;
      vec2 dir = vec2(cos(a), sin(a));
      float r = radius * (0.3 + 0.7 * fract(rnd + fi * 0.618));
      vec2 suv = uv + vec2(dir.x * r * sx, dir.y * r * sy);
      float sd = sampleDepth(suv);
      if (sd <= 0.0 || sd > uAOFar) continue;
      vec3 sp = viewPosFromDepth(suv, sd);
      vec3 d = sp - cp;
      float len = length(d);
      if (len < 0.004) continue;
      float ndl = max(0.0, dot(centerNormal, d / len));
      occ += ndl / (1.0 + len * 3.0);
    }
    float ao = 1.0 - uAO * occ / 9.0;
    ao = pow(clamp(ao, 0.0, 1.0), 1.25);
    return ao;
  }

  void main() {
    vec2 uv = vUv;
    vec3 col = sampleScene(uv);
    float dC = sampleDepth(uv);

    /* ---------------- ambient occlusion ---------------- */
    if (uAO > 0.001) {
      vec3 nC = normalize(sampleNormal(uv) * 2.0 - 1.0);
      float ao = computeAO(uv, dC, nC);
      col *= mix(1.0, ao, 0.92);
    }

    /* ---------------- outline ---------------- */
    vec2 e = uTexel * uEdgeWidth;
    float d1 = depthAt(uv + vec2(e.x, e.y));
    float d2 = depthAt(uv - vec2(e.x, e.y));
    float d3 = depthAt(uv + vec2(-e.x, e.y));
    float d4 = depthAt(uv - vec2(-e.x, e.y));
    float depthEdge = max(abs(d1 - d2), abs(d3 - d4)) / max(dC, 0.3);

    vec3 n1 = texture2D(tNormal, uv + vec2(e.x, e.y)).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(tNormal, uv - vec2(e.x, e.y)).xyz * 2.0 - 1.0;
    vec3 n3 = texture2D(tNormal, uv + vec2(-e.x, e.y)).xyz * 2.0 - 1.0;
    vec3 n4 = texture2D(tNormal, uv - vec2(-e.x, e.y)).xyz * 2.0 - 1.0;
    float normalEdge = max(length(n1 - n2), length(n3 - n4));

    float edge = smoothstep(uEdgeThreshold, uEdgeThreshold * 2.4, depthEdge)
               + smoothstep(0.48, 0.95, normalEdge);
    edge = clamp(edge, 0.0, 1.0);
    // keep lines crisp in the near field, thinner with distance
    float distFade = clamp(1.0 - (dC - 1.0) / 14.0, 0.25, 1.0);
    edge *= distFade;

    /* ---------------- cel shading ---------------- */
    if (uToon > 0.001) {
      float l = dot(col, LUMA);
      float lR = dot(sceneAt(uv + vec2(uTexel.x, 0.0)), LUMA);
      float lU = dot(sceneAt(uv + vec2(0.0, uTexel.y)), LUMA);
      float w = max(abs(lR - l), abs(lU - l)) * 1.35 + 0.0016;

      float f = l * uBands;
      float q = (floor(f) + smoothstep(0.5 - w * uBands, 0.5 + w * uBands, fract(f))) / uBands;
      float k = q / max(l, 1e-4);
      col = mix(col, col * k, uToon);

      float t = smoothstep(0.015, 0.6, l);
      col *= mix(uShadowTint, uHighTint, t);
    }

    /* ---------------- bloom ---------------- */
    vec3 bloom = texture2D(tBloom, uv).rgb * 0.62 + texture2D(tWide, uv).rgb * 0.85;
    col += bloom * uBloomStrength;

    /* ---------------- grade ---------------- */
    float g = dot(col, LUMA);
    col = mix(vec3(g), col, uSat);
    col *= vec3(1.0 + uWarm * 0.05, 1.0, 1.0 - uWarm * 0.05);

    col *= uExposure;
    col = aces(col);

    vec2 q2 = uv - 0.5;
    col *= clamp(1.0 - dot(q2, q2) * uVignette, 0.0, 1.0);

    col = mix(col, uOutlineColor, edge * uEdge);

    col += (hash12(uv * 2048.0 + fract(uTime) * 91.0) - 0.5) * uGrain;

    gl_FragColor = vec4(toSRGB(col), 1.0);
  }
`;

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    this.pipelineEnabled = true;
    this.ss = 1.0;

    this.normalMaterial = new THREE.MeshNormalMaterial();

    // full-screen triangle
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new THREE.Mesh(geo, null);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCamera = new THREE.Camera();

    this.uniforms = {
      bright: {
        tDiffuse: { value: null },
        uThreshold: { value: 1.5 },
        uKnee: { value: 0.9 },
      },
      blur: {
        tDiffuse: { value: null },
        uDir: { value: new THREE.Vector2() },
      },
      composite: {
        tDiffuse: { value: null },
        tBloom: { value: null },
        tWide: { value: null },
        tNormal: { value: null },
        tDepth: { value: null },
        uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
        uNear: { value: 0.05 },
        uFar: { value: 60 },
        uTime: { value: 0 },
        uSS: { value: 1 },
        uToon: { value: 1 },
        uBands: { value: 3.7 },
        uSat: { value: 1.16 },
        uExposure: { value: 1.05 },
        uShadowTint: { value: new THREE.Color('#bcc4ea') },
        uHighTint: { value: new THREE.Color('#fff5e8') },
        uEdge: { value: 0.72 },
        uEdgeWidth: { value: 1.15 },
        uEdgeThreshold: { value: 0.026 },
        uOutlineColor: { value: new THREE.Color('#3b3446') },
        uBloomStrength: { value: 0.34 },
        uVignette: { value: 0.34 },
        uGrain: { value: 0.013 },
        uWarm: { value: 1 },
        uAO: { value: 1.35 },
        uAORadius: { value: 0.2 },
        uAOFar: { value: 18 },
        uTanHalfFov: { value: 0.6 },
        uAspect: { value: 1.78 },
      },
    };

    this.materials = {
      bright: new THREE.ShaderMaterial({
        uniforms: this.uniforms.bright,
        vertexShader: QUAD_VERT,
        fragmentShader: BRIGHT_FRAG,
        depthTest: false,
        depthWrite: false,
      }),
      blur: new THREE.ShaderMaterial({
        uniforms: this.uniforms.blur,
        vertexShader: QUAD_VERT,
        fragmentShader: BLUR_FRAG,
        depthTest: false,
        depthWrite: false,
      }),
      composite: new THREE.ShaderMaterial({
        uniforms: this.uniforms.composite,
        vertexShader: QUAD_VERT,
        fragmentShader: COMPOSITE_FRAG,
        depthTest: false,
        depthWrite: false,
      }),
    };

    this.targets = {};
    this.setSize(1, 1, 1);
  }

  setSize(width, height, dpr) {
    const w = Math.max(2, Math.floor(width * dpr));
    const h = Math.max(2, Math.floor(height * dpr));
    const iw = Math.max(2, Math.floor(w * this.ss));
    const ih = Math.max(2, Math.floor(h * this.ss));
    const rtOpts = { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: true };
    const blurOpts = { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: false };

    this.dispose();

    this.targets.scene = new THREE.WebGLRenderTarget(iw, ih, rtOpts);
    this.targets.normal = new THREE.WebGLRenderTarget(iw, ih, { ...rtOpts });
    const depth = new THREE.DepthTexture(iw, ih);
    depth.type = THREE.UnsignedIntType;
    depth.format = THREE.DepthFormat;
    depth.minFilter = THREE.NearestFilter;
    depth.magFilter = THREE.NearestFilter;
    this.targets.normal.depthTexture = depth;

    const hw = Math.max(2, Math.floor(iw / 2));
    const hh = Math.max(2, Math.floor(ih / 2));
    const qw = Math.max(2, Math.floor(iw / 4));
    const qh = Math.max(2, Math.floor(ih / 4));

    this.targets.bright = new THREE.WebGLRenderTarget(hw, hh, blurOpts);
    this.targets.tmp = new THREE.WebGLRenderTarget(hw, hh, blurOpts);
    this.targets.bloom = new THREE.WebGLRenderTarget(hw, hh, blurOpts);
    this.targets.wideA = new THREE.WebGLRenderTarget(qw, qh, blurOpts);
    this.targets.wideB = new THREE.WebGLRenderTarget(qw, qh, blurOpts);

    this.halfTexel = new THREE.Vector2(1 / hw, 1 / hh);
    this.quarterTexel = new THREE.Vector2(1 / qw, 1 / qh);
    this.internalW = iw;
    this.internalH = ih;
    this.uniforms.composite.uTexel.value.set(1 / iw, 1 / ih);
    this.uniforms.bright.tDiffuse.value = this.targets.scene.texture;
    this.uniforms.composite.tDiffuse.value = this.targets.scene.texture;
    this.uniforms.composite.tNormal.value = this.targets.normal.texture;
    this.uniforms.composite.tDepth.value = depth;
    this.uniforms.composite.tBloom.value = this.targets.bloom.texture;
    this.uniforms.composite.tWide.value = this.targets.wideA.texture;
    this.uniforms.composite.uSS.value = this.ss > 1.001 ? 1 : 0;
  }

  blit(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    if (!target) this.renderer.clear(true, true, false);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  render(dt, time) {
    const r = this.renderer;
    const { scene, camera } = this;

    if (!this.pipelineEnabled) {
      r.setRenderTarget(null);
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.render(scene, camera);
      return;
    }

    r.toneMapping = THREE.NoToneMapping;

    this.uniforms.composite.uNear.value = camera.near;
    this.uniforms.composite.uFar.value = camera.far;
    this.uniforms.composite.uTanHalfFov.value = Math.tan((camera.fov * Math.PI) / 360);
    this.uniforms.composite.uAspect.value = camera.aspect;

    /* ---- depth + normals (layer 0 only: leaves out sky, glass, shafts, dust) ---- */
    const prevOverride = scene.overrideMaterial;
    const prevBackground = scene.background;
    const prevMask = camera.layers.mask;
    const prevClearAlpha = r.getClearAlpha();
    const prevClearColor = new THREE.Color();
    r.getClearColor(prevClearColor);

    scene.overrideMaterial = this.normalMaterial;
    scene.background = null;
    camera.layers.set(0);
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.targets.normal);
    r.clear(true, true, false);
    r.render(scene, camera);

    /* ---- beauty ---- */
    scene.overrideMaterial = prevOverride;
    scene.background = prevBackground;
    camera.layers.mask = prevMask;
    r.setRenderTarget(this.targets.scene);
    r.clear(true, true, false);
    r.render(scene, camera);

    /* ---- bloom ---- */
    const u = this.uniforms;
    u.bright.tDiffuse.value = this.targets.scene.texture;
    this.blit(this.materials.bright, this.targets.bright);

    u.blur.tDiffuse.value = this.targets.bright.texture;
    u.blur.uDir.value.set(this.halfTexel.x * 1.0, 0);
    this.blit(this.materials.blur, this.targets.tmp);
    u.blur.tDiffuse.value = this.targets.tmp.texture;
    u.blur.uDir.value.set(0, this.halfTexel.y * 1.0);
    this.blit(this.materials.blur, this.targets.bloom);

    u.blur.tDiffuse.value = this.targets.bloom.texture;
    u.blur.uDir.value.set(this.quarterTexel.x * 1.4, 0);
    this.blit(this.materials.blur, this.targets.wideA);
    u.blur.tDiffuse.value = this.targets.wideA.texture;
    u.blur.uDir.value.set(0, this.quarterTexel.y * 1.4);
    this.blit(this.materials.blur, this.targets.wideB);
    u.composite.tWide.value = this.targets.wideB.texture;

    /* ---- composite ---- */
    u.composite.uTime.value = time;
    u.composite.tBloom.value = this.targets.bloom.texture;
    r.setClearColor(prevClearColor, prevClearAlpha);
    this.blit(this.materials.composite, null);
  }

  dispose() {
    for (const key of Object.keys(this.targets)) {
      const t = this.targets[key];
      if (t && t.dispose) t.dispose();
    }
    this.targets = {};
  }

  /* style presets ------------------------------------------------- */
  setStyle(style) {
    const u = this.uniforms.composite;
    this.pipelineEnabled = true;
    this.realistic = style === 'realistic';
    if (this.realistic) {
      // same pipeline, but no cel banding, no outline — plain PBR + AO
      u.uToon.value = 0;
      u.uSat.value = 1.02;
      u.uEdge.value = 0;
      u.uBloomStrength.value = 0.2;
      u.uVignette.value = 0.22;
      u.uGrain.value = 0.007;
      u.uAO.value = 1.5;
      u.uAORadius.value = 0.24;
    } else {
      u.uToon.value = 1;
      u.uBands.value = 3.7;
      u.uSat.value = 1.16;
      u.uEdge.value = 0.72;
      u.uShadowTint.value.set('#bcc4ea');
      u.uHighTint.value.set('#fff5e8');
      u.uBloomStrength.value = 0.34;
      u.uVignette.value = 0.34;
      u.uGrain.value = 0.013;
      u.uAO.value = 1.35;
      u.uAORadius.value = 0.2;
    }
  }
}
