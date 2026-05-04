import { AnchorError } from "@coral-xyz/anchor";

// ─────────────────────────────────────────────────────────────────────────────
// Base class — all SDK errors extend this. Consumers can `instanceof`-check
// specific subclasses or fall back to BracketChainSDKError.
// ─────────────────────────────────────────────────────────────────────────────

export class BracketChainSDKError extends Error {
  /** Original error if available — useful for debugging unmapped cases. */
  public readonly cause?: unknown;
  /** Stable error code that won't change across SDK versions (matches the class name). */
  public readonly code: string;

  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.name = code;
    this.code = code;
    this.cause = cause;
    // V8 stack-trace clean-up
    if (typeof (Error as { captureStackTrace?: unknown }).captureStackTrace === "function") {
      (Error as { captureStackTrace: (target: object, ctor: Function) => void })
        .captureStackTrace(this, new.target);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// US-D01: createTournament errors
// ─────────────────────────────────────────────────────────────────────────────

export class InsufficientFundsError extends BracketChainSDKError {
  constructor(cause?: unknown) {
    super(
      "Wallet has insufficient SOL to pay for rent or transaction fees.",
      "InsufficientFunds",
      cause,
    );
  }
}

export class InvalidPayoutPresetError extends BracketChainSDKError {
  constructor(cause?: unknown) {
    super(
      "Selected payout preset is invalid or requires more participants than configured (e.g. Deep needs ≥7 players).",
      "InvalidPayoutPreset",
      cause,
    );
  }
}

export class RegistrationClosedError extends BracketChainSDKError {
  constructor(cause?: unknown) {
    super(
      "Tournament registration is closed (deadline passed or status is no longer Registration).",
      "RegistrationClosed",
      cause,
    );
  }
}

export class NameTooLongError extends BracketChainSDKError {
  constructor(cause?: unknown) {
    super(
      "Tournament name exceeds 32 bytes.",
      "NameTooLong",
      cause,
    );
  }
}

export class MaxParticipantsExceededError extends BracketChainSDKError {
  constructor(cause?: unknown) {
    super(
      "maxParticipants exceeds the on-chain cap of 128.",
      "MaxParticipantsExceeded",
      cause,
    );
  }
}

export class MinParticipantsNotMetError extends BracketChainSDKError {
  constructor(cause?: unknown) {
    super(
      "maxParticipants is below the on-chain minimum of 2.",
      "MinParticipantsNotMet",
      cause,
    );
  }
}

export class InvalidTokenMintError extends BracketChainSDKError {
  constructor(cause?: unknown) {
    super(
      "Token mint provided to the instruction does not match the tournament's configured mint, or is not a valid SPL Mint.",
      "InvalidTokenMint",
      cause,
    );
  }
}

export class ProtocolNotInitializedError extends BracketChainSDKError {
  constructor(cause?: unknown) {
    super(
      "ProtocolConfig PDA is not initialized — call initializeProtocol first.",
      "ProtocolNotInitialized",
      cause,
    );
  }
}

export class TournamentNameTakenError extends BracketChainSDKError {
  constructor(cause?: unknown) {
    super(
      "You already have a tournament with this name. Tournament PDA seeds are [organizer, name] — pick a different name.",
      "TournamentNameTaken",
      cause,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// US-D02: joinTournament errors
// ─────────────────────────────────────────────────────────────────────────────

export class TournamentFullError extends BracketChainSDKError {
  constructor(cause?: unknown) {
    super(
      "Tournament has reached its maximum participant count.",
      "TournamentFull",
      cause,
    );
  }
}

export class AlreadyRegisteredError extends BracketChainSDKError {
  constructor(cause?: unknown) {
    super(
      "This wallet is already registered for the tournament.",
      "AlreadyRegistered",
      cause,
    );
  }
}

export class InsufficientBalanceError extends BracketChainSDKError {
  constructor(cause?: unknown) {
    super(
      "Wallet's USDC balance is below the entry fee.",
      "InsufficientBalance",
      cause,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// US-D03: reportResult errors
// ─────────────────────────────────────────────────────────────────────────────

export class UnauthorizedReporterError extends BracketChainSDKError {
  constructor(cause?: unknown) {
    super(
      "Only the tournament organizer can report match results or cancel.",
      "UnauthorizedReporter",
      cause,
    );
  }
}

export class InvalidMatchError extends BracketChainSDKError {
  constructor(cause?: unknown) {
    super(
      "Match index is out of bounds, parents are not yet completed, or match doesn't belong to this tournament.",
      "InvalidMatch",
      cause,
    );
  }
}

export class MatchAlreadyReportedError extends BracketChainSDKError {
  constructor(cause?: unknown) {
    super(
      "This match has already been reported and cannot be reported again.",
      "MatchAlreadyReported",
      cause,
    );
  }
}

export class TournamentNotActiveError extends BracketChainSDKError {
  constructor(cause?: unknown) {
    super(
      "Tournament is not in the Active state — cannot report match results.",
      "TournamentNotActive",
      cause,
    );
  }
}

export class NonParticipantWinnerError extends BracketChainSDKError {
  constructor(cause?: unknown) {
    super(
      "Reported winner is not one of the two players in this match.",
      "NonParticipantWinner",
      cause,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// cancelTournament errors
// ─────────────────────────────────────────────────────────────────────────────

export class TournamentInProgressError extends BracketChainSDKError {
  constructor(cause?: unknown) {
    super(
      "Tournament has matches in progress and cannot be cancelled. V1 will support partial cancellation.",
      "TournamentInProgress",
      cause,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic / fallback
// ─────────────────────────────────────────────────────────────────────────────

export class TransactionFailedError extends BracketChainSDKError {
  constructor(message: string, cause?: unknown) {
    super(message, "TransactionFailed", cause);
  }
}

export class UnknownProgramError extends BracketChainSDKError {
  constructor(cause?: unknown) {
    super(
      "An unknown program error occurred. Inspect `cause` for details.",
      "UnknownProgramError",
      cause,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// On-chain BracketChainError code → SDK class lookup.
//
// These code numbers come from `bracket-chain-programs/src/errors.rs`. Anchor
// numbers them sequentially starting at 6000 (the standard `#[error_code]`
// offset), so the order in errors.rs determines the code.
//
// If you add a new error code on-chain, add a row here. Order MATTERS.
// ─────────────────────────────────────────────────────────────────────────────

const ANCHOR_ERROR_OFFSET = 6000;

const ERRORS_RS_ORDER = [
  "UnauthorizedAuthority",      // 6000
  "TournamentFull",             // 6001
  "AlreadyRegistered",          // 6002
  "RegistrationClosed",         // 6003
  "NotInRegistration",          // 6004
  "NotActive",                  // 6005
  "NotCompleted",               // 6006
  "InvalidPayoutPreset",        // 6007
  "PresetExceedsParticipants",  // 6008
  "MatchAlreadyReported",       // 6009
  "NonParticipantWinner",       // 6010
  "TournamentInProgress",       // 6011
  "RefundAlreadyIssued",        // 6012
  "MaxParticipantsExceeded",    // 6013
  "MinParticipantsNotMet",      // 6014
  "NameTooLong",                // 6015
  "InvalidTokenMint",           // 6016
  "InvalidVault",               // 6017
  "InvalidTreasury",            // 6018
  "InvalidMatchIndex",          // 6019
  "ParentMatchesNotComplete",   // 6020
  "RemainingAccountsMismatch",  // 6021
  "ArithmeticOverflow",         // 6022
  "SlotHashesUnavailable",      // 6023
] as const;

type OnChainErrorName = typeof ERRORS_RS_ORDER[number];

const ON_CHAIN_TO_SDK: Record<OnChainErrorName, new (cause?: unknown) => BracketChainSDKError> = {
  UnauthorizedAuthority: UnauthorizedReporterError,
  TournamentFull: TournamentFullError,
  AlreadyRegistered: AlreadyRegisteredError,
  RegistrationClosed: RegistrationClosedError,
  NotInRegistration: RegistrationClosedError,
  NotActive: TournamentNotActiveError,
  NotCompleted: TransactionFailedError as never,
  InvalidPayoutPreset: InvalidPayoutPresetError,
  PresetExceedsParticipants: InvalidPayoutPresetError,
  MatchAlreadyReported: MatchAlreadyReportedError,
  NonParticipantWinner: NonParticipantWinnerError,
  TournamentInProgress: TournamentInProgressError,
  RefundAlreadyIssued: TransactionFailedError as never,
  MaxParticipantsExceeded: MaxParticipantsExceededError,
  MinParticipantsNotMet: MinParticipantsNotMetError,
  NameTooLong: NameTooLongError,
  InvalidTokenMint: InvalidTokenMintError,
  InvalidVault: TransactionFailedError as never,
  InvalidTreasury: TransactionFailedError as never,
  InvalidMatchIndex: InvalidMatchError,
  ParentMatchesNotComplete: InvalidMatchError,
  RemainingAccountsMismatch: TransactionFailedError as never,
  ArithmeticOverflow: TransactionFailedError as never,
  SlotHashesUnavailable: TransactionFailedError as never,
};

// ─────────────────────────────────────────────────────────────────────────────
// Main entrypoint — wrap every SDK method's body in try/catch, call mapError.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert any low-level error (Anchor, web3.js, SystemProgram, SPL Token CPI)
 * into a typed `BracketChainSDKError` subclass.
 *
 * If the error is already a `BracketChainSDKError`, returns it unchanged.
 * For unrecognised errors, returns `UnknownProgramError` wrapping the original.
 */
export function mapError(err: unknown): BracketChainSDKError {
  if (err instanceof BracketChainSDKError) return err;

  if (err instanceof AnchorError) {
    const codeNumber = err.error?.errorCode?.number;
    if (typeof codeNumber === "number" && codeNumber >= ANCHOR_ERROR_OFFSET) {
      const idx = codeNumber - ANCHOR_ERROR_OFFSET;
      const name = ERRORS_RS_ORDER[idx];
      if (name) {
        const Ctor = ON_CHAIN_TO_SDK[name];
        if (Ctor) return new Ctor(err);
      }
    }
    return new TransactionFailedError(err.error?.errorMessage ?? err.message, err);
  }

  const message = err instanceof Error ? err.message : String(err);
  if (/insufficient (?:funds|lamports)/i.test(message)) {
    if (/lamports/i.test(message)) return new InsufficientFundsError(err);
    return new InsufficientBalanceError(err);
  }

  // Note: "account already in use" is intentionally NOT mapped here.
  // Different methods need different errors (createTournament → TournamentNameTaken,
  // joinTournament → AlreadyRegistered). Each call site handles it locally before
  // delegating to mapError so the user sees a meaningful message.

  return new UnknownProgramError(err);
}
