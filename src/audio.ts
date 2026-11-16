/** Best-effort voice + chime. Every call is safe when the APIs are missing or blocked. */
let ctx: AudioContext | null = null;

/** Must be called from a user gesture (the Start button) so iOS allows later audio. */
export function unlockAudio(): void {
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AC && !ctx) ctx = new AC();
    void ctx?.resume();
  } catch {
    ctx = null;
  }
}

export function chime(kind: 'ready' | 'go' | 'done'): void {
  try {
    if (!ctx || ctx.state !== 'running') return;
    const notes = kind === 'ready' ? [660, 880] : kind === 'go' ? [880] : [660, 880, 1100];
    const t0 = ctx.currentTime;
    notes.forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      const at = t0 + i * 0.16;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.2, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(at);
      osc.stop(at + 0.3);
    });
  } catch {
    /* audio is optional */
  }
}

export function stopSpeech(): void {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
}

/** Speak one phrase, replacing anything still being spoken (never queues). */
export function speak(text: string): void {
  try {
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 1;
    synth.speak(u);
  } catch {
    /* speech is optional */
  }
}
