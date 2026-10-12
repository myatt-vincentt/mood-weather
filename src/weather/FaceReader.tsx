// Reads the face each frame and steers the weather (mood.ts decides). A tapped
// chip (the fallback when the face isn't read well) holds until the face shows
// a different weather.
// Emotions come from the SDK's expression classifier; pout from the SDK face
// action's value (with stricter thresholds); puffed cheeks from the cheekPuff
// blendshape (physical movements).
import { useFrame } from "@react-three/fiber";
import {
  getFaceActionValue,
  useFaceAttributeExpression,
  useFaceInfo,
} from "@vincentt-xr/sdk/tracking";

import { MOOD } from "./config";
import { applyManual, readMood, stepMood } from "./mood";
import { weatherState } from "./state";

export const FaceReader = () => {
  const face = useFaceInfo({ active: true });
  const expression = useFaceAttributeExpression(face, {
    targetFps: MOOD.fps,
    minConfidence: MOOD.minConfidence,
  });

  useFrame((_s, dt) => {
    const s = weatherState;
    s.face = !!face;
    s.classifier = expression.status;
    const result = expression.status === "ready" ? expression.result : null;
    const poutValue = face ? getFaceActionValue(face, "mouthPout") : 0;
    const puffValue = face?.blendshapes.cheekPuff ?? 0;
    s.signals.pout = poutValue;
    s.signals.puff = puffValue;
    s.signals.expression = result ? result.expression : "";
    s.signals.score = result ? result.confidence : 0;
    const fromFace = readMood(
      {
        face: !!face,
        expression: result ? result.expression : null,
        score: result ? result.confidence : 0,
        pout: poutValue,
        cheekPuff: puffValue,
      },
      s.mood.current,
    );
    const manual = applyManual(s.manual, fromFace, dt);
    s.manual = manual.manual;
    const reading = s.forced
      ? { weather: s.forced, strength: 1 }
      : manual.reading;
    stepMood(s.mood, reading, dt, !s.forced && s.manual !== null);
  });

  return null;
};
