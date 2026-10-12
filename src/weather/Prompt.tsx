// The instructions: the player has to know their FACE is the controller.
//
//   intro card  — over the chest, when a face first appears: "Your face
//                 controls the weather / Make a face and hold it — or tap one";
//                 it leaves once a weather has turned (or after a while)
//   chips       — along the bottom while the camera runs, one per expression
//                 (😊 Sun … 😗 Love): the weather on show is lit, the one your
//                 face is building toward half-lit. Tapping one is the fallback
//                 when the face isn't read well (tap again to hand back)
//   line        — above the chips: "Hold it…" while an expression builds, the
//                 weather's name as it turns, "🌙 Night" / "☀️ Day" after a
//                 peace sign, otherwise a hint cycling through the expressions
//                 and the peace sign; "Look at the camera" without a face
//
// React state changes only when what's shown changes (the frame loop compares).
import { Fragment, useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { ScreenSpaceUI, ScreenText } from "@vincentt-xr/sdk";
import { useXRReady } from "@vincentt-xr/sdk/low-level";

import { MOOD, PRESETS, type WeatherName } from "./config";
import { tapWeather, weatherState } from "./state";

/** No face for this long → "Look at the camera". */
const NO_FACE_AFTER = 1.5;
/** The weather's name shows this long after it turns (s). */
const LABEL_FOR = 2.2;
/** The intro card leaves after this long in view, or once a weather has turned. */
const INTRO_MAX = 8;
/** A building expression counts (and says "Hold it…") after this long (s). */
const BUILDING_AFTER = 0.08;
/** Hints, one every HINT_EVERY seconds while the sky is calm. */
const HINT_EVERY = 2.8;
/** "🌙 Night" / "☀️ Day" shows this long after a flip (s). */
const NIGHT_LABEL = 1.6;

const CHIPS: {
  weather: WeatherName;
  face: string;
  label: string;
  hint: string;
}[] = [
  { weather: "sunny", face: "😊", label: "Sun", hint: "Smile for sunshine" },
  { weather: "rain", face: "☹️", label: "Rain", hint: "Frown for rain" },
  {
    weather: "lightning",
    face: "😮",
    label: "Bolt",
    hint: "Look surprised for lightning",
  },
  {
    weather: "storm",
    face: "😠",
    label: "Storm",
    hint: "Look angry for a thunderstorm",
  },
  {
    weather: "wind",
    face: "🐡",
    label: "Wind",
    hint: "Puff your cheeks for wind",
  },
  {
    weather: "hearts",
    face: "😗",
    label: "Love",
    hint: "Pout for falling hearts",
  },
];

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const CHIP_W = 108;
const CHIP_GAP = 8;
const CHIP_H = 104;
const CHIP_Y = -560;
/** The design screen the chips are laid out on (centre origin, y up). */
const DESIGN = { w: 720, h: 1280 };
const ROW_W = CHIPS.length * CHIP_W + (CHIPS.length - 1) * CHIP_GAP;
const chipX = (i: number) => -ROW_W / 2 + CHIP_W / 2 + i * (CHIP_W + CHIP_GAP);
/** Taps on these are left to the control under the finger. */
const TAP_IGNORE =
  'button, a, input, select, textarea, label, [role="button"], [role="menu"], [role="dialog"]';
const SHADOW = { shadowColor: "rgba(0,0,0,0.55)", shadowBlur: 10 };

type View = {
  line: string;
  intro: boolean;
  chips: boolean;
  active: WeatherName;
  building: WeatherName | null;
};

const sameView = (a: View, b: View) =>
  a.line === b.line &&
  a.intro === b.intro &&
  a.chips === b.chips &&
  a.active === b.active &&
  a.building === b.building;

/**
 * Tapping a chip is the fallback when the face isn't read well (see
 * applyManual). Taps are read on R3F's event source (the canvas wrapper):
 * design px map across the viewport on both axes, centre origin, y up.
 */
const useChipTaps = (enabled: boolean) => {
  const source = useThree((st) => st.events.connected) as
    | HTMLElement
    | undefined;
  useEffect(() => {
    const el = source;
    if (!el || !enabled) return undefined;
    const onDown = (e: PointerEvent) => {
      if (!e.isPrimary || e.button > 0) return;
      if ((e.target as Element | null)?.closest?.(TAP_IGNORE)) return;
      const r = el.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width - 0.5) * DESIGN.w;
      const y = (0.5 - (e.clientY - r.top) / r.height) * DESIGN.h;
      const i = CHIPS.findIndex(
        (_c, n) =>
          Math.abs(x - chipX(n)) <= CHIP_W / 2 &&
          Math.abs(y - CHIP_Y) <= CHIP_H / 2,
      );
      if (i >= 0) tapWeather(CHIPS[i].weather);
    };
    el.addEventListener("pointerdown", onDown);
    return () => el.removeEventListener("pointerdown", onDown);
  }, [source, enabled]);
};

export const Prompt = () => {
  const cameraReady = useXRReady();
  const [view, setView] = useState<View>({
    line: "",
    intro: false,
    chips: false,
    active: "calm",
    building: null,
  });
  useChipTaps(view.chips);
  const noFace = useRef(0);
  const inView = useRef(0);
  const calmFor = useRef(0);
  const introDone = useRef(false);

  useFrame((_s, dt) => {
    const s = weatherState;
    const { mood } = s;
    noFace.current = s.face ? 0 : noFace.current + dt;
    if (s.face) inView.current += dt;
    calmFor.current = mood.current === "calm" ? calmFor.current + dt : 0;
    if (mood.current !== "calm" || inView.current > INTRO_MAX)
      introDone.current = true;

    const building =
      s.face &&
      mood.candidate !== mood.current &&
      mood.candidate !== "calm" &&
      mood.held > BUILDING_AFTER
        ? mood.candidate
        : null;
    const need = MOOD.hold;
    let line = "";
    if (cameraReady && noFace.current > NO_FACE_AFTER)
      line = "Look at the camera";
    else if (!s.face) line = "";
    else if (s.classifier === "loading") line = "Reading the sky…";
    else if (building) {
      const chip = CHIPS.find((c) => c.weather === building);
      line = `${chip?.face ?? ""} Hold it${mood.held > need * 0.5 ? "…" : ""}`;
    } else if (mood.sinceChange < LABEL_FOR && mood.current !== "calm")
      line = PRESETS[mood.current].label;
    else if (s.sinceNight < NIGHT_LABEL) line = s.night ? "🌙 Night" : "☀️ Day";
    else if (mood.current === "calm" && introDone.current) {
      // The six faces, then the peace sign.
      const n = Math.floor(calmFor.current / HINT_EVERY) % (CHIPS.length + 1);
      line =
        n < CHIPS.length
          ? `Try: ${CHIPS[n].face} ${CHIPS[n].hint}`
          : `Try: ✌️ Peace sign for ${s.night ? "day" : "night"}`;
    }

    const next: View = {
      line,
      intro: s.face && !introDone.current,
      // Shown whenever the camera runs: tapping them works without a face.
      chips: cameraReady,
      active: mood.current,
      building,
    };
    if (!sameView(next, view)) setView(next);
  });

  return (
    <ScreenSpaceUI>
      {view.intro ? (
        <>
          <ScreenText
            name="weatherIntroTitle"
            text="Your face controls the weather"
            screenTransform={{
              position: { x: 0, y: -250 },
              size: { width: 660, height: 120 },
              renderOrder: 210,
              overlay: true,
            }}
            textAlign="center"
            verticalAlign="center"
            fontFamily={FONT}
            fontWeight={800}
            fontSize={52}
            resolution={150}
            color="#ffffff"
            bgColor="transparent"
            strokeColor="rgba(10,20,40,0.35)"
            strokeWidth={3}
            shadowColor="rgba(0,0,0,0.6)"
            shadowBlur={18}
          />
          <ScreenText
            name="weatherIntroSub"
            text="Make a face and hold it — or tap one ↓"
            screenTransform={{
              position: { x: 0, y: -350 },
              size: { width: 680, height: 60 },
              renderOrder: 210,
              overlay: true,
            }}
            textAlign="center"
            verticalAlign="center"
            fontFamily={FONT}
            fontWeight={600}
            fontSize={30}
            resolution={150}
            color="rgba(255,255,255,0.95)"
            bgColor="transparent"
            {...SHADOW}
          />
        </>
      ) : null}
      {view.line ? (
        <ScreenText
          name="weatherPrompt"
          text={view.line}
          screenTransform={{
            position: { x: 0, y: -462 },
            size: { width: 680, height: 64 },
            renderOrder: 200,
            overlay: true,
          }}
          textAlign="center"
          verticalAlign="center"
          fontFamily={FONT}
          fontWeight={700}
          fontSize={30}
          resolution={150}
          letterSpacing={0.03}
          color="#ffffff"
          bgColor="transparent"
          {...SHADOW}
        />
      ) : null}
      {view.chips
        ? CHIPS.map((c, i) => {
            const on = view.active === c.weather;
            const half = view.building === c.weather;
            let bg = "rgba(10,20,40,0.42)";
            if (on) bg = "rgba(255,255,255,0.92)";
            else if (half) bg = "rgba(255,255,255,0.5)";
            const x = chipX(i);
            return (
              <Fragment key={c.weather}>
                {/* The chip: its label at the bottom, the panel lit when active. */}
                <ScreenText
                  name={`weatherChip-${c.weather}`}
                  text={c.label}
                  screenTransform={{
                    position: { x, y: CHIP_Y },
                    size: { width: CHIP_W, height: CHIP_H },
                    renderOrder: 200,
                    overlay: true,
                  }}
                  textAlign="center"
                  verticalAlign="bottom"
                  fontFamily={FONT}
                  fontWeight={700}
                  fontSize={21}
                  resolution={150}
                  color={on || half ? "#14223a" : "#ffffff"}
                  bgColor={bg}
                  borderRadius={22}
                  padding={10}
                />
                {/* The expression, big, above the label. */}
                <ScreenText
                  name={`weatherChipFace-${c.weather}`}
                  text={c.face}
                  screenTransform={{
                    position: { x, y: CHIP_Y + 14 },
                    size: { width: CHIP_W, height: 60 },
                    renderOrder: 201,
                    overlay: true,
                  }}
                  textAlign="center"
                  verticalAlign="center"
                  fontFamily={FONT}
                  fontSize={44}
                  resolution={150}
                  color="#ffffff"
                  bgColor="transparent"
                />
              </Fragment>
            );
          })
        : null}
    </ScreenSpaceUI>
  );
};
