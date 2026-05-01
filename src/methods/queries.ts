import { PublicKey } from "@solana/web3.js";

import type { BracketChainClient } from "../client";
import { mapError } from "../errors";
import type {
  MatchNode,
  MatchNodeWithAddress,
  Participant,
  ParticipantWithAddress,
  ProtocolConfig,
  Tournament,
  TournamentState,
  TournamentWithAddress,
} from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Single-account fetches.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch a single Tournament PDA's deserialized state.
 *
 * Use {@link getTournamentState} when the caller also needs the bracket and
 * participant list — it parallelizes those reads.
 *
 * @throws UnknownProgramError if the PDA does not exist or is owned by a
 *   different program.
 * @throws TransactionFailedError on unexpected RPC failures.
 */
export async function getTournament(
  client: BracketChainClient,
  pda: PublicKey,
): Promise<Tournament> {
  try {
    return (await client.program.account.tournament.fetch(pda)) as Tournament;
  } catch (err) {
    throw mapError(err);
  }
}

/**
 * Fetch the singleton ProtocolConfig PDA (treasury, USDC mint, fee bps).
 *
 * Derive `pda` via {@link findProtocolConfigPda} — there is exactly one per
 * program deployment.
 *
 * @throws UnknownProgramError if the protocol has not been initialized yet.
 * @throws TransactionFailedError on unexpected RPC failures.
 */
export async function getProtocolConfig(
  client: BracketChainClient,
  pda: PublicKey,
): Promise<ProtocolConfig> {
  try {
    return (await client.program.account.protocolConfig.fetch(pda)) as ProtocolConfig;
  } catch (err) {
    throw mapError(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// List queries.
//
// `Tournament` has no parent — listTournaments returns the entire program's
// tournament accounts. Cheap on devnet (a few hundred at most), but for prod
// the indexer (Phase 4) is the right path; this is a fallback / dev tool.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List every Tournament PDA owned by the program.
 *
 * Backed by `getProgramAccounts` — fine on devnet, but in production prefer
 * the Phase 4 indexer (`GET /tournaments`) which paginates and filters by
 * status. Treat this as a dev/fallback tool.
 *
 * @throws TransactionFailedError if the RPC node rejects the query (e.g. due
 *   to size limits or rate limiting).
 */
export async function listTournaments(
  client: BracketChainClient,
): Promise<TournamentWithAddress[]> {
  try {
    const all = await client.program.account.tournament.all();
    return all.map((entry) => ({
      address: entry.publicKey,
      account: entry.account as Tournament,
    }));
  } catch (err) {
    throw mapError(err);
  }
}

/**
 * Returns all MatchNode accounts belonging to a tournament, sorted by
 * `(round, matchIndex)` for stable UI rendering.
 *
 * Filters via memcmp on the first field after the 8-byte discriminator —
 * `tournament: Pubkey` (32 bytes at offset 8).
 *
 * @throws TransactionFailedError if the RPC node rejects the query.
 */
export async function getAllMatches(
  client: BracketChainClient,
  tournamentPda: PublicKey,
): Promise<MatchNodeWithAddress[]> {
  try {
    const all = await client.program.account.matchNode.all([
      {
        memcmp: {
          offset: 8, // skip 8-byte Anchor discriminator
          bytes: tournamentPda.toBase58(),
        },
      },
    ]);
    return all
      .map((entry) => ({
        address: entry.publicKey,
        account: entry.account as MatchNode,
      }))
      // Stable order: by round, then matchIndex. UI relies on this for rendering.
      .sort((a, b) => {
        if (a.account.round !== b.account.round) {
          return a.account.round - b.account.round;
        }
        return a.account.matchIndex - b.account.matchIndex;
      });
  } catch (err) {
    throw mapError(err);
  }
}

/**
 * Returns all Participant accounts for a tournament, sorted by `seedIndex`.
 *
 * Same memcmp pattern as getAllMatches — `tournament` is the first field after
 * the discriminator.
 *
 * @throws TransactionFailedError if the RPC node rejects the query.
 */
export async function listParticipants(
  client: BracketChainClient,
  tournamentPda: PublicKey,
): Promise<ParticipantWithAddress[]> {
  try {
    const all = await client.program.account.participant.all([
      {
        memcmp: {
          offset: 8,
          bytes: tournamentPda.toBase58(),
        },
      },
    ]);
    return all
      .map((entry) => ({
        address: entry.publicKey,
        account: entry.account as Participant,
      }))
      .sort((a, b) => a.account.seedIndex - b.account.seedIndex);
  } catch (err) {
    throw mapError(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Composite — runs three queries in parallel and bundles the result.
// This is what the web app's /t/[address] page should call as its primary read.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Composite read for the tournament-detail view: fetches the Tournament PDA,
 * its bracket (all MatchNodes), and its participant list in parallel.
 *
 * This is the canonical read path for the `/t/[address]` page — one call,
 * one network round-trip's worth of latency.
 *
 * @throws UnknownProgramError if the Tournament PDA does not exist.
 * @throws TransactionFailedError if any sub-query fails at the RPC level.
 */
export async function getTournamentState(
  client: BracketChainClient,
  tournamentPda: PublicKey,
): Promise<TournamentState> {
  const [tournament, bracket, participants] = await Promise.all([
    getTournament(client, tournamentPda),
    getAllMatches(client, tournamentPda),
    listParticipants(client, tournamentPda),
  ]);
  return {
    address: tournamentPda,
    tournament,
    bracket,
    participants,
  };
}
