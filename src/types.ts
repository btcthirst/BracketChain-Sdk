import type { IdlAccounts, IdlTypes } from "@coral-xyz/anchor";
import type { PublicKey } from "@solana/web3.js";
import type BN from "bn.js";
import type { BracketChain } from "./idl/bracket_chain";

// ─────────────────────────────────────────────────────────────────────────────
// Account types — auto-derived from IDL via Anchor's IdlAccounts helper.
// ─────────────────────────────────────────────────────────────────────────────

export type Tournament = IdlAccounts<BracketChain>["tournament"];
export type Participant = IdlAccounts<BracketChain>["participant"];
export type MatchNode = IdlAccounts<BracketChain>["matchNode"];
export type ProtocolConfig = IdlAccounts<BracketChain>["protocolConfig"];

/**
 * A `Tournament` account paired with its on-chain PDA address. Returned by
 * list-style queries so the caller can route to `/t/[address]` without
 * recomputing PDAs.
 */
export interface TournamentWithAddress {
  address: PublicKey;
  account: Tournament;
}

/** Same shape, for matches. Round + matchIndex live inside `account` already. */
export interface MatchNodeWithAddress {
  address: PublicKey;
  account: MatchNode;
}

/** Same shape, for participants. */
export interface ParticipantWithAddress {
  address: PublicKey;
  account: Participant;
}

// ─────────────────────────────────────────────────────────────────────────────
// Enum kinds — Anchor serialises enums as discriminated unions like
// `{ winnerTakesAll: {} }`. We expose typed kind-strings + helpers so SDK
// consumers don't have to deal with the raw shape.
// ─────────────────────────────────────────────────────────────────────────────

export type PayoutPresetKind = "winnerTakesAll" | "standard" | "deep";
export type TournamentStatusKind =
  | "registration"
  | "pendingBracketInit"
  | "active"
  | "completed"
  | "cancelled";
export type MatchStatusKind = "pending" | "active" | "completed";

/** IDL-shape enum variant — `{ [kind]: {} }`. Use the helpers below to construct or read. */
export type PayoutPresetVariant = IdlTypes<BracketChain>["payoutPreset"];
export type TournamentStatusVariant = IdlTypes<BracketChain>["tournamentStatus"];
export type MatchStatusVariant = IdlTypes<BracketChain>["matchStatus"];

/** Read the kind of any IDL-shape enum variant: `getEnumKind(t.status) === "active"`. */
export function getEnumKind<K extends string>(variant: { [P in K]?: object }): K {
  const keys = Object.keys(variant) as K[];
  if (keys.length !== 1) {
    throw new Error(`Expected exactly one enum variant key, got ${keys.length}`);
  }
  return keys[0]!;
}

/** Construct an IDL-shape enum variant from a kind string: `payoutPreset("standard")`. */
export function payoutPreset(kind: PayoutPresetKind): PayoutPresetVariant {
  // Anchor's IdlTypes resolves enums into a strict union; the runtime shape
  // `{ [kind]: {} }` is correct but TS can't narrow from a computed key,
  // so we route through `unknown`.
  return { [kind]: {} } as unknown as PayoutPresetVariant;
}

// ─────────────────────────────────────────────────────────────────────────────
// Composite read shape — returned by getTournamentState(pda).
// Bundles the three things every UI page needs in one Promise.all.
// ─────────────────────────────────────────────────────────────────────────────

export interface TournamentState {
  address: PublicKey;
  tournament: Tournament;
  bracket: MatchNodeWithAddress[];
  participants: ParticipantWithAddress[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-export commonly-used primitive types so consumers don't import @coral-xyz
// or bn.js separately for basic shape work.
// ─────────────────────────────────────────────────────────────────────────────

export type { BN, PublicKey };
