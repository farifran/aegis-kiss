class RateLimiter {
    public windowMs: number;
    private remaining: number;
    private lastAttempt: number;

    constructor(windowMs: number) {
        this.windowMs = windowMs;
        this.remaining = windowMs;
        this.lastAttempt = 0;
    }

    allow(nowMs: number = Date.now()): boolean {
        if (nowMs - this.lastAttempt >= this.windowMs) {
            this.remaining = this.windowMs;
            this.lastAttempt = nowMs;
            return true;
        } else if (this.remaining > 0) {
            this.remaining--;
            this.lastAttempt = nowMs;
            return true;
        }
        return false;
    }

    reset(): void {
        this.remaining = this.windowMs;
        this.lastAttempt = 0;
    }

    get estimateBackoffMs(): bigint {
        const nextWindow = this.lastAttempt + this.windowMs;
        const backoffMs = nextWindow - this.lastAttempt;
        return BigInt(backoffMs);
    }
}

export { RateLimiter };
