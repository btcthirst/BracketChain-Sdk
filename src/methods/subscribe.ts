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
      } catch {
        // Decode failure — account might have been closed or written by another
        // program. Drop the event silently; consumers don't need partial state.
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
        } catch {
          // Same as above — drop silently.
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
