/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/base64.ts
 * @description Conversão bytes ↔ base64, isomórfica.
 *
 * Vive fora de crypto.ts porque compression.ts também precisa dela, e crypto.ts
 * passou a importar compression.ts para o envelope v3 — mantê-la aqui deixa o
 * grafo acíclico: base64 ← compression ← crypto.
 */

/**
 * Base64 em blocos. `btoa(String.fromCharCode(...bytes))` estoura o limite de
 * argumentos da engine (RangeError) para payloads grandes — e o estado inteiro
 * do app, cifrado, chega lá com poucos anos de histórico.
 */
const B64_CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += B64_CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK));
    }
    return btoa(binary);
}

// O retorno é explicitamente Uint8Array<ArrayBuffer> (e não o Uint8Array genérico,
// que admite SharedArrayBuffer): sem isso o resultado não satisfaz BufferSource e
// não pode ser passado direto às APIs de WebCrypto e Compression Streams.
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
    const str = atob(base64);
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
    return bytes;
}
