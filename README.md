# Heel 10

A hands-free, installable iPhone web app (PWA) that runs ten gentle, heel-friendly
exercises back to back.

- 10 exercises × 60 seconds + 9 × 5-second "get ready" transitions = **10:45** (645 s)
- A ring of 60 notches surrounds each animated GIF; one notch goes dim every second
- Voice announcement of the next exercise during each 5-second interval
- Pause / Resume at any point; auto-pauses if the phone locks or the tab is hidden
- Works offline after the first visit; no login, no server, no analytics

## 1. Add the GIFs

The ten supplied GIFs live in `public/assets/` (see the README in that folder for the
exact file names). Check them with:

    npm run check:assets

## 2. Run, test, build

    npm install
    npm run dev          # local development at http://localhost:5173
    npm test             # unit tests for the timer engine
    npm run build        # type-check + production build into dist/
    npm run test:e2e     # browser acceptance tests against dist/

`npm run test:e2e` needs Playwright (`npm i -D playwright && npx playwright install chromium`).
It drives a virtual clock, so the full 645-second session is verified in seconds.

## 3. Publish (any static HTTPS host)

The built app is the `dist/` folder — plain static files with relative paths.

- **Netlify:** drag the `dist/` folder onto <https://app.netlify.com/drop>, or connect the
  repository with build command `npm run build` and publish directory `dist`.
- GitHub Pages, Cloudflare Pages, Vercel etc. work the same way. HTTPS is required for
  the offline cache and the screen wake lock.

## 4. Install on an iPhone

1. Open the published URL in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Launch **Heel 10** from the Home Screen. It opens full screen and works offline.

Notes for iPhone: voice follows the phone's volume (and, on some iOS versions, the
ring/silent switch). iOS suspends web apps when the screen locks, so the app pauses
itself and shows "Paused while screen was off" — tap **Resume** to continue where you
stopped. While the workout is running the app asks iOS to keep the screen awake.

## How it is built

| File | Purpose |
| --- | --- |
| `src/exercises.json` | Exercise order, names, GIF paths, durations (source of truth) |
| `src/engine.ts` | Pure state machine: `idle / exercise / rest / complete` + `isPaused`, driven by `performance.now()` with an elapsed-time accumulator (no drift) |
| `src/App.tsx` | Screens, 60-tick SVG ring, pause/visibility handling, wake lock, persistence |
| `src/audio.ts` | Best-effort speech and chime |
| `src/sw.template.js` | Service worker; the build fills in the list of files to cache |
| `e2e/run.cjs` | Acceptance tests from the build brief |
