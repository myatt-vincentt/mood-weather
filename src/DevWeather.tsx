// DevWeather.tsx — dev-only: force each weather in a browser without a camera
// (no SDK sample pouts or puffs its cheeks).
//   1 calm  2 sunny  3 rain  4 lightning  5 storm  6 wind  7 hearts
//   0 back to reading the face          N  day ⇄ night (like a peace sign)
// Never reaches production: Scene.tsx lazy-imports this behind an inline
// `process.env.NODE_ENV` check, which esbuild folds.
import { useEffect } from "react";

import type { WeatherName } from "./weather/config";
import { toggleNight, weatherState } from "./weather/state";

const KEYS: Record<string, WeatherName | null> = {
  "0": null,
  "1": "calm",
  "2": "sunny",
  "3": "rain",
  "4": "lightning",
  "5": "storm",
  "6": "wind",
  "7": "hearts",
};

const DevWeather = () => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key in KEYS) weatherState.forced = KEYS[e.key];
      if (e.key === "n" || e.key === "N") toggleNight();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
};

export default DevWeather;
