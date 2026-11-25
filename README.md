# Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana

[![Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![Rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/ahmed1813544/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/rank.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![Reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/ahmed1813544/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/reward.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

Entry for the [Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1) bounty on make.fun.

## What it does

A dual-momentum trend follower for the seven-symbol Solana universe (FARTCOIN, JITOSOL, POPCAT, RAY, SOL, WETH, WIF) on hourly bars, speaking the `agent-fun/bars-replay/v1` protocol:

- `strategy.ts` scores every symbol on fast (12-bar) and slow (48-bar) momentum — the lookbacks shrink to whatever history exists, so the bot takes part from the first hours of a short window — and holds only the symbols whose trend is up, ranked best first, at most four at a time.
- `main.ts` aims the book at an even split of 90% of equity across the held symbols (never past the 25% weight cap) and trades only the drift beyond a 1.5%-of-equity band, so fees and pool impact are paid only when a trend actually starts, breaks, or runs. A symbol whose trend breaks is sold in full; when nothing trends, the book waits in USDC.
- Buys are shrunk until their own pool impact fits a 200 bps budget, and every decision is a pure function of the bars seen so far — no clock, no randomness — so the two grading executions agree byte for byte.

Buy-and-hold holds every loser for the whole window; this bot's whole edge is refusing to.

## Run it

The grader runs `node main.ts` (Node 22) with the replay harness feeding bars on stdin. To score it against the kit's dev window:

```sh
node cli/makefun.mjs grade-local --kit <kit dir> --bot <this repo> --driver docker
```
