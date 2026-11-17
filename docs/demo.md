# Demo media

The demo scripts seed one deterministic workspace through `scripts/demo/seed.mjs` and drive the real app with Playwright. They are not part of CI. The seed page runs on the app origin before boot, so the capture opens the seeded workspace instead of the storage chooser.

## Prerequisites

- `pnpm dev` on `http://127.0.0.1:3000`. Set `DEMO_APP_URL` to use another origin.
- Playwright's Chromium.
- `ffmpeg` for the video and GIF outputs.

## Scripts

- `node scripts/demo/capture.mjs`: README stills in `docs/images/`.
- `node scripts/demo/clips.mjs`: short feature GIFs in `docs/images/`.
- `node scripts/demo/hero.mjs`: `docs/video/hero.mp4`, `docs/images/hero.gif`, and `docs/images/hero-poster.png`.
- `node scripts/demo/store.mjs`: Play Store screenshots under `docs/store/play-phone`, `play-tablet-7`, and `play-tablet-10`. Use `--device=` or `--only=` to narrow a run.
- `node scripts/demo/attachment.mjs docs/video/hero.mp4 --update-readme`: uploads the video to GitHub user attachments and rewrites the README link. The endpoint needs `GITHUB_ATTACHMENT_TOKEN`, `GH_TOKEN`, or `gh auth token`.

## Hero notes

The hero capture is `1280x800`. The default 300px sidebar leaves 980px, so the backlinks rail opens inline at that width. The inline threshold is `viewport - sidebarWidth >= 940`.

- At 1280 the backlinks rail is a third pane. The graph scene has no backdrop, so the graph toolbar, switch, and nodes are clickable.
- Below the threshold the rail floats. Opening the graph from the floating rail closes it first, so the graph still gets the pane.
- The app bar is on by default and is part of the frame. The hero applies the dark theme and the default sizing, but app bar visibility is device-local and is not part of `SHOT_SETTINGS`.
- If you change the viewport, the sidebar width, or the inline threshold, check the backlinks scene first. A floating rail with a visible backdrop means the graph clicks will land on the backdrop instead of the canvas.
