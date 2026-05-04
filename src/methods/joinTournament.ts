import { BN, EventParser } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import type { BracketChainClient } from "../client";
import {
  AlreadyRegisteredError,
  BracketChainSDKError,
  InsufficientBalanceError,
  RegistrationClosedError,
  TournamentFullError,
  UnknownProgramError,
  mapError,
} from "../errors";
import { findParticipantPda, findVaultPda } from "../pdas";
import { getEnumKind } from "../types";
import type { Tournament } from "../types";

export interface JoinTournamentParams {
  /** PDA address of the tournament to join. */
  tournamentPda: PublicKey;
}

export interface JoinTournamentResult {
  /** Zero-based seed index assigned by the program (parsed from `ParticipantRegistered` event). */
  participantIndex: number;
  /** Derived Participant PDA — useful for follow-up reads/refunds. */
  participantPda: PublicKey;
  /** Transaction signature, confirmed at the provider's commitment. */
  txSignature: string;
}

/**
 * Register the connected wallet for an open tournament.
 *
 * Pre-flight:
 *  - status must be `registration`
 *  - now < registration_deadline
 *  - participant_count < max_participants
 *  - player's USDC ATA balance ≥ entry_fee (creates the ATA in-tx if missing,
 *    in which case balance is 0 → throws InsufficientBalanceError before sending)
 *
 * The transaction also creates the player's USDC ATA if it doesn't exist yet,
 * so callers don't need a separate "Create USDC Account" step in their UI.
 *
 * `participantIndex` is parsed from the `ParticipantRegistered` event in the
 * confirmed tx logs — we deliberately don't re-fetch the Participant PDA, since
 * its `seed_index` is already in the event payload.
 *
 * @throws BracketChainSDKError with code `ReadOnlyClient` if the client has no signing wallet.
 * @throws RegistrationClosedError if status is not Registration or the deadline has passed.
 * @throws TournamentFullError if `participantCount === maxParticipants`.
 * @throws InsufficientBalanceError if the player's USDC balance is below the entry fee.
 * @throws AlreadyRegisteredError if the wallet has already registered.
 * @throws UnknownProgramError if event parsing falls back to a Participant PDA fetch and that fetch fails.
 * @throws TransactionFailedError on other on-chain rejections.
 */
export async function joinTournament(
  client: BracketChainClient,
  params: JoinTournamentParams,
): Promise<JoinTournamentResult> {
  if (!client.canSign) {
    throw new BracketChainSDKError(
      "joinTournament requires a signing wallet — pass `wallet` to BracketChainClient.",
      "ReadOnlyClient",
    );
  }

  const player = client.provider.wallet.publicKey;
  const tournamentPda = params.tournamentPda;

  // ── read tournament + validate ────────────────────────────────────────────
  let tournament: Tournament;
  try {
    tournament = (await client.program.account.tournament.fetch(
      tournamentPda,
    )) as Tournament;
  } catch (err) {
    throw mapError(err);
  }

  if (getEnumKind(tournament.status) !== "registration") {
    throw new RegistrationClosedError();
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (new BN(nowSec).gte(tournament.registrationDeadline)) {
    throw new RegistrationClosedError();
  }

  if (tournament.participantCount >= tournament.maxParticipants) {
    throw new TournamentFullError();
  }

  const [participantPda] = findParticipantPda(tournamentPda, player, client.programId);
  const [vaultPda] = findVaultPda(tournamentPda, client.programId);

  // ── ATA: create if missing, then balance pre-check ────────────────────────
  const playerAta = getAssociatedTokenAddressSync(tournament.tokenMint, player);
  const preInstructions = [];
  let playerBalance = new BN(0);

  try {
    const ataAccount = await getAccount(client.connection, playerAta);
    playerBalance = new BN(ataAccount.amount.toString());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // TokenAccountNotFoundError / "could not find account" → ATA doesn't exist.
    // Schedule its creation on the same tx; balance stays 0.
    if (
      err instanceof Error &&
      (err.name === "TokenAccountNotFoundError" ||
        /could not find|TokenAccountNotFound/i.test(message))
    ) {
      preInstructions.push(
        createAssociatedTokenAccountInstruction(
          player,        // payer
          playerAta,     // ata to create
          player,        // owner of the ata
          tournament.tokenMint,
        ),
      );
    } else {
      throw mapError(err);
    }
  }

  if (playerBalance.lt(tournament.entryFee)) {
    throw new InsufficientBalanceError();
  }

  // ── build + send ──────────────────────────────────────────────────────────
  let txSignature: string;
  try {
    txSignature = await client.program.methods
      .joinTournament()
      .accountsPartial({
        player,
        tournament: tournamentPda,
        participant: participantPda,
        playerTokenAccount: playerAta,
        vault: vaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions(preInstructions)
      .rpc();
  } catch (err) {
    // Anchor `init` of Participant PDA collides when this wallet has already
    // registered. Surface AlreadyRegisteredError before the generic mapper
    // (the global "already in use" fallback was removed to keep create-flow
    // collisions from being mismapped).
    const message = err instanceof Error ? err.message : String(err);
    if (/already in use/i.test(message)) {
      throw new AlreadyRegisteredError(err);
    }
    throw mapError(err);
  }

  // ── parse ParticipantRegistered event ────────────────────────────────────
  const participantIndex = await readParticipantIndexFromTx(
    client,
    txSignature,
    tournamentPda,
    player,
  );

  return { participantIndex, participantPda, txSignature };
}

async function readParticipantIndexFromTx(
  client: BracketChainClient,
  txSignature: string,
  tournamentPda: PublicKey,
  wallet: PublicKey,
): Promise<number> {
  const txInfo = await client.connection.getTransaction(txSignature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  const logs = txInfo?.meta?.logMessages;
  if (!logs || logs.length === 0) {
    // Fall back to reading the Participant PDA directly. Costs one RPC, but
    // avoids failing the whole call if logs were truncated by the RPC node.
    try {
      const participantAccount = await client.program.account.participant.fetch(
        findParticipantPda(tournamentPda, wallet, client.programId)[0],
      );
      return participantAccount.seedIndex;
    } catch (err) {
      throw new UnknownProgramError(err);
    }
  }

  const parser = new EventParser(client.programId, client.program.coder);
  for (const evt of parser.parseLogs(logs)) {
    if (evt.name !== "participantRegistered") continue;
    const data = evt.data as { tournament: PublicKey; wallet: PublicKey; participantIndex: number };
    if (
      data.tournament.equals(tournamentPda) &&
      data.wallet.equals(wallet)
    ) {
      return Number(data.participantIndex);
    }
  }

  // Anchor `init` collision (already-registered) lands here only if mapError
  // missed it earlier — surface a friendlier error than UnknownProgram.
  if (logs.some((l) => /already in use/i.test(l))) {
    throw new AlreadyRegisteredError();
  }

  throw new UnknownProgramError(
    new Error("ParticipantRegistered event not found in tx logs"),
  );
}
