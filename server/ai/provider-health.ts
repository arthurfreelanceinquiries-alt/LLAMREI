import type { ProviderOutcome } from '../../shared/ai-protocol.ts';

const FAILURE_WINDOW_MS = 60_000;
const COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 120_000;
const MAX_ROUTES = 256;

interface CircuitState {
  failures: number;
  failedAt: number;
  retryAt: number;
  probing: boolean;
}

export class ProviderCircuitBreaker {
  private readonly circuits = new Map<string, CircuitState>();
  private readonly clock: () => number;

  constructor(clock = Date.now) {
    this.clock = clock;
  }

  claim(route: string): { probe: boolean } | null {
    const state = this.circuits.get(route);
    if (!state?.retryAt) return { probe: false };
    if (state.retryAt > this.clock() || state.probing) return null;
    state.probing = true;
    return { probe: true };
  }

  finish(route: string, { probe }: { probe: boolean }, outcome: ProviderOutcome, retryAfterMs?: number): void {
    const state = this.circuits.get(route);
    if (state?.retryAt && !probe) return;
    if (outcome === 'success') {
      this.circuits.delete(route);
      return;
    }
    if (outcome === 'cancelled') {
      if (state && probe) state.probing = false;
      return;
    }

    const now = this.clock();
    const failures = state && now - state.failedAt < FAILURE_WINDOW_MS ? state.failures + 1 : 1;
    const cooldown = Math.min(MAX_COOLDOWN_MS, Math.max(retryAfterMs ?? 0, COOLDOWN_MS));
    const retryAt = probe || outcome === 'rate_limited' || failures >= 2 ? now + cooldown : 0;
    this.circuits.delete(route);
    this.circuits.set(route, { failures, failedAt: now, retryAt, probing: false });
    if (this.circuits.size > MAX_ROUTES) {
      const oldest = this.circuits.keys().next().value;
      if (oldest) this.circuits.delete(oldest);
    }
  }
}
