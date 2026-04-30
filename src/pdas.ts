import { PublicKey } from "@solana/web3.js";

// Seed constants — must match `bracket-chain-programs/src/constants.rs`.
const PROTOCOL_CONFIG_SEED = Buffer.from("protocol_config");
const TOURNAMENT_SEED = Buffer.from("tournament");
const VAULT_SEED = Buffer.from("vault");
const PARTICIPANT_SEED = Buffer.from("participant");
const MATCH_SEED = Buffer.from("match");

/**
 * Singleton ProtocolConfig PDA: ["protocol_config"].
 */
export function findProtocolConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([PROTOCOL_CONFIG_SEED], programId);
}

/**
 * Tournament PDA: ["tournament", organizer, name_bytes].
 * Name is enforced ≤32 bytes on-chain — caller is responsible for validating
 * before calling this helper.
 */
export function findTournamentPda(
  organizer: PublicKey,
  name: string,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [TOURNAMENT_SEED, organizer.toBuffer(), Buffer.from(name)],
    programId,
  );
}

/**
 * Vault PDA TokenAccount (NOT an ATA): ["vault", tournament].
 * Tournament PDA itself is the token authority — no separate vault-authority PDA.
 */
export function findVaultPda(
  tournament: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, tournament.toBuffer()],
    programId,
  );
}

/**
 * Participant PDA: ["participant", tournament, wallet].
 * One per (tournament, wallet) pair — Anchor `init` constraint enforces uniqueness.
 */
export function findParticipantPda(
  tournament: PublicKey,
  wallet: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PARTICIPANT_SEED, tournament.toBuffer(), wallet.toBuffer()],
    programId,
  );
}

/**
 * MatchNode PDA: ["match", tournament, [round: u8], match_index_le_bytes(u16)].
 * `round` is single-byte; `matchIndex` is u16 little-endian.
 */
export function findMatchPda(
  tournament: PublicKey,
  round: number,
  matchIndex: number,
  programId: PublicKey,
): [PublicKey, number] {
  if (round < 0 || round > 255) {
    throw new RangeError(`round must fit in u8 (0..255), got ${round}`);
  }
  if (matchIndex < 0 || matchIndex > 0xffff) {
    throw new RangeError(`matchIndex must fit in u16 (0..65535), got ${matchIndex}`);
  }
  const matchIndexLe = Buffer.alloc(2);
  matchIndexLe.writeUInt16LE(matchIndex, 0);
  return PublicKey.findProgramAddressSync(
    [
      MATCH_SEED,
      tournament.toBuffer(),
      Buffer.from([round]),
      matchIndexLe,
    ],
    programId,
  );
}
