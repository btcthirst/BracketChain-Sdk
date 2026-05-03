import {
  AccountMeta,
  PublicKey,
  TransactionInstruction,
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
  TournamentInProgressError,
  UnauthorizedReporterError,
  mapError,
} from "../errors";
import { findParticipantPda, findVaultPda } from "../pdas";
import { getEnumKind } from "../types";
import type { Participant, Tournament } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Tx-size budget for chunking remaining_accounts.
//
// A Solana tx is capped at 1232 bytes. Fixed overhead for cancel_tournament:
//  - 4 base accounts (caller/tournament/vault/token_program) ≈ 4 × 32 = 128 B
//  - signatures + header + blockhash + ix discriminator ≈ ~180 B
//
// Each remaining_accounts pair adds 2 × 32 (pubkey) + 2 × 1 (account-meta byte)
// + 2 × 1 (instruction-array index) ≈ 68 B per pair.
//
// Worst-case usable budget: ~924 B ÷ 68 ≈ 13 pairs (very conservative).
// In practice 24 pairs land safely because v0 tx + ALT compression and
// pubkey deduplication free up space. We default to 24 and let the caller
// override if they hit `Transaction too large`.
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_CHUNK_SIZE = 24;

export interface CancelTournamentParams {
  tournamentPda: PublicKey;
  /**
   * Optional explicit wallet list. If omitted, the SDK fetches every Participant
   * for this tournament via getProgramAccounts and filters out already-refunded
   * ones. Pass this when you have a curated subset (e.g. retrying a failed chunk).
   */
  participantWallets?: PublicKey[];
  /** Refund pairs per tx. Default {@link DEFAULT_CHUNK_SIZE}. */
  chunkSize?: number;
}

export interface CancelTournamentResult {
  /** One signature per chunk, in send order. */
  txSignatures: string[];
  /** Number of [pda, ata] pairs submitted across all chunks. */
  refundsSubmitted: number;
  /** True when this call (or a prior one) flipped status to Cancelled. */
  statusFlipped: boolean;
}

/**
 * Cancel a tournament and refund participants.
 *
 * Two-phase semantics, mirrored from the on-chain handler:
 *  - First call (status ≠ Cancelled): only the organizer may invoke. Flips
 *    status to Cancelled and processes the supplied refund pairs.
 *  - Subsequent calls (status = Cancelled): any signer may invoke. Idempotent —
 *    already-refunded participants are skipped on-chain by `refund_paid` flag.
 *
 * If `participantWallets` is omitted, the SDK auto-discovers pending refunds:
 *   getProgramAccounts(participant)
 *     |> filter by tournament == tournamentPda
 *     |> drop refund_paid == true
 *
 * Refunds are chunked across multiple txs to fit Solana's 1232-byte tx limit.
 * Each chunk is sent and confirmed sequentially — if a middle chunk fails,
 * the caller can retry from the missed wallets via `participantWallets`.
 *
 * @throws BracketChainSDKError with code `ReadOnlyClient` if the client has no signing wallet.
 * @throws TournamentInProgressError if status is Active or Completed.
 * @throws UnauthorizedReporterError if the caller is not the organizer on the first call.
 * @throws TransactionFailedError on chunked-tx rejection (caller can retry the failed range).
 */
export async function cancelTournament(
  client: BracketChainClient,
  params: CancelTournamentParams,
): Promise<CancelTournamentResult> {
  if (!client.canSign) {
    throw new BracketChainSDKError(
      "cancelTournament requires a signing wallet — pass `wallet` to BracketChainClient.",
      "ReadOnlyClient",
    );
  }

  const caller = client.provider.wallet.publicKey;
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

  const statusKind = getEnumKind(tournament.status);
  const isCancellable =
    statusKind === "registration" ||
    statusKind === "pendingBracketInit" ||
    statusKind === "cancelled";
  if (!isCancellable) {
    throw new TournamentInProgressError();
  }

  // First-call auth check — saves a wasted tx fee + clearer error message.
  if (statusKind !== "cancelled" && !tournament.organizer.equals(caller)) {
    throw new UnauthorizedReporterError();
  }

  const [vaultPda] = findVaultPda(tournamentPda, client.programId);

  // ── organizer-deposit refund prep (Phase 2.5, Variant B) ──────────────────
  // Pass the organizer's ATA on the FIRST tx only — the program flips
  // `organizer_deposit_refunded = true` after refunding, so subsequent chunks
  // can pass `null` and the refund branch becomes a no-op. If the ATA doesn't
  // exist yet (e.g. organizer never held this token), we auto-create it on
  // the same tx via preInstructions.
  const organizerDepositRefundPending =
    tournament.organizerDeposit.gtn(0) && !tournament.organizerDepositRefunded;

  let organizerAta: PublicKey | null = null;
  const ataPreInstructions: TransactionInstruction[] = [];

  if (organizerDepositRefundPending) {
    organizerAta = getAssociatedTokenAddressSync(tournament.tokenMint, tournament.organizer);
    try {
      await getAccount(client.connection, organizerAta);
      // ATA exists — no preInstruction needed.
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        err instanceof Error &&
        (err.name === "TokenAccountNotFoundError" ||
          /could not find|TokenAccountNotFound/i.test(message))
      ) {
        // Caller pays for ATA creation. On a recovery call by a non-organizer,
        // the caller is fronting the rent — they recover nothing on-chain.
        // Acceptable for a mainly-organizer-driven flow.
        ataPreInstructions.push(
          createAssociatedTokenAccountInstruction(
            caller,
            organizerAta,
            tournament.organizer,
            tournament.tokenMint,
          ),
        );
      } else {
        throw mapError(err);
      }
    }
  }

  // ── resolve refund pairs ──────────────────────────────────────────────────
  const pairs = await resolveRefundPairs(client, tournamentPda, tournament, params);

  if (pairs.length === 0) {
    // Nothing to refund — but if status is still Registration/PendingBracketInit,
    // we still need to flip it. Send an empty-remaining_accounts tx for that case.
    // If a pending organizer-deposit refund is also waiting, fold it into this
    // single tx via the organizerTokenAccount + preInstructions.
    if (statusKind === "cancelled" && !organizerDepositRefundPending) {
      return { txSignatures: [], refundsSubmitted: 0, statusFlipped: false };
    }
    try {
      const builder = client.program.methods
        .cancelTournament()
        .accountsPartial({
          caller,
          tournament: tournamentPda,
          vault: vaultPda,
          organizerTokenAccount: organizerAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        });
      const sig = ataPreInstructions.length > 0
        ? await builder.preInstructions(ataPreInstructions).rpc()
        : await builder.rpc();
      return { txSignatures: [sig], refundsSubmitted: 0, statusFlipped: true };
    } catch (err) {
      throw mapError(err);
    }
  }

  // ── chunk + send sequentially ────────────────────────────────────────────
  const chunkSize = Math.max(1, Math.min(params.chunkSize ?? DEFAULT_CHUNK_SIZE, 32));
  const chunks: Array<Array<readonly [PublicKey, PublicKey]>> = [];
  for (let i = 0; i < pairs.length; i += chunkSize) {
    chunks.push(pairs.slice(i, i + chunkSize));
  }

  const txSignatures: string[] = [];
  let statusFlipped = statusKind === "cancelled";

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const isFirstChunk = i === 0;
    const remainingAccounts: AccountMeta[] = chunk.flatMap(([pda, ata]) => [
      { pubkey: pda, isSigner: false, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
    ]);

    try {
      // Pass organizer ATA + ATA-create preInstructions only on first chunk.
      // Subsequent chunks pass `null`: the program's flag-gate makes the
      // refund branch a no-op, so we skip the extra account/CU per chunk.
      const builder = client.program.methods
        .cancelTournament()
        .accountsPartial({
          caller,
          tournament: tournamentPda,
          vault: vaultPda,
          organizerTokenAccount: isFirstChunk ? organizerAta : null,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts(remainingAccounts);

      const sig = isFirstChunk && ataPreInstructions.length > 0
        ? await builder.preInstructions(ataPreInstructions).rpc()
        : await builder.rpc();
      txSignatures.push(sig);
      statusFlipped = true;
    } catch (err) {
      throw mapError(err);
    }
  }

  return { txSignatures, refundsSubmitted: pairs.length, statusFlipped };
}

async function resolveRefundPairs(
  client: BracketChainClient,
  tournamentPda: PublicKey,
  tournament: Tournament,
  params: CancelTournamentParams,
): Promise<Array<readonly [PublicKey, PublicKey]>> {
  if (params.participantWallets && params.participantWallets.length > 0) {
    return params.participantWallets.map((wallet) => {
      const [pda] = findParticipantPda(tournamentPda, wallet, client.programId);
      const ata = getAssociatedTokenAddressSync(tournament.tokenMint, wallet);
      return [pda, ata] as const;
    });
  }

  // Auto-discovery via memcmp filter on the `tournament` field.
  // Participant layout: 8 disc + 32 tournament + 32 wallet + ...
  let all;
  try {
    all = await client.program.account.participant.all([
      {
        memcmp: {
          offset: 8,
          bytes: tournamentPda.toBase58(),
        },
      },
    ]);
  } catch (err) {
    throw mapError(err);
  }

  return all
    .filter((entry) => !(entry.account as Participant).refundPaid)
    .map((entry) => {
      const account = entry.account as Participant;
      const ata = getAssociatedTokenAddressSync(tournament.tokenMint, account.wallet);
      return [entry.publicKey, ata] as const;
    });
}
