import { getDb, todayWibIsoDate } from '../db/connection.ts';
import { sseBus } from '../lib/sse.ts';

export type TradeDirection = 'buy' | 'sell';
export type TradeSession = 'sydney' | 'tokyo' | 'london' | 'new_york';
export type TradeOutcome = 'win' | 'loss' | 'breakeven' | 'open';
export type TradeEmotion = 'calm' | 'focused' | 'fomo' | 'revenge' | 'hesitant' | 'tilted';

export const VALID_TRADE_DIRECTIONS = new Set<TradeDirection>(['buy', 'sell']);
export const VALID_TRADE_SESSIONS = new Set<TradeSession>(['sydney', 'tokyo', 'london', 'new_york']);
export const VALID_TRADE_OUTCOMES = new Set<TradeOutcome>(['win', 'loss', 'breakeven', 'open']);
export const VALID_TRADE_EMOTIONS = new Set<TradeEmotion>(['calm', 'focused', 'fomo', 'revenge', 'hesitant', 'tilted']);

export interface TradingJournalEntry {
  id: string;
  symbol: string;
  direction: TradeDirection;
  session: TradeSession;
  entry_price: number;
  exit_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  r_multiple: number;
  pnl_usd: number;
  outcome: TradeOutcome;
  emotion: TradeEmotion;
  setup_reason: string;
  evaluation_note: string;
  checkin_date_wib: string | null;
  created_at: string;
}

export function getTradingJournalState(): {
  entries: TradingJournalEntry[];
  stats: {
    totalTrades: number;
    closedTrades: number;
    winRatePercent: number;
    totalR: number;
    netPnlUsd: number;
    calmWinRatePercent: number;
    tiltLossCount: number;
    patternSummary: string;
  };
} {
  const db = getDb();
  const entries = db
    .prepare('SELECT * FROM trading_journal_entries ORDER BY created_at DESC, rowid DESC')
    .all() as unknown as TradingJournalEntry[];

  const closed = entries.filter((e) => e.outcome !== 'open');
  const wins = closed.filter((e) => e.outcome === 'win');
  const winRatePercent = closed.length > 0 ? Math.round((wins.length / closed.length) * 100) : 0;
  const totalR = Math.round(entries.reduce((acc, e) => acc + e.r_multiple, 0) * 100) / 100;
  const netPnlUsd = Math.round(entries.reduce((acc, e) => acc + e.pnl_usd, 0) * 100) / 100;

  const calmClosed = closed.filter((e) => e.emotion === 'calm' || e.emotion === 'focused');
  const calmWins = calmClosed.filter((e) => e.outcome === 'win');
  const calmWinRatePercent = calmClosed.length > 0 ? Math.round((calmWins.length / calmClosed.length) * 100) : 0;

  const tiltLosses = closed.filter(
    (e) => e.outcome === 'loss' && (e.emotion === 'fomo' || e.emotion === 'revenge' || e.emotion === 'tilted'),
  );

  // Check correlation with high-risk Tilt Guard check-in days
  const highTiltCheckins = new Set(
    (
      db.prepare("SELECT date_wib FROM daily_checkins WHERE tilt_risk_level = 'high'").all() as Array<{ date_wib: string }>
    ).map((r) => r.date_wib),
  );
  const tradesOnHighTiltDays = closed.filter((e) => e.checkin_date_wib && highTiltCheckins.has(e.checkin_date_wib));

  const patternLines: string[] = [];
  if (closed.length === 0) {
    patternLines.push('Belum ada trade tertutup untuk dianalisis.');
  } else {
    patternLines.push(
      `Win rate saat kondisi Calm/Focused: ${calmWinRatePercent}% (${calmWins.length}/${calmClosed.length} trade).`,
    );
    if (tiltLosses.length > 0) {
      patternLines.push(
        `Terdeteksi ${tiltLosses.length} kekalahan akibat emosi FOMO/Revenge/Tilted — disiplin berhenti 15 menit setelah loss.`,
      );
    }
    if (tradesOnHighTiltDays.length > 0) {
      patternLines.push(
        `Peringatan korelasi: ${tradesOnHighTiltDays.length} trade diambil pada hari berstatus Tilt Guard HIGH.`,
      );
    }
  }
  patternLines.push('Catatan: Ringkasan evaluasi pola historis pribadi, bukan saran investasi.');

  return {
    entries,
    stats: {
      totalTrades: entries.length,
      closedTrades: closed.length,
      winRatePercent,
      totalR,
      netPnlUsd,
      calmWinRatePercent,
      tiltLossCount: tiltLosses.length,
      patternSummary: patternLines.join(' '),
    },
  };
}

export function createTradingJournalEntry(input: {
  symbol: string;
  direction: TradeDirection;
  session: TradeSession;
  entryPrice: number;
  exitPrice?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  rMultiple?: number;
  pnlUsd?: number;
  outcome?: TradeOutcome;
  emotion?: TradeEmotion;
  setupReason?: string;
  evaluationNote?: string;
}): { ok: boolean; entry?: TradingJournalEntry; error?: string } {
  if (!input.symbol?.trim()) return { ok: false, error: 'Symbol wajib diisi' };
  if (!VALID_TRADE_DIRECTIONS.has(input.direction)) return { ok: false, error: 'Direction harus buy atau sell' };
  if (!VALID_TRADE_SESSIONS.has(input.session)) return { ok: false, error: 'Session tidak valid' };
  const outcome = input.outcome ?? 'open';
  const emotion = input.emotion ?? 'calm';
  if (!VALID_TRADE_OUTCOMES.has(outcome)) return { ok: false, error: 'Outcome tidak valid' };
  if (!VALID_TRADE_EMOTIONS.has(emotion)) return { ok: false, error: 'Emotion tidak valid' };

  const db = getDb();
  const id = `jrn_${crypto.randomUUID().slice(0, 8)}`;
  const today = todayWibIsoDate();

  db.prepare(
    `INSERT INTO trading_journal_entries
     (id, symbol, direction, session, entry_price, exit_price, stop_loss, take_profit, r_multiple, pnl_usd, outcome, emotion, setup_reason, evaluation_note, checkin_date_wib)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.symbol.trim().toUpperCase(),
    input.direction,
    input.session,
    Number(input.entryPrice),
    input.exitPrice !== undefined && input.exitPrice !== null ? Number(input.exitPrice) : null,
    input.stopLoss !== undefined && input.stopLoss !== null ? Number(input.stopLoss) : null,
    input.takeProfit !== undefined && input.takeProfit !== null ? Number(input.takeProfit) : null,
    Number(input.rMultiple ?? 0),
    Number(input.pnlUsd ?? 0),
    outcome,
    emotion,
    input.setupReason ?? '',
    input.evaluationNote ?? '',
    today,
  );

  const entry = db.prepare('SELECT * FROM trading_journal_entries WHERE id = ?').get(id) as unknown as TradingJournalEntry;
  sseBus.emit('journal:update', entry);
  return { ok: true, entry };
}

export function deleteTradingJournalEntry(id: string): boolean {
  const db = getDb();
  const info = db.prepare('DELETE FROM trading_journal_entries WHERE id = ?').run(id);
  sseBus.emit('journal:update', { deletedId: id });
  return Number(info.changes) > 0;
}
