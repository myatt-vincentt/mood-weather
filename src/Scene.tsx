// Scene.tsx — Mood Weather: your expression sets the sky behind you — smile for
// sun and rainbows, frown for rain, surprise for lightning, angry for a
// thunderstorm, puffed cheeks for wind, a pout for falling hearts; a peace sign
// flips day and night. See PLAN.md.
import { lazy, Suspense } from "react";

import { DayNight } from "./weather/DayNight";
import { ExperienceStatus } from "./weather/ExperienceStatus";
import { FaceReader } from "./weather/FaceReader";
import { Prompt } from "./weather/Prompt";
import { Weather } from "./weather/Weather";

// Dev-only tools (media switcher; weather keys) for previewing without a
// camera. Lazy and behind a constant esbuild folds to false in production. Two
// rules: `process.env.NODE_ENV`, not `import.meta.env.DEV`
// (vincentt-xr/v2-template#112); and write the check INSIDE each ternary —
// hoisted into a `const`, esbuild keeps the dead branch.
const DevMediaSwitcher =
  process.env.NODE_ENV !== "production"
    ? lazy(() => import("./DevMediaSwitcher"))
    : null;
const DevWeather =
  process.env.NODE_ENV !== "production"
    ? lazy(() => import("./DevWeather"))
    : null;

export const Scene = () => (
  <>
    <ExperienceStatus />
    <FaceReader />
    <DayNight />
    <Weather />
    <Prompt />
    {DevMediaSwitcher ? (
      <Suspense fallback={null}>
        <DevMediaSwitcher />
      </Suspense>
    ) : null}
    {DevWeather ? (
      <Suspense fallback={null}>
        <DevWeather />
      </Suspense>
    ) : null}
  </>
);
