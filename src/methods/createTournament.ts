import { BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import type { BracketChainClient } from "../client";
import {
  BracketChainSDKError,
  InvalidPayoutPresetError,
  MaxParticipantsExceededError,
  MinParticipantsNotMetError,
  NameTooLongError,
  ProtocolNotInitializedError,
  RegistrationClosedError,
  mapError,
} from "../errors";
import { findProtocolConfigPda, findTournamentPda, findVaultPda } from "../pdas";
import type { PayoutPresetVariant } from "../types";

// On-chain bounds — must mirror `bracket-chain-programs/src/constants.rs`.
const MAX_TOURNAMENT_NAME_BYTES = 32;
const MIN_PARTICIPANTS = 2;
const MAX_PARTICIPANTS = 128;

// Per-preset minimum players. Mirrors `PayoutPreset::min_participants()`.
const PRESET_MIN_PARTICIPANTS: Record<string, number> = {
  winnerTakesAll: 1,
  standard: 3,
  deep: 7,
};

export interface CreateTournamentConfig {
  /** UTF-8 name, ≤32 bytes (not characters). Used in the tournament PDA seed. */
  name: string;
  /** Entry fee in micro-USDC (u64). 1 USDC = 1_000_000. */
  entryFee: BN | bigint | number;
  /** Hard cap, [2, 128]. Bracket size derives from this at start time. */
  maxParticipants: number;
  /**
   * Payout preset variant — IDL-encoded as `{ winnerTakesAll: {} }` etc.
   * Construct via `payoutPreset("standard")` from the SDK's `types` module.
   */
  payoutPreset: PayoutPresetVariant;
  /** Unix timestamp (seconds). Must be strictly greater than the on-chain clock at submit time. */
  registrationDeadline: BN | bigint | number;
}

export interface CreateTournamentResult {
  tournamentPda: PublicKey;
  vaultPda: PublicKey;
  txSignature: string;
}

function toBN(value: BN | bigint | number): BN {
  if (BN.isBN(value)) return value;
  if (typeof value === "bigint") return new BN(value.toString());
  if (Number.isInteger(value)) return new BN(value);
  throw new BracketChainSDKError(
    `Expected integer/BN/bigint, got ${typeof value} (${String(value)})`,
    "InvalidArgument",
  );
}

function presetKind(variant: PayoutPresetVariant): string {
  const keys = Object.keys(variant);
  if (keys.length !== 1) {
    throw new BracketChainSDKError(
      "payoutPreset must be a single-variant enum object",
      "InvalidArgument",
    );
  }
  return keys[0]!;
}

/**
 * Create a new tournament on-chain.
 *
 * Pre-flight validation mirrors the program's `require!` checks so we fail
 * fast in the browser instead of paying tx fees:
 *  - name UTF-8 byte length ≤ 32
 *  - 2 ≤ maxParticipants ≤ 128
 *  - preset's minimum players ≤ maxParticipants (Standard ≥ 3, Deep ≥ 7)
 *  - registrationDeadline > Date.now()/1000
 *
 * Pre-fetches `ProtocolConfig` to surface a clean `ProtocolNotInitializedError`
 * if the singleton hasn't been initialized yet — saves the caller from staring
 * at a confusing on-chain `AccountNotInitialized`.
 */
export async function createTournament(
  client: BracketChainClient,
  config: CreateTournamentConfig,
): Promise<CreateTournamentResult> {
  if (!client.canSign) {
    throw new BracketChainSDKError(
      "createTournament requires a signing wallet — pass `wallet` to BracketChainClient.",
      "ReadOnlyClient",
    );
  }

  // ── client-side validation ────────────────────────────────────────────────
  const nameBytes = Buffer.byteLength(config.name, "utf8");
  if (nameBytes === 0 || nameBytes > MAX_TOURNAMENT_NAME_BYTES) {
    throw new NameTooLongError();
  }

  if (!Number.isInteger(config.maxParticipants)) {
    throw new BracketChainSDKError(
      "maxParticipants must be an integer",
      "InvalidArgument",
    );
  }
  if (config.maxParticipants < MIN_PARTICIPANTS) throw new MinParticipantsNotMetError();
  if (config.maxParticipants > MAX_PARTICIPANTS) throw new MaxParticipantsExceededError();

  const kind = presetKind(config.payoutPreset);
  const presetMin = PRESET_MIN_PARTICIPANTS[kind];
  if (presetMin === undefined) {
    throw new BracketChainSDKError(
      `Unknown payout preset variant: "${kind}"`,
      "InvalidArgument",
    );
  }
  if (presetMin > config.maxParticipants) {
    throw new InvalidPayoutPresetError();
  }

  const entryFeeBN = toBN(config.entryFee);
  const deadlineBN = toBN(config.registrationDeadline);
  const nowSec = Math.floor(Date.now() / 1000);
  if (deadlineBN.lten(nowSec)) {
    throw new RegistrationClosedError();
  }

  // ── account derivation ────────────────────────────────────────────────────
  const organizer = client.provider.wallet.publicKey;
  const [protocolConfigPda] = findProtocolConfigPda(client.programId);
  const [tournamentPda] = findTournamentPda(organizer, config.name, client.programId);
  const [vaultPda] = findVaultPda(tournamentPda, client.programId);

  // Pre-fetch ProtocolConfig — surfaces ProtocolNotInitializedError clearly,
  // and pulls the canonical USDC mint we must pass into the tx.
  let usdcMint: PublicKey;
  try {
    const protocolConfig = await client.program.account.protocolConfig.fetch(protocolConfigPda);
    usdcMint = protocolConfig.usdcMint;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/Account does not exist|has no data/i.test(message)) {
      throw new ProtocolNotInitializedError(err);
    }
    throw mapError(err);
  }

  // ── build + send ──────────────────────────────────────────────────────────
  try {
    const txSignature = await client.program.methods
      .createTournament(
        config.name,
        entryFeeBN,
        config.maxParticipants,
        config.payoutPreset,
        deadlineBN,
      )
      .accountsPartial({
        organizer,
        protocolConfig: protocolConfigPda,
        usdcMint,
        tournament: tournamentPda,
        vault: vaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    return { tournamentPda, vaultPda, txSignature };
  } catch (err) {
    throw mapError(err);
  }
}
