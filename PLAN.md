# Plan — Mood Weather

The user's request (2026-10-12), from my suggestion list: your expression controls the sky behind
you — smile → sun and rainbows, frown → rain, surprise → lightning, puffed cheeks → wind, pout →
falling hearts — using face expressions and person segmentation. There is no Brief.md and no
preview video.

## Decisions (the user's answers)

- **Background:** an **animated sky** (procedural) replaces the room.
- **Depth:** weather falls **behind and in front** of you; lightning lights you up.
- **Neutral:** a **calm**, partly cloudy sky.
- **Extras:** **strength follows the expression**, **angry → thunderstorm**, **weather lights
  you** (a tint), and a **weather name label**.
- **Round 1 (picked from my suggestions):** **puddles and splashes**, **wind tugs at you** (sway +
  streaks), a **sun that smiles back**, and **day ⇄ night by peace sign** (the user's own twist on
  my "day to night" idea). The intro title lost its background panel (the user didn't like it).
- **Preview:** the SDK's samples (starts on "Person Looking"); dev-only keys force each weather.

## Composition

| renderOrder | Layer | What                                                                    |
| ----------- | ----- | ----------------------------------------------------------------------- |
| 0           | sky   | gradient, two cloud layers, sun + rays, rainbow, lightning bolt, flash  |
| 50          | back  | particles behind you                                                    |
| 100         | you   | camera × person mask (eroded edge), tinted to the weather, flash-lifted |
| 150         | front | a share of the particles, bigger and faster (closer)                    |

All layers draw straight to clip space, outside any `ScreenTransform` (its group renderOrder 1000
would sort first). You are drawn by our own shader instead of `PersonCutout` so the tint and the
lightning flash can change every frame.

## Pipeline

1. **Face** (`FaceReader.tsx`): `useFaceInfo` → `useFaceAttributeExpression` (SDK classifier, 6
   fps, confidence ≥ 0.45) for emotions; `useFaceAction(face, "mouthPout")` +
   `getFaceActionValue` for the pout; `face.blendshapes.cheekPuff` for puffed cheeks. Per the
   SDK, emotions never come from blendshape thresholds; pout and puff are physical movements.
2. **Mood** (`mood.ts`, pure, tested): pout (> 0.82, see round 2) → hearts; puff (enter 0.35 / leave 0.25) → wind;
   then happy → sunny, sad → rain, surprise → lightning, angry → storm; else calm. Strength ramps
   with the score / pout / puff and never drops below 0.35 once a weather is on. A new mood must
   hold 0.45 s (calm 1.4 s) before the weather turns.
3. **Look** (`Weather.tsx`): each weather is a preset (`config.ts`: sky colours, cloud cover,
   darkness, drift speed, sun, rainbow, particles, lightning interval, tint). The target is calm
   blended toward the current preset by strength, and everything eases toward it (1.4/s), so
   changes roll in.
4. **Particles**: rain streaks (slanted with the wind), sun motes, leaves, hearts — one point
   shader drawing each shape; up to 900 behind and 315 in front. Rain spawns upwind so slanted
   rain still covers the screen.
5. **Lightning**: flashes at random (mean 1.1 s for surprise, 2.4 s for a storm, shorter when
   stronger), each a bright flash, a jagged bolt and a weaker flicker 0.12 s later; the flash
   lights the sky and you.
6. **Instructions** (`Prompt.tsx`), so players know their face is the controller:
   - an **intro card** over the chest when a face first appears — "Your face controls the
     weather / Make a face and hold it ↓" — until a weather turns (or 8 s);
   - a row of six **expression chips** along the bottom while a face is in view (😊 Sun, ☹️ Rain,
     😮 Bolt, 😠 Storm, 🐡 Wind, 😗 Love): the weather on show lit white, the one the face is
     building toward half-lit;
   - a **line** above the chips: "😮 Hold it…" while an expression builds, the weather's name as it
     turns, "Try: 😊 Smile for sunshine" (cycling) on a calm sky, "Look at the camera" without a
     face, "Reading the sky…" while the classifier loads.
     React state changes only when what's shown changes.

## Round 1 additions

- **Puddles and splashes**: raindrops behind you land between 86 % and 100 % of the screen height
  and 40 % splash (a flat ring that spreads and fades over 0.35 s); drops in front fall past the
  lens and never splash on you. Wetness rises 0.06/s × strength while it rains, dries 0.14/s in
  sun and 0.012/s otherwise; the sky shader draws puddles in the bottom ~17 % (fbm blobs that
  grow with wetness) mirroring the sky, with ripple rings while it rains. In a head-and-shoulders
  selfie your body covers that strip, so puddles show beside you in wider shots.
- **Wind tugs at you**: the person shader samples camera and mask with a gusty sideways offset
  (up to 1.2 % of the width at full wind), growing toward the top so the feet stay put; white
  wisps (streak particles, 26/s) fly past in front.
- **Sun smiles back**: the sun has eyes, a mouth whose curve follows the happy strength (a small
  smile on a calm day), rosy cheeks when beaming, and longer, brighter, faster rays. The face is
  painted over the sky (adding it would tint it blue).
- **Day ⇄ night** (`DayNight.tsx`): a peace sign (SDK gesture engine, 250 ms hold, 1 s cooldown)
  flips night, eased at 0.9/s: deep blue sky, twinkling stars where clear, a moon instead of the
  sun, darker clouds, no rainbow, you lit cooler and dimmer (× `#c3cde6`), fireflies on calm /
  sunny nights, stronger flashes. "🌙 Night" / "☀️ Day" shows on a flip and the hints include
  "✌️ Peace sign for night / day". Dev key: N.
- **Edge**: the soft edge of the cut-out has a green / coloured cast pulled toward neutral (a
  green or bright wall spilling onto hair and shoulders).

## Round 2: tap fallback and a stricter Love

- **Tap a chip** (mouse click or touch) when the face isn't read well: that weather comes on at
  full strength almost at once (0.15 s hold) and stays; the same chip again hands back to the
  face. For the first 6 s of "mood time" nothing the face reads can override a tap (a poorly
  read face flickers stray expressions); after that a different expression the face holds takes
  over (`applyManual`, tested). Calm or no face never clear it. The chips show whenever the
  camera runs (not only with a face); taps are read on R3F's event source and matched against the
  chips' design-px boxes; the intro says "Make a face and hold it — or tap one".
- **Love was winning all the time**: on the "Person Looking" sample the pout value sat around
  0.20 but reached 0.75 a tenth of the time (lips purse while talking), above the SDK's default
  0.5. Love now needs pout > 0.82 to start (0.65 to stop) and a 0.8 s hold; it still outranks the
  others once it's clearly on purpose.

## Notes

- The built-in preview throttles a page it considers obscured to one frame every 2 s (no long
  tasks: it's the browser, not the effect); the dev hook's `snap()` jumps the eased look to its
  target so a forced weather can be screenshotted.

- Tints multiply in linear colour, so they stay near white (a hex that looks gentle darkens a
  lot).
- Housekeeping: preset colours are parsed once and the blended look is written into reused
  objects (no per-frame allocation); particle colour / size / kind upload only on a spawn.
- The person mask is eroded (a 3 px minimum ring) so the room's colour doesn't fringe the sky.
- Verified in the built-in preview with the dev keys: sunny (sun, rays, rainbow), rain, storm
  (dark sky, slanted rain, bolt, flash on the person), wind (fast clouds, leaves) and hearts.
  On "Person Looking" the classifier reads happy / neutral as he moves. Pout and cheek puff need
  a real face; check on a phone.

## Production

- The dev media switcher, the weather keys and the `window.__weather` hook are dev-only (inline
  `NODE_ENV` guards).
