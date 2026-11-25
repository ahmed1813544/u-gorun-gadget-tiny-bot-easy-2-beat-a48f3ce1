// Tiny Bot: beat buy-and-hold on Solana hourly bars.
//
// A dual-momentum trend follower over the seven-symbol universe. On every
// bar it asks strategy.ts which symbols are trending up, aims the book at
// an even split of the target invested share across the best of them, and
// trades only the difference — and only when that difference is worth the
// fees. Symbols whose trend breaks are sold in full; when nothing trends,
// the book waits in USDC. Buy-and-hold cannot do any of that: it holds
// every symbol, winners and losers alike, for the whole window.
//
// The wire protocol (agent-fun/bars-replay/v1) is spoken by the vendored
// shim in vendor/makefun-bars.ts; this file owns only the decisions.
// Orders decided on one bar fill at the next bar's open, a sell's proceeds
// never fund a buy in the same reply, and every position is flattened at
// the end — the planner below is written around all three facts.

import { runBars, type BarsState, type OrderInput } from './vendor/makefun-bars.ts';
import { PriceBook, targetWeights } from './strategy.ts';

/** Fills may walk at most this far from the latest close before the market refuses them. */
const MAX_SLIPPAGE_BPS = 400;

/**
 * Rebalance a symbol only once its value is this share of equity away from
 * its target. Hourly noise under the band is ignored; a real drift — a
 * trend starting, breaking, or running far enough to unbalance the book —
 * crosses it and trades. The band is what keeps the 10 bps fee and the
 * pool impact from eating the edge one small trade at a time.
 */
const DRIFT_BAND = 0.015;

/** Skip (or shrink) a trade whose own pool impact alone would cost more than this. */
const IMPACT_LIMIT_BPS = 200n;

const book = new PriceBook();

/** Quote units of `share` of the account's equity, truncated. */
function shareOf(state: BarsState, share: number): bigint {
  return BigInt(Math.floor(share * Number(state.equity)));
}

/**
 * Shrink a planned buy until its pool impact fits the limit, halving as
 * needed; returns 0n when even a small trade would move the pool too much
 * (a thin pool is a reason to wait for the next bar, not to pay up).
 */
function impactFitted(state: BarsState, symbol: string, want: bigint): bigint {
  let size = want;
  while (size > 0n) {
    const impact = state.impactBps(symbol, size);
    if (impact === null || impact <= IMPACT_LIMIT_BPS) return size;
    size /= 2n;
  }
  return 0n;
}

await runBars({
  onBatch(state, batch) {
    for (const bar of batch.bars) book.record(bar.symbol, BigInt(bar.c));
    // Warm-up bars build history only; any order on one is rejected.
    if (state.warmingUp) return [];

    const symbols = state.hello.symbols.map((s) => s.symbol);
    const capWeight = state.hello.caps.max_weight_bps / 10_000;
    const minNotional = BigInt(state.hello.fees.min_notional_quote_units);
    const targets = targetWeights(book, symbols);
    const band = shareOf(state, DRIFT_BAND);
    const orders: OrderInput[] = [];

    // Sells first: exits and trims. Their proceeds land for the next bar's
    // buys, never this one's, so the buy pass below budgets from the cash
    // the account already holds.
    for (const symbol of symbols) {
      const held = state.positions.get(symbol);
      if (held === undefined || held.qty === 0n) continue;
      const heldValue = state.value(symbol, held.qty);
      const weight = Math.min(targets.get(symbol) ?? 0, capWeight);
      const targetValue = shareOf(state, weight);
      if (heldValue - targetValue <= band) continue;
      if (targetValue === 0n) {
        // The trend broke: leave in full, whatever the band says.
        orders.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
      } else {
        const excess = heldValue - targetValue;
        const qty = (held.qty * excess) / heldValue;
        if (qty > 0n && state.value(symbol, qty) >= minNotional) {
          orders.push({ side: 'sell', symbol, qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
        }
      }
    }

    // Buys: entries and top-ups, budgeted from cash on hand and from each
    // symbol's remaining room under the weight cap.
    let cash = state.cash;
    for (const symbol of symbols) {
      const weight = Math.min(targets.get(symbol) ?? 0, capWeight);
      if (weight === 0) continue;
      const heldQty = state.positions.get(symbol)?.qty ?? 0n;
      const heldValue = heldQty === 0n ? 0n : state.value(symbol, heldQty);
      const targetValue = shareOf(state, weight);
      if (targetValue - heldValue <= band) continue;
      let want = targetValue - heldValue;
      const room = state.weightRoom(symbol);
      if (want > room) want = room;
      if (want > cash) want = cash;
      want = impactFitted(state, symbol, want);
      if (want < minNotional) continue;
      orders.push({ side: 'buy', symbol, notional_quote_units: want, max_slippage_bps: MAX_SLIPPAGE_BPS });
      cash -= want;
    }

    return orders;
  },
});
