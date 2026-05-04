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
  BN,
  PublicKey,
} from "./types";
export { getEnumKind, payoutPreset } from "./types";

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
  TournamentSubscriptionEvent,
} from "./methods";

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
