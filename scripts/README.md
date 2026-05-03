# SDK E2E Harness

`e2e-demo.ts` — frontend-free, end-to-end exercise of every `@bracketchain/sdk` method against a live cluster. Replaces "two Phantom wallets on Vercel" with a single Node script for SDK validation.

## Install

```sh
pnpm add -D tsx
```

`tsx` is the only new dependency. Everything else (`@coral-xyz/anchor`, `@solana/web3.js`, `@solana/spl-token`) is already in `package.json`.

## Run

```sh
# Both flows on devnet (default)
pnpm tsx scripts/e2e-demo.ts

# Happy path only — 8 players, Standard preset, asserts payout math
pnpm tsx scripts/e2e-demo.ts --flow=happy

# Cancel + refund only — 4 players join, organizer cancels, asserts full refund
pnpm tsx scripts/e2e-demo.ts --flow=cancel

# Against a local validator / Surfpool fork
pnpm tsx scripts/e2e-demo.ts --rpc=http://127.0.0.1:8899

# Custom funder keypair
pnpm tsx scripts/e2e-demo.ts --funder=/path/to/id.json
# or via env: FUNDER_KEYPAIR=/path/to/id.json pnpm tsx scripts/e2e-demo.ts
```

## Prerequisites

The funder keypair (default `~/.config/solana/id.json`) needs **≥ 0.5 SOL** on the target cluster. On devnet:

```sh
solana airdrop 1 --url devnet
```

## What it does

**Bootstrap**
- Reads `protocol_config` PDA. If absent, mints a fresh test USDC mint (funder = mint authority) and calls `initialize_protocol`. If present, reuses the on-chain mint — but bails out if the funder isn't the mint authority (the harness can't mint test USDC to participants in that case).

**Happy flow** (`--flow=happy`)
1. `createTournament` (Standard preset, 8 players, 1 USDC entry fee)
2. `joinTournament` × 8 with fresh keypairs (mints USDC + airdrops SOL beforehand)
3. Asserts vault holds 8 × 1 USDC
4. `startTournament` (chunked init across `bracketSize - 1` matches)
5. `reportResult` × 7, lower-seed wins each match deterministically
6. Final match passes `placements` array; SDK pre-creates ATAs
7. Asserts post-payout balances:
   - vault drained to 0
   - 1st = 60% of (pool − 3.5%)
   - 2nd = 25% of (pool − 3.5%)
   - 3rd = remainder (rounding absorbed)
   - treasury ≥ 3.5% of pool

**Cancel flow** (`--flow=cancel`)
1. `createTournament` (WTA, 4 players)
2. `joinTournament` × 4
3. `cancelTournament` (organizer-initiated, auto-discovers refund pairs)
4. Asserts vault drained, every player has full entry fee back

## What it does NOT cover

- `subscribe()` — separate harness, this script is sequential reads
- 128-player chunked start — covered by mocha test suite already
- Bye matches — Standard preset with non-power-of-2 counts; add `--players=7` later if needed
- Real Phantom signing UX — that's the frontend's job

## Re-running on the same cluster

Each run uses a fresh ephemeral organizer keypair + tournament name (`e2e-${Date.now()}`) so no PDA collisions. The protocol_config PDA is one-time — first run initializes it, subsequent runs reuse the same mint and accumulate test USDC in the funder/treasury.

## Pointing at Surfpool

Surfpool forks devnet locally with cheatcodes. Once it's running:

```sh
NO_DNA=1 surfpool start
pnpm tsx scripts/e2e-demo.ts --rpc=http://127.0.0.1:8899
```

The harness works the same — Surfpool's main win is fast resets and not waiting on devnet RPC.
