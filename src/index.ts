// ─────────────────────────────────────────────────────────────────────────────
// Public surface of @bracketchain/sdk.
//
// Anything not re-exported here is internal and may change without a major bump.
// ─────────────────────────────────────────────────────────────────────────────

// Client
export { BracketChainClient } from "./client";
export type { BracketChainClientOptions } from "./client";

// PDA helpers
export {
  findProtocolConfigPda,
  findTournamentPda,
  findVaultPda,
  findParticipantPda,
  findMatchPda,
} from "./pdas";

// Types — account shapes, composite reads, enum helpers
export type {
  Tournament,
  Participant,
  MatchNode,
  ProtocolConfig,
  TournamentWithAddress,
  MatchNodeWithAddress,
  ParticipantWithAddress,
  TournamentState,
  PayoutPresetKind,
  TournamentStatusKind,
  MatchStatusKind,
  PayoutPresetVariant,
  TournamentStatusVariant,
  MatchStatusVariant,
  PublicKey,
} from "./types";
export { getEnumKind, payoutPreset } from "./types";

// Re-export BN as a runtime value so SDK consumers can construct BN instances
// (e.g. for entry-fee args, deadline, organizer-deposit) without installing
// bn.js or @coral-xyz/anchor as a direct dependency. The type is already
// re-exported above via `BN` in the type-only block.
export { default as BN } from "bn.js";

// Methods — reads + mutations
export {
  getTournament,
  getProtocolConfig,
  listTournaments,
  getAllMatches,
  listParticipants,
  getTournamentState,
  createTournament,
  joinTournament,
  cancelTournament,
  startTournament,
  reportResult,
  subscribe,
} from "./methods";
export type {
  CreateTournamentConfig,
  CreateTournamentResult,
  JoinTournamentParams,
  JoinTournamentResult,
  CancelTournamentParams,
  CancelTournamentResult,
  StartTournamentParams,
  StartTournamentResult,
  ReportResultParams,
  ReportResultResult,
  SubscribeOptions,
  SubscriptionError,
  TournamentSubscriptionEvent,
} from "./methods";

// Indexer client (Phase 5.1) — typed REST wrapper for the indexer service.
// Composes orthogonally with BracketChainClient; Phase 5.3 will weave them
// together via SWR for indexer-first reads with chain-side reconciliation.
export { BracketChainIndexerClient } from "./api";
export type {
  IndexerClientOptions,
  IndexerTournament,
  IndexerPayout,
  IndexerParticipant,
  IndexerMatch,
  IndexerTournamentStatus,
  IndexerPayoutPreset,
  IndexerPayoutKind,
  IndexerMatchStatus,
  ListTournamentsOptions,
  GetPayoutsOptions,
  GetParticipantsOptions,
  GetMatchesOptions,
} from "./api";

// Errors — base class + every typed subclass + the mapError helper
export {
  BracketChainSDKError,
  InsufficientFundsError,
  InvalidPayoutPresetError,
  RegistrationClosedError,
  NameTooLongError,
  MaxParticipantsExceededError,
  MinParticipantsNotMetError,
  InvalidTokenMintError,
  ProtocolNotInitializedError,
  TournamentNameTakenError,
  TournamentFullError,
  AlreadyRegisteredError,
  InsufficientBalanceError,
  UnauthorizedReporterError,
  InvalidMatchError,
  MatchAlreadyReportedError,
  TournamentNotActiveError,
  NonParticipantWinnerError,
  TournamentInProgressError,
  TransactionFailedError,
  UnknownProgramError,
  mapError,
} from "./errors";
