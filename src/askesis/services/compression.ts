/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/compression.ts
 * @description GZIP para o cold storage (arquivos anuais), via Compression Streams API.
 *
 * ENVELOPE:
 *   "gz1:" + base64(gzip(utf8(json)))
 *
 * O envelope é uma STRING por decisão de compatibilidade: o mesmo valor atravessa
 * quatro fronteiras — IndexedDB (structured clone), postMessage do worker,
 * JSON.stringify do payload de sync e o hash de shard do murmur3. Um Uint8Array
 * sobreviveria às duas primeiras e viraria `{"0":31,"1":139,...}` nas duas últimas.
 * O base64 custa +33% sobre o gzip e ainda assim o saldo é grande (ver testes).
 *
 * O prefixo torna o formato autodescritivo: arquivos gravados antes desta camada
 * são JSON puro e continuam legíveis sem migração — `decompressArchive` devolve a
 * entrada intacta quando não há prefixo, e a próxima regravação já sai comprimida.
 *
 * Este módulo é isomórfico (roda no worker) e é a camada baixa de compressão:
 * `crypto.ts` consome `gzipBytes`/`gunzipBytes` daqui para o envelope v3.
 */

import { bytesToBase64, base64ToBytes } from './base64';

const GZIP_PREFIX = 'gz1:';
const MAX_DECOMPRESSED_BYTES = 50 * 1024 * 1024; // 50 MB (proteção contra zip bomb; um ano real tem ~290 KB)

/**
 * Safari < 16.4 e Firefox < 113 não têm Compression Streams. Sem a API, gravamos
 * JSON puro: o app perde a economia, não a funcionalidade.
 */
function hasCompressionStreams(): boolean {
    return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

export function isCompressedArchive(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith(GZIP_PREFIX);
}

/** Compression Streams está disponível? Exposto para o envelope v3 decidir o flag. */
export const canCompress = hasCompressionStreams;

/**
 * Escreve e lê o TransformStream em paralelo. Escrever tudo antes de ler trava
 * assim que o payload passa do buffer interno do stream — e os arquivos anuais
 * chegam lá com facilidade.
 */
async function pump(transform: CompressionStream | DecompressionStream, input: BufferSource, maxOutputBytes?: number): Promise<Uint8Array<ArrayBuffer>> {
    const writer = transform.writable.getWriter();
    const writeDone = (async () => {
        await writer.write(input);
        await writer.close();
    })();
    // Handler anexado já: quando o gzip é inválido, a leitura estoura primeiro e a
    // rejeição gêmea da escrita ficaria órfã. O `await` abaixo continua propagando.
    writeDone.catch(() => {});

    const reader = transform.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.length;
        if (maxOutputBytes && total > maxOutputBytes) {
            await reader.cancel().catch(() => {});
            throw new Error(`gunzipBytes: payload descomprimido excede o limite de segurança (${maxOutputBytes} bytes)`);
        }
        chunks.push(value);
    }
    await writeDone;

    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

/** GZIP cru, sem envelope. Base do formato v3 de `crypto.ts`. */
export function gzipBytes(input: BufferSource): Promise<Uint8Array<ArrayBuffer>> {
    return pump(new CompressionStream('gzip'), input);
}

/** Inverso de `gzipBytes`. Lança quando o fluxo não é um gzip válido ou excede o teto. */
export function gunzipBytes(input: BufferSource): Promise<Uint8Array<ArrayBuffer>> {
    return pump(new DecompressionStream('gzip'), input, MAX_DECOMPRESSED_BYTES);
}

/**
 * Comprime um JSON de arquivo. Devolve o texto original quando a API não existe
 * ou quando o envelope ficaria maior que ele — o gzip tem ~20 bytes de cabeçalho,
 * então arquivos minúsculos não compensam o base64.
 */
export async function compressArchive(json: string): Promise<string> {
    if (!json || !hasCompressionStreams()) return json;

    try {
        const gzipped = await gzipBytes(new TextEncoder().encode(json));
        const envelope = GZIP_PREFIX + bytesToBase64(gzipped);
        return envelope.length < json.length ? envelope : json;
    } catch {
        return json;
    }
}

/**
 * Desembrulha um arquivo. Entrada sem prefixo passa direto (formato legado).
 *
 * LANÇA quando o envelope existe mas não pode ser lido — um envelope comprimido
 * por outro dispositivo em um navegador sem DecompressionStream, ou base64
 * corrompido. Os chamadores tratam a exceção preservando o arquivo como está;
 * devolver `{}` aqui apagaria o histórico na regravação seguinte.
 */
export async function decompressArchive(value: string): Promise<string> {
    if (!isCompressedArchive(value)) return value;
    if (!hasCompressionStreams()) {
        throw new Error('decompressArchive: Compression Streams API indisponível neste navegador');
    }

    const bytes = base64ToBytes(value.slice(GZIP_PREFIX.length));
    const plain = await gunzipBytes(bytes);
    return new TextDecoder().decode(plain);
}
