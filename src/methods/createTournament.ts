import { BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

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
  /** Entry fee in token's base units (u64). For 6-decimal USDC, 1 USDC = 1_000_000. */
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
  /**
   * SPL Token mint for entry fees + prize pool. Defaults to
   * `ProtocolConfig.defaultMint` (advisory canonical mint, e.g. USDC). Pass
   * any valid SPL Mint to use a different token. Per-tournament; once
   * created, all participants must hold balance in this mint.
   */
  tokenMint?: PublicKey;
  /**
   * Optional organizer top-up to the prize pool, in token base units.
   * Defaults to `0`. When > 0, the SDK auto-creates the organizer's ATA
   * (if missing) and transfers the deposit into the vault on the same tx.
   * Goes INTO the prize pool (Variant B): distributed via the chosen preset
   * on completion, refunded to the organizer if the tournament is cancelled.
   */
  organizerDeposit?: BN | bigint | number;
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
 *
 * @throws BracketChainSDKError with code `ReadOnlyClient` if the client has no signing wallet.
 * @throws BracketChainSDKError with code `InvalidArgument` for non-integer numeric inputs or unknown preset variants.
 * @throws NameTooLongError if the name's UTF-8 byte length is 0 or > 32.
 * @throws MinParticipantsNotMetError if `maxParticipants` < 2.
 * @throws MaxParticipantsExceededError if `maxParticipants` > 128.
 * @throws InvalidPayoutPresetError if the preset's minimum players exceeds `maxParticipants` (e.g. Deep with < 7).
 * @throws RegistrationClosedError if `registrationDeadline` is at or before the current time.
 * @throws ProtocolNotInitializedError if the singleton ProtocolConfig PDA does not exist.
 * @throws InvalidTokenMintError if the supplied token mint is invalid for this tournament.
 * @throws TransactionFailedError on other on-chain rejections.
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
  const organizerDepositBN = config.organizerDeposit !== undefined
    ? toBN(config.organizerDeposit)
    : new BN(0);
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
  // and resolves the protocol's advisory `default_mint` as a fallback for
  // tournaments that don't override the mint.
  let defaultMint: PublicKey;
  try {
    const protocolConfig = await client.program.account.protocolConfig.fetch(protocolConfigPda);
    defaultMint = protocolConfig.defaultMint;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/Account does not exist|has no data/i.test(message)) {
      throw new ProtocolNotInitializedError(err);
    }
    throw mapError(err);
  }

  const tokenMint = config.tokenMint ?? defaultMint;

  // ── organizer ATA resolution + auto-create when deposit > 0 ───────────────
  // Required only when organizer_deposit > 0; otherwise pass `null` and the
  // program skips the CPI branch. We auto-create the ATA on the same tx if
  // it doesn't exist yet, mirroring the join_tournament UX.
  const preInstructions = [];
  let organizerTokenAccount: PublicKey | null = null;

  if (organizerDepositBN.gtn(0)) {
    const organizerAta = getAssociatedTokenAddressSync(tokenMint, organizer);
    organizerTokenAccount = organizerAta;

    try {
      await getAccount(client.connection, organizerAta);
      // ATA exists — nothing to do (program will validate balance during CPI).
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        err instanceof Error &&
        (err.name === "TokenAccountNotFoundError" ||
          /could not find|TokenAccountNotFound/i.test(message))
      ) {
        // Auto-create the organizer's ATA on the same tx.
        preInstructions.push(
          createAssociatedTokenAccountInstruction(
            organizer,    // payer
            organizerAta, // ata to create
            organizer,    // owner of the ata
            tokenMint,
          ),
        );
      } else {
        throw mapError(err);
      }
    }
  }

  // ── build + send ──────────────────────────────────────────────────────────
  try {
    const builder = client.program.methods
      .createTournament(
        config.name,
        entryFeeBN,
        config.maxParticipants,
        config.payoutPreset,
        deadlineBN,
        organizerDepositBN,
      )
      .accountsPartial({
        organizer,
        protocolConfig: protocolConfigPda,
        tokenMint,
        tournament: tournamentPda,
        vault: vaultPda,
        organizerTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      });

    const txSignature = preInstructions.length > 0
      ? await builder.preInstructions(preInstructions).rpc()
      : await builder.rpc();

    return { tournamentPda, vaultPda, txSignature };
  } catch (err) {
    throw mapError(err);
  }
}
