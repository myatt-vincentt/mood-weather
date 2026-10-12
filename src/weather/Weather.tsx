// Mood Weather: your expression sets the sky behind you. The room is replaced
// by an animated sky (person segmentation), and the weather falls behind and in
// front of you:
//
//   renderOrder 0    sky        — gradient, clouds, sun, rainbow, lightning bolt
//   renderOrder 50   back       — rain / motes / leaves / hearts behind you
//   renderOrder 100  you        — the camera cut out by the person mask, tinted
//                                  to the weather and lit by lightning
//   renderOrder 150  front      — a share of the particles, bigger and faster
//
// Every layer draws straight to clip space, outside any ScreenTransform (its
// group carries renderOrder 1000 and three sorts by the group's order first).
// You are drawn by our own shader rather than PersonCutout so the weather's
// tint and the lightning flash can change every frame.
//
// The sky's look is a blend of presets (config.ts): calm → the current
// weather by its strength, eased so changes roll in rather than cut.
import { useEffect, useMemo, useRef } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  ShaderMaterial,
  SRGBColorSpace,
  type Texture,
} from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { usePersonMaskTexture } from "@vincentt-xr/sdk";
import { useXRCameraTexture } from "@vincentt-xr/sdk/low-level";

import {
  BLEND,
  FLASH,
  NIGHT,
  PARTICLES,
  PERSON,
  PRESETS,
  type ParticleKind,
  SUN,
  WET,
  WIND,
  type WeatherName,
} from "./config";
import { weatherState } from "./state";

const DESIGN_H = 1280;

const screenVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }
`;

const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
`;

const skyFrag = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uBottom;
  uniform vec3 uCloud;
  uniform float uCover;
  uniform float uDark;
  uniform float uOffset;
  uniform float uSun;
  uniform float uRainbow;
  uniform float uTime;
  uniform float uAspect;
  uniform float uFlash;
  uniform float uBolt;
  uniform float uBoltX;
  uniform float uBoltSeed;
  uniform float uNight;
  uniform float uSmile;
  uniform float uWet;
  uniform float uRain;
  varying vec2 vUv;
  ${NOISE}
  vec3 hue(float h) {
    return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  }
  void main() {
    vec2 p = vec2(vUv.x * uAspect, vUv.y);
    vec3 col = mix(uBottom, uTop, smoothstep(0.05, 1.0, vUv.y));
    // Night: the same weather, under a deep blue sky.
    vec3 nightSky = mix(vec3(0.02, 0.03, 0.09), vec3(0.005, 0.008, 0.035), vUv.y);
    col = mix(col, nightSky + col * 0.12, uNight);

    // Stars (night, where the sky is clear).
    vec2 sg = floor(p * 90.0);
    float star = step(0.985, hash(sg)) * (0.55 + 0.45 * sin(uTime * 2.0 + hash(sg + 3.1) * 40.0));
    vec2 sf = fract(p * 90.0) - 0.5;
    star *= smoothstep(0.18, 0.0, length(sf)) * smoothstep(0.2, 0.55, vUv.y);
    col += vec3(0.9, 0.93, 1.0) * star * uNight * (1.0 - uCover * 0.85);

    // Sun by day (with a face that smiles back), moon by night: top left.
    vec2 sp = vec2(0.24 * uAspect, 0.86);
    vec2 sd = p - sp;
    float d = length(sd);
    float day = 1.0 - uNight;
    float rays = pow(max(0.0, sin(atan(sd.y, sd.x) * 9.0 + uTime * (0.25 + uSmile * 0.6))), 6.0)
               * exp(-d * (3.8 - uSmile * 1.8));
    float disc = smoothstep(0.07, 0.055, d);
    vec2 l = sd / 0.07;
    // Face: two eyes and a mouth that curves up with the smile; rosy cheeks when beaming.
    float eyes = smoothstep(0.13, 0.07, length(vec2(abs(l.x) - 0.33, l.y - 0.18)));
    float bend = 0.5 + 1.6 * uSmile;
    float mouthY = -0.28 - 0.1 * uSmile + bend * (l.x * l.x - 0.12);
    float mouth = smoothstep(0.075, 0.03, abs(l.y - mouthY)) * step(abs(l.x), 0.42 + 0.12 * uSmile);
    float cheeks = smoothstep(0.17, 0.0, length(vec2(abs(l.x) - 0.52, l.y + 0.12))) * uSmile;
    vec3 sunCol = vec3(1.0, 0.92, 0.68) * (disc * 1.4 + exp(-d * 6.0) * 0.55 + rays * (0.3 + 0.5 * uSmile));
    sunCol = mix(sunCol, vec3(1.0, 0.55, 0.45), cheeks * disc * 0.6);
    col += sunCol * uSun * day;
    // The face is painted over (not added onto the sky, which would tint it
    // blue), in a warm brown.
    col = mix(col, vec3(0.42, 0.2, 0.05), max(eyes, mouth) * disc * uSun * day);
    float crater = noise(l * 3.0 + 7.0) * 0.25;
    col += vec3(0.86, 0.9, 1.0) * (disc * (1.1 - crater) + exp(-d * 9.0) * 0.25) * uNight * (1.0 - uCover * 0.8);

    // Rainbow: an arc low on the right.
    float r = length(p - vec2(0.7 * uAspect, 0.1));
    float band = (r - 0.48) / 0.14;
    float arc = smoothstep(0.0, 0.12, band) * smoothstep(1.0, 0.88, band);
    col = mix(col, hue(0.83 * (1.0 - clamp(band, 0.0, 1.0))), arc * uRainbow * day * 0.42 * smoothstep(0.12, 0.4, vUv.y));

    // Clouds: two drifting layers; heavier cover fills the sky, dark bellies for rain.
    vec2 q = p * vec2(1.4, 2.6) + vec2(uOffset, 0.0);
    float n = fbm(q) * 0.65 + fbm(q * 2.1 + vec2(uOffset * 0.6, 3.1)) * 0.35;
    float coverAt = uCover * (0.55 + 0.45 * smoothstep(0.1, 0.75, vUv.y));
    float c = smoothstep(1.0 - coverAt - 0.08, 1.0 - coverAt + 0.22, n);
    vec3 cc = mix(uCloud, uCloud * 0.42, uDark * smoothstep(0.45, 0.85, n));
    cc = mix(cc, cc * vec3(0.12, 0.14, 0.24), uNight);
    col = mix(col, cc, c * 0.95);

    // Puddles: wet patches along the ground mirror the sky; drops ripple them.
    float ground = smoothstep(0.17, 0.11, vUv.y);
    if (ground > 0.0 && uWet > 0.0) {
      float blob = fbm(vec2(p.x * 2.6, vUv.y * 9.0) + 11.0);
      float puddle = smoothstep(0.62 - 0.42 * uWet, 0.66 - 0.42 * uWet, blob) * ground;
      vec3 refl = mix(uBottom, uTop, 0.35 + (0.17 - vUv.y) * 2.0);
      refl = mix(refl, nightSky, uNight) * 0.75;
      vec2 cell = vec2(p.x * 9.0, vUv.y * 40.0);
      vec2 ci = floor(cell);
      float phase = fract(uTime * 0.9 + hash(ci) * 7.0);
      vec2 cf = (fract(cell) - 0.5) * vec2(1.0, 2.2);
      float ring = smoothstep(0.06, 0.0, abs(length(cf) - phase * 0.48)) * (1.0 - phase) * step(0.55, hash(ci + 5.0));
      col = mix(col, refl + ring * 0.25 * uRain, puddle * uWet);
    }

    // Lightning: a jagged bolt from the top, and the whole sky flashing.
    if (uBolt > 0.0) {
      float y = vUv.y;
      float bx = uBoltX + (noise(vec2(y * 7.0, uBoltSeed)) - 0.5) * 0.12
                        + (noise(vec2(y * 31.0, uBoltSeed + 9.0)) - 0.5) * 0.03;
      float bd = abs(vUv.x - bx) * uAspect;
      float reach = smoothstep(0.32, 0.45, y);
      col += vec3(0.85, 0.9, 1.0) * (exp(-bd * 260.0) * 1.5 + exp(-bd * 28.0) * 0.35) * uBolt * reach;
    }
    col += vec3(0.7, 0.76, 1.0) * uFlash * (0.6 + 0.4 * uNight);

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * You: the camera cut out by the person mask, tinted, lifted by a flash. The
 * mask is eroded (the minimum over a small ring) so the room's colour at the
 * soft edge doesn't show as a fringe against the sky.
 */
const personFrag = /* glsl */ `
  uniform sampler2D uCamera;
  uniform sampler2D uMask;
  uniform float uCameraLinear;
  uniform float uHasMask;
  uniform vec3 uTint;
  uniform float uFlash;
  uniform vec2 uEdge;
  uniform vec2 uErode;
  uniform float uSway;
  uniform float uTime;
  varying vec2 vUv;
  vec3 fromSrgb(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }
  void main() {
    if (uHasMask < 0.5) discard;
    // Wind tugs at you: a gusty sway, more toward the top (feet stay put).
    float gust = sin(uTime * 1.7 + vUv.y * 2.0) + 0.5 * sin(uTime * 3.9 + 1.3);
    vec2 uv = vUv - vec2(uSway * gust * smoothstep(0.0, 1.0, vUv.y), 0.0);
    float m = texture2D(uMask, uv).g;
    if (m <= uEdge.x) discard;
    for (int j = 0; j < 6; j++) {
      float ang = float(j) * 1.0471976;
      m = min(m, texture2D(uMask, uv + vec2(cos(ang), sin(ang)) * uErode).g);
    }
    float a = smoothstep(uEdge.x, uEdge.y, m);
    if (a <= 0.0) discard;
    vec3 c = texture2D(uCamera, uv).rgb;
    if (uCameraLinear < 0.5) c = fromSrgb(c);
    // At the soft edge, pull a green / coloured cast toward neutral (a green or
    // bright wall spilling onto hair and shoulders).
    float edge = 1.0 - smoothstep(uEdge.y, 1.0, m);
    c.g = mix(c.g, min(c.g, max(c.r, c.b)), edge);
    c = c * uTint + vec3(0.8, 0.85, 1.0) * uFlash;
    gl_FragColor = vec4(c, a);
    #include <colorspace_fragment>
  }
`;

/** Particles in design px, straight to clip space. */
const particleVert = /* glsl */ `
  attribute vec3 color;
  attribute float size;
  attribute float alpha;
  attribute float kind;
  attribute float angle;
  uniform vec2 uDesign;
  uniform float uPxScale;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vKind;
  varying float vAngle;
  void main() {
    vColor = color;
    vAlpha = alpha;
    vKind = kind;
    vAngle = angle;
    gl_PointSize = size * uPxScale;
    gl_Position = vec4(position.x / uDesign.x * 2.0 - 1.0, 1.0 - position.y / uDesign.y * 2.0, 0.0, 1.0);
  }
`;
const particleFrag = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vKind;
  varying float vAngle;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    p.y = -p.y;
    float cs = cos(vAngle), sn = sin(vAngle);
    p = vec2(cs * p.x - sn * p.y, sn * p.x + cs * p.y);
    float a = 0.0;
    vec3 col = vColor;
    if (vKind < 0.5) {
      // Rain: a thin streak, brighter at the leading end.
      a = smoothstep(0.035, 0.0, abs(p.x)) * smoothstep(0.5, 0.2, abs(p.y)) * (0.45 + 0.55 * (0.5 - p.y));
    } else if (vKind < 1.5) {
      // Mote: a soft glowing dot.
      a = smoothstep(0.5, 0.0, length(p));
      a *= a;
    } else if (vKind < 2.5) {
      // Leaf: a pointed ellipse with a midrib.
      float e = length(vec2(p.x * 2.2, p.y));
      a = smoothstep(0.42, 0.36, e + abs(p.y) * 0.25);
      col *= 1.0 - 0.35 * smoothstep(0.03, 0.0, abs(p.x));
    } else if (vKind > 3.5 && vKind < 4.5) {
      // Splash: a flat ring spreading where a drop lands.
      float d = length(vec2(p.x, p.y * 2.8));
      a = smoothstep(0.07, 0.0, abs(d - 0.38)) + smoothstep(0.08, 0.0, length(vec2(p.x * 3.0, p.y + 0.1))) * 0.6;
    } else if (vKind > 4.5) {
      // Streak: a thin wisp of wind.
      a = smoothstep(0.022, 0.0, abs(p.y + sin(p.x * 6.0) * 0.02)) * smoothstep(0.5, 0.05, abs(p.x));
    } else {
      // Heart.
      vec2 h = p * 2.6;
      h.y -= 0.25 - abs(h.x) * 0.55;
      float d = length(h) - 0.6;
      a = smoothstep(0.05, -0.05, d);
      col = mix(col, vec3(1.0), smoothstep(-0.25, -0.6, d) * 0.35);
    }
    a *= vAlpha;
    if (a <= 0.002) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

const KIND_INDEX: Record<ParticleKind, number> = {
  rain: 0,
  mote: 1,
  leaf: 2,
  heart: 3,
  splash: 4,
  streak: 5,
  none: -1,
};
const LEAF_COLORS = ["#d9a441", "#e07a3a", "#b8c44a", "#c8553d"];
const HEART_COLORS = ["#ff3d7f", "#ff6fa5", "#ff9ec4", "#e8325f"];

type Pool = ReturnType<typeof makePool>;

const makePool = (n: number) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(n * 3), 3),
  );
  geometry.setAttribute(
    "color",
    new BufferAttribute(new Float32Array(n * 3), 3),
  );
  geometry.setAttribute("size", new BufferAttribute(new Float32Array(n), 1));
  geometry.setAttribute("alpha", new BufferAttribute(new Float32Array(n), 1));
  geometry.setAttribute("kind", new BufferAttribute(new Float32Array(n), 1));
  geometry.setAttribute("angle", new BufferAttribute(new Float32Array(n), 1));
  const material = new ShaderMaterial({
    uniforms: {
      uDesign: { value: [DESIGN_H, DESIGN_H] },
      uPxScale: { value: 1 },
    },
    vertexShader: particleVert,
    fragmentShader: particleFrag,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: NormalBlending,
  });
  return {
    n,
    geometry,
    material,
    vel: new Float32Array(n * 2),
    life: new Float32Array(n),
    maxLife: new Float32Array(n),
    spin: new Float32Array(n),
    sway: new Float32Array(n),
    /** Where a raindrop lands (design px from the top; Infinity: never). */
    ground: new Float32Array(n).fill(Infinity),
    base: new Float32Array(n),
    next: 0,
  };
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(list: readonly T[]) =>
  list[Math.floor(Math.random() * list.length)];

/** Spawn one particle of `kind` into `pool`; `front` ones are bigger and faster. */
const spawn = (
  pool: Pool,
  kind: ParticleKind,
  w: number,
  fall: number,
  drift: number,
  front: boolean,
  color: Color,
  night = false,
) => {
  const i = pool.next;
  pool.next = (i + 1) % pool.n;
  const g = pool.geometry;
  const pos = g.getAttribute("position") as BufferAttribute;
  const col = g.getAttribute("color") as BufferAttribute;
  const size = g.getAttribute("size") as BufferAttribute;
  const k = g.getAttribute("kind") as BufferAttribute;
  const near = front ? 1.6 : rand(0.6, 1.1);
  let x = rand(-0.1, 1.1) * w;
  let y = -40;
  let vx = drift * near;
  let vy = fall * near * rand(0.85, 1.15);
  let life = (DESIGN_H + 120) / Math.max(40, vy);
  if (kind === "mote") {
    x = rand(0, w);
    y = rand(0, DESIGN_H);
    vx = drift * rand(0.5, 1.5);
    vy = fall * rand(0.5, 1.5);
    life = rand(2.5, 4.5);
  } else if (kind === "leaf") {
    x = -40;
    y = rand(-0.05, 0.95) * DESIGN_H;
    vx = drift * near * rand(0.8, 1.25);
    vy = fall * rand(-0.5, 1.2);
    life = (w + 120) / Math.max(40, vx);
  } else if (kind === "streak") {
    x = -120;
    y = rand(0.04, 0.8) * DESIGN_H;
    vx = drift * rand(1.3, 1.8);
    vy = rand(-25, 25);
    life = (w + 260) / Math.max(40, vx);
  } else if (kind === "rain") {
    // Start upwind so slanted rain still covers the screen.
    x -= (drift / Math.max(1, fall)) * DESIGN_H * 0.5;
  }
  pos.setXYZ(i, x, y, 0);
  pool.vel[i * 2] = vx;
  pool.vel[i * 2 + 1] = vy;
  pool.life[i] = life;
  pool.maxLife[i] = life;
  pool.spin[i] = kind === "rain" || kind === "streak" ? 0 : rand(-2.5, 2.5);
  // Raindrops behind you land on the ground (and may splash); the ones in front
  // fall past the lens, so they never splash on you.
  pool.ground[i] =
    kind === "rain" && !front
      ? rand(WET.ground[0], WET.ground[1]) * DESIGN_H
      : Infinity;
  pool.sway[i] = rand(0, Math.PI * 2);
  const base = PARTICLES.size[kind as Exclude<ParticleKind, "none">] ?? 10;
  pool.base[i] = base * near * rand(0.75, 1.25);
  size.setX(i, pool.base[i]);
  k.setX(i, KIND_INDEX[kind]);
  if (kind === "leaf") color.set(pick(LEAF_COLORS));
  else if (kind === "heart") color.set(pick(HEART_COLORS));
  else if (kind === "mote") color.set(night ? "#d9ff7a" : "#fff1c2");
  else if (kind === "streak") color.set("#ffffff");
  else color.set("#dfe9ff");
  col.setXYZ(i, color.r, color.g, color.b);
  // Colour, size and kind change only here, so they upload only on a spawn.
  col.needsUpdate = true;
  size.needsUpdate = true;
  k.needsUpdate = true;
};

/** A splash ring at (x, y): grows and fades over WET.splashLife. */
const spawnSplash = (pool: Pool, x: number, y: number, scale: number) => {
  const i = pool.next;
  pool.next = (i + 1) % pool.n;
  const g = pool.geometry;
  (g.getAttribute("position") as BufferAttribute).setXYZ(i, x, y, 0);
  (g.getAttribute("color") as BufferAttribute).setXYZ(i, 0.85, 0.9, 1);
  (g.getAttribute("kind") as BufferAttribute).setX(i, KIND_INDEX.splash);
  (g.getAttribute("angle") as BufferAttribute).setX(i, 0);
  pool.vel[i * 2] = 0;
  pool.vel[i * 2 + 1] = 0;
  pool.life[i] = WET.splashLife;
  pool.maxLife[i] = WET.splashLife;
  pool.spin[i] = 0;
  pool.ground[i] = Infinity;
  pool.base[i] = PARTICLES.size.splash * scale * rand(0.8, 1.2);
  for (const name of ["color", "kind"]) g.getAttribute(name).needsUpdate = true;
};

/** Move and fade every live particle in `pool`. */
const stepPool = (pool: Pool, dt: number, t: number) => {
  const g = pool.geometry;
  const pos = g.getAttribute("position") as BufferAttribute;
  const alpha = g.getAttribute("alpha") as BufferAttribute;
  const angle = g.getAttribute("angle") as BufferAttribute;
  const kind = g.getAttribute("kind") as BufferAttribute;
  const size = g.getAttribute("size") as BufferAttribute;
  let sized = false;
  for (let i = 0; i < pool.n; i++) {
    if (pool.life[i] <= 0) {
      alpha.setX(i, 0);
      continue;
    }
    pool.life[i] -= dt;
    const k = kind.getX(i);
    const vx = pool.vel[i * 2];
    const vy = pool.vel[i * 2 + 1];
    // Hearts and leaves sway as they go.
    const sway = k >= 2 ? Math.sin(t * 2.2 + pool.sway[i]) * 60 : 0;
    const y = pos.getY(i) + vy * dt;
    pos.setXYZ(i, pos.getX(i) + (vx + sway) * dt, y, 0);
    // A raindrop reaching its ground ends; some splash.
    if (y >= pool.ground[i]) {
      pool.life[i] = 0;
      alpha.setX(i, 0);
      if (Math.random() < WET.splash)
        spawnSplash(
          pool,
          pos.getX(i),
          pool.ground[i],
          pool.base[i] / PARTICLES.size.rain,
        );
      continue;
    }
    if (k > 3.5 && k < 4.5) {
      const age = 1 - pool.life[i] / pool.maxLife[i];
      size.setX(i, pool.base[i] * (0.35 + 0.9 * age));
      alpha.setX(i, 0.75 * (1 - age));
      sized = true;
      continue;
    }
    if (k < 0.5) angle.setX(i, Math.atan2(vx, vy));
    else if (k > 4.5) angle.setX(i, 0);
    else angle.setX(i, angle.getX(i) + pool.spin[i] * dt);
    const age = 1 - pool.life[i] / pool.maxLife[i];
    const pulse = (k > 0.5 && k < 1.5) || k > 4.5;
    const fade = pulse ? Math.sin(Math.PI * age) : Math.min(1, age * 8);
    let strength = 0.95;
    if (k < 0.5) strength = 0.75;
    else if (k > 4.5) strength = 0.45;
    alpha.setX(i, strength * fade);
  }
  pos.needsUpdate = true;
  alpha.needsUpdate = true;
  angle.needsUpdate = true;
  if (sized) size.needsUpdate = true;
};

const samplesLinear = (tex: Texture | null | undefined) =>
  !!tex && tex.colorSpace === SRGBColorSpace;

/** Preset colours parsed once (hex → linear Color). */
const PRESET_COLORS = Object.fromEntries(
  (Object.keys(PRESETS) as WeatherName[]).map((n) => [
    n,
    {
      top: new Color(PRESETS[n].top),
      bottom: new Color(PRESETS[n].bottom),
      cloud: new Color(PRESETS[n].cloud),
      tint: new Color(PRESETS[n].tint),
    },
  ]),
) as Record<WeatherName, Record<"top" | "bottom" | "cloud" | "tint", Color>>;

type Look = ReturnType<typeof createLook>;
const createLook = () => ({
  top: new Color(),
  bottom: new Color(),
  cloud: new Color(),
  tint: new Color(),
  cover: 0,
  dark: 0,
  speed: 0,
  sun: 0,
  rainbow: 0,
});

/** The blended look into `out`: calm → the current weather by its strength. */
const blendTarget = (out: Look, name: WeatherName, strength: number) => {
  const { calm } = PRESETS;
  const w = PRESETS[name];
  const s = name === "calm" ? 0 : strength;
  const mix = (a: number, b: number) => a + (b - a) * s;
  const c0 = PRESET_COLORS.calm;
  const c1 = PRESET_COLORS[name];
  out.top.copy(c0.top).lerp(c1.top, s);
  out.bottom.copy(c0.bottom).lerp(c1.bottom, s);
  out.cloud.copy(c0.cloud).lerp(c1.cloud, s);
  out.tint.copy(c0.tint).lerp(c1.tint, s);
  out.cover = mix(calm.cover, w.cover);
  out.dark = mix(calm.dark, w.dark);
  out.speed = mix(calm.speed, w.speed);
  out.sun = mix(calm.sun, w.sun);
  out.rainbow = mix(calm.rainbow, w.rainbow);
  return out;
};

export const Weather = () => {
  const { gl, size } = useThree();
  const cameraTexture = useXRCameraTexture();
  const { texture: maskTexture, status } = usePersonMaskTexture();

  const sky = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uTop: { value: new Color(PRESETS.calm.top) },
          uBottom: { value: new Color(PRESETS.calm.bottom) },
          uCloud: { value: new Color(PRESETS.calm.cloud) },
          uCover: { value: PRESETS.calm.cover },
          uDark: { value: 0 },
          uOffset: { value: 0 },
          uSun: { value: PRESETS.calm.sun },
          uRainbow: { value: 0 },
          uTime: { value: 0 },
          uAspect: { value: 1 },
          uFlash: { value: 0 },
          uBolt: { value: 0 },
          uBoltX: { value: 0.5 },
          uBoltSeed: { value: 0 },
          uNight: { value: 0 },
          uSmile: { value: SUN.calmSmile },
          uWet: { value: 0 },
          uRain: { value: 0 },
        },
        vertexShader: screenVert,
        fragmentShader: skyFrag,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );
  const person = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uCamera: { value: null },
          uMask: { value: null },
          uCameraLinear: { value: 0 },
          uHasMask: { value: 0 },
          uTint: { value: new Color("#ffffff") },
          uFlash: { value: 0 },
          uEdge: { value: [...PERSON.edge] },
          uErode: { value: [0, 0] },
          uSway: { value: 0 },
          uTime: { value: 0 },
        },
        vertexShader: screenVert,
        fragmentShader: personFrag,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );
  const back = useMemo(() => makePool(PARTICLES.max), []);
  const front = useMemo(() => makePool(Math.round(PARTICLES.max * 0.35)), []);
  const scratch = useMemo(() => new Color(), []);
  const look = useMemo(createLook, []);
  const live = useRef({
    cover: PRESETS.calm.cover,
    dark: 0,
    speed: PRESETS.calm.speed,
    sun: PRESETS.calm.sun,
    rainbow: 0,
    offset: 0,
    night: 0,
    smile: SUN.calmSmile,
    sway: 0,
    rain: 0,
  });
  const nightTint = useMemo(() => new Color(NIGHT.tint), []);
  const tint = useMemo(() => new Color(), []);
  const extraDebt = useRef(0);
  const debt = useRef(0);
  const lightning = useRef({ next: 1, second: -1, bolt: 0 });
  /** Dev: jump the eased look straight to its target on the next frame. */
  const snap = useRef(false);

  useEffect(
    () => () => {
      sky.dispose();
      person.dispose();
      for (const p of [back, front]) {
        p.geometry.dispose();
        p.material.dispose();
      }
    },
    [sky, person, back, front],
  );

  // Dev hook for inspecting the weather live.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __weather?: unknown }).__weather = {
        state: weatherState,
        live: live.current,
        snap: () => {
          snap.current = true;
        },
        gl,
        materials: { sky, person, back: back.material, front: front.material },
      };
    }
  }, [gl, sky, person, back, front]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const t = state.clock.elapsedTime;
    const { mood } = weatherState;
    const preset = PRESETS[mood.current];
    const strength = mood.current === "calm" ? 0 : mood.strength;
    const target = blendTarget(look, mood.current, mood.strength);
    const snapNow = snap.current;
    snap.current = false;
    const k = snapNow ? 1 : 1 - Math.exp(-BLEND.rate * dt);
    const aspect = size.width / Math.max(1, size.height);
    const designW = DESIGN_H * aspect;

    // Sky: ease toward the blended look.
    const u = sky.uniforms;
    (u.uTop.value as Color).lerp(target.top, k);
    (u.uBottom.value as Color).lerp(target.bottom, k);
    (u.uCloud.value as Color).lerp(target.cloud, k);
    const l = live.current;
    l.cover += (target.cover - l.cover) * k;
    l.dark += (target.dark - l.dark) * k;
    l.speed += (target.speed - l.speed) * k;
    l.sun += (target.sun - l.sun) * k;
    l.rainbow += (target.rainbow - l.rainbow) * k;
    l.offset += l.speed * dt;
    u.uCover.value = l.cover;
    u.uDark.value = l.dark;
    u.uOffset.value = l.offset;
    u.uSun.value = l.sun;
    u.uRainbow.value = l.rainbow;
    u.uTime.value = t;
    u.uAspect.value = aspect;

    // Night (peace sign): eased in and out.
    weatherState.sinceNight += dt;
    const nk = snapNow ? 1 : 1 - Math.exp(-NIGHT.rate * dt);
    l.night += ((weatherState.night ? 1 : 0) - l.night) * nk;
    u.uNight.value = l.night;

    // The sun smiles back: as wide as your smile when sunny, a little when calm.
    let smile = 0;
    if (mood.current === "sunny") smile = mood.strength;
    else if (mood.current === "calm") smile = SUN.calmSmile;
    l.smile += (smile - l.smile) * k;
    u.uSmile.value = l.smile;

    // Puddles: grow while it rains, dry in the sun (fast) or slowly otherwise.
    const raining = preset.particle === "rain" ? strength : 0;
    if (raining > 0)
      weatherState.wet = Math.min(
        1,
        weatherState.wet + WET.rise * raining * dt,
      );
    else
      weatherState.wet = Math.max(
        0,
        weatherState.wet -
          (mood.current === "sunny" ? WET.drySun : WET.dry) * dt,
      );
    l.rain += (raining - l.rain) * k;
    u.uWet.value = weatherState.wet;
    u.uRain.value = l.rain;

    // Lightning: random flashes (a bright one, then a weaker flicker).
    const lt = lightning.current;
    if (preset.lightning > 0 && strength > 0) {
      lt.next -= dt;
      if (lt.next <= 0) {
        weatherState.flash = FLASH.sky;
        lt.bolt = 1;
        lt.second = 0.12;
        u.uBoltX.value = 0.15 + Math.random() * 0.7;
        u.uBoltSeed.value = Math.random() * 100;
        const mean = preset.lightning / strength;
        lt.next = mean * (0.4 + Math.random() * 1.2);
      }
    } else {
      lt.next = 0.6;
    }
    if (lt.second >= 0) {
      lt.second -= dt;
      if (lt.second < 0) weatherState.flash = Math.max(weatherState.flash, 0.6);
    }
    weatherState.flash *= Math.exp(-FLASH.decay * dt);
    lt.bolt *= Math.exp(-5 * dt);
    u.uFlash.value = weatherState.flash;
    u.uBolt.value = lt.bolt;

    // You: tinted to the weather, lifted by a flash.
    const p = person.uniforms;
    p.uCamera.value = cameraTexture;
    p.uMask.value = maskTexture;
    p.uCameraLinear.value = samplesLinear(cameraTexture) ? 1 : 0;
    p.uHasMask.value =
      cameraTexture && maskTexture && status === "ready" ? 1 : 0;
    // At night, cooler and dimmer: the weather's tint × (white → night tint).
    tint.setRGB(1, 1, 1).lerp(nightTint, l.night).multiply(target.tint);
    (p.uTint.value as Color).lerp(tint, k);
    // Wind tugs at you.
    const windy = mood.current === "wind" ? strength : 0;
    l.sway += (windy * WIND.sway - l.sway) * k;
    p.uSway.value = l.sway;
    p.uTime.value = t;
    p.uFlash.value = weatherState.flash * FLASH.person;
    const erode = PERSON.erode / DESIGN_H;
    p.uErode.value = [erode / aspect, erode];

    // Particles: this weather's kind, at a rate scaled by strength.
    const pxScale = (size.height * gl.getPixelRatio()) / DESIGN_H;
    for (const pool of [back, front]) {
      pool.material.uniforms.uDesign.value = [designW, DESIGN_H];
      pool.material.uniforms.uPxScale.value = pxScale;
    }
    if (preset.particle !== "none" && strength > 0) {
      debt.current += dt * preset.rate * strength;
      while (debt.current >= 1) {
        debt.current -= 1;
        const inFront = Math.random() < preset.front;
        spawn(
          inFront ? front : back,
          preset.particle,
          designW,
          preset.fall,
          preset.drift,
          inFront,
          scratch,
          weatherState.night,
        );
      }
    } else {
      debt.current = 0;
    }
    // Extras: wind streaks flying past in front; fireflies on a clear night.
    let extraRate = 0;
    let extra: ParticleKind = "none";
    if (mood.current === "wind") {
      extra = "streak";
      extraRate = WIND.streaks * strength;
    } else if (
      l.night > 0.6 &&
      (mood.current === "calm" || mood.current === "sunny")
    ) {
      extra = "mote";
      extraRate = NIGHT.fireflies;
    }
    if (extra !== "none") {
      extraDebt.current += dt * extraRate;
      while (extraDebt.current >= 1) {
        extraDebt.current -= 1;
        const inFront = extra === "streak" || Math.random() < 0.3;
        spawn(
          inFront ? front : back,
          extra,
          designW,
          extra === "streak" ? 0 : -14,
          extra === "streak" ? PRESETS.wind.drift : 10,
          inFront,
          scratch,
          weatherState.night,
        );
      }
    } else {
      extraDebt.current = 0;
    }
    stepPool(back, dt, t);
    stepPool(front, dt, t);
  }, -0.5);

  return (
    <>
      <mesh name="sky" material={sky} renderOrder={0} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <points
        name="weatherBack"
        geometry={back.geometry}
        material={back.material}
        renderOrder={50}
        frustumCulled={false}
      />
      <mesh
        name="you"
        material={person}
        renderOrder={100}
        frustumCulled={false}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>
      <points
        name="weatherFront"
        geometry={front.geometry}
        material={front.material}
        renderOrder={150}
        frustumCulled={false}
      />
    </>
  );
};
