// Tuning for Mood Weather.

export type WeatherName =
  | "calm"
  | "sunny"
  | "rain"
  | "lightning"
  | "storm"
  | "wind"
  | "hearts";

export type ParticleKind =
  | "none"
  | "rain"
  | "mote"
  | "leaf"
  | "heart"
  | "splash"
  | "streak";

export type Preset = {
  /** Label shown when the weather arrives. */
  label: string;
  /** Sky gradient (top, horizon) and the clouds' colour. */
  top: string;
  bottom: string;
  cloud: string;
  /** Cloud cover 0..1, darkness 0..1 (rain-heavy bellies) and drift speed. */
  cover: number;
  dark: number;
  speed: number;
  /** Sun and rainbow strength 0..1. */
  sun: number;
  rainbow: number;
  /** Particles: kind, per second at full strength, and the share passing in front of you. */
  particle: ParticleKind;
  rate: number;
  front: number;
  /** Particle fall (design px / s) and sideways drift (design px / s, + right). */
  fall: number;
  drift: number;
  /** Lightning: mean seconds between flashes at full strength (0 = none). */
  lightning: number;
  /** How you're lit: multiplies the camera in linear colour, so keep it near
   *  white (a hex that looks gentle darkens a lot). */
  tint: string;
};

export const PRESETS: Record<WeatherName, Preset> = {
  calm: {
    label: "⛅ Calm",
    top: "#5d9ce6",
    bottom: "#c3e2ff",
    cloud: "#ffffff",
    cover: 0.38,
    dark: 0,
    speed: 0.02,
    sun: 0.35,
    rainbow: 0,
    particle: "none",
    rate: 0,
    front: 0,
    fall: 0,
    drift: 0,
    lightning: 0,
    tint: "#ffffff",
  },
  sunny: {
    label: "☀️ Sunny",
    top: "#2a83f0",
    bottom: "#a6dcff",
    cloud: "#ffffff",
    cover: 0.14,
    dark: 0,
    speed: 0.015,
    sun: 1,
    rainbow: 1,
    particle: "mote",
    rate: 14,
    front: 0.3,
    fall: -18,
    drift: 12,
    lightning: 0,
    tint: "#fff6e6",
  },
  rain: {
    label: "🌧️ Rainy",
    top: "#46515f",
    bottom: "#8f99a6",
    cloud: "#6a7380",
    cover: 0.92,
    dark: 0.45,
    speed: 0.04,
    sun: 0,
    rainbow: 0,
    particle: "rain",
    rate: 300,
    front: 0.18,
    fall: 1500,
    drift: -120,
    lightning: 0,
    tint: "#e6ecf5",
  },
  lightning: {
    label: "⚡ Lightning",
    top: "#1b2140",
    bottom: "#4a4f70",
    cloud: "#383d58",
    cover: 0.86,
    dark: 0.6,
    speed: 0.05,
    sun: 0,
    rainbow: 0,
    particle: "rain",
    rate: 90,
    front: 0.15,
    fall: 1500,
    drift: -80,
    lightning: 1.1,
    tint: "#e0e3f2",
  },
  storm: {
    label: "⛈️ Thunderstorm",
    top: "#101219",
    bottom: "#2e313c",
    cloud: "#252932",
    cover: 1,
    dark: 0.8,
    speed: 0.1,
    sun: 0,
    rainbow: 0,
    particle: "rain",
    rate: 560,
    front: 0.22,
    fall: 1900,
    drift: -420,
    lightning: 2.4,
    tint: "#d6dbe6",
  },
  wind: {
    label: "💨 Windy",
    top: "#62a0d6",
    bottom: "#d5e8f3",
    cloud: "#f1f5f9",
    cover: 0.55,
    dark: 0.05,
    speed: 0.45,
    sun: 0.25,
    rainbow: 0,
    particle: "leaf",
    rate: 34,
    front: 0.3,
    fall: 120,
    drift: 900,
    lightning: 0,
    tint: "#f6f8fa",
  },
  hearts: {
    label: "💕 Love",
    top: "#ff95c8",
    bottom: "#ffe1ef",
    cloud: "#fff2f8",
    cover: 0.42,
    dark: 0,
    speed: 0.02,
    sun: 0.2,
    rainbow: 0,
    particle: "heart",
    rate: 22,
    front: 0.25,
    fall: 150,
    drift: 0,
    lightning: 0,
    tint: "#ffedf4",
  },
};

/** Reading the face. Strength ramps from `from` to `full` of each signal. */
export const MOOD = {
  /** Classifier: frames per second and its own confidence floor. */
  fps: 6,
  minConfidence: 0.45,
  /** Classifier score → strength. */
  score: { from: 0.45, full: 0.95 },
  /**
   * Pout (mouthPucker via the SDK face action value). Stricter than the SDK's
   * default 0.5: lips purse on their own while talking (on the "Person Looking"
   * sample the value reached 0.75 a tenth of the time), which made Love win all
   * the time. Enter / leave thresholds, then strength.
   */
  pout: { enter: 0.82, exit: 0.65, from: 0.8, full: 0.95 },
  /** Puffed cheeks (cheekPuff blendshape): enter / leave thresholds, then strength. */
  puff: { enter: 0.35, exit: 0.25, from: 0.3, full: 0.75 },
  /** Weakest strength once a weather is on, so it's always visible. */
  floor: 0.35,
  /** A new mood must hold this long (s) before the weather turns; calm takes longer. */
  hold: 0.45,
  holdCalm: 1.4,
  /** Love needs a longer hold, so a passing lip shape doesn't trigger it. */
  holdLove: 0.8,
  /** A tapped chip is deliberate: it turns the weather almost at once. */
  holdTap: 0.15,
  /** Strength easing (1/s). */
  strengthRate: 2.5,
  /** A tapped chip can't be overridden by the face for this long (s). */
  tapLock: 6,
};

/** Sky and lighting changes ease at this rate (1/s). */
export const BLEND = { rate: 1.4 };

/** Particles (design px of the 1280-tall screen). */
export const PARTICLES = {
  max: 900,
  size: { rain: 26, mote: 7, leaf: 22, heart: 30, splash: 30, streak: 90 },
};

/** Puddles and splashes. */
export const WET = {
  /** Raindrops land between these heights (share of the screen, from the top). */
  ground: [0.86, 1.0] as const,
  /** Share of landing drops that splash, and a splash's life (s). */
  splash: 0.4,
  splashLife: 0.35,
  /** Wetness per second while raining (× strength), drying in sun, drying otherwise. */
  rise: 0.06,
  drySun: 0.14,
  dry: 0.012,
};

/** Wind tugging at you, and streaks flying past in front. */
export const WIND = {
  /** Sway (share of the screen width) at full wind, more at the top. */
  sway: 0.012,
  /** Streaks per second at full wind. */
  streaks: 26,
};

/** The sun's face: smile from the happy strength; calm gets a small smile. */
export const SUN = { calmSmile: 0.25 };

/** Night (peace sign): blend speed (1/s), how you're lit, fireflies per second. */
export const NIGHT = {
  rate: 0.9,
  tint: "#c3cde6",
  fireflies: 12,
  /** Peace sign hold and the gap before the next flip (ms). */
  holdMs: 250,
  cooldownMs: 1000,
};

/** A flash: peak brightness of sky and you, and how fast it fades (1/s). */
export const FLASH = { sky: 1, person: 0.4, decay: 7 };

/** Person cut-out: mask values from `edge[0]` (out) to `edge[1]` (in), and an
 *  erosion (design px) that trims the room's colour off the soft edge. */
export const PERSON = { edge: [0.35, 0.75] as const, erode: 3 };
