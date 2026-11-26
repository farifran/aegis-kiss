
/**
 * @license
 * SPDX-License-Identifier: MIT
*/

import { Redis } from '@upstash/redis';
import {
    checkRateLimit,
    getClientIp,
    getCorsOrigin as getCorsOriginFromRules,
    isOriginAllowed,
    parseAllowedOrigins,
    parsePositiveInt
} from './_httpSecurity';

export const config = {
  runtime: 'edge',
};

const SHOULD_LOG = typeof process !== 'undefined' && !!process.env && process.env.NODE_ENV !== 'production';
const logger = {
        error: (message: string, error?: unknown) => {
                if (!SHOULD_LOG) return;
                if (error !== undefined) console.error(message, error);
                else console.error(message);
        }
};

const LUA_SHARDED_UPDATE = `
local key = KEYS[1]
local newTs = tonumber(ARGV[1])
local shardsJson = ARGV[2]

local currentTs = tonumber(redis.call("HGET", key, "lastModified") or 0)

if not newTs then
    return { "ERROR", "INVALID_TS" }
end

-- Optimistic Concurrency Control
if newTs < currentTs then
    local all = redis.call("HGETALL", key)
    return { "CONFLICT", all }
end

-- Robust JSON Parsing
local status, shards = pcall(cjson.decode, shardsJson)
if not status then
    return { "ERROR", "INVALID_JSON" }
end

-- Atomic Shard Update
for shardName, shardData in pairs(shards) do
    if type(shardData) == "string" then
        redis.call("HSET", key, shardName, shardData)
    else
        return { "ERROR", "INVALID_SHARD_TYPE", shardName, type(shardData) }
    end
end

redis.call("HSET", key, "lastModified", newTs)
return { "OK" }
`;

const MAX_SHARDS_PER_REQUEST = 256;
const MAX_SHARD_VALUE_BYTES = 512 * 1024; // 512KB por shard
const MAX_TOTAL_SHARDS_BYTES = 4 * 1024 * 1024; // 4MB total
const MAX_REQUEST_BODY_BYTES = 5 * 1024 * 1024; // 5MB total bruto

const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);
const CORS_STRICT = process.env.CORS_STRICT === '1';
const ALLOW_LEGACY_SYNC_AUTH = process.env.ALLOW_LEGACY_SYNC_AUTH === '1';
const SYNC_HASH_REGEX = /^[a-f0-9]{64}$/i;

function getCorsOrigin(req: Request): string {
    return getCorsOriginFromRules(req, ALLOWED_ORIGINS);
}

function getResponseHeaders(req: Request): Record<string, string> {
    const allowHeaders = ['Content-Type', 'X-Sync-Key-Hash'];
    if (ALLOW_LEGACY_SYNC_AUTH) allowHeaders.push('Authorization');

    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': getCorsOrigin(req),
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': allowHeaders.join(', '),
        'Vary': 'Origin'
    };
}

function withEtag(headers: Record<string, string>, etag: string): Record<string, string> {
    return {
        ...headers,
        'ETag': etag
    };
}

function isRequestBodyTooLarge(req: Request): boolean {
    const contentLength = req.headers.get('content-length');
    if (!contentLength) return false;

    const parsed = Number(contentLength);
    return Number.isFinite(parsed) && parsed > MAX_REQUEST_BODY_BYTES;
}

async function sha256(message: string) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const SYNC_RATE_LIMIT_WINDOW_MS = parsePositiveInt(process.env.SYNC_RATE_LIMIT_WINDOW_MS, 60_000);
const SYNC_RATE_LIMIT_MAX_REQUESTS = parsePositiveInt(process.env.SYNC_RATE_LIMIT_MAX_REQUESTS, 120);
const SYNC_RATE_LIMIT_DISABLED = process.env.NODE_ENV === 'test' || process.env.DISABLE_RATE_LIMIT === '1';

type ErrorLike = { message?: string };

type SyncPostBody = {
    lastModified?: unknown;
    shards?: Record<string, unknown>;
};

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && typeof (error as ErrorLike).message === 'string') return (error as ErrorLike).message as string;
    return 'Internal Server Error';
}

async function extractKeyHash(req: Request): Promise<string | null> {
    const directHash = req.headers.get('x-sync-key-hash')?.trim() || '';
    if (SYNC_HASH_REGEX.test(directHash)) return directHash;

    if (!ALLOW_LEGACY_SYNC_AUTH) return null;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

    const rawKey = authHeader.replace('Bearer ', '').trim();
    if (rawKey.length < 8) return null;
    return sha256(rawKey);
}

export default async function handler(req: Request) {
    const reqOrigin = req.headers.get('origin') || '';
    const HEADERS_BASE = getResponseHeaders(req);
    if (CORS_STRICT && ALLOWED_ORIGINS.length > 0 && reqOrigin && !isOriginAllowed(req, reqOrigin, ALLOWED_ORIGINS)) {
        return new Response(JSON.stringify({ error: 'Origin not allowed', code: 'CORS_DENIED' }), {
            status: 403,
            headers: HEADERS_BASE
        });
    }

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS_BASE });

    const dbUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const dbToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!dbUrl || !dbToken) {
         return new Response(JSON.stringify({ error: 'Server Config Error' }), { status: 500, headers: HEADERS_BASE });
    }

    const kv = new Redis({ url: dbUrl, token: dbToken });

    try {
        const keyHash = await extractKeyHash(req);

        if (!keyHash || !SYNC_HASH_REGEX.test(keyHash)) {
            return new Response(JSON.stringify({ error: 'Auth Required' }), { status: 401, headers: HEADERS_BASE });
        }

        const ip = getClientIp(req);
        const limiter = await checkRateLimit({
            namespace: 'sync',
            key: `${keyHash}:${ip}:${req.method}`,
            windowMs: SYNC_RATE_LIMIT_WINDOW_MS,
            maxRequests: SYNC_RATE_LIMIT_MAX_REQUESTS,
            disabled: SYNC_RATE_LIMIT_DISABLED,
            localMaxEntries: 2000
        });
        if (limiter.limited) {
            return new Response(JSON.stringify({ error: 'Too Many Requests', code: 'RATE_LIMITED' }), {
                status: 429,
                headers: {
                    ...HEADERS_BASE,
                    'Retry-After': String(limiter.retryAfterSec)
                }
            });
        }
        
        const dataKey = `sync_v3:${keyHash}`;

        if (req.method === 'GET') {
            const allData = await kv.hgetall(dataKey);
            if (!allData) return new Response('null', { status: 200, headers: HEADERS_BASE });
            const payload = JSON.stringify(allData);
            const etag = `"${await sha256(payload)}"`;
            const ifNoneMatch = req.headers.get('if-none-match');
            if (ifNoneMatch && ifNoneMatch === etag) {
                return new Response(null, { status: 304, headers: withEtag(HEADERS_BASE, etag) });
            }
            return new Response(payload, { status: 200, headers: withEtag(HEADERS_BASE, etag) });
        }

        if (req.method === 'POST') {
            if (isRequestBodyTooLarge(req)) {
                return new Response(JSON.stringify({ error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE', detail: 'content-length' }), { status: 413, headers: HEADERS_BASE });
            }

            const rawBody = await req.text();
            const rawBodyBytes = new TextEncoder().encode(rawBody).length;
            if (rawBodyBytes > MAX_REQUEST_BODY_BYTES) {
                return new Response(JSON.stringify({ error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE', detail: 'body' }), { status: 413, headers: HEADERS_BASE });
            }

            let body: SyncPostBody;
            try {
                body = JSON.parse(rawBody) as SyncPostBody;
            } catch {
                return new Response(JSON.stringify({ error: 'Invalid JSON', code: 'INVALID_JSON' }), { status: 400, headers: HEADERS_BASE });
            }
            const { lastModified, shards } = body;

            if (lastModified === undefined) {
                return new Response(JSON.stringify({ error: 'Missing lastModified' }), { status: 400, headers: HEADERS_BASE });
            }
            if (!shards || typeof shards !== 'object' || Array.isArray(shards)) {
                return new Response(JSON.stringify({ error: 'Invalid or missing shards' }), { status: 400, headers: HEADERS_BASE });
            }

            const shardEntries = Object.entries(shards);
            if (shardEntries.length > MAX_SHARDS_PER_REQUEST) {
                return new Response(JSON.stringify({ error: 'Too many shards', code: 'SHARD_LIMIT_EXCEEDED' }), { status: 413, headers: HEADERS_BASE });
            }

            const lastModifiedNum = Number(lastModified);
            if (!Number.isFinite(lastModifiedNum)) {
                return new Response(JSON.stringify({ error: 'Invalid lastModified', code: 'INVALID_TS' }), { status: 400, headers: HEADERS_BASE });
            }

            let totalBytes = 0;
            for (const [shardName, shardValue] of shardEntries) {
                if (typeof shardValue !== 'string') {
                    return new Response(JSON.stringify({ error: 'Invalid shard type', code: 'INVALID_SHARD_TYPE', detail: shardName, detailType: typeof shardValue }), { status: 400, headers: HEADERS_BASE });
                }
                const shardBytes = new TextEncoder().encode(shardValue).length;
                if (shardBytes > MAX_SHARD_VALUE_BYTES) {
                    return new Response(JSON.stringify({ error: 'Shard too large', code: 'SHARD_TOO_LARGE', detail: shardName }), { status: 413, headers: HEADERS_BASE });
                }
                totalBytes += shardBytes;
                if (totalBytes > MAX_TOTAL_SHARDS_BYTES) {
                    return new Response(JSON.stringify({ error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE' }), { status: 413, headers: HEADERS_BASE });
                }
            }

            let result: unknown = null;
            for (let attempt = 0; attempt < 2; attempt++) {
                result = await kv.eval(LUA_SHARDED_UPDATE, [dataKey], [String(lastModifiedNum), JSON.stringify(shards)]);
                if (Array.isArray(result)) break;
                await sleep(50);
            }

            if (!Array.isArray(result)) {
                return new Response(JSON.stringify({
                    error: 'Atomic sync unavailable',
                    code: 'LUA_UNAVAILABLE',
                    detail: 'Non-atomic fallback disabled to prevent shard desynchronization'
                }), { status: 503, headers: HEADERS_BASE });
            }
            
            if (result[0] === 'OK') return new Response('{"success":true}', { status: 200, headers: HEADERS_BASE });

            if (typeof result[0] === 'number') {
                return new Response(JSON.stringify({
                    error: 'Atomic sync unavailable',
                    code: 'LUA_UNAVAILABLE',
                    detail: 'Lua engine returned invalid format'
                }), { status: 503, headers: HEADERS_BASE });
            }
            
            if (result[0] === 'CONFLICT') {
                // Lua returns a flat array [key, val, key, val...] for HGETALL
                const rawList = Array.isArray(result[1]) ? (result[1] as string[]) : [];
                const conflictShards: Record<string, string> = {};
                for (let i = 0; i < rawList.length; i += 2) {
                    conflictShards[rawList[i]] = rawList[i+1];
                }
                return new Response(JSON.stringify(conflictShards), { status: 409, headers: HEADERS_BASE });
            }

            const code = typeof result[1] === 'string' ? result[1] : 'UNKNOWN';
            const detail = typeof result[2] === 'string' ? result[2] : undefined;
            const detailType = typeof result[3] === 'string' ? result[3] : undefined;
            return new Response(JSON.stringify({ error: 'Lua Execution Error', code, detail, detailType, raw: result }), { status: 400, headers: HEADERS_BASE });
        }

        return new Response(null, { status: 405 });
    } catch (error: unknown) {
        logger.error('KV Error:', error);
        return new Response(JSON.stringify({ error: getErrorMessage(error) }), { status: 500, headers: HEADERS_BASE });
    }
}
