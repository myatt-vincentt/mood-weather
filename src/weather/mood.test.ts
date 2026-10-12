import { describe, expect, it } from "vitest";

import { MOOD } from "./config";
import {
  applyManual,
  createMood,
  type MoodInput,
  readMood,
  stepMood,
} from "./mood";

const face = (over: Partial<MoodInput> = {}): MoodInput => ({
  face: true,
  expression: "neutral",
  score: 0.9,
  pout: 0,
  cheekPuff: 0,
  ...over,
});

const hold = (
  m: ReturnType<typeof createMood>,
  input: MoodInput,
  seconds: number,
) => {
  for (let t = 0; t < seconds; t += 1 / 30)
    stepMood(m, readMood(input, m.current), 1 / 30);
};

describe("readMood", () => {
  it("maps the classifier's emotions to weather", () => {
    expect(readMood(face({ expression: "happy" }), "calm").weather).toBe(
      "sunny",
    );
    expect(readMood(face({ expression: "sad" }), "calm").weather).toBe("rain");
    expect(readMood(face({ expression: "surprise" }), "calm").weather).toBe(
      "lightning",
    );
    expect(readMood(face({ expression: "angry" }), "calm").weather).toBe(
      "storm",
    );
    expect(readMood(face({ expression: "neutral" }), "calm").weather).toBe(
      "calm",
    );
    expect(readMood(face({ expression: null }), "calm").weather).toBe("calm");
  });

  it("puts a pout and puffed cheeks ahead of the classifier", () => {
    expect(
      readMood(face({ expression: "happy", pout: 0.9 }), "calm").weather,
    ).toBe("hearts");
    expect(
      readMood(face({ expression: "sad", cheekPuff: 0.6 }), "calm").weather,
    ).toBe("wind");
  });

  it("holds wind between the puff thresholds once it's blowing", () => {
    const mid = (MOOD.puff.enter + MOOD.puff.exit) / 2;
    expect(readMood(face({ cheekPuff: mid }), "calm").weather).toBe("calm");
    expect(readMood(face({ cheekPuff: mid }), "wind").weather).toBe("wind");
  });

  it("scales strength with the expression, never below the floor", () => {
    const weak = readMood(
      face({ expression: "happy", score: 0.4 }),
      "calm",
    ).strength;
    const strong = readMood(
      face({ expression: "happy", score: 0.99 }),
      "calm",
    ).strength;
    expect(weak).toBeCloseTo(MOOD.floor);
    expect(strong).toBeCloseTo(1);
  });

  it("goes calm without a face", () => {
    expect(
      readMood(face({ face: false, expression: "happy" }), "sunny"),
    ).toEqual({ weather: "calm", strength: 0 });
  });
});

describe("stepMood", () => {
  it("turns only after the mood holds, and calm takes longer", () => {
    const m = createMood();
    hold(m, face({ expression: "happy" }), MOOD.hold * 0.5);
    expect(m.current).toBe("calm");
    hold(m, face({ expression: "happy" }), MOOD.hold);
    expect(m.current).toBe("sunny");
    expect(m.strength).toBeGreaterThan(0.3);
    hold(m, face(), MOOD.hold * 1.5);
    expect(m.current).toBe("sunny"); // a neutral glance doesn't clear the sky
    hold(m, face(), MOOD.holdCalm);
    expect(m.current).toBe("calm");
  });

  it("ignores a flicker that doesn't hold", () => {
    const m = createMood();
    for (let i = 0; i < 20; i++) {
      hold(m, face({ expression: i % 2 ? "sad" : "happy" }), MOOD.hold * 0.6);
    }
    expect(m.current).toBe("calm");
  });
});

describe("applyManual (tapped chip)", () => {
  const calm = { weather: "calm" as const, strength: 0 };
  const sad = { weather: "rain" as const, strength: 0.8 };
  const tap = (weather: "wind" | "hearts", age = 0) => ({ weather, age });

  it("does nothing without a tap", () => {
    expect(applyManual(null, calm, 0.1)).toEqual({
      reading: calm,
      manual: null,
    });
  });

  it("holds the tapped weather at full strength while the face is calm or missing", () => {
    const r = applyManual(tap("wind"), calm, 0.1);
    expect(r.reading).toEqual({ weather: "wind", strength: 1 });
    expect(r.manual?.age).toBeCloseTo(0.1);
  });

  it("can't be overridden by the face during the lock", () => {
    const r = applyManual(tap("wind", MOOD.tapLock * 0.5), sad, 0.1);
    expect(r.reading.weather).toBe("wind");
    expect(r.manual).not.toBeNull();
  });

  it("after the lock, a different expression takes over and clears the tap", () => {
    expect(applyManual(tap("wind", MOOD.tapLock), sad, 0.1)).toEqual({
      reading: sad,
      manual: null,
    });
  });

  it("after the lock, calm still keeps the tap", () => {
    expect(
      applyManual(tap("wind", MOOD.tapLock * 3), calm, 0.1).reading.weather,
    ).toBe("wind");
  });

  it("turns the weather on almost at once (a tap is deliberate)", () => {
    const m = createMood();
    let manual: ReturnType<typeof tap> | null = tap("hearts");
    for (let t = 0; t < MOOD.holdTap + 0.05; t += 1 / 30) {
      const r = applyManual(manual, calm, 1 / 30);
      manual = r.manual as typeof manual;
      stepMood(m, r.reading, 1 / 30, true);
    }
    expect(m.current).toBe("hearts");
  });
});

describe("pout (Love) is strict", () => {
  it("ignores lips pursed in passing, and needs a longer hold", () => {
    expect(readMood(face({ pout: 0.75 }), "calm").weather).toBe("calm");
    expect(readMood(face({ pout: 0.9 }), "calm").weather).toBe("hearts");
    // Once on, it stays between the thresholds.
    expect(readMood(face({ pout: 0.7 }), "hearts").weather).toBe("hearts");
    const m = createMood();
    hold(m, face({ pout: 0.9 }), MOOD.hold + 0.05);
    expect(m.current).toBe("calm");
    hold(m, face({ pout: 0.9 }), MOOD.holdLove);
    expect(m.current).toBe("hearts");
  });
});
