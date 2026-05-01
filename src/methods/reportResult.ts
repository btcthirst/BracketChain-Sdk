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
  InvalidMatchError,
  InvalidPayoutPresetError,
  MatchAlreadyReportedError,
  NonParticipantWinnerError,
  TournamentNotActiveError,
  UnauthorizedReporterError,
  mapError,
} from "../errors";
import { findMatchPda, findProtocolConfigPda, findVaultPda } from "../pdas";
import { getEnumKind } from "../types";
import type {
  MatchNode,
  PayoutPresetVariant,
  ProtocolConfig,
  Tournament,
} from "../types";

export interface ReportResultParams {
  tournamentPda: PublicKey;
  /** 0-indexed round of the match being reported. */
  round: number;
  /** 0-indexed match position within the round. */
  matchIndex: number;
  /** Winner pubkey — must equal player_a or player_b on the match account. */
  winner: PublicKey;
  /**
   * Required ONLY when reporting the final match. Length + ordering:
   *  - WTA (1):      [champion]
   *  - Standard (3): [champion, runnerUp, third]
   *  - Deep (7):     [champion, runnerUp, third, fifthEighth, fifthEighth,
   *                   fifthEighth, fifthEighth]
   *
   * Position 0 must equal `winner`; position 1 must be the loser of the final
   * match (the program validates both on-chain). Positions 2+ are organizer-
   * trusted in MVP.
   */
  placements?: PublicKey[];
}

export interface ReportResultResult {
  txSignature: string;
  isFinal: boolean;
}

/**
 * Report a match winner. For non-final matches, advances the winner into the
 * next-round match's player slot. For the final match, distributes the prize
 * pool per the tournament's payout preset and flips status to Completed.
 *
 * Pre-flight (mirrors on-chain `require!` checks):
 *  - wallet is the organizer
 *  - tournament status is Active
 *  - match status is Active
 *  - winner ∈ { player_a, player_b }
 *  - if final: placements.length === preset.placementCount
 *  - if final: placements[0] === winner, placements[1] === runnerUp
 *
 * For the final match, the SDK pre-creates any missing placement / treasury
 * USDC ATAs as `preInstructions` on the same tx, so callers don't need a
 * separate "Create Account" step.
 *
 * @throws BracketChainSDKError with code `ReadOnlyClient` if the client has no signing wallet.
 * @throws BracketChainSDKError with code `InvalidArgument` for an unknown preset variant when computing the placement count.
 * @throws UnauthorizedReporterError if the caller is not the organizer.
 * @throws TournamentNotActiveError if the tournament status is not Active.
 * @throws MatchAlreadyReportedError if the match is already Completed.
 * @throws InvalidMatchError if the match status is not Active (e.g. parents not resolved).
 * @throws NonParticipantWinnerError if `winner` is not one of the match's two players, or final-match `placements[0]/[1]` mismatch.
 * @throws InvalidPayoutPresetError if `placements.length` does not match the preset's required count.
 * @throws TransactionFailedError on other on-chain rejections.
 */
export async function reportResult(
  client: BracketChainClient,
  params: ReportResultParams,
): Promise<ReportResultResult> {
  if (!client.canSign) {
    throw new BracketChainSDKError(
      "reportResult requires a signing wallet — pass `wallet` to BracketChainClient.",
      "ReadOnlyClient",
    );
  }

  const organizer = client.provider.wallet.publicKey;
  const tournamentPda = params.tournamentPda;

  // ── read tournament + match ──────────────────────────────────────────────
  let tournament: Tournament;
  try {
    tournament = (await client.program.account.tournament.fetch(
      tournamentPda,
    )) as Tournament;
  } catch (err) {
    throw mapError(err);
  }

  if (!tournament.organizer.equals(organizer)) {
    throw new UnauthorizedReporterError();
  }
  if (getEnumKind(tournament.status) !== "active") {
    throw new TournamentNotActiveError();
  }

  const [matchPda] = findMatchPda(
    tournamentPda,
    params.round,
    params.matchIndex,
    client.programId,
  );

  let matchAccount: MatchNode;
  try {
    matchAccount = (await client.program.account.matchNode.fetch(
      matchPda,
    )) as MatchNode;
  } catch (err) {
    throw mapError(err);
  }

  const matchStatus = getEnumKind(matchAccount.status);
  if (matchStatus === "completed") {
    throw new MatchAlreadyReportedError();
  }
  if (matchStatus !== "active") {
    throw new InvalidMatchError();
  }
  if (
    !params.winner.equals(matchAccount.playerA) &&
    !params.winner.equals(matchAccount.playerB)
  ) {
    throw new NonParticipantWinnerError();
  }

  const maxRound = Math.log2(tournament.bracketSize);
  const isFinal = params.round + 1 === maxRound && params.matchIndex === 0;

  // ── branch: non-final ────────────────────────────────────────────────────
  if (!isFinal) {
    return reportNonFinal(client, params, organizer, tournamentPda, matchPda);
  }

  // ── branch: final → payout distribution ──────────────────────────────────
  return reportFinal(
    client,
    params,
    organizer,
    tournamentPda,
    matchPda,
    matchAccount,
    tournament,
  );
}

async function reportNonFinal(
  client: BracketChainClient,
  params: ReportResultParams,
  organizer: PublicKey,
  tournamentPda: PublicKey,
  matchPda: PublicKey,
): Promise<ReportResultResult> {
  const [nextMatchPda] = findMatchPda(
    tournamentPda,
    params.round + 1,
    Math.floor(params.matchIndex / 2),
    client.programId,
  );

  const [protocolConfigPda] = findProtocolConfigPda(client.programId);
  const [vaultPda] = findVaultPda(tournamentPda, client.programId);

  try {
    const txSignature = await client.program.methods
      .reportResult(params.winner, [])
      .accountsPartial({
        organizer,
        tournament: tournamentPda,
        matchAccount: matchPda,
        nextMatch: nextMatchPda,
        protocolConfig: protocolConfigPda,
        vault: vaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    return { txSignature, isFinal: false };
  } catch (err) {
    throw mapError(err);
  }
}

async function reportFinal(
  client: BracketChainClient,
  params: ReportResultParams,
  organizer: PublicKey,
  tournamentPda: PublicKey,
  matchPda: PublicKey,
  matchAccount: MatchNode,
  tournament: Tournament,
): Promise<ReportResultResult> {
  const placements = params.placements ?? [];
  const expectedCount = getPlacementCount(tournament.payoutPreset);

  if (placements.length !== expectedCount) {
    throw new InvalidPayoutPresetError(
      new Error(
        `placements length ${placements.length} does not match preset's placement_count ${expectedCount}`,
      ),
    );
  }
  if (!placements[0]!.equals(params.winner)) {
    throw new NonParticipantWinnerError(
      new Error("placements[0] must equal `winner`"),
    );
  }
  if (placements.length >= 2) {
    const runnerUp = params.winner.equals(matchAccount.playerA)
      ? matchAccount.playerB
      : matchAccount.playerA;
    if (!placements[1]!.equals(runnerUp)) {
      throw new NonParticipantWinnerError(
        new Error("placements[1] must equal the loser of the final match"),
      );
    }
  }

  // Read protocol_config to get treasury wallet for ATA derivation
  const [protocolConfigPda] = findProtocolConfigPda(client.programId);
  let protocolConfig: ProtocolConfig;
  try {
    protocolConfig = (await client.program.account.protocolConfig.fetch(
      protocolConfigPda,
    )) as ProtocolConfig;
  } catch (err) {
    throw mapError(err);
  }

  const usdcMint = tournament.usdcMint;

  // Build ATA list: [...placementATAs, treasuryATA]
  const placementAtas = placements.map((wallet) =>
    getAssociatedTokenAddressSync(usdcMint, wallet),
  );
  const treasuryAta = getAssociatedTokenAddressSync(
    usdcMint,
    protocolConfig.treasury,
  );

  // Pre-create any missing ATAs in a single batch
  const preInstructions = await buildAtaCreationIxs(
    client,
    organizer,
    usdcMint,
    [
      ...placements.map((wallet, i) => ({ owner: wallet, ata: placementAtas[i]! })),
      { owner: protocolConfig.treasury, ata: treasuryAta },
    ],
  );

  const remainingAccounts: AccountMeta[] = [
    ...placementAtas.map((pubkey) => ({
      pubkey,
      isSigner: false,
      isWritable: true,
    })),
    { pubkey: treasuryAta, isSigner: false, isWritable: true },
  ];

  const [vaultPda] = findVaultPda(tournamentPda, client.programId);

  try {
    const txSignature = await client.program.methods
      .reportResult(params.winner, placements)
      .accountsPartial({
        organizer,
        tournament: tournamentPda,
        matchAccount: matchPda,
        nextMatch: null,
        protocolConfig: protocolConfigPda,
        vault: vaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(remainingAccounts)
      .preInstructions(preInstructions)
      .rpc();

    return { txSignature, isFinal: true };
  } catch (err) {
    throw mapError(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getPlacementCount(preset: PayoutPresetVariant): number {
  const kind = getEnumKind(preset);
  switch (kind) {
    case "winnerTakesAll":
      return 1;
    case "standard":
      return 3;
    case "deep":
      return 7;
    default:
      throw new BracketChainSDKError(
        `Unknown payout preset variant: "${kind}"`,
        "InvalidArgument",
      );
  }
}

async function buildAtaCreationIxs(
  client: BracketChainClient,
  payer: PublicKey,
  mint: PublicKey,
  entries: Array<{ owner: PublicKey; ata: PublicKey }>,
): Promise<TransactionInstruction[]> {
  // Dedupe by ATA pubkey — same wallet can appear multiple times in placements
  // (Deep preset has 4 × fifthEighth slots on different wallets, but defensive
  // dedupe protects against caller mistakes).
  const seen = new Set<string>();
  const ixs: TransactionInstruction[] = [];

  for (const { owner, ata } of entries) {
    const key = ata.toBase58();
    if (seen.has(key)) continue;
    seen.add(key);

    try {
      await getAccount(client.connection, ata);
      // ATA exists — no creation needed.
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        err instanceof Error &&
        (err.name === "TokenAccountNotFoundError" ||
          /could not find|TokenAccountNotFound/i.test(message))
      ) {
        ixs.push(
          createAssociatedTokenAccountInstruction(payer, ata, owner, mint),
        );
      } else {
        throw mapError(err);
      }
    }
  }

  return ixs;
}
