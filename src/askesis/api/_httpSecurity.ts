import { Redis } from '@upstash/redis';

export type RateLimitResult = { limited: boolean; retryAfterSec: number };

type LocalRateEntry = { count: number; resetAt: number };

type CheckRateLimitOptions = {
    namespace: string;
    key: string;
    windowMs: number;
    maxRequests: number;
    disabled?: boolean;
    localMaxEntries?: number;
};

const localRateLimitStores = new Map<string, Map<string, LocalRateEntry>>();
let distributedLimiterRedis: Redis | null | undefined;

export function parsePositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function parseAllowedOrigins(value: string | undefined): string[] {
    return (value || '')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean);
}

export function isSameDeploymentOrigin(req: Request, origin: string): boolean {
    if (!origin) return false;
    try {
        const originUrl = new URL(origin);
        const requestHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
        return !!requestHost && originUrl.host === requestHost;
    } catch {
        return false;
    }
}

export function matchesOriginRule(origin: string, rule: string): boolean {
    if (!origin || !rule) return false;
    if (rule === '*' || rule === origin) return true;

    const wildcardMatch = rule.match(/^(https?):\/\/\*\.(.+)$/i);
    if (!wildcardMatch) return false;

    try {
        const originUrl = new URL(origin);
        const expectedProtocol = wildcardMatch[1].toLowerCase();
        const expectedHostSuffix = wildcardMatch[2].toLowerCase();
        const host = originUrl.hostname.toLowerCase();

        return originUrl.protocol.replace(':', '').toLowerCase() === expectedProtocol
            && host.endsWith(`.${expectedHostSuffix}`);
    } catch {
        return false;
    }
}

export function isOriginAllowed(req: Request, origin: string, allowedOrigins: readonly string[]): boolean {
    if (!origin) return false;
    if (isSameDeploymentOrigin(req, origin)) return true;
    return allowedOrigins.some(rule => matchesOriginRule(origin, rule));
}

export function getCorsOrigin(req: Request, allowedOrigins: readonly string[]): string {
    const origin = req.headers.get('origin') || '';
    if (allowedOrigins.length === 0) {
        if (isSameDeploymentOrigin(req, origin)) return origin;
        return '*';
    }
    return isOriginAllowed(req, origin, allowedOrigins) ? origin : 'null';
}

function normalizeIpCandidate(value: string): string {
    const candidate = value.trim();
    if (!candidate) return '';
    // Limita tamanho para evitar amplificação de memória/chave via headers forjados.
    return candidate.slice(0, 64);
}

export function getClientIp(req: Request): string {
    const vercelForwarded = req.headers.get('x-vercel-forwarded-for');
    if (vercelForwarded) {
        const normalized = normalizeIpCandidate(vercelForwarded);
        if (normalized) return normalized;
    }

    const realIp = req.headers.get('x-real-ip');
    if (realIp) {
        const normalized = normalizeIpCandidate(realIp);
        if (normalized) return normalized;
    }

    const forwardedFor = req.headers.get('x-forwarded-for');
    if (forwardedFor) {
        const chain = forwardedFor.split(',').map(part => part.trim()).filter(Boolean);
        const lastHop = chain[chain.length - 1] || '';
        const normalized = normalizeIpCandidate(lastHop);
        if (normalized) return normalized;
    }

    return 'unknown';
}

function getDistributedLimiterRedis(): Redis | null {
    if (distributedLimiterRedis !== undefined) return distributedLimiterRedis;

    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
        distributedLimiterRedis = null;
        return distributedLimiterRedis;
    }

    distributedLimiterRedis = new Redis({ url, token });
    return distributedLimiterRedis;
}

function checkRateLimitLocal(options: CheckRateLimitOptions): RateLimitResult {
    const {
        namespace,
        key,
        windowMs,
        maxRequests,
        localMaxEntries = 2000
    } = options;

    let store = localRateLimitStores.get(namespace);
    if (!store) {
        store = new Map<string, LocalRateEntry>();
        localRateLimitStores.set(namespace, store);
    }

    const now = Date.now();

    if (store.size > localMaxEntries) {
        for (const [storeKey, value] of store.entries()) {
            if (value.resetAt <= now) store.delete(storeKey);
        }
    }

    const current = store.get(key);
    if (!current || current.resetAt <= now) {
        store.set(key, { count: 1, resetAt: now + windowMs });
        return { limited: false, retryAfterSec: 0 };
    }

    if (current.count >= maxRequests) {
        return {
            limited: true,
            retryAfterSec: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
        };
    }

    current.count += 1;
    return { limited: false, retryAfterSec: 0 };
}

export async function checkRateLimit(options: CheckRateLimitOptions): Promise<RateLimitResult> {
    if (options.disabled) return { limited: false, retryAfterSec: 0 };

    const redis = getDistributedLimiterRedis();
    if (!redis) return checkRateLimitLocal(options);

    const redisKey = `rl:${options.namespace}:${options.key}`;

    try {
        const count = Number(await redis.incr(redisKey));
        if (count === 1) {
            await redis.pexpire(redisKey, options.windowMs);
        }

        if (count > options.maxRequests) {
            const ttlMs = Number(await redis.pttl(redisKey));
            return {
                limited: true,
                retryAfterSec: Math.max(1, Math.ceil(Math.max(0, ttlMs) / 1000))
            };
        }

        return { limited: false, retryAfterSec: 0 };
    } catch {
        return checkRateLimitLocal(options);
    }
}
