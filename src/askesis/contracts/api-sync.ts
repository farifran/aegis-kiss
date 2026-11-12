/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file contracts/api-sync.ts
 * @description Contratos de payload para sincronizacao de shards no endpoint /api/sync.
 */

export type EncryptedShardMap = Record<string, string>;

export type SyncPostRequest = {
    lastModified: number;
    shards: EncryptedShardMap;
    /** Reset de conta: apaga o cofre inteiro antes de gravar os shards enviados. */
    purge?: boolean;
};

export type SyncServerShards = EncryptedShardMap & {
    lastModified?: string;
    /** Carimbo do último reset de conta. Campo de controle, não é shard cifrado. */
    resetAt?: string;
};

export type SyncPostResponse = {
    fallback?: boolean;
};
