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
 * Returns all MatchNode accounts belonging to a tournament.
 *
 * Filters via memcmp on the first field after the 8-byte discriminator —
 * `tournament: Pubkey` (32 bytes at offset 8).
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
