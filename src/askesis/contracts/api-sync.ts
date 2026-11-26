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
};

export type SyncServerShards = EncryptedShardMap & {
    lastModified?: string;
};

export type SyncPostResponse = {
    fallback?: boolean;
};
