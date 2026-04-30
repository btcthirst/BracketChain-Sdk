/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/bracket_chain.json`.
 */
export type BracketChain = {
  "address": "AuXJKpuZtkegs2ZSgopgckhN7Ev8bUz4zBc238LD2F1",
  "metadata": {
    "name": "bracketChain",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "BracketChain on-chain tournament protocol"
  },
  "instructions": [
    {
      "name": "cancelTournament",
      "discriminator": [
        249,
        227,
        133,
        5,
        9,
        142,
        29,
        122
      ],
      "accounts": [
        {
          "name": "caller",
          "docs": [
            "Only required to be the organizer when flipping status to Cancelled.",
            "Once status == Cancelled, any signer can call to process refund chunks."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "tournament",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  117,
                  114,
                  110,
                  97,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "tournament.organizer",
                "account": "tournament"
              },
              {
                "kind": "account",
                "path": "tournament.name",
                "account": "tournament"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "tournament"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "createTournament",
      "discriminator": [
        158,
        137,
        233,
        231,
        73,
        132,
        191,
        68
      ],
      "accounts": [
        {
          "name": "organizer",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocolConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tournament",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  117,
                  114,
                  110,
                  97,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "organizer"
              },
              {
                "kind": "arg",
                "path": "name"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "tournament"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "entryFee",
          "type": "u64"
        },
        {
          "name": "maxParticipants",
          "type": "u16"
        },
        {
          "name": "payoutPreset",
          "type": {
            "defined": {
              "name": "payoutPreset"
            }
          }
        },
        {
          "name": "registrationDeadline",
          "type": "i64"
        }
      ]
    },
    {
      "name": "initializeProtocol",
      "discriminator": [
        188,
        233,
        252,
        106,
        134,
        146,
        202,
        91
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocolConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "docs": [
            "The actual ATA `(treasury, usdc_mint)` is derived at distribution time."
          ]
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "joinTournament",
      "discriminator": [
        77,
        21,
        212,
        206,
        77,
        82,
        124,
        31
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "signer": true
        },
        {
          "name": "tournament",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  117,
                  114,
                  110,
                  97,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "tournament.organizer",
                "account": "tournament"
              },
              {
                "kind": "account",
                "path": "tournament.name",
                "account": "tournament"
              }
            ]
          }
        },
        {
          "name": "participant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  114,
                  116,
                  105,
                  99,
                  105,
                  112,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "tournament"
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "playerTokenAccount",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "tournament"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "reportResult",
      "discriminator": [
        195,
        187,
        161,
        107,
        75,
        154,
        102,
        183
      ],
      "accounts": [
        {
          "name": "organizer",
          "writable": true,
          "signer": true
        },
        {
          "name": "tournament",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  117,
                  114,
                  110,
                  97,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "tournament.organizer",
                "account": "tournament"
              },
              {
                "kind": "account",
                "path": "tournament.name",
                "account": "tournament"
              }
            ]
          }
        },
        {
          "name": "matchAccount",
          "writable": true
        },
        {
          "name": "nextMatch",
          "docs": [
            "Required for non-final matches; pass `None` when reporting the final."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "protocolConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "tournament"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "winner",
          "type": "pubkey"
        },
        {
          "name": "placements",
          "type": {
            "vec": "pubkey"
          }
        }
      ]
    },
    {
      "name": "startTournament",
      "discriminator": [
        164,
        168,
        208,
        157,
        43,
        10,
        220,
        241
      ],
      "accounts": [
        {
          "name": "organizer",
          "writable": true,
          "signer": true
        },
        {
          "name": "tournament",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  117,
                  114,
                  110,
                  97,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "tournament.organizer",
                "account": "tournament"
              },
              {
                "kind": "account",
                "path": "tournament.name",
                "account": "tournament"
              }
            ]
          }
        },
        {
          "name": "slotHashes",
          "docs": [
            "Read manually because deserializing the full Vec is expensive."
          ],
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "descriptors",
          "type": {
            "vec": {
              "defined": {
                "name": "matchInitDescriptor"
              }
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "matchNode",
      "discriminator": [
        177,
        131,
        32,
        203,
        23,
        107,
        237,
        191
      ]
    },
    {
      "name": "participant",
      "discriminator": [
        32,
        142,
        108,
        79,
        247,
        179,
        54,
        6
      ]
    },
    {
      "name": "protocolConfig",
      "discriminator": [
        207,
        91,
        250,
        28,
        152,
        179,
        215,
        209
      ]
    },
    {
      "name": "tournament",
      "discriminator": [
        175,
        139,
        119,
        242,
        115,
        194,
        57,
        92
      ]
    }
  ],
  "events": [
    {
      "name": "matchReported",
      "discriminator": [
        213,
        163,
        144,
        194,
        233,
        124,
        25,
        37
      ]
    },
    {
      "name": "participantRegistered",
      "discriminator": [
        47,
        115,
        159,
        109,
        135,
        121,
        70,
        193
      ]
    },
    {
      "name": "refundIssued",
      "discriminator": [
        249,
        16,
        159,
        159,
        93,
        186,
        145,
        206
      ]
    },
    {
      "name": "tournamentCancelled",
      "discriminator": [
        118,
        92,
        146,
        131,
        165,
        72,
        81,
        120
      ]
    },
    {
      "name": "tournamentCompleted",
      "discriminator": [
        67,
        47,
        75,
        4,
        191,
        61,
        1,
        150
      ]
    },
    {
      "name": "tournamentCreated",
      "discriminator": [
        102,
        32,
        240,
        45,
        52,
        64,
        97,
        0
      ]
    },
    {
      "name": "tournamentStarted",
      "discriminator": [
        200,
        157,
        174,
        194,
        174,
        219,
        107,
        44
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorizedAuthority",
      "msg": "Caller is not the authorized authority for this action"
    },
    {
      "code": 6001,
      "name": "tournamentFull",
      "msg": "Tournament has reached its maximum participant count"
    },
    {
      "code": 6002,
      "name": "alreadyRegistered",
      "msg": "Wallet is already registered for this tournament"
    },
    {
      "code": 6003,
      "name": "registrationClosed",
      "msg": "Registration window for this tournament is closed"
    },
    {
      "code": 6004,
      "name": "notInRegistration",
      "msg": "Tournament is not in the Registration state"
    },
    {
      "code": 6005,
      "name": "notActive",
      "msg": "Tournament is not in the Active state"
    },
    {
      "code": 6006,
      "name": "notCompleted",
      "msg": "Tournament is not in the Completed state"
    },
    {
      "code": 6007,
      "name": "invalidPayoutPreset",
      "msg": "Selected payout preset is invalid"
    },
    {
      "code": 6008,
      "name": "presetExceedsParticipants",
      "msg": "Selected payout preset requires more participants than configured"
    },
    {
      "code": 6009,
      "name": "matchAlreadyReported",
      "msg": "Match has already been reported"
    },
    {
      "code": 6010,
      "name": "nonParticipantWinner",
      "msg": "Reported winner is not a participant of the tournament"
    },
    {
      "code": 6011,
      "name": "tournamentInProgress",
      "msg": "Cannot cancel a tournament that has matches in progress"
    },
    {
      "code": 6012,
      "name": "refundAlreadyIssued",
      "msg": "Refund has already been issued to this participant"
    },
    {
      "code": 6013,
      "name": "maxParticipantsExceeded",
      "msg": "Participant count exceeds the protocol maximum (128)"
    },
    {
      "code": 6014,
      "name": "minParticipantsNotMet",
      "msg": "Participant count is below the protocol minimum (2)"
    },
    {
      "code": 6015,
      "name": "nameTooLong",
      "msg": "Tournament name exceeds 32 bytes"
    },
    {
      "code": 6016,
      "name": "invalidUsdcMint",
      "msg": "Provided USDC mint does not match the protocol-configured mint"
    },
    {
      "code": 6017,
      "name": "invalidVault",
      "msg": "Provided vault token account does not match the tournament vault"
    },
    {
      "code": 6018,
      "name": "invalidTreasury",
      "msg": "Provided treasury token account does not match the protocol treasury"
    },
    {
      "code": 6019,
      "name": "invalidMatchIndex",
      "msg": "Match referenced is outside the bracket"
    },
    {
      "code": 6020,
      "name": "parentMatchesNotComplete",
      "msg": "Match parents not yet completed; cannot report this match"
    },
    {
      "code": 6021,
      "name": "remainingAccountsMismatch",
      "msg": "remaining_accounts does not match expected count for this instruction"
    },
    {
      "code": 6022,
      "name": "arithmeticOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6023,
      "name": "slotHashesUnavailable",
      "msg": "slot_hashes sysvar is empty; cannot derive seed"
    }
  ],
  "types": [
    {
      "name": "matchInitDescriptor",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "round",
            "type": "u8"
          },
          {
            "name": "matchIndex",
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "playerA",
            "type": "pubkey"
          },
          {
            "name": "playerB",
            "type": "pubkey"
          },
          {
            "name": "bye",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "matchNode",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tournament",
            "type": "pubkey"
          },
          {
            "name": "round",
            "type": "u8"
          },
          {
            "name": "matchIndex",
            "type": "u16"
          },
          {
            "name": "playerA",
            "type": "pubkey"
          },
          {
            "name": "playerB",
            "type": "pubkey"
          },
          {
            "name": "winner",
            "type": "pubkey"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "matchStatus"
              }
            }
          },
          {
            "name": "bye",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "matchReported",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tournament",
            "type": "pubkey"
          },
          {
            "name": "round",
            "type": "u8"
          },
          {
            "name": "matchIndex",
            "type": "u16"
          },
          {
            "name": "winner",
            "type": "pubkey"
          },
          {
            "name": "reportedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "matchStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "pending"
          },
          {
            "name": "active"
          },
          {
            "name": "completed"
          }
        ]
      }
    },
    {
      "name": "participant",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tournament",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "seedIndex",
            "type": "u16"
          },
          {
            "name": "refundPaid",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "participantRegistered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tournament",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "participantIndex",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "payoutPreset",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "winnerTakesAll"
          },
          {
            "name": "standard"
          },
          {
            "name": "deep"
          }
        ]
      }
    },
    {
      "name": "protocolConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "refundIssued",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tournament",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "tournament",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "organizer",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "entryFee",
            "type": "u64"
          },
          {
            "name": "maxParticipants",
            "type": "u16"
          },
          {
            "name": "bracketSize",
            "type": "u16"
          },
          {
            "name": "participantCount",
            "type": "u16"
          },
          {
            "name": "matchesInitialized",
            "type": "u16"
          },
          {
            "name": "matchesReported",
            "type": "u16"
          },
          {
            "name": "totalMatches",
            "type": "u16"
          },
          {
            "name": "registrationDeadline",
            "type": "i64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "startedAt",
            "type": "i64"
          },
          {
            "name": "completedAt",
            "type": "i64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "tournamentStatus"
              }
            }
          },
          {
            "name": "payoutPreset",
            "type": {
              "defined": {
                "name": "payoutPreset"
              }
            }
          },
          {
            "name": "seedHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "champion",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "tournamentCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tournament",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "cancelledAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "tournamentCompleted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tournament",
            "type": "pubkey"
          },
          {
            "name": "champion",
            "type": "pubkey"
          },
          {
            "name": "grossPool",
            "type": "u64"
          },
          {
            "name": "feeAmount",
            "type": "u64"
          },
          {
            "name": "netPool",
            "type": "u64"
          },
          {
            "name": "completedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "tournamentCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tournament",
            "type": "pubkey"
          },
          {
            "name": "organizer",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "entryFee",
            "type": "u64"
          },
          {
            "name": "maxParticipants",
            "type": "u16"
          },
          {
            "name": "payoutPreset",
            "type": "u8"
          },
          {
            "name": "registrationDeadline",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "tournamentStarted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tournament",
            "type": "pubkey"
          },
          {
            "name": "bracketSize",
            "type": "u16"
          },
          {
            "name": "participantCount",
            "type": "u16"
          },
          {
            "name": "seedHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "startedAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "tournamentStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "registration"
          },
          {
            "name": "pendingBracketInit"
          },
          {
            "name": "active"
          },
          {
            "name": "completed"
          },
          {
            "name": "cancelled"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "bpsDenominator",
      "type": "u16",
      "value": "10000"
    },
    {
      "name": "maxParticipants",
      "type": "u16",
      "value": "128"
    },
    {
      "name": "minParticipants",
      "type": "u16",
      "value": "2"
    },
    {
      "name": "protocolFeeBps",
      "type": "u16",
      "value": "350"
    }
  ]
};
