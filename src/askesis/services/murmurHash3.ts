/**
 * @license
 * SPDX-License-Identifier: MIT
 */

// Zero-deps murmurhash3 (x86_32) used for sync shard hashing.
export function murmurHash3(key: string, seed: number = 0): string {
    let remainder = key.length & 3,
        bytes = key.length - remainder,
        h1 = seed,
        c1 = 0xcc9e2d51,
        c2 = 0x1b873593,
        i = 0;

    while (i < bytes) {
        let k1 =
            (key.charCodeAt(i) & 0xff) |
            ((key.charCodeAt(++i) & 0xff) << 8) |
            ((key.charCodeAt(++i) & 0xff) << 16) |
            ((key.charCodeAt(++i) & 0xff) << 24);
        ++i;
        k1 = ((((k1 & 0xffff) * c1) + ((((k1 >>> 16) * c1) & 0xffff) << 16))) & 0xffffffff;
        k1 = (k1 << 15) | (k1 >>> 17);
        k1 = ((((k1 & 0xffff) * c2) + ((((k1 >>> 16) * c2) & 0xffff) << 16))) & 0xffffffff;
        h1 ^= k1;
        h1 = (h1 << 13) | (h1 >>> 19);
        h1 = (((h1 * 5) + 0xe6546b64)) & 0xffffffff;
    }

    let k2 = 0;
    switch (remainder) {
        case 3:
            k2 ^= (key.charCodeAt(i + 2) & 0xff) << 16;
        case 2:
            k2 ^= (key.charCodeAt(i + 1) & 0xff) << 8;
        case 1:
            k2 ^= (key.charCodeAt(i) & 0xff);
            k2 = (((k2 & 0xffff) * c1) + ((((k2 >>> 16) * c1) & 0xffff) << 16)) & 0xffffffff;
            k2 = (k2 << 15) | (k2 >>> 17);
            k2 = (((k2 & 0xffff) * c2) + ((((k2 >>> 16) * c2) & 0xffff) << 16)) & 0xffffffff;
            h1 ^= k2;
    }

    h1 ^= key.length;
    h1 ^= h1 >>> 16;
    h1 = (((h1 & 0xffff) * 0x85ebca6b) + ((((h1 >>> 16) * 0x85ebca6b) & 0xffff) << 16)) & 0xffffffff;
    h1 ^= h1 >>> 13;
    h1 = (((h1 & 0xffff) * 0xc2b2ae35) + ((((h1 >>> 16) * 0xc2b2ae35) & 0xffff) << 16)) & 0xffffffff;
    h1 ^= h1 >>> 16;

    return (h1 >>> 0).toString(16);
}
