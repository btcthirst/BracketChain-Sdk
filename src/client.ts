import { AnchorProvider, Program, Wallet, Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey, Commitment } from "@solana/web3.js";

import IDL_JSON from "./idl/bracket_chain.json";
import type { BracketChain } from "./idl/bracket_chain";

export interface BracketChainClientOptions {
  /** Solana RPC connection. Cluster choice is the caller's responsibility. */
  connection: Connection;
  /**
   * Wallet for signing transactions. If omitted, the client is read-only —
   * mutating methods (createTournament, joinTournament, etc.) will throw at
   * runtime with a clear message.
   *
   * In a frontend, pass `useAnchorWallet()` from @solana/wallet-adapter-react.
   * In a Node script, wrap a Keypair with `anchor.Wallet`.
   */
  wallet?: Wallet;
  /** Override the program ID. Defaults to the value baked into the IDL. */
  programId?: PublicKey;
  /** Commitment level used for both reads and writes. Default: "confirmed". */
  commitment?: Commitment;
}

/**
 * Read-only Wallet stub used when `BracketChainClient` is constructed without
 * a wallet. `provider.publicKey` is `PublicKey.default`; signing methods throw.
 *
 * This lets us share one Provider/Program code-path for both read-only and
 * signing clients — Anchor accepts any `Wallet`-shaped object.
 */
class ReadOnlyWallet implements Wallet {
  public readonly publicKey: PublicKey = PublicKey.default;

  // eslint-disable-next-line @typescript-eslint/require-await
  public async signTransaction<T>(_tx: T): Promise<T> {
    throw new Error("BracketChainClient is read-only — no wallet was provided.");
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  public async signAllTransactions<T>(_txs: T[]): Promise<T[]> {
    throw new Error("BracketChainClient is read-only — no wallet was provided.");
  }
  public get payer(): never {
    throw new Error("BracketChainClient is read-only — no wallet was provided.");
  }
}

/**
 * High-level client for the BracketChain on-chain program.
 *
 * Phase 3.1: read-only methods only. Mutating methods are added in Phase 3.2.
 *
 * @example
 * ```ts
 * import { Connection, clusterApiUrl } from "@solana/web3.js";
 * import { BracketChainClient } from "@bracketchain/sdk";
 *
 * const client = new BracketChainClient({
 *   connection: new Connection(clusterApiUrl("devnet")),
 * });
 *
 * const tournaments = await client.listTournaments();
 * ```
 */
export class BracketChainClient {
  public readonly connection: Connection;
  public readonly provider: AnchorProvider;
  public readonly program: Program<BracketChain>;
  public readonly programId: PublicKey;

  constructor(opts: BracketChainClientOptions) {
    this.connection = opts.connection;

    const wallet = opts.wallet ?? new ReadOnlyWallet();
    this.provider = new AnchorProvider(opts.connection, wallet, {
      commitment: opts.commitment ?? "confirmed",
    });

    this.program = new Program<BracketChain>(
      IDL_JSON as unknown as BracketChain & Idl,
      this.provider,
    );
    this.programId = opts.programId ?? this.program.programId;
  }

  /** True if a real wallet is attached and mutations are allowed. */
  public get canSign(): boolean {
    return !(this.provider.wallet instanceof ReadOnlyWallet);
  }
}
