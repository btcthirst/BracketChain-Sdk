/**
 * End-to-end harness for @bracketchain/sdk.
 *
 * Drives every SDK method against a live cluster — no frontend, no Phantom,
 * no wallet adapter. One funder keypair pays for everything; participants
 * are ephemeral keypairs generated per-run.
 *
 * Flows:
 *   --flow=happy    8-player Standard preset → final payout assertion
 *   --flow=cancel   4-player join → cancel → refund assertion
 *   --flow=both     run happy then cancel (default)
 *
 * Usage:
 *   tsx scripts/e2e-demo.ts                             # devnet, both flows
 *   tsx scripts/e2e-demo.ts --flow=happy                # happy path only
 *   tsx scripts/e2e-demo.ts --rpc=http://127.0.0.1:8899 # local validator / surfpool
 *   FUNDER_KEYPAIR=/path/id.json tsx scripts/e2e-demo.ts
 *
 * The funder keypair must have ≥ 0.5 SOL on the target cluster. Each run
 * costs a few thousand lamports per participant for rent + tx fees.
 *
 * Bootstrap behavior:
 *   - If protocol_config does NOT exist → harness creates a fresh test USDC
 *     mint owned by the funder and calls initialize_protocol with it.
 *   - If protocol_config DOES exist → harness reuses its usdc_mint. If the
 *     funder is not the mint authority, the run fails with a clear message
 *     (you can't mint test USDC into participant wallets).
 *
 * On-chain program: AuXJKpuZtkegs2ZSgopgckhN7Ev8bUz4zBc238LD2F1 (devnet).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { AnchorProvider, BN, Program, Wallet, Idl } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";

import {
  BracketChainClient,
  cancelTournament,
  createTournament,
  findProtocolConfigPda,
  findTournamentPda,
  findVaultPda,
  joinTournament,
  payoutPreset,
  reportResult,
  startTournament,
} from "../src";

import IDL_JSON from "../src/idl/bracket_chain.json" with { type: "json" };
import type { BracketChain } from "../src/idl/bracket_chain";

// ─────────────────────────────────────────────────────────────────────────────
// CLI args
// ─────────────────────────────────────────────────────────────────────────────

type Flow = "happy" | "cancel" | "both";

interface Cli {
  rpc: string;
  flow: Flow;
  funderKeypair: string;
}

function parseCli(): Cli {
  const args = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };

  const flowArg = (get("flow") ?? "both") as Flow;
  if (!["happy", "cancel", "both"].includes(flowArg)) {
    throw new Error(`--flow must be happy|cancel|both (got "${flowArg}")`);
  }

  return {
    rpc: get("rpc") ?? "https://api.devnet.solana.com",
    flow: flowArg,
    funderKeypair:
      get("funder") ??
      process.env.FUNDER_KEYPAIR ??
      path.join(os.homedir(), ".config", "solana", "id.json"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const USDC_DECIMALS = 6;
const ENTRY_FEE_USDC = 1_000_000; // 1 USDC = 10^6 micro-USDC
const PROTOCOL_FEE_BPS = 350; // 3.5% — must match constants.rs
const PARTICIPANT_AIRDROP_SOL = 0.05;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function loadKeypair(filePath: string): Keypair {
  const expanded = filePath.startsWith("~")
    ? path.join(os.homedir(), filePath.slice(1))
    : filePath;
  const raw = JSON.parse(fs.readFileSync(expanded, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function shortAddr(pk: PublicKey): string {
  const s = pk.toBase58();
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function microToUsdc(micro: bigint | number): string {
  const n = typeof micro === "bigint" ? micro : BigInt(micro);
  const whole = n / 1_000_000n;
  const frac = n % 1_000_000n;
  return `${whole}.${frac.toString().padStart(6, "0")}`;
}

async function fundSol(
  conn: Connection,
  funder: Keypair,
  recipient: PublicKey,
  sol: number,
): Promise<void> {
  const lamports = Math.floor(sol * LAMPORTS_PER_SOL);
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: recipient, lamports }),
  );
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = funder.publicKey;
  tx.sign(funder);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight: (await conn.getLatestBlockhash("confirmed")).lastValidBlockHeight }, "confirmed");
}

function makeWallet(kp: Keypair): Wallet {
  return {
    publicKey: kp.publicKey,
    payer: kp,
    async signTransaction<T extends Transaction>(tx: T): Promise<T> {
      tx.partialSign(kp);
      return tx;
    },
    async signAllTransactions<T extends Transaction>(txs: T[]): Promise<T[]> {
      txs.forEach((t) => t.partialSign(kp));
      return txs;
    },
  } as unknown as Wallet;
}

// ─────────────────────────────────────────────────────────────────────────────
// Protocol bootstrap — initialize_protocol or reuse existing config
// ─────────────────────────────────────────────────────────────────────────────

interface BootstrapResult {
  usdcMint: PublicKey;
  treasury: PublicKey;
  funderControlsMint: boolean;
}

async function bootstrapProtocol(
  conn: Connection,
  funder: Keypair,
  programId: PublicKey,
): Promise<BootstrapResult> {
  const provider = new AnchorProvider(conn, makeWallet(funder), { commitment: "confirmed" });
  const program = new Program<BracketChain>(IDL_JSON as unknown as BracketChain & Idl, provider);

  const [protocolConfigPda] = findProtocolConfigPda(programId);

  const existing = await conn.getAccountInfo(protocolConfigPda);
  if (existing) {
    const cfg = await program.account.protocolConfig.fetch(protocolConfigPda);
    console.log(
      `  protocol_config exists: default_mint=${shortAddr(cfg.defaultMint)} treasury=${shortAddr(cfg.treasury)}`,
    );
    let funderControlsMint = false;
    try {
      const mint = await getMint(conn, cfg.defaultMint);
      funderControlsMint = mint.mintAuthority?.equals(funder.publicKey) ?? false;
    } catch {
      // Mint may have been frozen / closed — treat as not controlled.
    }
    return {
      usdcMint: cfg.defaultMint,
      treasury: cfg.treasury,
      funderControlsMint,
    };
  }

  // Fresh init — funder owns mint authority so we can mint test USDC freely.
  console.log("  protocol_config not found — initializing with fresh test mint...");
  const usdcMint = await createMint(
    conn,
    funder,
    funder.publicKey, // mint authority
    null,             // freeze authority — not needed
    USDC_DECIMALS,
  );

  // Use funder as treasury too — keeps the harness self-contained. In real
  // deployment, treasury is a multisig or separate wallet.
  const treasury = funder.publicKey;

  const sig = await program.methods
    .initializeProtocol()
    .accountsPartial({
      authority: funder.publicKey,
      protocolConfig: protocolConfigPda,
      treasury,
      defaultMint: usdcMint,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(`  initialize_protocol tx: ${sig}`);
  console.log(`  fresh test usdc_mint:   ${usdcMint.toBase58()}`);

  return { usdcMint, treasury, funderControlsMint: true };
}

async function mintUsdcTo(
  conn: Connection,
  funder: Keypair,
  usdcMint: PublicKey,
  recipient: PublicKey,
  micro: number,
): Promise<void> {
  const ata = await getOrCreateAssociatedTokenAccount(conn, funder, usdcMint, recipient);
  await mintTo(conn, funder, usdcMint, ata.address, funder, micro);
}

async function getUsdcBalance(
  conn: Connection,
  usdcMint: PublicKey,
  owner: PublicKey,
): Promise<bigint> {
  const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
  const ata = getAssociatedTokenAddressSync(usdcMint, owner);
  try {
    const account = await getAccount(conn, ata);
    return account.amount;
  } catch {
    return 0n;
  }
}

/**
 * Read the amount of a token account directly by its address. Use this for the
 * tournament vault (which is itself a PDA token account, NOT an ATA-of-PDA —
 * `getAssociatedTokenAddressSync` rejects PDA owners as "off curve").
 */
async function getTokenAccountAmount(
  conn: Connection,
  tokenAccount: PublicKey,
): Promise<bigint> {
  try {
    const account = await getAccount(conn, tokenAccount);
    return account.amount;
  } catch {
    return 0n;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow A — happy path, 8 players, Standard preset
// ─────────────────────────────────────────────────────────────────────────────

async function runHappyFlow(
  conn: Connection,
  funder: Keypair,
  programId: PublicKey,
  usdcMint: PublicKey,
  treasury: PublicKey,
): Promise<void> {
  console.log("\n──────── Flow: happy (8 players, Standard preset) ────────");

  const PARTICIPANT_COUNT = 8;
  const tournamentName = `e2e-${Date.now()}`;

  const organizer = Keypair.generate();
  const players = Array.from({ length: PARTICIPANT_COUNT }, () => Keypair.generate());

  console.log(`  organizer: ${shortAddr(organizer.publicKey)}`);
  console.log(`  tournament name: ${tournamentName}`);

  // ── Fund SOL + mint USDC ───────────────────────────────────────────────────
  console.log("  funding SOL + minting USDC to participants...");
  await fundSol(conn, funder, organizer.publicKey, PARTICIPANT_AIRDROP_SOL * 4);
  for (const p of players) {
    await fundSol(conn, funder, p.publicKey, PARTICIPANT_AIRDROP_SOL);
    await mintUsdcTo(conn, funder, usdcMint, p.publicKey, ENTRY_FEE_USDC);
  }

  // ── createTournament ──────────────────────────────────────────────────────
  const orgClient = new BracketChainClient({
    connection: conn,
    wallet: makeWallet(organizer),
    programId,
  });

  const nowSec = Math.floor(Date.now() / 1000);
  console.log("  → createTournament");
  const created = await createTournament(orgClient, {
    name: tournamentName,
    entryFee: ENTRY_FEE_USDC,
    maxParticipants: PARTICIPANT_COUNT,
    payoutPreset: payoutPreset("standard"),
    registrationDeadline: nowSec + 60 * 60, // 1h from now
  });
  console.log(`    tournament: ${created.tournamentPda.toBase58()}`);
  console.log(`    vault:      ${created.vaultPda.toBase58()}`);
  console.log(`    tx:         ${created.txSignature}`);

  // ── joinTournament × 8 ────────────────────────────────────────────────────
  console.log("  → joinTournament × 8");
  for (let i = 0; i < players.length; i++) {
    const playerClient = new BracketChainClient({
      connection: conn,
      wallet: makeWallet(players[i]!),
      programId,
    });
    const joined = await joinTournament(playerClient, { tournamentPda: created.tournamentPda });
    console.log(`    [${i}] ${shortAddr(players[i]!.publicKey)} seedIndex=${joined.participantIndex}`);
  }

  const vaultBefore = await getTokenAccountAmount(conn, created.vaultPda);
  console.log(`  vault after joins: ${microToUsdc(vaultBefore)} USDC (expected ${PARTICIPANT_COUNT} × 1.0)`);
  if (vaultBefore !== BigInt(ENTRY_FEE_USDC * PARTICIPANT_COUNT)) {
    throw new Error(`vault math: got ${vaultBefore}, expected ${ENTRY_FEE_USDC * PARTICIPANT_COUNT}`);
  }

  // ── startTournament ───────────────────────────────────────────────────────
  console.log("  → startTournament");
  const started = await startTournament(orgClient, { tournamentPda: created.tournamentPda });
  console.log(
    `    bracketSize=${started.bracketSize} totalMatches=${started.totalMatches} chunks=${started.txSignatures.length}`,
  );

  // ── reportResult — declare winners deterministically (lower seed wins) ────
  // Seeds are the order players[] joined. Lower index = "stronger" by fiat.
  // For 8 players, bracket layout (round 0): (0v1) (2v3) (4v5) (6v7)
  //                            (round 1): winners advance: (0v2) (4v6)
  //                            (round 2): final: (0v4)
  console.log("  → reportResult × 7 (lower seed wins each match)");

  type Round = { round: number; matches: Array<{ matchIndex: number; winner: PublicKey; runnerUp: PublicKey }> };
  const rounds: Round[] = [
    {
      round: 0,
      matches: [
        { matchIndex: 0, winner: players[0]!.publicKey, runnerUp: players[1]!.publicKey },
        { matchIndex: 1, winner: players[2]!.publicKey, runnerUp: players[3]!.publicKey },
        { matchIndex: 2, winner: players[4]!.publicKey, runnerUp: players[5]!.publicKey },
        { matchIndex: 3, winner: players[6]!.publicKey, runnerUp: players[7]!.publicKey },
      ],
    },
    {
      round: 1,
      matches: [
        { matchIndex: 0, winner: players[0]!.publicKey, runnerUp: players[2]!.publicKey },
        { matchIndex: 1, winner: players[4]!.publicKey, runnerUp: players[6]!.publicKey },
      ],
    },
    {
      round: 2,
      matches: [
        { matchIndex: 0, winner: players[0]!.publicKey, runnerUp: players[4]!.publicKey },
      ],
    },
  ];

  for (const r of rounds) {
    for (const m of r.matches) {
      const isFinal = r.round === rounds.length - 1 && m.matchIndex === 0;
      const placements = isFinal
        ? [m.winner, m.runnerUp, players[2]!.publicKey] // 3rd = organizer-trusted, picked here as semifinal-loser-A
        : undefined;
      const result = await reportResult(orgClient, {
        tournamentPda: created.tournamentPda,
        round: r.round,
        matchIndex: m.matchIndex,
        winner: m.winner,
        placements,
      });
      console.log(
        `    r${r.round}m${m.matchIndex} winner=${shortAddr(m.winner)} ${isFinal ? "(FINAL)" : ""}`,
      );
      if (isFinal && !result.isFinal) {
        throw new Error("expected isFinal=true on final match");
      }
    }
  }

  // ── Assert payout math ────────────────────────────────────────────────────
  const vaultAfter = await getTokenAccountAmount(conn, created.vaultPda);
  const pool = ENTRY_FEE_USDC * PARTICIPANT_COUNT;
  const expectedFee = Math.floor((pool * PROTOCOL_FEE_BPS) / 10_000);
  const expectedNet = pool - expectedFee;
  const expectedFirst = Math.floor((expectedNet * 6000) / 10_000);
  const expectedSecond = Math.floor((expectedNet * 2500) / 10_000);
  // Third absorbs rounding so distribution sums exactly to expectedNet.
  const expectedThird = expectedNet - expectedFirst - expectedSecond;

  const firstBal = await getUsdcBalance(conn, usdcMint, players[0]!.publicKey);
  const secondBal = await getUsdcBalance(conn, usdcMint, players[4]!.publicKey);
  const thirdBal = await getUsdcBalance(conn, usdcMint, players[2]!.publicKey);
  const treasuryBal = await getUsdcBalance(conn, usdcMint, treasury);

  console.log("\n  ── post-final balances ──");
  console.log(`    vault:    ${microToUsdc(vaultAfter)} (expect 0.000000)`);
  console.log(`    1st:      ${microToUsdc(firstBal)} (expect ${microToUsdc(expectedFirst)})`);
  console.log(`    2nd:      ${microToUsdc(secondBal)} (expect ${microToUsdc(expectedSecond)})`);
  console.log(`    3rd:      ${microToUsdc(thirdBal)} (expect ${microToUsdc(expectedThird)})`);
  console.log(`    treasury: ${microToUsdc(treasuryBal)} (expect ≥ ${microToUsdc(expectedFee)})`);

  if (vaultAfter !== 0n) throw new Error(`vault not drained: ${vaultAfter}`);
  if (firstBal !== BigInt(expectedFirst)) throw new Error(`1st payout off: ${firstBal} vs ${expectedFirst}`);
  if (secondBal !== BigInt(expectedSecond)) throw new Error(`2nd payout off: ${secondBal} vs ${expectedSecond}`);
  if (thirdBal !== BigInt(expectedThird)) throw new Error(`3rd payout off: ${thirdBal} vs ${expectedThird}`);
  // treasury may carry balance from prior runs — assert ≥ expectedFee, not ==.
  if (treasuryBal < BigInt(expectedFee)) {
    throw new Error(`treasury under-funded: ${treasuryBal} < ${expectedFee}`);
  }

  console.log("  ✅ happy flow PASSED");
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow B — cancel-and-refund, 4 players
// ─────────────────────────────────────────────────────────────────────────────

async function runCancelFlow(
  conn: Connection,
  funder: Keypair,
  programId: PublicKey,
  usdcMint: PublicKey,
): Promise<void> {
  console.log("\n──────── Flow: cancel (4 players, full refund) ────────");

  const PARTICIPANT_COUNT = 4;
  const tournamentName = `e2e-cancel-${Date.now()}`;

  const organizer = Keypair.generate();
  const players = Array.from({ length: PARTICIPANT_COUNT }, () => Keypair.generate());

  console.log(`  organizer: ${shortAddr(organizer.publicKey)}`);
  console.log(`  tournament name: ${tournamentName}`);

  await fundSol(conn, funder, organizer.publicKey, PARTICIPANT_AIRDROP_SOL * 2);
  for (const p of players) {
    await fundSol(conn, funder, p.publicKey, PARTICIPANT_AIRDROP_SOL);
    await mintUsdcTo(conn, funder, usdcMint, p.publicKey, ENTRY_FEE_USDC);
  }

  const orgClient = new BracketChainClient({
    connection: conn,
    wallet: makeWallet(organizer),
    programId,
  });

  const nowSec = Math.floor(Date.now() / 1000);
  console.log("  → createTournament (WTA)");
  const created = await createTournament(orgClient, {
    name: tournamentName,
    entryFee: ENTRY_FEE_USDC,
    maxParticipants: PARTICIPANT_COUNT,
    payoutPreset: payoutPreset("winnerTakesAll"),
    registrationDeadline: nowSec + 60 * 60,
  });
  console.log(`    tournament: ${created.tournamentPda.toBase58()}`);

  console.log("  → joinTournament × 4");
  for (let i = 0; i < players.length; i++) {
    const playerClient = new BracketChainClient({
      connection: conn,
      wallet: makeWallet(players[i]!),
      programId,
    });
    await joinTournament(playerClient, { tournamentPda: created.tournamentPda });
  }

  const vaultBefore = await getTokenAccountAmount(conn, created.vaultPda);
  console.log(`  vault after joins: ${microToUsdc(vaultBefore)} USDC`);

  const balancesBefore = await Promise.all(
    players.map((p) => getUsdcBalance(conn, usdcMint, p.publicKey)),
  );
  console.log(`  player USDC balances pre-cancel: ${balancesBefore.map(microToUsdc).join(", ")}`);

  console.log("  → cancelTournament (organizer-initiated, all 4 refunds)");
  const cancelled = await cancelTournament(orgClient, { tournamentPda: created.tournamentPda });
  console.log(
    `    txs=${cancelled.txSignatures.length} refundsSubmitted=${cancelled.refundsSubmitted} statusFlipped=${cancelled.statusFlipped}`,
  );

  const vaultAfter = await getTokenAccountAmount(conn, created.vaultPda);
  const balancesAfter = await Promise.all(
    players.map((p) => getUsdcBalance(conn, usdcMint, p.publicKey)),
  );
  console.log(`  vault after cancel: ${microToUsdc(vaultAfter)} (expect 0.000000)`);
  console.log(`  player USDC balances post-cancel: ${balancesAfter.map(microToUsdc).join(", ")}`);

  if (vaultAfter !== 0n) throw new Error(`vault not drained on cancel: ${vaultAfter}`);
  for (let i = 0; i < players.length; i++) {
    if (balancesAfter[i] !== BigInt(ENTRY_FEE_USDC)) {
      throw new Error(`player[${i}] not fully refunded: ${balancesAfter[i]}`);
    }
  }

  console.log("  ✅ cancel flow PASSED");
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cli = parseCli();

  console.log("BracketChain SDK E2E");
  console.log(`  rpc:    ${cli.rpc}`);
  console.log(`  flow:   ${cli.flow}`);
  console.log(`  funder: ${cli.funderKeypair}`);

  const conn = new Connection(cli.rpc, "confirmed");
  const funder = loadKeypair(cli.funderKeypair);

  const funderBal = await conn.getBalance(funder.publicKey);
  console.log(`  funder pubkey:  ${funder.publicKey.toBase58()}`);
  console.log(`  funder SOL:     ${(funderBal / LAMPORTS_PER_SOL).toFixed(4)}`);
  if (funderBal < 0.5 * LAMPORTS_PER_SOL) {
    throw new Error(
      `Funder needs ≥ 0.5 SOL on ${cli.rpc} (has ${(funderBal / LAMPORTS_PER_SOL).toFixed(4)}). ` +
        `Run: solana airdrop 1 ${funder.publicKey.toBase58()} --url ${cli.rpc}`,
    );
  }

  const programId = new PublicKey((IDL_JSON as { address: string }).address);
  console.log(`  program:        ${programId.toBase58()}`);

  console.log("\n──────── Bootstrap ────────");
  const boot = await bootstrapProtocol(conn, funder, programId);

  if (!boot.funderControlsMint) {
    throw new Error(
      `Existing protocol_config uses usdc_mint ${boot.usdcMint.toBase58()}, ` +
        `but funder ${funder.publicKey.toBase58()} is not its mint authority. ` +
        `This harness needs to mint test USDC to participants. Either:\n` +
        `  (a) run against a fresh cluster (e.g. surfpool / new validator), or\n` +
        `  (b) deploy a fresh program ID and re-init protocol_config.`,
    );
  }

  if (cli.flow === "happy" || cli.flow === "both") {
    await runHappyFlow(conn, funder, programId, boot.usdcMint, boot.treasury);
  }

  if (cli.flow === "cancel" || cli.flow === "both") {
    await runCancelFlow(conn, funder, programId, boot.usdcMint);
  }

  console.log("\n✅ all flows passed");
}

main().catch((err) => {
  console.error("\n❌ E2E failed");
  console.error(err);
  process.exit(1);
});
