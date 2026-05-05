import { Commitment, PublicKey } from "@solana/web3.js";

import type { BracketChainClient } from "../client";
import type { MatchNode, Tournament } from "../types";

/**
 * Event emitted by {@link subscribe} when an account changes on-chain.
 *
 * Discriminated by `kind` so consumers can narrow on a single union type.
 */
export type TournamentSubscriptionEvent =
  | {
      kind: "tournament";
      address: PublicKey;
      account: Tournament;
    }
  | {
      kind: "match";
      address: PublicKey;
      account: MatchNode;
    };

export interface SubscribeOptions {
  /**
   * Additional MatchNode PDAs to watch alongside the tournament. The web app
   * typically passes the current round's active matches — when those flip to
   * Completed, swap to the next round and re-subscribe.
   */
  matchPdas?: PublicKey[];
  /**
   * Commitment for account-change deliveries. Defaults to the client's
   * provider commitment.
   */
  commitment?: Commitment;
  /**
   * Phase 5.4: invoked when a subscription's account-change handler throws
   * during decode, OR when the underlying WebSocket signals an error event.
   *
   * Consumers can plug their own resub strategy here — the most common
   * pattern is to tear down the current subscription and call `subscribe()`
   * again after a backoff window. The SDK does NOT auto-resubscribe in MVP
   * (full Drift v2 resub manager is V1+ scope) — the frontend's 30s inactivity
   * reconcile is the safety net for transient WS drops.
   */
  onError?: (err: SubscriptionError) => void;
}

/** Phase 5.4: typed error surface for subscribe() callbacks. */
export interface SubscriptionError {
  /** Address whose handler threw, or null for connection-level errors. */
  address: PublicKey | null;
  /** Underlying error or message. */
  cause: unknown;
  /** Subscription kind that errored — useful for selective resub. */
  kind: "tournament" | "match" | "connection";
}

/**
 * Live-subscribe to a tournament's on-chain state via Solana WebSocket
 * `onAccountChange`. The callback fires whenever the Tournament PDA or any
 * of the supplied MatchNode PDAs changes.
 *
 * **Scope (MVP):** single tournament + caller-supplied match PDAs. We do NOT
 * generalize to multi-PDA filter/transform pipelines or auto-reconnect on
 * WS drop — those land in V1.
 *
 * Errors thrown by Anchor's account decoder inside the callback are swallowed
 * silently — consumers don't see partial state. This function itself does not
 * throw; subscription-level RPC failures surface via the underlying connection's
 * own error handlers.
 *
 * @returns an unsubscribe fn that tears down every WS handler this call
 *   registered. Idempotent — safe to call multiple times.
 */
export function subscribe(
  client: BracketChainClient,
  tournamentPda: PublicKey,
  callback: (event: TournamentSubscriptionEvent) => void,
  options: SubscribeOptions = {},
): () => void {
  const commitment = options.commitment ?? client.provider.opts.commitment;
  const subscriptionIds: number[] = [];
  const onError = options.onError;

  // Tournament account
  const tournamentSubId = client.connection.onAccountChange(
    tournamentPda,
    (accountInfo) => {
      try {
        const account = client.program.coder.accounts.decode<Tournament>(
          "tournament",
          accountInfo.data,
        );
        callback({ kind: "tournament", address: tournamentPda, account });
      } catch (err) {
        // Decode failure — account might have been closed or written by another
        // program. Surface to onError so consumers can decide whether to resub
        // (Phase 5.4); previously this was swallowed silently.
        if (onError) {
          onError({ address: tournamentPda, cause: err, kind: "tournament" });
        }
      }
    },
    commitment,
  );
  subscriptionIds.push(tournamentSubId);

  // MatchNode accounts
  for (const matchPda of options.matchPdas ?? []) {
    const matchSubId = client.connection.onAccountChange(
      matchPda,
      (accountInfo) => {
        try {
          const account = client.program.coder.accounts.decode<MatchNode>(
            "matchNode",
            accountInfo.data,
          );
          callback({ kind: "match", address: matchPda, account });
        } catch (err) {
          if (onError) {
            onError({ address: matchPda, cause: err, kind: "match" });
          }
        }
      },
      commitment,
    );
    subscriptionIds.push(matchSubId);
  }

  let torn = false;
  return () => {
    if (torn) return;
    torn = true;
    for (const id of subscriptionIds) {
      void client.connection.removeAccountChangeListener(id);
    }
  };
}
