import { describe, expect, it } from 'vitest';
import data from './exercises.json';
import {
  idleState, litTicks, pause, remainingMs, remainingSeconds, restore, resume, start, tick, totalElapsedMs,
  type WorkoutConfig, type WorkoutState,
} from './engine';

const cfg: WorkoutConfig = {
  exerciseCount: data.exercises.length,
  exerciseMs: data.exerciseSeconds * 1000,
  restMs: data.restSeconds * 1000,
};

/** Run the clock forward in uneven frame-sized steps, like requestAnimationFrame would. */
function run(s: WorkoutState, from: number, ms: number): [WorkoutState, number] {
  let now = from;
  const end = from + ms;
  let i = 0;
  while (now < end) {
    now = Math.min(end, now + [16.7, 33.4, 16.6, 50.1, 8.3][i++ % 5]);
    s = tick(s, cfg, now);
  }
  return [s, now];
}

describe('exercises.json', () => {
  it('lists ten unique exercises in order with matching GIF paths', () => {
    expect(data.exercises).toHaveLength(10);
    expect(data.exercises.map((e) => e.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(data.exercises.map((e) => e.name)).size).toBe(10);
    expect(new Set(data.exercises.map((e) => e.gif)).size).toBe(10);
    data.exercises.forEach((e, i) => {
      expect(e.gif).toMatch(new RegExp(`^assets/${String(i + 1).padStart(2, '0')}_[a-z_]+\\.gif$`));
    });
    expect(data.exercises[0].name).toBe('Body Waves');
    expect(data.exercises[9].name).toBe('Body Taps');
  });
  it('adds up to 645 seconds', () => {
    expect(10 * data.exerciseSeconds + 9 * data.restSeconds).toBe(data.expectedTotalSeconds);
    expect(data.expectedTotalSeconds).toBe(645);
  });
});

describe('engine', () => {
  it('starts on exercise 1 with 60 seconds and 60 lit ticks', () => {
    const s = start(cfg, 1000);
    expect(s.phase).toBe('exercise');
    expect(s.index).toBe(0);
    expect(remainingSeconds(s)).toBe(60);
    expect(litTicks(s)).toBe(60);
  });

  it('drops exactly one tick per elapsed second', () => {
    let s = start(cfg, 0);
    let now = 0;
    for (let sec = 1; sec <= 59; sec++) {
      [s, now] = run(s, now, 999);
      expect(litTicks(s)).toBe(61 - sec); // just before the boundary
      [s, now] = run(s, now, 1);
      expect(litTicks(s)).toBe(60 - sec); // exactly on the boundary
    }
    expect(litTicks(s)).toBe(1);
    [s, now] = run(s, now, 999);
    expect(litTicks(s)).toBe(1);
  });

  it('has 30 lit ticks after 30 seconds', () => {
    const [s] = run(start(cfg, 0), 0, 30_000);
    expect(litTicks(s)).toBe(30);
    expect(remainingSeconds(s)).toBe(30);
  });

  it('moves to a 5 s rest for exercise 2 at 60 s, then exercise 2 at 65 s', () => {
    let [s, now] = run(start(cfg, 0), 0, 60_000);
    expect(s.phase).toBe('rest');
    expect(s.index).toBe(1);
    expect(remainingSeconds(s)).toBe(5);
    expect(litTicks(s)).toBe(0);
    [s, now] = run(s, now, 4_999);
    expect(s.phase).toBe('rest');
    expect(remainingSeconds(s)).toBe(1);
    [s, now] = run(s, now, 1);
    expect(s.phase).toBe('exercise');
    expect(s.index).toBe(1);
    expect(remainingSeconds(s)).toBe(60);
    expect(litTicks(s)).toBe(60);
  });

  it('runs all ten exercises with nine rests and completes at exactly 645 s', () => {
    let s = start(cfg, 0);
    let now = 0;
    const log: string[] = ['exercise:0'];
    let last = 'exercise:0';
    while (now < 644_999) {
      now = Math.min(644_999, now + 16.7);
      s = tick(s, cfg, now);
      const key = `${s.phase}:${s.index}`;
      if (key !== last) {
        log.push(key);
        last = key;
        // Every boundary lands on its exact scheduled time (no drift).
        const expected = totalElapsedMs({ ...s, elapsedMs: 0 }, cfg);
        expect(now - expected).toBeLessThan(17);
        expect(totalElapsedMs(s, cfg)).toBeCloseTo(now, 6);
      }
    }
    expect(s.phase).toBe('exercise');
    expect(s.index).toBe(9);
    expect(log.filter((k) => k.startsWith('rest')).length).toBe(9);
    expect(log.filter((k) => k.startsWith('exercise')).length).toBe(10);
    expect(log).toEqual(
      Array.from({ length: 10 }, (_, i) => (i === 0 ? ['exercise:0'] : [`rest:${i}`, `exercise:${i}`])).flat(),
    );
    s = tick(s, cfg, 645_000);
    expect(s.phase).toBe('complete');
    expect(totalElapsedMs(s, cfg)).toBe(645_000);
    // Nothing happens after completion.
    expect(tick(s, cfg, 700_000)).toBe(s);
  });

  it('pause freezes an exercise and resume continues from the same remaining time', () => {
    let [s, now] = run(start(cfg, 0), 0, 30_500);
    s = pause(s, cfg, now, 'user');
    expect(s.isPaused).toBe(true);
    expect(remainingMs(s)).toBeCloseTo(29_500, 6);
    const frozen = s;
    for (let t = now; t < now + 600_000; t += 1000) s = tick(s, cfg, t);
    expect(s).toBe(frozen);
    now += 600_000;
    s = resume(s, now);
    expect(remainingMs(s)).toBeCloseTo(29_500, 6);
    expect(litTicks(s)).toBe(30);
    [s, now] = run(s, now, 29_499);
    expect(s.phase).toBe('exercise');
    [s, now] = run(s, now, 1);
    expect(s.phase).toBe('rest');
  });

  it('pause freezes a rest interval too', () => {
    let [s, now] = run(start(cfg, 0), 0, 62_500);
    expect(s.phase).toBe('rest');
    s = pause(s, cfg, now, 'user');
    expect(remainingMs(s)).toBeCloseTo(2_500, 6);
    s = tick(s, cfg, now + 100_000);
    expect(s.phase).toBe('rest');
    now += 100_000;
    s = resume(s, now);
    [s, now] = run(s, now, 2_499);
    expect(s.phase).toBe('rest');
    [s, now] = run(s, now, 1);
    expect(s.phase).toBe('exercise');
    expect(s.index).toBe(1);
  });

  it('auto-pauses instead of skipping when the page was suspended', () => {
    let [s, now] = run(start(cfg, 0), 0, 10_000);
    s = tick(s, cfg, now + 5 * 60_000); // phone locked for five minutes, no visibility event
    expect(s.isPaused).toBe(true);
    expect(s.pauseReason).toBe('hidden');
    expect(s.phase).toBe('exercise');
    expect(s.index).toBe(0);
    expect(remainingSeconds(s)).toBe(50);
  });

  it('restores a saved session paused and rejects bad data', () => {
    const [s] = run(start(cfg, 0), 0, 200_000);
    const r = restore(JSON.parse(JSON.stringify(s)), cfg)!;
    expect(r.isPaused).toBe(true);
    expect(r.pauseReason).toBe('restored');
    expect(r.phase).toBe(s.phase);
    expect(r.index).toBe(s.index);
    expect(r.elapsedMs).toBeCloseTo(s.elapsedMs, 6);
    expect(restore(null, cfg)).toBeNull();
    expect(restore(idleState(), cfg)).toBeNull();
    expect(restore({ phase: 'exercise', index: 10, elapsedMs: 0 }, cfg)).toBeNull();
    expect(restore({ phase: 'rest', index: 0, elapsedMs: 0 }, cfg)).toBeNull();
    expect(restore({ phase: 'rest', index: 2, elapsedMs: 9000 }, cfg)).toBeNull();
    expect(restore({ phase: 'exercise', index: 2, elapsedMs: 'x' }, cfg)).toBeNull();
  });
});
