// Fase 4 Voice Mode (FR-09): Browser SpeechRecognition & SpeechSynthesis with graceful fallback

interface BrowserSpeechRecognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function isVoiceRecognitionSupported(): boolean {
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function startVoiceDictation(
  onTranscript: (text: string) => void,
  onError: (msg: string) => void,
  onDone: () => void,
): () => void {
  const w = window as unknown as {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) {
    onError('Browser ini tidak mendukung Web Speech API (pakai Chrome/Edge atau ketik langsung).');
    onDone();
    return () => {};
  }

  const rec = new Ctor();
  rec.lang = 'id-ID';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = (ev) => {
    const transcript = ev.results?.[0]?.[0]?.transcript ?? '';
    if (transcript) onTranscript(transcript);
  };
  rec.onerror = (ev) => {
    onError(`Voice recognition error: ${ev.error}`);
  };
  rec.onend = () => {
    onDone();
  };
  rec.start();
  return () => rec.stop();
}

export function speakLlamreiReply(text: string): void {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const clean = text.replace(/[*_`#]/g, '');
  const utter = new SpeechSynthesisUtterance(clean.slice(0, 400));
  utter.lang = 'id-ID';
  utter.rate = 1.05;
  window.speechSynthesis.speak(utter);
}
