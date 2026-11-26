import { vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

const originalFetch = globalThis.fetch ? globalThis.fetch.bind(globalThis) : undefined;

function tryParseUrl(input: unknown): URL | null {
    try {
        if (typeof input === 'string') return new URL(input, 'http://localhost');
        if (input instanceof URL) return new URL(input.toString(), 'http://localhost');
        // Request-like
        const req = input as { url?: string };
        if (req && typeof req.url === 'string') return new URL(req.url, 'http://localhost');
    } catch {}
    return null;
}

async function readWorkspaceLocaleJson(langFile: string): Promise<string | null> {
    try {
        const filePath = path.join(process.cwd(), 'locales', langFile);
        return await fs.readFile(filePath, 'utf8');
    } catch {
        return null;
    }
}

// Happy DOM tenta resolver URLs relativas com base em http://localhost:3000.
// Em testes, não queremos rede: servimos `locales/*.json` do disco.
globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    const url = tryParseUrl(input);
    if (url && url.pathname.startsWith('/locales/')) {
        const langFile = url.pathname.replace('/locales/', '');
        const body = await readWorkspaceLocaleJson(langFile);
        if (body !== null) {
            return new Response(body, {
                status: 200,
                headers: { 'Content-Type': 'application/json; charset=utf-8' }
            });
        }
        return new Response(JSON.stringify({}), {
            status: 404,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    }

    if (originalFetch) return originalFetch(input, init);
    return new Response('', { status: 404 });
});
