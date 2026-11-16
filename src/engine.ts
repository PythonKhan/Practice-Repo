/**
 * Pure workout state machine. Time is supplied by the caller (performance.now()),
 * and progress is tracked with an elapsed-time accumulator so the session never drifts.
 */
export type Phase = 'idle' | 'exercise' | 'rest' | 'complete';
export type PauseReason = 'user' | 'hidden' | 'restored' | null;

export interface WorkoutState {
  phase: Phase;
  isPaused: boolean;
  pauseReason: PauseReason;
  /** During `exercise`: the current exercise. During `rest`: the exercise coming next. */
  index: number;
  phaseDurationMs: number;
  /** Active (unpaused) milliseconds elapsed in the current phase. */
  elapsedMs: number;
  /** Timestamp of the last tick while running; null while paused/idle/complete. */
  lastActiveTs: number | null;
}

export interface WorkoutConfig {
  exerciseCount: number;
  exerciseMs: number;
  restMs: number;
}

/** A gap this long between ticks means the page was suspended, not running. */
export const SUSPEND_GAP_MS = 1500;

export const idleState = (): WorkoutState => ({
  phase: 'idle',
  isPaused: false,
  pauseReason: null,
  index: 0,
  phaseDurationMs: 0,
  elapsedMs: 0,
  lastActiveTs: null,
});

export function start(cfg: WorkoutConfig, now: number): WorkoutState {
  return {
    phase: 'exercise',
    isPaused: false,
    pauseReason: null,
    index: 0,
    phaseDurationMs: cfg.exerciseMs,
    elapsedMs: 0,
    lastActiveTs: now,
  };
}

const isActive = (s: WorkoutState) => s.phase === 'exercise' || s.phase === 'rest';

/** Advance the clock to `now`, crossing as many phase boundaries as needed. */
export function tick(s: WorkoutState, cfg: WorkoutConfig, now: number): WorkoutState {
  if (!isActive(s) || s.isPaused || s.lastActiveTs === null) return s;
  const delta = now - s.lastActiveTs;
  if (delta <= 0) return s;
  if (delta > SUSPEND_GAP_MS) {
    // The page was frozen (screen lock, background tab). Do not count that time.
    return { ...s, isPaused: true, pauseReason: 'hidden', lastActiveTs: null };
  }
  let { phase, index, phaseDurationMs } = s;
  let elapsedMs = s.elapsedMs + delta;
  while (elapsedMs >= phaseDurationMs) {
    const carry = elapsedMs - phaseDurationMs;
    if (phase === 'exercise') {
      if (index >= cfg.exerciseCount - 1) {
        return { ...s, phase: 'complete', elapsedMs: phaseDurationMs, lastActiveTs: null };
      }
      phase = 'rest';
      index += 1;
      phaseDurationMs = cfg.restMs;
    } else {
      phase = 'exercise';
      phaseDurationMs = cfg.exerciseMs;
    }
    elapsedMs = carry; // carry the overshoot forward so boundaries never drift
  }
  return { ...s, phase, index, phaseDurationMs, elapsedMs, lastActiveTs: now };
}

export function pause(s: WorkoutState, cfg: WorkoutConfig, now: number, reason: Exclude<PauseReason, null>): WorkoutState {
  if (!isActive(s) || s.isPaused) return s;
  const t = tick(s, cfg, now);
  if (!isActive(t) || t.isPaused) return t;
  return { ...t, isPaused: true, pauseReason: reason, lastActiveTs: null };
}

export function resume(s: WorkoutState, now: number): WorkoutState {
  if (!isActive(s) || !s.isPaused) return s;
  return { ...s, isPaused: false, pauseReason: null, lastActiveTs: now };
}

export const remainingMs = (s: WorkoutState) => Math.max(0, s.phaseDurationMs - s.elapsedMs);

/** Whole seconds shown on screen: the full duration at phase start, 0 only at the boundary. */
export const remainingSeconds = (s: WorkoutState) => Math.ceil(remainingMs(s) / 1000);

export const litTicks = (s: WorkoutState) =>
  s.phase === 'exercise' ? Math.min(60, Math.max(0, remainingSeconds(s))) : 0;

/** Total active milliseconds since Start, across all phases. */
export function totalElapsedMs(s: WorkoutState, cfg: WorkoutConfig): number {
  if (s.phase === 'idle') return 0;
  if (s.phase === 'complete') return cfg.exerciseCount * cfg.exerciseMs + (cfg.exerciseCount - 1) * cfg.restMs;
  const done = s.phase === 'exercise' ? s.index : s.index - 1; // fully finished exercises
  const rests = s.phase === 'exercise' ? s.index : s.index - 1; // fully finished rests
  return done * cfg.exerciseMs + rests * cfg.restMs + (s.phase === 'rest' ? cfg.exerciseMs : 0) + s.elapsedMs;
}

/** Restore a saved session safely: always paused, never skipping ahead. */
export function restore(raw: unknown, cfg: WorkoutConfig): WorkoutState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<WorkoutState>;
  if (r.phase !== 'exercise' && r.phase !== 'rest') return null;
  const index = Number(r.index);
  const elapsed = Number(r.elapsedMs);
  const minIndex = r.phase === 'rest' ? 1 : 0;
  if (!Number.isInteger(index) || index < minIndex || index >= cfg.exerciseCount) return null;
  const phaseDurationMs = r.phase === 'exercise' ? cfg.exerciseMs : cfg.restMs;
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= phaseDurationMs) return null;
  return {
    phase: r.phase,
    isPaused: true,
    pauseReason: 'restored',
    index,
    phaseDurationMs,
    elapsedMs: elapsed,
    lastActiveTs: null,
  };
}
