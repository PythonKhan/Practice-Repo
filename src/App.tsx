import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import data from './exercises.json';
import {
  idleState, litTicks, pause, remainingSeconds, restore, resume, start, tick,
  type WorkoutConfig, type WorkoutState,
} from './engine';
import { chime, speak, stopSpeech, unlockAudio } from './audio';

const EXERCISES = data.exercises;
const CFG: WorkoutConfig = {
  exerciseCount: EXERCISES.length,
  exerciseMs: data.exerciseSeconds * 1000,
  restMs: data.restSeconds * 1000,
};
const TOTAL_LABEL = formatClock(data.expectedTotalSeconds);
const K_SESSION = 'heel10.session';
const K_VOICE = 'heel10.voice';
const K_LAST = 'heel10.lastCompleted';

function formatClock(totalSeconds: number): string {
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null): void {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* storage is optional */
    }
  },
};

function loadSession(): WorkoutState {
  try {
    return restore(JSON.parse(store.get(K_SESSION) ?? 'null'), CFG) ?? idleState();
  } catch {
    return idleState();
  }
}

const isActive = (s: WorkoutState) => s.phase === 'exercise' || s.phase === 'rest';
const viewKey = (s: WorkoutState) => `${s.phase}|${s.index}|${remainingSeconds(s)}|${s.isPaused}|${s.pauseReason}`;

export default function App() {
  const stateRef = useRef<WorkoutState>(null as unknown as WorkoutState);
  if (stateRef.current === null) stateRef.current = loadSession();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [voiceOn, setVoiceOn] = useState(() => store.get(K_VOICE) !== 'off');
  const voiceRef = useRef(voiceOn);
  voiceRef.current = voiceOn;
  const [confirmEnd, setConfirmEnd] = useState(false);
  const resumeAfterConfirm = useRef(false);
  const [lastCompleted, setLastCompleted] = useState(() => store.get(K_LAST));
  const [liveText, setLiveText] = useState('');

  /** Apply a new engine state: persist, announce phase changes, re-render if the view changed. */
  const commit = useCallback((next: WorkoutState) => {
    const prev = stateRef.current;
    if (next === prev) return;
    stateRef.current = next;
    if (viewKey(next) === viewKey(prev)) return;

    store.set(K_SESSION, isActive(next) ? JSON.stringify(next) : null);

    if (next.phase !== prev.phase || next.index !== prev.index) {
      const name = EXERCISES[next.index]?.name ?? '';
      if (next.phase === 'rest') {
        setLiveText(`Get ready. Up next: ${name}`);
        if (voiceRef.current) {
          chime('ready');
          speak(`Get ready for ${name}`);
        }
      } else if (next.phase === 'exercise') {
        setLiveText(`Exercise ${next.index + 1} of ${EXERCISES.length}: ${name}`);
        if (prev.phase === 'rest') {
          stopSpeech(); // never let the announcement overlap the exercise
          if (voiceRef.current) chime('go');
        }
      } else if (next.phase === 'complete') {
        setLiveText('Workout complete');
        const stamp = new Date().toISOString();
        store.set(K_LAST, stamp);
        setLastCompleted(stamp);
        if (voiceRef.current) {
          chime('done');
          speak('Workout complete. Well done.');
        }
      }
    }
    rerender();
  }, []);

  const s = stateRef.current;
  const running = isActive(s) && !s.isPaused;

  // Clock: driven by performance.now(); the engine derives everything from elapsed time.
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const loop = () => {
      commit(tick(stateRef.current, CFG, performance.now()));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, commit]);

  // Auto-pause when the page is hidden or the phone locks.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        stopSpeech();
        commit(pause(stateRef.current, CFG, performance.now(), 'hidden'));
      }
    };
    const onPageHide = () => commit(pause(stateRef.current, CFG, performance.now(), 'hidden'));
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [commit]);

  // Keep the screen awake while the clock is running (when supported).
  useEffect(() => {
    if (!running) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    try {
      navigator.wakeLock
        ?.request('screen')
        .then((l) => {
          if (cancelled) void l.release().catch(() => {});
          else lock = l;
        })
        .catch(() => {});
    } catch {
      /* unsupported */
    }
    return () => {
      cancelled = true;
      void lock?.release().catch(() => {});
    };
  }, [running]);

  const beginWorkout = () => {
    unlockAudio();
    store.set(K_SESSION, null);
    setConfirmEnd(false);
    stateRef.current = idleState();
    commit(start(CFG, performance.now()));
    // Spoken inside the tap handler so iOS unlocks speech for later announcements.
    if (voiceRef.current) speak(`Starting with ${EXERCISES[0].name}`);
  };

  const togglePause = () => {
    const cur = stateRef.current;
    if (cur.isPaused) {
      unlockAudio();
      commit(resume(cur, performance.now()));
    } else {
      stopSpeech();
      commit(pause(cur, CFG, performance.now(), 'user'));
    }
  };

  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    store.set(K_VOICE, next ? 'on' : 'off');
    if (next) unlockAudio();
    else stopSpeech();
  };

  const askEnd = () => {
    resumeAfterConfirm.current = !stateRef.current.isPaused;
    commit(pause(stateRef.current, CFG, performance.now(), 'user'));
    setConfirmEnd(true);
  };
  const cancelEnd = () => {
    setConfirmEnd(false);
    if (resumeAfterConfirm.current) commit(resume(stateRef.current, performance.now()));
  };
  const endWorkout = () => {
    stopSpeech();
    setConfirmEnd(false);
    setLiveText('');
    commit(idleState());
  };

  const pauseNote =
    s.pauseReason === 'hidden'
      ? 'Paused while screen was off'
      : s.pauseReason === 'restored'
        ? 'Session restored — paused where you left off'
        : 'Paused';

  const controls = (
    <div className="controls">
      <p className="pause-note" data-testid="pause-note" aria-hidden={!s.isPaused}>
        {s.isPaused ? pauseNote : ' '}
      </p>
      <button className={`btn btn-primary ${s.isPaused ? 'is-resume' : ''}`} data-testid="pause" onClick={togglePause}>
        {s.isPaused ? 'Resume' : 'Pause'}
      </button>
      <button className="btn-link" data-testid="end" onClick={askEnd}>
        End Workout
      </button>
    </div>
  );

  const soundButton = (
    <button
      className="sound"
      data-testid="sound"
      aria-pressed={voiceOn}
      aria-label={`Voice announcements ${voiceOn ? 'on' : 'off'}`}
      onClick={toggleVoice}
    >
      <SoundIcon on={voiceOn} />
      <span>{voiceOn ? 'Voice on' : 'Voice off'}</span>
    </button>
  );

  let screen: JSX.Element;
  if (s.phase === 'idle') {
    screen = (
      <main className="screen welcome" data-testid="welcome">
        <div className="brand">
          <Ring lit={60} className="brand-ring" />
          <span className="brand-num">10</span>
        </div>
        <h1>Heel 10</h1>
        <p className="intro">A hands-free sequence of ten gentle, heel-friendly movements.</p>
        <p className="formula" data-testid="formula">
          10 exercises × 60 seconds + 9 × 5-second transitions = <strong>{TOTAL_LABEL}</strong>
        </p>
        <button className="btn btn-primary btn-start" data-testid="start" onClick={beginWorkout}>
          Start Workout
        </button>
        <label className="toggle">
          <span>Voice announcements</span>
          <input type="checkbox" role="switch" data-testid="voice-toggle" checked={voiceOn} onChange={toggleVoice} />
          <span className="switch" aria-hidden="true" />
          <span className="toggle-state">{voiceOn ? 'On' : 'Off'}</span>
        </label>
        <p className="safety">Wear supportive footwear. Stop if your heel pain increases.</p>
      </main>
    );
  } else if (s.phase === 'exercise') {
    const ex = EXERCISES[s.index];
    const secs = remainingSeconds(s);
    screen = (
      <main className={`screen exercise ${s.isPaused ? 'paused' : ''}`} data-testid="exercise">
        <header className="topbar">
          <span className="count" data-testid="count" aria-label={`Exercise ${s.index + 1} of ${EXERCISES.length}`}>
            <b>{s.index + 1}</b> / {EXERCISES.length}
          </span>
          {soundButton}
        </header>
        <h2 className="ex-name" data-testid="name">
          {ex.name}
        </h2>
        <div className="clock">
          <Ring lit={litTicks(s)} />
          <GifWindow key={ex.gif} src={ex.gif} alt={`${ex.name} demonstration`} frozen={s.isPaused} />
        </div>
        <p className="cue">{ex.cue}</p>
        <p className="seconds" data-testid="seconds" aria-hidden="true">
          {String(secs).padStart(2, '0')}
          <small>sec</small>
        </p>
        {controls}
      </main>
    );
  } else if (s.phase === 'rest') {
    const next = EXERCISES[s.index];
    screen = (
      <main className={`screen rest ${s.isPaused ? 'paused' : ''}`} data-testid="rest">
        <header className="topbar">
          <span className="count" data-testid="count">
            Next: <b>{s.index + 1}</b> / {EXERCISES.length}
          </span>
          {soundButton}
        </header>
        <h2 className="get-ready">GET READY</h2>
        <p className="up-next">
          Up next: <strong data-testid="next-name">{next.name}</strong>
        </p>
        <p className="rest-count" data-testid="rest-seconds" aria-hidden="true">
          {remainingSeconds(s)}
        </p>
        {/* Preloads the next GIF so the exercise starts instantly. */}
        <img className="next-preview" src={next.gif} alt="" />
        {controls}
      </main>
    );
  } else {
    screen = (
      <main className="screen complete" data-testid="complete">
        <div className="check" aria-hidden="true">
          <svg viewBox="0 0 48 48">
            <path d="M12 25l8 8 16-18" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1>Workout complete!</h1>
        <div className="stats">
          <div>
            <b data-testid="done-count">
              {EXERCISES.length} / {EXERCISES.length}
            </b>
            <span>exercises finished</span>
          </div>
          <div>
            <b data-testid="done-time">{TOTAL_LABEL}</b>
            <span>active time</span>
          </div>
        </div>
        {lastCompleted && (
          <p className="completed-on">
            Completed {new Date(lastCompleted).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        )}
        <button className="btn btn-primary btn-start" data-testid="again" onClick={beginWorkout}>
          Start Again
        </button>
        <button className="btn-link" data-testid="home" onClick={endWorkout}>
          Back to start
        </button>
      </main>
    );
  }

  return (
    <>
      {screen}
      <div className="sr-only" aria-live="polite" data-testid="live">
        {liveText}
      </div>
      {confirmEnd && (
        <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="end-title">
          <div className="dialog">
            <h3 id="end-title">End this workout?</h3>
            <p>Your progress in this session will be cleared.</p>
            <button className="btn btn-danger" data-testid="end-confirm" onClick={endWorkout}>
              End Workout
            </button>
            <button className="btn btn-ghost" data-testid="end-cancel" onClick={cancelEnd}>
              Keep going
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** 60 radial notches. They go dim one per second, clockwise from 12 o'clock. */
function Ring({ lit, className = '' }: { lit: number; className?: string }) {
  return (
    <svg className={`ring ${className}`} viewBox="0 0 400 400" aria-hidden="true" data-testid="ring" data-lit={lit}>
      {Array.from({ length: 60 }, (_, i) => (
        <line
          key={i}
          x1="200"
          y1="5"
          x2="200"
          y2="25"
          transform={`rotate(${i * 6} 200 200)`}
          className={i >= 60 - lit ? 'tick lit' : 'tick'}
        />
      ))}
    </svg>
  );
}

/** Inner radius of the tick ring as a fraction of the clock's width (with a small gap). */
const INNER_RADIUS = 0.425;

/**
 * The GIF sits in a square window sized so the whole picture fits inside the tick circle:
 * nothing is cropped and no corner touches the notches.
 */
function GifWindow({ src, alt, frozen }: { src: string; alt: string; frozen: boolean }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [side, setSide] = useState(66); // % of the clock; correct for the supplied 528×642 cards
  const [missing, setMissing] = useState(false);
  const [still, setStill] = useState(false);

  const onLoad = () => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    setSide((2 * INNER_RADIUS * Math.max(w, h) * 100) / Math.hypot(w, h));
  };

  // While paused, show a still frame so the animation stops with the clock.
  useLayoutEffect(() => {
    if (!frozen) {
      setStill(false);
      return;
    }
    try {
      const img = imgRef.current;
      const canvas = canvasRef.current;
      if (!img || !canvas || !img.complete || !img.naturalWidth) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      setStill(true);
    } catch {
      setStill(false);
    }
  }, [frozen]);

  return (
    <div className="gif-window" style={{ width: `${side}%`, height: `${side}%` }}>
      {missing ? (
        <p className="gif-missing" data-testid="gif-missing">
          Animation file not found:
          <br />
          <code>{src}</code>
        </p>
      ) : (
        <>
          <img
            ref={imgRef}
            src={src}
            alt={alt}
            data-testid="gif"
            onLoad={onLoad}
            onError={() => setMissing(true)}
            style={{ visibility: still ? 'hidden' : 'visible' }}
          />
          <canvas ref={canvasRef} data-testid="gif-still" style={{ display: still ? 'block' : 'none' }} />
        </>
      )}
    </div>
  );
}

function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9h3l5-4v14l-5-4H4z" fill="currentColor" />
      {on ? (
        <>
          <path d="M16 9a4 4 0 010 6" />
          <path d="M18.5 6.5a8 8 0 010 11" />
        </>
      ) : (
        <path d="M16 9l5 6M21 9l-5 6" />
      )}
    </svg>
  );
}
