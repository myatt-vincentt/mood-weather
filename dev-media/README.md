# dev-media

Optional dev-only preview media. Nothing here ships: only
`src/DevMediaSwitcher.tsx` reads this folder, and it is stripped from
production builds.

You don't need anything here. Without a webcam, `pnpm dev` starts on the SDK's
built-in "Person Looking" video and lists every SDK sample video and image
("Two People Smiling" is a good test for sunshine).

To preview with your own clip, add a portrait video of a face at
`dev-media/face.mp4` (H.264 MP4); it is listed first and used as the start.
Clips here are git-ignored. Restart `pnpm dev` after adding or removing one.

No sample pouts or puffs its cheeks, so the dev-only weather keys (see
`src/DevWeather.tsx`) force each weather in the built-in preview.
