// Strategy math for the tiny bot: dual-momentum trend following.
//
// The idea is the oldest one that survives contact with a replay: hold the
// symbols that are going up, sit in USDC on the ones that are not, and let
// the ranking — not a prediction — decide where the money rests. Buy-and-hold
// owns every loser for the whole window; this bot owns a symbol only while
// its own recent past says it is rising, so a falling window leaves it mostly
// in cash and a rising window leaves it concentrated in the leaders.
//
// Everything here is a pure function of the bars seen so far: no clock, no
// randomness, no environment. The harness runs the entry twice and the two
// action logs must match byte for byte, so determinism is a hard rule, not
// a preference.

/** Closes kept per symbol; the longest lookback below needs 49 of them. */
export const HISTORY_CAP = 96;

/**
 * Lookback lengths, in bars (hours on this competition's 1h bars). These
 * are maxima, not requirements: a scored window can be as short as 72 bars
 * with no warm-up, so a bot that waits for 48 bars of history before its
 * first decision would sit in cash for two thirds of the contest. The
 * views below shrink both lookbacks to whatever history exists (down to
 * MIN_HISTORY bars), which trades a little signal quality for actually
 * taking part.
 */
export const FAST_LOOKBACK = 12;
export const SLOW_LOOKBACK = 48;
export const MIN_HISTORY = 9;

/**
 * A symbol must clear this slow-momentum bar before it can be held. The
 * bar sits a little above zero on purpose: momentum measured over a
 * handful of early bars is mostly noise, and a symbol drifting sideways
 * at +0.1% has not earned the fee and impact its entry costs. Half a
 * percent of actual rise is the cheapest filter against falling knives.
 */
export const MIN_SLOW_MOMENTUM = 0.005;

/** Per-symbol closes, oldest first, capped at HISTORY_CAP entries. */
export class PriceBook {
  readonly closes = new Map<string, bigint[]>();

  record(symbol: string, close: bigint): void {
    let series = this.closes.get(symbol);
    if (series === undefined) {
      series = [];
      this.closes.set(symbol, series);
    }
    series.push(close);
    if (series.length > HISTORY_CAP) series.splice(0, series.length - HISTORY_CAP);
  }

  series(symbol: string): readonly bigint[] {
    return this.closes.get(symbol) ?? [];
  }
}

/**
 * Return over the last `lookback` bars as a plain ratio (0.05 = +5%), or
 * null when the series does not reach back that far or starts at zero.
 * Prices arrive as bigints at the symbol's price scale; the scale cancels
 * in the ratio, so a float division is exact enough for a ranking signal
 * and — being computed from the same inputs — identical on every run.
 */
export function lookbackReturn(closes: readonly bigint[], lookback: number): number | null {
  if (closes.length <= lookback) return null;
  const then = closes[closes.length - 1 - lookback];
  const now = closes[closes.length - 1];
  if (then === undefined || now === undefined || then === 0n) return null;
  return Number(now) / Number(then) - 1;
}

/** Simple moving average of the last `span` closes, or null when too short. */
export function movingAverage(closes: readonly bigint[], span: number): number | null {
  if (closes.length < span) return null;
  let sum = 0;
  for (let i = closes.length - span; i < closes.length; i++) sum += Number(closes[i]);
  return sum / span;
}

/**
 * One symbol's trend picture: its fast and slow momentum and whether its
 * latest close sits above its slow average. `score` blends the two momenta
 * (the slow one weighs more: it is the trend, the fast one is the timing).
 */
export interface TrendView {
  fast: number;
  slow: number;
  aboveAverage: boolean;
  score: number;
}

export function trendView(closes: readonly bigint[]): TrendView | null {
  if (closes.length < MIN_HISTORY) return null;
  const slowSpan = Math.min(SLOW_LOOKBACK, closes.length - 1);
  const fastSpan = Math.min(FAST_LOOKBACK, slowSpan);
  const fast = lookbackReturn(closes, fastSpan);
  const slow = lookbackReturn(closes, slowSpan);
  const average = movingAverage(closes, Math.min(SLOW_LOOKBACK, closes.length));
  if (fast === null || slow === null || average === null) return null;
  const latest = closes[closes.length - 1];
  if (latest === undefined) return null;
  return {
    fast,
    slow,
    aboveAverage: Number(latest) > average,
    score: 0.35 * fast + 0.65 * slow,
  };
}

/** A symbol earns a place in the book only while its trend is up. */
export function isEligible(view: TrendView): boolean {
  return view.slow > MIN_SLOW_MOMENTUM && view.aboveAverage && view.score > 0;
}

/** How many symbols the book holds at once; the rest of the equity waits in cash. */
export const MAX_HELD = 4;

/** Total equity share the book aims to have invested when the trend is kind. */
export const TARGET_INVESTED = 0.9;

/**
 * The book's target weight per symbol, as a share of equity (0 when the
 * symbol should not be held). Eligible symbols are ranked by score and the
 * best MAX_HELD split TARGET_INVESTED evenly; the per-symbol cap from the
 * hello (max_weight_bps) is applied by the caller, which knows it. When
 * nothing is eligible the map is empty and the bot sits in cash — that is
 * the whole defence against a falling window.
 */
export function targetWeights(book: PriceBook, symbols: readonly string[]): Map<string, number> {
  const ranked: { symbol: string; score: number }[] = [];
  for (const symbol of symbols) {
    const view = trendView(book.series(symbol));
    if (view !== null && isEligible(view)) ranked.push({ symbol, score: view.score });
  }
  ranked.sort((a, b) => b.score - a.score || (a.symbol < b.symbol ? -1 : 1));
  const held = ranked.slice(0, MAX_HELD);
  const weights = new Map<string, number>();
  if (held.length === 0) return weights;
  const each = TARGET_INVESTED / held.length;
  for (const { symbol } of held) weights.set(symbol, each);
  return weights;
}
