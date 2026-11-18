// BTC race bot: 5-minute burst momentum, half size, 6-bar hold, long only.
//
// Strategy (validated on the kit's frozen dev window, 24h of cbBTC
// 1-minute bars, Nov 17 14:44 UTC -> Nov 18 14:44 UTC, and on the
// previous race's dev window, Nov 16 06:03 UTC -> Nov 17 06:03 UTC):
//   - The pool price lags spot BTC, so a sharp multi-minute burst keeps
//     drifting the same way for several minutes after it prints. A
//     5-minute window catches the burst better than 3 minutes: on this
//     window the 3-minute rule from the previous round loses -$1.45,
//     while the 5-minute rule below makes +$1.93.
//   - Entry: flat, and the trailing 5-minute close-to-close return is
//     above +60 bps -> buy 50% of cash. Half size keeps the
//     constant-product price impact near 6 bps a leg (depth on this
//     window medians ~844k USDC, so a full-size round trip pays ~44 bps
//     in fees, slippage and impact; at half size ~28 bps). Lower
//     thresholds were tested and rejected: at 50 bps the per-trade
//     expectancy is about -$1, because most moves that size are noise
//     that mean-reverts while every round trip still pays ~28 bps.
//     At 65 bps and above the old window turns negative, so 60 bps is
//     the plateau both windows agree on (55-60 bps is positive on both;
//     60 bps is the best joint point).
//   - Exit: sell the whole position 6 bars after the entry decision,
//     or earlier if the close falls more than 80 bps below the peak
//     close since entry (trailing stop; never triggered on either dev
//     window, kept as insurance against a sharp reversal on the unseen
//     race window). A scale-out variant (half at 6 bars, rest at 10)
//     was tested: it makes less on both windows (+$1.86 / +$1.21),
//     because the drift fades after ~6 bars, so the whole position
//     goes at 6 bars.
//   - Never trades during warm-up; never shorts; at most one position.
//   - max_slippage_bps 100 on every order: a fill more than 1% past the
//     latest close is refused rather than chased.
//
// Dev-window results (kit grade-local, --driver process, exact harness):
//   This window (Nov 17-18): net PnL +$1.9298 on $1,000, 2 round trips
//   (4 fills), max drawdown 0.123%, fees $0.80.
//   Previous window (Nov 16-17, graded with that round's kit):
//   net PnL +$1.8588, 2 round trips, max drawdown 0.144%, fees $0.80.
//   Both windows pass the dev gate (net PnL above 0) with margin.
// The edge is small and the profit concentrates in a few trades, so no
// result on the unseen race window is promised: the bot is a
// disciplined, low-drawdown momentum catcher, not a guarantee.
//
// Deterministic: no clock, no environment, no randomness; all decisions
// are pure functions of the closes seen so far, in float64. Two runs on
// the same bars give the same orders.

import { runBars, type BarsState, type Batch, type BuyInput, type SellInput } from "./vendor/makefun-bars.ts";

const SYMBOL = "CBBTC";
// Entry: trailing 5-minute return above this, in bps.
const ENTRY_BPS = 60;
// Lookback for the entry return, in bars.
const LOOKBACK_BARS = 5;
// Full exit: bars after the entry decision to sell the whole position.
const HOLD_BARS = 6;
// Exit: close this many bps below the peak close since entry.
const TRAIL_BPS = 80;
// Size: half of cash per entry.
const SIZE_FRACTION = 2n; // cash / 2
const MAX_SLIPPAGE_BPS = 100;
// Minimum buy notional: 1 USDC, in quote units (1e6 per USDC).
const MIN_NOTIONAL = 1_000_000n;

// Closes seen so far (float64 USDC), oldest first.
const closes: number[] = [];
// Seq of the batch where the current position's entry was decided.
let entrySeq: number | null = null;
// Highest close seen since the entry decision.
let peakClose: number | null = null;

await runBars({
  onBatch(state: BarsState, _batch: Batch): (BuyInput | SellInput)[] {
    if (state.warmingUp) return [];
    const closeRaw = state.close(SYMBOL);
    if (closeRaw === null) return [];
    const close = Number(closeRaw) / 100000;
    closes.push(close);
    const held = state.positions.get(SYMBOL);
    if (held === undefined) {
      entrySeq = null;
      peakClose = null;
      if (closes.length > LOOKBACK_BARS) {
        const retBps = (closes[closes.length - 1] / closes[closes.length - 1 - LOOKBACK_BARS] - 1) * 10000;
        if (retBps > ENTRY_BPS) {
          const amount = state.cash / SIZE_FRACTION;
          if (amount >= MIN_NOTIONAL) {
            entrySeq = state.seq;
            peakClose = close;
            return [{ side: "buy", symbol: SYMBOL, notional_quote_units: amount, max_slippage_bps: MAX_SLIPPAGE_BPS }];
          }
        }
      }
      return [];
    }
    // Holding: track the peak and check the exits. The trailing stop is
    // checked first so a sharp reversal always closes the whole position,
    // even before the hold bar. Exits are level-triggered, so a rejected
    // sell is retried on the next batch while the condition still holds.
    if (peakClose === null) peakClose = close;
    else if (close > peakClose) peakClose = close;
    const heldBars = entrySeq !== null ? state.seq - entrySeq : 0;
    if (peakClose !== null && (peakClose / close - 1) * 10000 > TRAIL_BPS) {
      return [{ side: "sell", symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    if (entrySeq !== null && heldBars >= HOLD_BARS) {
      return [{ side: "sell", symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  },
});
