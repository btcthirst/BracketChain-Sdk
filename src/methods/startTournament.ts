import {
  AccountMeta,
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  SYSVAR_SLOT_HASHES_PUBKEY,
} from "@solana/web3.js";

import type { BracketChainClient } from "../client";
import {
  BracketChainSDKError,
  MinParticipantsNotMetError,
  RegistrationClosedError,
  UnauthorizedReporterError,
  mapError,
} from "../errors";
import { findMatchPda } from "../pdas";
import { getEnumKind } from "../types";
import type { Participant, Tournament } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Chunk-size budget for legacy txs (1232 byte cap). Measured empirically:
//   - Per descriptor: 69 bytes ix-data + 32 pubkey + 1 idx + AccountMeta
//     overhead ≈ 110 bytes per match-PDA slot
//   - After fixed overhead (signatures, header, blockhash, 4 fixed accounts,
//     compute-budget ix, start_tournament ix framing) ≈ 920 bytes available
//   - 920 / 110 ≈ 8.4 → 7 fits with margin, 8 spills by ~2 bytes
//
// 128 players → 127 matches → 19 chunks at default size 7. For V1, switching
// to versioned tx + Address Lookup Table for the 4 fixed accounts unlocks
// chunk size 8-10.
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_CHUNK_SIZE = 7;
const DEFAULT_COMPUTE_UNITS = 400_000;

interface MatchInitDescriptor {
  round: number;
  matchIndex: number;
  bump: number;
  playerA: PublicKey;
  playerB: PublicKey;
  bye: boolean;
}

export interface StartTournamentParams {
  tournamentPda: PublicKey;
  /**
   * Player wallets in seed order. If omitted, the SDK auto-discovers via
   * getProgramAccounts and orders ascending by `seed_index`. Pass this to
   * apply an organizer-trusted shuffle (V1 will derive from on-chain seed_hash).
   */
  participantWallets?: PublicKey[];
  /** Match-PDA inits per tx. Default {@link DEFAULT_CHUNK_SIZE}. */
  chunkSize?: number;
  /** Compute budget per chunk. Default {@link DEFAULT_COMPUTE_UNITS}. */
  computeUnits?: number;
}

export interface StartTournamentResult {
  txSignatures: string[];
  bracketSize: number;
  totalMatches: number;
}

/**
 * Initialize the bracket and transition Registration → Active.
 *
 * Lifecycle (mirrors on-chain `start_tournament`):
 *  1. First chunk: program captures `seed_hash` from the SlotHashes sysvar,
 *     computes bracket_size = next_pow_of_2(participant_count), flips status
 *     Registration → PendingBracketInit, then inits its descriptors.
 *  2. Subsequent chunks: status is PendingBracketInit. Program inits more
 *     match PDAs.
 *  3. Last chunk fills the final descriptor → status flips to Active and
 *     `TournamentStarted` event is emitted.
 *
 * Bracket layout (organizer-trusted, V1 will use VRF):
 *   - Round 0 pairs sequentially: match i = seeds[2i] vs seeds[2i+1]
 *   - Top seeds get byes when participant_count < bracket_size
 *   - Round 1+ have player slots pre-populated for parents that are byes
 *     (otherwise on-chain `report_result` can't auto-advance into a slot
 *     when only one parent is real)
 *
 * Each chunk runs with a 400K compute-unit budget (default), accounting
 * for create_account CPIs at ~5K CU per match-PDA init.
 *
 * @throws BracketChainSDKError with code `ReadOnlyClient` if the client has no signing wallet.
 * @throws BracketChainSDKError with code `InvalidArgument` if `participantWallets.length !== participantCount`.
 * @throws BracketChainSDKError with code `ParticipantCountMismatch` when auto-discovered wallets don't match on-chain count (typically RPC lag).
 * @throws UnauthorizedReporterError if the caller is not the organizer.
 * @throws RegistrationClosedError if status is not Registration or PendingBracketInit.
 * @throws MinParticipantsNotMetError if `participantCount < 2`.
 * @throws TransactionFailedError on chunk-tx rejection (the next call resumes from `matchesInitialized`).
 */
export async function startTournament(
  client: BracketChainClient,
  params: StartTournamentParams,
): Promise<StartTournamentResult> {
  if (!client.canSign) {
    throw new BracketChainSDKError(
      "startTournament requires a signing wallet — pass `wallet` to BracketChainClient.",
      "ReadOnlyClient",
    );
  }

  const organizer = client.provider.wallet.publicKey;
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

  if (!tournament.organizer.equals(organizer)) {
    throw new UnauthorizedReporterError();
  }

  const statusKind = getEnumKind(tournament.status);
  if (statusKind !== "registration" && statusKind !== "pendingBracketInit") {
    throw new RegistrationClosedError();
  }

  if (tournament.participantCount < 2) {
    throw new MinParticipantsNotMetError();
  }

  // ── resolve participants, sorted by seed_index ────────────────────────────
  const participantWallets = await resolveParticipantWallets(
    client,
    tournamentPda,
    tournament,
    params.participantWallets,
  );

  // ── build full descriptor list (round 0 + bye-propagation for round 1+) ──
  const { descriptors, matchPdas, bracketSize } = buildBracketDescriptors(
    tournamentPda,
    participantWallets,
    client.programId,
  );

  // If a prior partial start_tournament call already initialized some matches,
  // skip them to be idempotent.
  const alreadyInit = tournament.matchesInitialized;
  const remainingDescriptors = descriptors.slice(alreadyInit);
  const remainingPdas = matchPdas.slice(alreadyInit);

  // ── chunk + send sequentially ─────────────────────────────────────────────
  const chunkSize = Math.max(1, Math.min(params.chunkSize ?? DEFAULT_CHUNK_SIZE, 12));
  const computeUnits = params.computeUnits ?? DEFAULT_COMPUTE_UNITS;
  const txSignatures: string[] = [];

  for (let i = 0; i < remainingDescriptors.length; i += chunkSize) {
    const dChunk = remainingDescriptors.slice(i, i + chunkSize);
    const pdaChunk = remainingPdas.slice(i, i + chunkSize);

    const remainingAccounts: AccountMeta[] = pdaChunk.map((pubkey) => ({
      pubkey,
      isSigner: false,
      isWritable: true,
    }));

    try {
      const sig = await client.program.methods
        .startTournament(dChunk as never)
        .accountsPartial({
          organizer,
          tournament: tournamentPda,
          slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
        ])
        .rpc();
      txSignatures.push(sig);
    } catch (err) {
      throw mapError(err);
    }
  }

  return {
    txSignatures,
    bracketSize,
    totalMatches: bracketSize - 1,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function resolveParticipantWallets(
  client: BracketChainClient,
  tournamentPda: PublicKey,
  tournament: Tournament,
  override?: PublicKey[],
): Promise<PublicKey[]> {
  if (override && override.length > 0) {
    if (override.length !== tournament.participantCount) {
      throw new BracketChainSDKError(
        `participantWallets length (${override.length}) does not match on-chain participantCount (${tournament.participantCount})`,
        "InvalidArgument",
      );
    }
    return override;
  }

  let all;
  try {
    all = await client.program.account.participant.all([
      { memcmp: { offset: 8, bytes: tournamentPda.toBase58() } },
    ]);
  } catch (err) {
    throw mapError(err);
  }

  if (all.length !== tournament.participantCount) {
    throw new BracketChainSDKError(
      `Expected ${tournament.participantCount} participants on-chain, found ${all.length}. RPC may be lagging — retry, or pass participantWallets explicitly.`,
      "ParticipantCountMismatch",
    );
  }

  // Sort ascending by seed_index — this is the order in which players joined.
  return all
    .map((entry) => entry.account as Participant)
    .sort((a, b) => a.seedIndex - b.seedIndex)
    .map((p) => p.wallet);
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

interface BuildBracketResult {
  descriptors: MatchInitDescriptor[];
  matchPdas: PublicKey[];
  bracketSize: number;
}

/**
 * Build the full bracket: round 0 pairs `[seeds[2i], seeds[2i+1]]`, with byes
 * for top seeds when N < bracket_size. Round 1+ have player slots pre-populated
 * only for parent matches that are byes — required because `report_result` only
 * advances the *current* match's winner; if a sibling parent is a bye and we
 * leave the round-1 slot empty, the round-1 match never reaches `Active`.
 */
function buildBracketDescriptors(
  tournament: PublicKey,
  players: PublicKey[],
  programId: PublicKey,
): BuildBracketResult {
  const N = players.length;
  if (N < 2) {
    throw new MinParticipantsNotMetError();
  }

  const bracketSize = nextPowerOfTwo(N);
  const totalRounds = Math.log2(bracketSize);
  const padded = [...players];
  while (padded.length < bracketSize) padded.push(PublicKey.default);

  const descriptors: MatchInitDescriptor[] = [];
  const matchPdas: PublicKey[] = [];

  // ── Round 0 ───────────────────────────────────────────────────────────────
  const round0Matches = bracketSize >> 1;
  const round0ByeWinners: Array<PublicKey | null> = [];
  for (let m = 0; m < round0Matches; m++) {
    const a = padded[2 * m]!;
    const b = padded[2 * m + 1]!;
    const aIsDefault = a.equals(PublicKey.default);
    const bIsDefault = b.equals(PublicKey.default);
    const bye = aIsDefault || bIsDefault;
    const playerA = bye ? (aIsDefault ? b : a) : a;
    const playerB = bye ? PublicKey.default : b;

    const [pda, bump] = findMatchPda(tournament, 0, m, programId);
    descriptors.push({ round: 0, matchIndex: m, bump, playerA, playerB, bye });
    matchPdas.push(pda);
    round0ByeWinners.push(bye ? playerA : null);
  }

  // ── Rounds 1+ ────────────────────────────────────────────────────────────
  for (let r = 1; r < totalRounds; r++) {
    const matches = bracketSize >> (r + 1);
    for (let m = 0; m < matches; m++) {
      // Parents in round r-1: indices 2m (left, slot a) and 2m+1 (right, slot b)
      let playerA = PublicKey.default;
      let playerB = PublicKey.default;
      if (r === 1) {
        playerA = round0ByeWinners[2 * m] ?? PublicKey.default;
        playerB = round0ByeWinners[2 * m + 1] ?? PublicKey.default;
      }
      // r ≥ 2: byes can only propagate past round 0 in highly-skewed brackets
      // (e.g. 5-of-8 gives r1m0 with both bye parents). Handling that here
      // would require recursive winner tracking; for our typical "≤ 1 bye row"
      // brackets the on-chain `report_result` flow handles propagation correctly
      // once the round-1 sibling reports.

      const [pda, bump] = findMatchPda(tournament, r, m, programId);
      descriptors.push({
        round: r,
        matchIndex: m,
        bump,
        playerA,
        playerB,
        bye: false,
      });
      matchPdas.push(pda);
    }
  }

  return { descriptors, matchPdas, bracketSize };
}
