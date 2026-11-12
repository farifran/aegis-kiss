import { vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

// --- Supressão do ExperimentalWarning de localStorage (Node >= 26) ---
// O primeiro acesso a `globalThis.localStorage` dispara um ExperimentalWarning por
// worker, poluindo o output do CI. O printer padrão do Node é um listener comum de
// 'warning'; substituímos por um que filtra só esse aviso (o shim abaixo cobre a
// funcionalidade — o aviso é puro ruído).
process.removeAllListeners('warning');
process.on('warning', (warning) => {
    if (warning.name === 'ExperimentalWarning' && /localstorage/i.test(warning.message)) return;
    console.error(`${warning.name}: ${warning.message}`);
});

// --- localStorage shim ---
// Node >= 26 define `globalThis.localStorage` como um getter nativo NÃO-enumerável
// (Web Storage experimental) que retorna `undefined` sem `--experimental-webstorage`.
// Essa propriedade pré-existente impede o ambiente de teste de instalar a sua, e o
// resultado é `localStorage === undefined` em runtime (note que `sessionStorage`,
// sendo enumerável, não sofre do mesmo problema). Instalamos uma implementação
// própria para que a suíte não dependa da versão do Node.
function createMemoryStorage(): Storage {
    const data = new Map<string, string>();
    return {
        get length() { return data.size; },
        key: (index: number) => Array.from(data.keys())[index] ?? null,
        getItem: (key: string) => data.get(String(key)) ?? null,
        setItem: (key: string, value: string) => { data.set(String(key), String(value)); },
        removeItem: (key: string) => { data.delete(String(key)); },
        clear: () => { data.clear(); }
    } as Storage;
}

if (!globalThis.localStorage) {
    const storage = (globalThis as { window?: { localStorage?: Storage } }).window?.localStorage
        ?? createMemoryStorage();
    Object.defineProperty(globalThis, 'localStorage', {
        value: storage,
        writable: true,
        configurable: true,
        enumerable: true
    });
    const win = (globalThis as unknown as { window?: Record<string, unknown> }).window;
    if (win && !win.localStorage) {
        Object.defineProperty(win, 'localStorage', {
            value: storage,
            writable: true,
            configurable: true,
            enumerable: true
        });
    }
}

// --- elementFromPoint shim ---
// jsdom não implementa `document.elementFromPoint` (não há layout). Os testes de
// drag-and-drop precisam apenas que a propriedade exista para poder aplicar
// `vi.spyOn`. Retorna null por padrão, como um ponto fora de qualquer elemento.
if (typeof document !== 'undefined' && typeof document.elementFromPoint !== 'function') {
    Object.defineProperty(document, 'elementFromPoint', {
        value: () => null,
        writable: true,
        configurable: true
    });
}

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
