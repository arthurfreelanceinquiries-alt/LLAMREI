import type { AiProviderId } from '../types/llamrei';

export const aiProviderLabels: Record<AiProviderId, string> = {
  auto: 'Otomatis',
  local: 'Aturan lokal',
  ollama: 'Ollama lokal',
  opencode_zen: 'OpenCode Zen',
  openrouter: 'OpenRouter',
  opencode_cli: 'OpenCode CLI · harga belum terverifikasi',
  groq: 'Groq · harga belum terverifikasi',
  gemini: 'Gemini · harga belum terverifikasi',
};
