/**
 * One-shot initializer for the BracketChain protocol singleton on a live cluster.
 *
 * Calls `initialize_protocol(treasury, usdc_mint)` ONCE, with the canonical devnet
 * USDC mint by default — so any wallet that already holds devnet USDC can join
 * tournaments without first receiving a fresh test mint.
 *
 * Use this instead of `e2e-demo.ts --flow=happy` when you only want to bootstrap
 * the protocol (no demo tournament). Idempotent: if `protocol_config` already
 * exists, the script prints its contents and exits with code 0.
 *
 * Usage:
 *   tsx scripts/init-protocol.ts
 *   tsx scripts/init-protocol.ts --rpc=https://devnet.helius-rpc.com/?api-key=KEY
 *   tsx scripts/init-protocol.ts --treasury=<pubkey>
 *   tsx scripts/init-protocol.ts --usdc-mint=<pubkey>     # override default
 *   FUNDER_KEYPAIR=/path/id.json tsx scripts/init-protocol.ts
 *
 * The funder keypair is the protocol authority. They must have ≥ ~0.005 SOL on
 * the target cluster (rent for the ProtocolConfig PDA + tx fee).
 *
 * On-chain program: AuXJKpuZtkegs2ZSgopgckhN7Ev8bUz4zBc238LD2F1 (devnet).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { AnchorProvider, Program, Wallet, Idl } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { getMint } from "@solana/spl-token";

import { findProtocolConfigPda } from "../src";
import IDL_JSON from "../src/idl/bracket_chain.json" with { type: "json" };
import type { BracketChain } from "../src/idl/bracket_chain";

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

// Canonical devnet USDC. Any wallet on devnet that ever ran the test faucet at
// https://spl-token-faucet.com/?token-name=USDC-Dev or received a transfer of
// "devnet USDC" holds tokens of this mint.
const DEFAULT_USDC_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

const MIN_FUNDER_LAMPORTS = 0.005 * LAMPORTS_PER_SOL;

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

interface Cli {
  rpc: string;
  funderKeypair: string;
  usdcMint: PublicKey;
  treasury: PublicKey | null; // null → use funder pubkey
}

function parseCli(): Cli {
  const args = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };

  const usdcMintArg = get("usdc-mint");
  const treasuryArg = get("treasury");

  return {
    rpc: get("rpc") ?? "https://api.devnet.solana.com",
    funderKeypair:
      get("funder") ??
      process.env.FUNDER_KEYPAIR ??
      path.join(os.homedir(), ".config", "solana", "id.json"),
    usdcMint: usdcMintArg ? new PublicKey(usdcMintArg) : DEFAULT_USDC_MINT,
    treasury: treasuryArg ? new PublicKey(treasuryArg) : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (mirror e2e-demo.ts patterns)
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
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cli = parseCli();
  const conn = new Connection(cli.rpc, "confirmed");
  const funder = loadKeypair(cli.funderKeypair);
  const treasury = cli.treasury ?? funder.publicKey;

  console.log("BracketChain protocol initializer");
  console.log(`  rpc:           ${cli.rpc}`);
  console.log(`  funder:        ${funder.publicKey.toBase58()}`);
  console.log(`  treasury:      ${treasury.toBase58()}${cli.treasury ? "" : "  (defaulted to funder)"}`);
  console.log(`  usdc_mint:     ${cli.usdcMint.toBase58()}${cli.usdcMint.equals(DEFAULT_USDC_MINT) ? "  (canonical devnet USDC)" : "  (override)"}`);

  // ── Sanity: funder has SOL ─────────────────────────────────────────────────
  const balance = await conn.getBalance(funder.publicKey);
  if (balance < MIN_FUNDER_LAMPORTS) {
    throw new Error(
      `Funder ${shortAddr(funder.publicKey)} has ${balance / LAMPORTS_PER_SOL} SOL — need ≥ ${MIN_FUNDER_LAMPORTS / LAMPORTS_PER_SOL}. Run \`solana airdrop 1 --url devnet\`.`,
    );
  }

  // ── Sanity: USDC mint exists on this cluster ───────────────────────────────
  try {
    const mint = await getMint(conn, cli.usdcMint);
    console.log(`  mint check:    decimals=${mint.decimals}, supply=${mint.supply.toString()}`);
  } catch (err) {
    throw new Error(
      `USDC mint ${cli.usdcMint.toBase58()} does not exist on this cluster. ` +
        `Either pass --usdc-mint=<pubkey> with a valid mint, or pick a different --rpc.`,
    );
  }

  // ── Setup Anchor ───────────────────────────────────────────────────────────
  const provider = new AnchorProvider(conn, makeWallet(funder), { commitment: "confirmed" });
  const program = new Program<BracketChain>(
    IDL_JSON as unknown as BracketChain & Idl,
    provider,
  );
  const programId = program.programId;
  const [protocolConfigPda] = findProtocolConfigPda(programId);

  console.log(`  program_id:    ${programId.toBase58()}`);
  console.log(`  config_pda:    ${protocolConfigPda.toBase58()}`);

  // ── Idempotency: skip if already initialized ───────────────────────────────
  const existing = await conn.getAccountInfo(protocolConfigPda);
  if (existing) {
    const cfg = await program.account.protocolConfig.fetch(protocolConfigPda);
    console.log("\n✅ ProtocolConfig already initialized:");
    console.log(`   authority:  ${cfg.authority.toBase58()}`);
    console.log(`   treasury:   ${cfg.treasury.toBase58()}`);
    console.log(`   usdc_mint:  ${cfg.usdcMint.toBase58()}`);
    console.log(`   fee_bps:    ${cfg.feeBps}`);
    if (!cfg.usdcMint.equals(cli.usdcMint)) {
      console.log(
        `\n⚠️  on-chain usdc_mint differs from your --usdc-mint argument. Existing config wins; reinit is not possible without redeploying the program.`,
      );
    }
    return;
  }

  // ── Send initialize_protocol ───────────────────────────────────────────────
  console.log("\n  sending initialize_protocol...");
  const sig = await program.methods
    .initializeProtocol()
    .accountsPartial({
      authority: funder.publicKey,
      protocolConfig: protocolConfigPda,
      treasury,
      usdcMint: cli.usdcMint,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(`\n✅ ProtocolConfig initialized.`);
  console.log(`   tx:         ${sig}`);
  console.log(`   explorer:   https://explorer.solana.com/tx/${sig}?cluster=devnet`);

  // ── Verify ─────────────────────────────────────────────────────────────────
  const cfg = await program.account.protocolConfig.fetch(protocolConfigPda);
  console.log(`   authority:  ${cfg.authority.toBase58()}`);
  console.log(`   treasury:   ${cfg.treasury.toBase58()}`);
  console.log(`   usdc_mint:  ${cfg.usdcMint.toBase58()}`);
  console.log(`   fee_bps:    ${cfg.feeBps}`);
}

main().catch((err) => {
  console.error("\n❌ initialization failed:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
