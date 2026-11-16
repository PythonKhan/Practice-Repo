/**
 * End-to-end acceptance tests against the production build.
 *   npm run build && npm run test:e2e            (serves ./dist)
 *   node e2e/run.cjs <dir> [screenshotDir]       (serves another build directory)
 * Needs Playwright with Chromium (`npm i -D playwright && npx playwright install chromium`).
 * Timing tests use a virtual clock, so the full 10:45 session runs in seconds.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium, webkit, devices } = require('playwright');

const ROOT = path.resolve(process.argv[2] || 'dist');
const SHOTS = process.argv[3] ? path.resolve(process.argv[3]) : null;
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'exercises.json'), 'utf8'));
const EX = data.exercises;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.gif': 'image/gif', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

const FRAME = 40; // ms: the on-screen clock updates once per animation frame, so allow one frame either side
const results = [];
let URL_BASE = '';

const ONLY = process.env.E2E_ONLY; // optional: run only tests whose name contains this text

async function test(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  const t0 = Date.now();
  try {
    await fn();
    results.push([true, name]);
    console.log(`  ✓ ${name} (${Date.now() - t0} ms)`);
  } catch (err) {
    results.push([false, name]);
    console.log(`  ✗ ${name}\n      ${String(err.stack || err).split('\n').slice(0, 6).join('\n      ')}`);
  }
}

/** Stub that records speech instead of playing it. */
const speechStub = () => {
  window.__spoken = [];
  window.__cancels = 0;
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: { speak: (u) => window.__spoken.push(u.text), cancel: () => { window.__cancels++; }, getVoices: () => [] },
  });
};
const noSpeech = () => {
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined });
  delete window.SpeechSynthesisUtterance;
  window.AudioContext = undefined;
  window.webkitAudioContext = undefined;
};

async function open(browser, { viewport = { width: 375, height: 667 }, init = speechStub, clock = true, sw = 'block', storage } = {}) {
  const context = await browser.newContext({ viewport, serviceWorkers: sw, storageState: storage });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  if (init) await page.addInitScript(init);
  if (clock) await page.clock.install({ time: new Date('2026-01-05T09:00:00') });
  await page.goto(URL_BASE);
  await page.getByTestId('welcome').waitFor();
  // Freeze the virtual clock: from here time only moves when a test calls run().
  if (clock) await page.clock.pauseAt(new Date('2026-01-05T10:00:00'));
  return { context, page, errors };
}

const view = (page) =>
  page.evaluate(() => {
    const q = (id) => document.querySelector(`[data-testid="${id}"]`);
    const phase = q('exercise') ? 'exercise' : q('rest') ? 'rest' : q('complete') ? 'complete' : q('welcome') ? 'welcome' : '?';
    const ring = q('exercise') && q('ring');
    return {
      phase,
      name: q('name')?.textContent ?? q('next-name')?.textContent ?? null,
      count: q('count')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      seconds: q('seconds') ? q('seconds').firstChild.textContent : q('rest-seconds')?.textContent ?? null,
      lit: ring ? ring.querySelectorAll('.tick.lit').length : null,
      ticks: ring ? ring.querySelectorAll('.tick').length : null,
      litIdx: ring ? [...ring.querySelectorAll('.tick')].map((t, i) => (t.classList.contains('lit') ? i : -1)).filter((i) => i >= 0) : null,
      gif: q('gif')?.getAttribute('src') ?? null,
      gifOk: q('gif') ? q('gif').complete && q('gif').naturalWidth > 0 : null,
      button: q('pause')?.textContent ?? null,
      note: q('pause-note')?.textContent?.trim() ?? null,
    };
  });

const run = (page, ms) => page.clock.runFor(ms);

/** Wait (in real time) until the GIF has loaded or failed; the virtual clock stays frozen. */
async function gifSettled(page) {
  for (let i = 0; i < 100; i++) {
    if (await page.evaluate(() => { const g = document.querySelector('[data-testid="gif"]'); return !g || g.complete; })) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function setHidden(page, hidden) {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  URL_BASE = `http://127.0.0.1:${server.address().port}/`;
  const gifsPresent = EX.every((e) => fs.existsSync(path.join(ROOT, e.gif)));
  console.log(`Serving ${ROOT} at ${URL_BASE}`);
  console.log(gifsPresent ? 'All 10 GIF files are present in the build.' : '⚠ GIF files are missing from the build: image-loading checks will fail.');
  const browser = await chromium.launch();

  await test('welcome screen shows name, formula, start button, voice toggle and safety note', async () => {
    const { page, context, errors } = await open(browser);
    const text = await page.getByTestId('welcome').innerText();
    assert.match(text, /Heel 10/);
    assert.match(text, /10 exercises × 60 seconds \+ 9 × 5-second transitions = 10:45/);
    assert.match(text, /Voice announcements/);
    assert.match(text, /supportive footwear/i);
    assert.match(text, /heel pain increases/i);
    const box = await page.getByTestId('start').boundingBox();
    assert.ok(box.height >= 44 && box.width >= 200);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'welcome-375.png') });
    assert.deepEqual(errors, []);
    await context.close();
  });

  await test('AC1-3: 60 lit ticks at start, one fewer each second, rest at 60 s, next exercise at 65 s', async () => {
    const { page, context } = await open(browser);
    await page.getByTestId('start').click();
    let v = await view(page);
    assert.equal(v.phase, 'exercise');
    assert.equal(v.name, 'Body Waves');
    assert.equal(v.count, '1 / 10');
    assert.equal(v.seconds, '60');
    assert.equal(v.ticks, 60);
    assert.equal(v.lit, 60);
    assert.equal(v.gif, 'assets/01_body_waves.gif');

    await run(page, 1000 - FRAME);
    assert.equal((await view(page)).lit, 60, 'still 60 just before 1 s');
    await run(page, 2 * FRAME);
    v = await view(page);
    assert.equal(v.lit, 59, '59 lit just after 1 s');
    assert.equal(v.seconds, '59');
    assert.deepEqual(v.litIdx, Array.from({ length: 59 }, (_, i) => i + 1), 'tick at 12 o\'clock goes dim first (clockwise)');

    // Every second from 2 to 59: lit ticks === seconds label === 60 - elapsed.
    for (let sec = 2; sec <= 59; sec++) {
      await run(page, 1000);
      v = await view(page);
      assert.equal(v.lit, 60 - sec, `lit ticks after ${sec} s`);
      assert.equal(Number(v.seconds), 60 - sec);
      if (sec === 30) {
        assert.equal(v.lit, 30);
        assert.deepEqual(v.litIdx, Array.from({ length: 30 }, (_, i) => i + 30));
      }
    }
    assert.equal(v.lit, 1); // t = 59 s + FRAME
    await run(page, 1000 - 2 * FRAME); // t = 60 s - FRAME
    v = await view(page);
    assert.equal(v.phase, 'exercise');
    assert.equal(v.lit, 1);
    await run(page, 2 * FRAME); // t = 60 s + FRAME
    v = await view(page);
    assert.equal(v.phase, 'rest', 'GET READY appears at 60 s');
    assert.equal(v.name, 'Arm Circles');
    assert.equal(v.seconds, '5');
    assert.match(await page.getByTestId('rest').innerText(), /GET READY[\s\S]*Up next:[\s\S]*Arm Circles/);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'rest-375.png') });
    for (let left = 4; left >= 1; left--) {
      await run(page, 1000);
      assert.equal((await view(page)).seconds, String(left));
    }
    await run(page, 1000 - 2 * FRAME); // t = 65 s - FRAME
    assert.equal((await view(page)).phase, 'rest');
    await run(page, 2 * FRAME); // t = 65 s + FRAME
    v = await view(page);
    assert.equal(v.phase, 'exercise', 'Arm Circles starts automatically at 65 s');
    assert.equal(v.name, 'Arm Circles');
    assert.equal(v.count, '2 / 10');
    assert.equal(v.seconds, '60');
    assert.equal(v.lit, 60);
    assert.equal(v.gif, 'assets/02_arm_circles.gif');
    await context.close();
  });

  await test('AC4/8/9: all ten GIFs in order, nine transitions, one announcement each, complete at 645 s', async () => {
    const { page, context, errors } = await open(browser);
    await page.getByTestId('start').click();
    let t = 0; // virtual ms since start
    const advanceTo = async (target) => { await run(page, target - t); t = target; };
    let rests = 0;
    for (let i = 0; i < 10; i++) {
      const startAt = i * 65_000;
      await advanceTo(startAt + FRAME);
      let v = await view(page);
      assert.equal(v.phase, 'exercise', `exercise ${i + 1} running at ${startAt / 1000} s`);
      assert.equal(v.name, EX[i].name);
      assert.equal(v.count, `${i + 1} / 10`);
      assert.equal(v.gif, EX[i].gif);
      assert.equal(v.lit, 60);
      await gifSettled(page);
      assert.equal((await view(page)).gifOk, true, `GIF loads: ${EX[i].gif}`);
      await advanceTo(startAt + 60_000 - FRAME);
      v = await view(page);
      assert.equal(v.phase, 'exercise');
      assert.equal(v.name, EX[i].name);
      assert.equal(v.lit, 1);
      if (i < 9) {
        await advanceTo(startAt + 60_000 + FRAME);
        v = await view(page);
        assert.equal(v.phase, 'rest');
        assert.equal(v.name, EX[i + 1].name);
        rests++;
        await advanceTo(startAt + 65_000 - FRAME);
        assert.equal((await view(page)).phase, 'rest');
      }
    }
    assert.equal(rests, 9);
    assert.equal((await view(page)).phase, 'exercise', 'still exercising just before 645 s');
    await advanceTo(645_000 + FRAME);
    assert.equal((await view(page)).phase, 'complete', 'complete at 645 s');
    const text = await page.getByTestId('complete').innerText();
    assert.match(text, /Workout complete!/);
    assert.match(text, /10:45/);
    assert.match(text, /10 \/ 10/);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'complete-375.png') });

    const spoken = await page.evaluate(() => window.__spoken);
    assert.deepEqual(spoken, [
      'Starting with Body Waves',
      ...EX.slice(1).map((e) => `Get ready for ${e.name}`),
      'Workout complete. Well done.',
    ], 'each announcement spoken exactly once, in order');
    assert.equal(await page.evaluate(() => localStorage.getItem('heel10.session')), null);
    assert.ok(await page.evaluate(() => localStorage.getItem('heel10.lastCompleted')));

    // Start Again begins a fresh session from exercise 1.
    await page.getByTestId('again').click();
    const v = await view(page);
    assert.equal(v.phase, 'exercise');
    assert.equal(v.name, 'Body Waves');
    assert.equal(v.lit, 60);
    assert.deepEqual(errors, []);
    await context.close();
  });

  await test('AC5: pause mid-exercise and mid-rest freezes everything; resume continues from the same time', async () => {
    const { page, context } = await open(browser);
    await page.getByTestId('start').click();
    await gifSettled(page);
    await run(page, 30_500);
    await page.getByTestId('pause').click();
    let v = await view(page);
    assert.equal(v.button, 'Resume');
    assert.equal(v.note, 'Paused');
    assert.equal(v.lit, 30);
    if (v.gifOk) assert.equal(await page.getByTestId('gif-still').isVisible(), true, 'animation replaced by a still frame while paused');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'paused-375.png') });
    await run(page, 10 * 60_000);
    v = await view(page);
    assert.equal(v.phase, 'exercise');
    assert.equal(v.name, 'Body Waves');
    assert.equal(v.lit, 30);
    assert.equal(v.seconds, '30');
    await page.getByTestId('pause').click();
    v = await view(page);
    assert.equal(v.button, 'Pause');
    assert.equal(v.lit, 30);
    assert.equal(await page.getByTestId('gif-still').isVisible(), false);
    await run(page, 29_500 - FRAME); // 29.5 s were left
    v = await view(page);
    assert.equal(v.phase, 'exercise');
    assert.equal(v.lit, 1);
    await run(page, 2 * FRAME);
    assert.equal((await view(page)).phase, 'rest');

    await run(page, 2_500 - FRAME); // now 2.5 s into the rest
    await page.getByTestId('pause').click();
    assert.equal((await view(page)).seconds, '3');
    await run(page, 10 * 60_000);
    v = await view(page);
    assert.equal(v.phase, 'rest');
    assert.equal(v.seconds, '3');
    assert.equal(v.button, 'Resume');
    await page.getByTestId('pause').click();
    await run(page, 2_500 - FRAME);
    assert.equal((await view(page)).phase, 'rest');
    await run(page, 2 * FRAME);
    v = await view(page);
    assert.equal(v.phase, 'exercise');
    assert.equal(v.name, 'Arm Circles');
    assert.equal(v.lit, 60);
    await context.close();
  });

  await test('AC6: hiding the page auto-pauses with a message and never skips an exercise', async () => {
    const { page, context } = await open(browser);
    await page.getByTestId('start').click();
    await run(page, 65_000 + 20_000); // 20 s into exercise 2
    await setHidden(page, true);
    await run(page, 30 * 60_000); // phone locked for half an hour
    await setHidden(page, false);
    await run(page, 5_000);
    let v = await view(page);
    assert.equal(v.phase, 'exercise');
    assert.equal(v.name, 'Arm Circles');
    assert.equal(v.count, '2 / 10');
    assert.equal(v.lit, 40);
    assert.equal(v.note, 'Paused while screen was off');
    assert.equal(v.button, 'Resume');
    await page.getByTestId('pause').click();
    await run(page, 10_000 + FRAME);
    v = await view(page);
    assert.equal(v.lit, 30);
    assert.equal(v.name, 'Arm Circles');

    // A frozen page with no visibility event (timers simply stop) is also treated as a pause.
    await page.clock.fastForward(20 * 60_000);
    await run(page, 1_000);
    v = await view(page);
    assert.equal(v.name, 'Arm Circles');
    assert.equal(v.lit, 30);
    assert.equal(v.note, 'Paused while screen was off');
    await context.close();
  });

  await test('reload restores the session paused; End Workout confirms and clears it', async () => {
    const { page, context } = await open(browser);
    await page.getByTestId('start').click();
    await run(page, 2 * 65_000 + 12_500); // 12.5 s into exercise 3
    await page.reload();
    await page.getByTestId('exercise').waitFor();
    await run(page, 60_000);
    let v = await view(page);
    assert.equal(v.name, 'Overhead Arm Raises');
    assert.equal(v.count, '3 / 10');
    assert.ok(v.lit === 48 || v.lit === 47, `restored near where it stopped (lit=${v.lit})`);
    assert.equal(v.button, 'Resume');
    assert.match(v.note, /Session restored/);
    const before = v.lit;
    await page.getByTestId('pause').click();
    await run(page, 5_000 + FRAME);
    assert.equal((await view(page)).lit, before - 5);

    await page.getByTestId('end').click();
    await page.getByTestId('end-cancel').waitFor();
    await run(page, 60_000); // clock is held while the dialog is open
    await page.getByTestId('end-cancel').click();
    v = await view(page);
    assert.equal(v.lit, before - 5);
    assert.equal(v.button, 'Pause', 'resumes after cancelling');
    await page.getByTestId('end').click();
    await page.getByTestId('end-confirm').click();
    assert.equal((await view(page)).phase, 'welcome');
    assert.equal(await page.evaluate(() => localStorage.getItem('heel10.session')), null);
    await page.reload();
    await page.getByTestId('welcome').waitFor();
    await page.getByTestId('start').click();
    v = await view(page);
    assert.equal(v.name, 'Body Waves');
    assert.equal(v.lit, 60);
    await context.close();
  });

  await test('AC8: voice toggle is remembered; muted and no-speech-API sessions run the full workout', async () => {
    let { page, context } = await open(browser);
    assert.equal(await page.getByTestId('voice-toggle').isChecked(), true);
    await page.getByTestId('voice-toggle').uncheck({ force: true });
    await page.reload();
    await page.getByTestId('welcome').waitFor();
    assert.equal(await page.getByTestId('voice-toggle').isChecked(), false, 'choice remembered');
    await page.getByTestId('start').click();
    await run(page, 65_000 + FRAME);
    assert.deepEqual(await page.evaluate(() => window.__spoken), [], 'nothing spoken when muted');
    assert.equal((await view(page)).name, 'Arm Circles');
    // Turning voice back on mid-session takes effect at the next transition.
    await page.getByTestId('sound').click();
    await run(page, 60_000);
    assert.deepEqual(await page.evaluate(() => window.__spoken), ['Get ready for Overhead Arm Raises']);
    await context.close();

    ({ page, context } = await open(browser, { init: noSpeech }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.getByTestId('start').click();
    await run(page, 60_000 + FRAME);
    assert.match(await page.getByTestId('rest').innerText(), /GET READY[\s\S]*Arm Circles/);
    assert.match(await page.getByTestId('live').innerText(), /Get ready. Up next: Arm Circles/);
    await run(page, 645_000 - 60_000);
    assert.equal((await view(page)).phase, 'complete');
    assert.deepEqual(errors, []);
    await context.close();
  });

  for (const [label, viewport] of [['375×667 iPhone SE', { width: 375, height: 667 }], ['390×844 iPhone', { width: 390, height: 844 }], ['820×1180 tablet', { width: 820, height: 1180 }], ['1280×800 desktop', { width: 1280, height: 800 }]]) {
    await test(`AC7 layout ${label}: nothing scrolls, Pause is on screen, GIF sits uncropped inside the tick circle`, async () => {
      const { page, context } = await open(browser, { viewport });
      const fits = () => page.evaluate(() => ({ sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, h: innerHeight, w: innerWidth }));
      let f = await fits();
      assert.ok(f.sh <= f.h && f.sw <= f.w, `welcome fits (${JSON.stringify(f)})`);
      await page.getByTestId('start').click();
      await gifSettled(page);
      await run(page, 7_000);
      f = await fits();
      assert.ok(f.sh <= f.h && f.sw <= f.w, `exercise screen fits (${JSON.stringify(f)})`);
      const geo = await page.evaluate(() => {
        const r = (el) => el.getBoundingClientRect();
        const ring = r(document.querySelector('.clock .ring'));
        const img = document.querySelector('[data-testid="gif"]');
        const win = r(document.querySelector('.gif-window'));
        const pause = r(document.querySelector('[data-testid="pause"]'));
        const out = { ring: ring.width, ringSquare: Math.abs(ring.width - ring.height) < 1, pause: { top: pause.top, bottom: pause.bottom, h: pause.height }, vh: innerHeight, fit: img && getComputedStyle(img).objectFit, winSquare: Math.abs(win.width - win.height) < 1 };
        if (img && img.naturalWidth) {
          // Drawn size of the picture inside its object-fit: contain box.
          const scale = Math.min(win.width / img.naturalWidth, win.height / img.naturalHeight);
          const halfDiag = Math.hypot(img.naturalWidth * scale, img.naturalHeight * scale) / 2;
          out.cornerRadius = halfDiag / ring.width; // fraction of the clock width
          out.drawn = { w: img.naturalWidth * scale, h: img.naturalHeight * scale };
          out.centered = Math.abs(win.left + win.width / 2 - (ring.left + ring.width / 2)) < 1 && Math.abs(win.top + win.height / 2 - (ring.top + ring.height / 2)) < 1;
        }
        return out;
      });
      assert.ok(geo.ringSquare && geo.winSquare);
      assert.equal(geo.fit, 'contain');
      assert.ok(geo.pause.h >= 44 && geo.pause.top >= 0 && geo.pause.bottom <= geo.vh, 'Pause button fully visible');
      assert.ok(geo.cornerRadius !== undefined, 'GIF loaded');
      // Ticks start at 175/400 = 0.4375 of the clock width from the centre.
      assert.ok(geo.cornerRadius <= 0.4375, `GIF corners stay inside the ticks (${geo.cornerRadius})`);
      assert.ok(geo.centered);
      assert.ok(geo.drawn.h >= 180, `GIF is large enough to see (${Math.round(geo.drawn.w)}×${Math.round(geo.drawn.h)} px)`);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `exercise-${viewport.width}.png`) });
      await run(page, 53_000 + FRAME);
      f = await fits();
      assert.ok(f.sh <= f.h && f.sw <= f.w, `rest screen fits (${JSON.stringify(f)})`);
      await context.close();
    });
  }

  await test('AC7 offline: after one online visit the app and all ten GIFs load with the network off', async () => {
    const { page, context } = await open(browser, { clock: false, sw: 'allow' });
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await context.setOffline(true);
    await page.reload();
    await page.getByTestId('welcome').waitFor();
    const loaded = await page.evaluate(async (gifs) => {
      const out = [];
      for (const g of [...gifs, 'manifest.webmanifest', 'icons/apple-touch-icon.png']) {
        try { const r = await fetch(g); out.push([g, r.ok && (await r.blob()).size > 0]); } catch { out.push([g, false]); }
      }
      return out;
    }, EX.map((e) => e.gif));
    assert.deepEqual(loaded.filter(([, ok]) => !ok).map(([g]) => g), [], 'all files served from the offline cache');
    await page.getByTestId('start').click();
    await page.getByTestId('exercise').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="gif"]')?.naturalWidth > 0);
    await page.waitForFunction(() => document.querySelector('[data-testid="ring"]').querySelectorAll('.tick.lit').length <= 58, null, { timeout: 5000 });
    await context.close();
  });

  await test('PWA: manifest, icons and iOS home-screen tags are in place', async () => {
    const { page, context } = await open(browser);
    const head = await page.evaluate(() => ({
      manifest: document.querySelector('link[rel="manifest"]')?.href,
      touch: document.querySelector('link[rel="apple-touch-icon"]')?.href,
      capable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content,
      viewport: document.querySelector('meta[name="viewport"]')?.content,
    }));
    assert.equal(head.capable, 'yes');
    assert.match(head.viewport, /viewport-fit=cover/);
    const m = await (await page.request.get(head.manifest)).json();
    assert.equal(m.name, 'Heel 10');
    assert.equal(m.display, 'standalone');
    for (const icon of m.icons) assert.equal((await page.request.get(new URL(icon.src, head.manifest).href)).status(), 200);
    assert.equal((await page.request.get(head.touch)).status(), 200);
    assert.equal((await page.request.get(URL_BASE + 'sw.js')).status(), 200);
    await context.close();
  });

  await browser.close();

  // Same engine in WebKit (the engine behind iPhone Safari), with an iPhone profile.
  let wk = null;
  try { wk = await webkit.launch(); } catch { console.log('  - WebKit is not installed here: skipped the Safari-engine run'); }
  if (wk) {
    await test('WebKit (iPhone 13 profile): start, tick, rest, next exercise, pause', async () => {
      const context = await wk.newContext({ ...devices['iPhone 13'] });
      const page = await context.newPage();
      await page.addInitScript(speechStub);
      await page.clock.install({ time: new Date('2026-01-05T09:00:00') });
      await page.goto(URL_BASE);
      await page.getByTestId('welcome').waitFor();
      await page.clock.pauseAt(new Date('2026-01-05T10:00:00'));
      await page.getByTestId('start').click();
      await run(page, 30_000 + FRAME);
      assert.equal((await view(page)).lit, 30);
      await run(page, 30_000);
      assert.equal((await view(page)).phase, 'rest');
      await run(page, 5_000);
      const v = await view(page);
      assert.equal(v.name, 'Arm Circles');
      assert.equal(v.lit, 60);
      await page.getByTestId('pause').click();
      await run(page, 60_000);
      assert.equal((await view(page)).lit, 60);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'webkit-iphone13.png') });
      await context.close();
    });
    await wk.close();
  }

  server.close();
  const failed = results.filter(([ok]) => !ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
