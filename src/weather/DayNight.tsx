// A peace sign ✌️ flips day ⇄ night (SDK gesture engine, one shared hand model).
// `onBegin` fires once per sign, so holding it doesn't keep flipping.
import { useGesture } from "@vincentt-xr/sdk/tracking";

import { NIGHT } from "./config";
import { toggleNight } from "./state";

export const DayNight = () => {
  useGesture("peaceSign", {
    holdMs: NIGHT.holdMs,
    cooldownMs: NIGHT.cooldownMs,
    onBegin: toggleNight,
  });
  return null;
};
