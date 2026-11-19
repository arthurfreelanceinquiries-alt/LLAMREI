// Offline Web Audio API Alarm Synthesizer for Hard Alarms (no external MP3 required)
let audioCtx: AudioContext | null = null;
let loopTimer: number | null = null;

function playBurst(preset: string) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }

    const now = audioCtx.currentTime;
    const freqs =
      preset === 'siren_urgent'
        ? [880, 1174, 880, 1174]
        : preset === 'zen_chime'
          ? [523.25, 659.25, 783.99]
          : [740, 987.77, 1174.66];

    freqs.forEach((f, idx) => {
      if (!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = preset === 'zen_chime' ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(f, now + idx * 0.16);
      gain.gain.setValueAtTime(0.001, now + idx * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.18, now + idx * 0.16 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.16 + 0.15);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + idx * 0.16);
      osc.stop(now + idx * 0.16 + 0.16);
    });
  } catch {
    // Ignore autoplay errors before user gesture
  }
}

export function startHardAlarmSoundLoop(preset = 'tactical_pulse'): void {
  stopHardAlarmSoundLoop();
  playBurst(preset);
  loopTimer = window.setInterval(() => playBurst(preset), 1800);
}

export function stopHardAlarmSoundLoop(): void {
  if (loopTimer !== null) {
    window.clearInterval(loopTimer);
    loopTimer = null;
  }
}
