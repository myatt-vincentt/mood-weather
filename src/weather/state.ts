// Shared live state: the face reader writes it, the sky, particles and prompt
// read it. Plain mutable fields, read every frame (no React state).
import type { WeatherName } from "./config";
import { createMood, type Manual } from "./mood";

export const weatherState = {
  mood: createMood(),
  /** A face is in view; the expression classifier's lifecycle. */
  face: false,
  classifier: "idle" as "idle" | "loading" | "ready" | "error",
  /** This frame's face readings (for tuning and the dev hook). */
  signals: { pout: 0, puff: 0, expression: "", score: 0 },
  /** A tapped chip's weather (null = read the face); see applyManual. */
  manual: null as Manual | null,
  /** Dev-only: force a weather (null = read the face). */
  forced: null as WeatherName | null,
  /** Lightning flash brightness 0..1 (for the sky and you). */
  flash: 0,
  /** Night (toggled by a peace sign), and seconds since it last flipped. */
  night: false,
  sinceNight: Infinity,
  /** How wet the ground is 0..1: puddles grow in rain, dry in sun. */
  wet: 0,
};

/** Tap a chip: that weather on; the same chip again: back to the face. */
export const tapWeather = (weather: WeatherName) => {
  weatherState.manual =
    weatherState.manual?.weather === weather ? null : { weather, age: 0 };
};

/** Flip day ⇄ night. */
export const toggleNight = () => {
  weatherState.night = !weatherState.night;
  weatherState.sinceNight = 0;
};
