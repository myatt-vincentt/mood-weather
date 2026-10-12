// Face → weather — pure, unit-tested (mood.test.ts).
//
// Emotions come from the SDK's expression classifier (happy → sunny, sad →
// rain, surprise → lightning, angry → thunderstorm); never from blendshape
// guesses, per the SDK. Pouting and puffed cheeks are physical movements, read
// from the face action / blendshape, and take priority (you do them on purpose).
// A new mood must hold briefly before the weather turns, so a passing look
// doesn't flicker the sky.
import { MOOD, type WeatherName } from "./config";

export type MoodInput = {
  /** A face is in view. */
  face: boolean;
  /** Classifier result (null while loading or below its confidence floor). */
  expression: string | null;
  score: number;
  /** Pout: the SDK face action's value 0..1 (thresholds here, see MOOD.pout). */
  pout: number;
  /** cheekPuff blendshape 0..1. */
  cheekPuff: number;
};

export type Reading = { weather: WeatherName; strength: number };

const ramp = (v: number, { from, full }: { from: number; full: number }) =>
  Math.min(1, Math.max(0, (v - from) / (full - from)));

const withFloor = (s: number) => MOOD.floor + (1 - MOOD.floor) * s;

const EXPRESSION_WEATHER: Partial<Record<string, WeatherName>> = {
  happy: "sunny",
  sad: "rain",
  surprise: "lightning",
  angry: "storm",
};

/** What the face asks for right now. `current` gives pout / puff hysteresis. */
export const readMood = (input: MoodInput, current: WeatherName): Reading => {
  if (!input.face) return { weather: "calm", strength: 0 };
  const pouting =
    input.pout > (current === "hearts" ? MOOD.pout.exit : MOOD.pout.enter);
  if (pouting)
    return {
      weather: "hearts",
      strength: withFloor(ramp(input.pout, MOOD.pout)),
    };
  const puffing =
    input.cheekPuff > (current === "wind" ? MOOD.puff.exit : MOOD.puff.enter);
  if (puffing)
    return {
      weather: "wind",
      strength: withFloor(ramp(input.cheekPuff, MOOD.puff)),
    };
  const weather = input.expression
    ? EXPRESSION_WEATHER[input.expression]
    : undefined;
  if (weather)
    return { weather, strength: withFloor(ramp(input.score, MOOD.score)) };
  return { weather: "calm", strength: 0 };
};

/** A tapped chip: its weather, and seconds since the tap. */
export type Manual = { weather: WeatherName; age: number };

/**
 * A tapped chip (the fallback when the face isn't read well) holds its weather
 * at full strength. For the first `MOOD.tapLock` seconds nothing the face reads
 * can override it (a poorly read face often flickers stray expressions); after
 * that, the face showing a different weather takes over and clears the tap.
 * Calm or no face never clear it.
 */
export const applyManual = (
  manual: Manual | null,
  reading: Reading,
  dt: number,
): { reading: Reading; manual: Manual | null } => {
  if (!manual) return { reading, manual };
  // The same capped step as stepMood, so the lock and the mood's hold agree.
  const step = Math.max(0, Math.min(dt, 0.25));
  const next = { weather: manual.weather, age: manual.age + step };
  const differs =
    reading.weather !== "calm" && reading.weather !== manual.weather;
  if (differs && next.age >= MOOD.tapLock) return { reading, manual: null };
  return { reading: { weather: manual.weather, strength: 1 }, manual: next };
};

export type MoodState = {
  current: WeatherName;
  strength: number;
  /** The mood waiting to take over, and how long it has held. */
  candidate: WeatherName;
  held: number;
  /** Seconds since the weather last changed. */
  sinceChange: number;
};

export const createMood = (): MoodState => ({
  current: "calm",
  strength: 0,
  candidate: "calm",
  held: 0,
  sinceChange: Infinity,
});

/** Advance with this frame's reading (`tapped`: it comes from a chip). Mutates `m`. */
export const stepMood = (
  m: MoodState,
  reading: Reading,
  dt: number,
  tapped = false,
) => {
  const step = Math.max(0, Math.min(dt, 0.25));
  m.sinceChange += step;
  if (reading.weather !== m.candidate) {
    m.candidate = reading.weather;
    m.held = 0;
  } else {
    m.held += step;
  }
  let need = MOOD.hold;
  if (tapped) need = MOOD.holdTap;
  else if (m.candidate === "calm") need = MOOD.holdCalm;
  else if (m.candidate === "hearts") need = MOOD.holdLove;
  if (m.candidate !== m.current && m.held >= need) {
    m.current = m.candidate;
    m.sinceChange = 0;
  }
  // Strength follows the reading while it agrees with the weather on show.
  const target = reading.weather === m.current ? reading.strength : m.strength;
  m.strength +=
    (target - m.strength) * (1 - Math.exp(-MOOD.strengthRate * step));
};
