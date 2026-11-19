import { useState } from 'react';
import type { TradingJournalEntryItem, TradingJournalState } from '../../types/llamrei';

interface Props {
  journal: TradingJournalState;
  onCreateEntry: (input: {
    symbol: string;
    direction: TradingJournalEntryItem['direction'];
    session: TradingJournalEntryItem['session'];
    entryPrice: number;
    exitPrice?: number | null;
    rMultiple: number;
    pnlUsd: number;
    outcome: TradingJournalEntryItem['outcome'];
    emotion: TradingJournalEntryItem['emotion'];
    setupReason: string;
    evaluationNote: string;
  }) => Promise<void>;
  onDeleteEntry: (id: string) => Promise<void>;
  onAskLlamreiPattern: (summary: string) => void;
}

export function TradingJournalView({ journal, onCreateEntry, onDeleteEntry, onAskLlamreiPattern }: Props) {
  const [symbol, setSymbol] = useState('XAUUSD');
  const [direction, setDirection] = useState<TradingJournalEntryItem['direction']>('buy');
  const [session, setSession] = useState<TradingJournalEntryItem['session']>('london');
  const [entryPrice, setEntryPrice] = useState('2640');
  const [exitPrice, setExitPrice] = useState('2652');
  const [rMultiple, setRMultiple] = useState('1.5');
  const [pnlUsd, setPnlUsd] = useState('150');
  const [outcome, setOutcome] = useState<TradingJournalEntryItem['outcome']>('win');
  const [emotion, setEmotion] = useState<TradingJournalEntryItem['emotion']>('focused');
  const [setupReason, setSetupReason] = useState('');
  const [evaluationNote, setEvaluationNote] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      await onCreateEntry({
        symbol,
        direction,
        session,
        entryPrice: Number(entryPrice) || 0,
        exitPrice: exitPrice ? Number(exitPrice) : null,
        rMultiple: Number(rMultiple) || 0,
        pnlUsd: Number(pnlUsd) || 0,
        outcome,
        emotion,
        setupReason,
        evaluationNote,
      });
      setSetupReason('');
      setEvaluationNote('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyimpan entri jurnal');
    }
  };

  const { stats, entries } = journal;

  return (
    <div className="space-y-3">
      <div className="pb-2 border-b flex flex-wrap items-center justify-between gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
        <div>
          <div className="text-xs font-mono-num" style={{ color: 'var(--accent)' }}>
            TRADING JOURNAL & TILT CORRELATION (FR-42, FR-43)
          </div>
          <h1 className="text-sm font-bold">Jurnal Trading Manual & Evaluasi Pola Emosi</h1>
        </div>
        <button
          onClick={() =>
            onAskLlamreiPattern(
              `Evaluasi pola jurnal trading saya (${stats.closedTrades} trade, Win Rate ${stats.winRatePercent}%, Total R ${stats.totalR}, Tilt Loss ${stats.tiltLossCount}). Beri aturan perbaikan disiplin spesifik.`,
            )
          }
          className="px-3 py-1.5 rounded text-xs font-mono-num font-bold cursor-pointer"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          ⚡ Analisis Pola oleh Llamrei
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="themed-card p-2.5">
          <div className="font-mono-num" style={{ color: 'var(--text-muted)' }}>
            WIN RATE
          </div>
          <div className="text-base font-mono-num font-bold" style={{ color: 'var(--accent)' }}>
            {stats.winRatePercent}% ({stats.closedTrades})
          </div>
        </div>
        <div className="themed-card p-2.5">
          <div className="font-mono-num" style={{ color: 'var(--text-muted)' }}>
            TOTAL R-MULTIPLE
          </div>
          <div className="text-base font-mono-num font-bold" style={{ color: stats.totalR >= 0 ? 'var(--accent)' : '#f87171' }}>
            {stats.totalR >= 0 ? `+${stats.totalR}R` : `${stats.totalR}R`}
          </div>
        </div>
        <div className="themed-card p-2.5">
          <div className="font-mono-num" style={{ color: 'var(--text-muted)' }}>
            NET PNL (USD)
          </div>
          <div className="text-base font-mono-num font-bold" style={{ color: stats.netPnlUsd >= 0 ? 'var(--accent)' : '#f87171' }}>
            ${stats.netPnlUsd}
          </div>
        </div>
        <div className="themed-card p-2.5">
          <div className="font-mono-num" style={{ color: 'var(--text-muted)' }}>
            CALM WIN / TILT LOSS
          </div>
          <div className="text-base font-mono-num font-bold text-amber-300">
            {stats.calmWinRatePercent}% / {stats.tiltLossCount}x
          </div>
        </div>
      </div>

      {/* Pattern Summary */}
      <div className="themed-card p-2.5 text-xs" style={{ borderColor: 'var(--border-accent)' }}>
        {stats.patternSummary}
      </div>

      {/* Add Entry Form */}
      <form onSubmit={(e) => void submit(e)} className="themed-card p-3 space-y-2 text-xs">
        <div className="font-mono-num font-bold" style={{ color: 'var(--text-secondary)' }}>
          + CATAT TRADE MANUAL (TANPA EKSEKUSI ORDER)
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="Pair (XAUUSD)"
            className="px-2 py-1.5 rounded border font-mono-num outline-none"
            style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          />
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as TradingJournalEntryItem['direction'])}
            className="px-2 py-1.5 rounded border"
            style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          >
            <option value="buy">BUY / LONG</option>
            <option value="sell">SELL / SHORT</option>
          </select>
          <select
            value={session}
            onChange={(e) => setSession(e.target.value as TradingJournalEntryItem['session'])}
            className="px-2 py-1.5 rounded border"
            style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          >
            <option value="sydney">Sydney</option>
            <option value="tokyo">Tokyo</option>
            <option value="london">London</option>
            <option value="new_york">New York</option>
          </select>
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as TradingJournalEntryItem['outcome'])}
            className="px-2 py-1.5 rounded border"
            style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          >
            <option value="win">WIN</option>
            <option value="loss">LOSS</option>
            <option value="breakeven">BREAKEVEN</option>
            <option value="open">OPEN</option>
          </select>
          <input
            type="number"
            step="any"
            value={entryPrice}
            onChange={(e) => setEntryPrice(e.target.value)}
            placeholder="Entry"
            className="px-2 py-1.5 rounded border font-mono-num outline-none"
            style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          />
          <input
            type="number"
            step="any"
            value={exitPrice}
            onChange={(e) => setExitPrice(e.target.value)}
            placeholder="Exit"
            className="px-2 py-1.5 rounded border font-mono-num outline-none"
            style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          />
          <input
            type="number"
            step="0.1"
            value={rMultiple}
            onChange={(e) => setRMultiple(e.target.value)}
            placeholder="R-Multiple"
            className="px-2 py-1.5 rounded border font-mono-num outline-none"
            style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          />
          <select
            value={emotion}
            onChange={(e) => setEmotion(e.target.value as TradingJournalEntryItem['emotion'])}
            className="px-2 py-1.5 rounded border"
            style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          >
            <option value="focused">Emosi: Focused</option>
            <option value="calm">Emosi: Calm</option>
            <option value="hesitant">Emosi: Hesitant</option>
            <option value="fomo">Emosi: FOMO</option>
            <option value="revenge">Emosi: Revenge</option>
            <option value="tilted">Emosi: Tilted</option>
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            type="number"
            step="any"
            value={pnlUsd}
            onChange={(e) => setPnlUsd(e.target.value)}
            placeholder="PnL USD"
            className="px-2 py-1.5 rounded border font-mono-num outline-none"
            style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          />
          <input
            value={setupReason}
            onChange={(e) => setSetupReason(e.target.value)}
            placeholder="Alasan Setup (mis. Liquidity Sweep + FVG)..."
            className="px-2 py-1.5 rounded border outline-none"
            style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          />
          <input
            value={evaluationNote}
            onChange={(e) => setEvaluationNote(e.target.value)}
            placeholder="Catatan evaluasi..."
            className="px-2 py-1.5 rounded border outline-none"
            style={{ background: 'var(--bg-void)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          />
        </div>

        {errorMsg && <div className="text-rose-400 font-mono-num">⚠ {errorMsg}</div>}
        <button type="submit" className="px-3 py-1.5 rounded font-mono-num font-bold cursor-pointer" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
          + Simpan Entri Jurnal
        </button>
      </form>

      {/* Entries List */}
      <div className="space-y-2">
        {entries.map((e) => (
          <div key={e.id} className="themed-card p-3 space-y-1 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-mono-num">
                <span className="font-bold text-sm">{e.symbol}</span>
                <span className={e.direction === 'buy' ? 'text-emerald-400' : 'text-rose-400'}>{e.direction.toUpperCase()}</span>
                <span style={{ color: 'var(--text-muted)' }}>· {e.session.toUpperCase()}</span>
                <span className="px-1.5 py-0.5 rounded bg-white/5">{e.emotion.toUpperCase()}</span>
              </div>
              <div className="flex items-center gap-2 font-mono-num">
                <span className={e.r_multiple >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                  {e.r_multiple >= 0 ? `+${e.r_multiple}R` : `${e.r_multiple}R`} (${e.pnl_usd})
                </span>
                <span className="px-1.5 py-0.5 rounded bg-white/5">{e.outcome.toUpperCase()}</span>
                <button onClick={() => void onDeleteEntry(e.id)} className="text-rose-400 cursor-pointer">
                  ✕
                </button>
              </div>
            </div>
            {e.setup_reason && <div style={{ color: 'var(--text-secondary)' }}>Setup: {e.setup_reason}</div>}
            {e.evaluation_note && <div style={{ color: 'var(--text-muted)' }}>Evaluasi: {e.evaluation_note}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
