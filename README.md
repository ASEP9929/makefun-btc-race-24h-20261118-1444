# BTC race bot — 5-minute burst momentum, half size, 6-bar hold (long only)

Entry for make.fun competition `btc-race-24h-20261118-1444` ("Race a BTC
trading bot live for 24 hours", $250, top 10 net PnL).

## What it does

`main.ts` (Node 22, stdlib only + the kit's `vendor/makefun-bars.ts`
shim, byte-identical) trades Coinbase Wrapped BTC (cbBTC) against USDC on
1-minute bars, starting with $1,000 of paper money:

- **Entry:** flat, and the trailing 5-minute close-to-close return is
  above +60 bps → buy 50% of cash.
- **Exit:** sell the whole position 6 bars after the entry decision, or
  earlier if the close falls more than 80 bps below the peak close since
  entry (trailing stop).
- **Guards:** never trades during warm-up, never shorts, at most one
  position, `max_slippage_bps` 100 on every order.

## Why

The pool price lags spot BTC, so a sharp multi-minute burst keeps
drifting the same way for several minutes after it prints. A 5-minute
window catches the burst better than 3 minutes on this window: the
previous round's 3-minute rule loses −$1.45 here, while the 5-minute
rule makes +$1.93. Half size keeps the constant-product impact near
6 bps a leg (depth medians ~844k USDC on this window); a full-size round
trip pays ~44 bps in fees, slippage and impact, at half size ~28 bps.
Lower entry thresholds were tested and rejected (at 50 bps the
per-trade expectancy is about −$1), and at 65 bps and above the older
window turns negative, so 60 bps is the plateau both windows agree on.
A scale-out variant (half at 6 bars, rest at 10) makes less on both
windows, because the drift fades after ~6 bars.

## Validation (dev windows, kit grade-local, `--driver process`)

- **This window (Nov 17–18, 2026): net PnL +$1.9298**, 2 round trips
  (4 fills), max drawdown 0.123%, fees $0.80.
- **Previous window (Nov 16–17, graded with that round's kit):
  net PnL +$1.8588**, 2 round trips, max drawdown 0.144%, fees $0.80.

Both windows pass the dev gate (net PnL above 0). The edge is small and
concentrated in a few trades — no result on the unseen race window is
promised.

## Run

```sh
node cli/makefun.mjs grade-local --kit <kit> --bot . --driver process --worktree
```

## Files

- `main.ts` — the bot (entrypoint).
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's SDK shim.
- `LICENSE` — MIT.
