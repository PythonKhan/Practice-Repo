# Build brief for Claude Code or OpenAI Codex: Heel 10 workout app

## First: get the ten GIFs

The complete downloadable package, including all ten exercise GIFs, `exercises.json`, and this build brief, is available here:

**Download URL:** https://chatgpt.com/library?file_id=libfile_9ea670ae95b4819189c5a1bd388fa684&account_id=personal

Try to download and extract it before starting development. **Important:** this is a private ChatGPT Library link, not a public direct-download endpoint. If authentication or access restrictions prevent you (Claude Code/Codex) from fetching it, tell the user to download the ZIP while signed into ChatGPT and then place the extracted `heel10_claude_handoff` folder into your project, or attach the ZIP to the session. Continue using those actual GIF files; do not replace them with stock images or invented placeholders.

Build a complete, polished, mobile-first, installable Progressive Web App (PWA) for an iPhone using the **ten actual GIF files in the `assets/` folder**. Do not replace the GIFs with generated images, placeholders, or stock videos. Implement the app and run tests; don't stop at a mockup or a plan.

## Product goal

One-tap, hands-free sequence of ten gentle exercise demonstrations. Every exercise runs for exactly **60 seconds**. After each of exercises 1 through 9, insert an automatic **5-second get-ready interval** that announces the next exercise. After the tenth exercise, display a completion screen. The entire continuous session, excluding manual pauses, must be **10 minutes 45 seconds (645 seconds)**.

## Exercise order and exact GIF files

Read `exercises.json` as the source of truth. Files are included locally, are already animated, and must be displayed in this order:

1. Body Waves — `assets/01_body_waves.gif`
2. Arm Circles — `assets/02_arm_circles.gif`
3. Overhead Arm Raises — `assets/03_overhead_arm_raises.gif`
4. Arm Swings — `assets/04_arm_swings.gif`
5. Trunk Twists — `assets/05_trunk_twists.gif`
6. Seated Marches — `assets/06_seated_marches.gif`
7. Modified Windmills — `assets/07_modified_windmills.gif`
8. Chair Sit to Stand — `assets/08_chair_sit_to_stand.gif`
9. Stationary Wide Arm Openings — `assets/09_stationary_wide_arm_openings.gif`
10. Body Taps — `assets/10_body_taps.gif`

## Screen design

Use a calm, premium visual style consistent with the GIF cards: deep navy, light backgrounds, soft green accent, generous spacing, crisp typography. Design for 375px-wide iPhones first, then tablets and desktops.

### Welcome screen

- App name **Heel 10** and one-sentence intro.
- Show `10 exercises × 60 seconds + 9 × 5-second transitions = 10:45`.
- Big **Start Workout** button (must be a user action so browser audio can be enabled).
- **Voice announcements** On/Off toggle; remember choice locally.
- Display brief reminder: supportive footwear; stop if heel pain increases.

### Exercise screen — most important part

- Large GIF in the centre, contained inside a square visual window (`object-fit: contain`) so the full person and shoes remain visible.
- **A circular clock of exactly 60 evenly spaced radial tick marks SURROUNDING the GIF**, not a single continuous progress arc. Put the ticks in SVG for sharp scaling. At 60 seconds, all 60 ticks are lit green. At each elapsed whole second, one tick switches to dim grey. After one second exactly 59 should be lit, after 30 seconds exactly 30, after 60 seconds none. The countdown moves clockwise from 12 o'clock.
- A prominent `60`, `59` ... `00` seconds remaining digital label, matching the ticks.
- Prominent current exercise name and `Exercise N of 10`, e.g. `3 / 10`.
- A large **Pause** button persistently visible on the lower portion of the screen; when paused it changes to **Resume**. Pausing works during both the exercise phase and the 5-second rest phase, and it must stop the countdown, turn-off animation and automatic transitions.
- Optional unobtrusive **End Workout** button with confirmation. No required per-exercise taps.
- Keep the app awake via Screen Wake Lock API when available; fall back gracefully when unsupported.

### Five-second interval screen

- Immediately after exercise N finishes (unless N is #10), automatically transition to a clearly different screen: **GET READY** in large text, followed by **Up next: [name]** and a large 5-to-1 countdown.
- Announce by speech once: `Get ready for [next exercise name]`, or use a short chime with spoken announcement when browser permits. Use `speechSynthesis` where supported; treat voice/audio as best effort and always show the visual announcement. Do not queue announcements on every tick. Provide a sound toggle; avoid overlapping speech when the interval ends. Enable audio with the initial Start button.
- The rest countdown automatically starts immediately, and the next exercise automatically starts after exactly 5 seconds. No Continue or Next button is required.
- Maintain the **Pause / Resume** button on this screen too.
- No five-second interval after exercise #10.

### Completion screen

- `Workout complete!` and `10:45` planned active duration.
- Show finished exercise count and a **Start Again** button.
- Optional local-only completion date, with no login, cloud sync or analytics.

## Timer and state requirements

Model the state explicitly as `idle`, `exercise`, `rest`, `complete`, plus a separate `isPaused` flag. Store current exercise index from `0` to `9`, phase duration, elapsed/remaining milliseconds, and last active timestamp.

- Do **not** decrement an integer once per `setInterval` and assume it is perfectly accurate. Use `performance.now()` with an elapsed-time accumulator, then derive `remainingMs` and `ceil(remainingMs / 1000)` for the visible second countdown and tick count. Render via `requestAnimationFrame` or a short interval.
- Each phase begins with its full 60 or 5 seconds visible, with accurate boundary transitions. Never drift across the ten exercises.
- `litTicks = clamp(ceil(remainingExerciseMs / 1000), 0, 60)`; build 60 SVG radial notches at angles `i × 6 degrees`.
- Pause captures exactly the remaining time; Resume uses the captured time and a fresh performance timestamp. No tick loss or jumps.
- At the exercise boundary: if index < 9 -> `rest(5s,nextIndex)`; else -> `complete`. At rest boundary -> next exercise automatically.
- The app runs automatically while visible. If the page becomes hidden or the phone locks, **automatically pause** and display `Paused while screen was off` on return, rather than silently skipping exercises. iOS and other browsers can throttle/suspend background pages; do not falsely promise background playback.
- Animated GIFs may keep looping independently when the clock pauses; the critical guarantee is that the **session clock and phase transitions pause**. Optionally freeze GIF to a first-frame poster while paused if feasible.
- Preserve current session state in local storage in case of reload; recover safely in paused mode, never auto-skip missed exercises. Persistence must not interfere with fresh Start Again.

## Suggested implementation

- Prefer **React + TypeScript + Vite** or equally simple typed front-end stack, self-contained local static assets, no server/backend and no paid API.
- Use an inline SVG with 60 `<line>` ticks around the contained `<img>` for the clock display. The image must not be cropped by the circle: scale it to fit within the circle.
- PWA manifest, service worker to cache the app shell and all ten GIFs for offline use. Use HTTPS for deployment.
- Accessible buttons of at least 44px touch area, responsive dimensions and clear high contrast; use `aria-live="polite"` only for phase and exercise announcements, not every countdown tick.
- Run `npm install`, `npm run build`, and automated tests before presenting the result. Include instructions to publish the built `dist/` on Netlify or another simple HTTPS host and to use Safari > Share > Add to Home Screen on iPhone.

## Test these acceptance criteria

1. First Start displays Body Waves at 60 seconds and 60 lit ticks.
2. Precisely one elapsed second later there are 59 lit ticks; after 30 seconds, 30; after 60 seconds, 0.
3. At the first 60-second mark the display changes to a 5-second GET READY for Arm Circles. At 65 seconds Arm Circles begins automatically at 60 seconds.
4. Repeat the sequence for all ten GIFs in order with exactly nine transitions. At 645 elapsed unpaused seconds show completion.
5. Pausing halfway through an exercise or a get-ready interval freezes all timing and transitions. Resuming continues from the same remaining time.
6. Switching tabs/locking the phone auto-pauses, and resuming does not skip a single exercise.
7. Works on a 375px iPhone-sized screen, desktop Chrome and iPhone Safari; app remains usable when offline after initial load.
8. Speech announcements work when permitted, but the UI works perfectly when the voice API is unavailable or sound is muted.
9. GIF names and images match the `exercises.json` order exactly; no duplicates, broken paths or substituted images.

Deliver runnable source code, a tested production build and short installation instructions.
