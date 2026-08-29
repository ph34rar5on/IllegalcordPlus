/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fixWebmDuration from "fix-webm-duration";

/**
 * Patches MP4 (ISO BMFF / fMP4) headers in-place so standard media players
 * (Windows Media Player, VLC, QuickTime, etc.) can read the total duration
 * and seek/scrub throughout the recording.
 * Pure JS implementation using DataView - works in Node.js, Electron and browser.
 */
export function fixMp4Duration(buffer: Buffer | Uint8Array, durationMs: number): Uint8Array {
    const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const view = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);
    let movieTimescale = 1000;

    function scanBox(start: number, end: number, path: string) {
        let pos = start;
        while (pos + 8 <= end) {
            const size = view.getUint32(pos, false);
            let type = "";
            for (let i = 0; i < 4; i++) {
                type += String.fromCharCode(uint8[pos + 4 + i]);
            }

            let boxEnd = end;
            let headerSize = 8;
            if (size === 1) {
                headerSize = 16;
                const high = view.getUint32(pos + 8, false);
                const low = view.getUint32(pos + 12, false);
                boxEnd = pos + (high * 4294967296 + low);
            } else if (size === 0) {
                boxEnd = end;
            } else {
                boxEnd = pos + size;
            }

            const currentPath = path ? `${path}.${type}` : type;

            if (currentPath === "moov.mvhd") {
                const version = view.getUint8(pos + headerSize);
                if (version === 0) {
                    movieTimescale = view.getUint32(pos + headerSize + 12, false) || 1000;
                    const durationUnits = Math.round((durationMs / 1000) * movieTimescale);
                    view.setUint32(pos + headerSize + 16, durationUnits, false);
                } else if (version === 1) {
                    movieTimescale = view.getUint32(pos + headerSize + 20, false) || 1000;
                    const durationUnits = Math.round((durationMs / 1000) * movieTimescale);
                    const high = Math.floor(durationUnits / 4294967296);
                    const low = durationUnits >>> 0;
                    view.setUint32(pos + headerSize + 24, high, false);
                    view.setUint32(pos + headerSize + 28, low, false);
                }
            } else if (currentPath.endsWith("tkhd")) {
                const version = view.getUint8(pos + headerSize);
                const durationUnits = Math.round((durationMs / 1000) * movieTimescale);
                if (version === 0) {
                    view.setUint32(pos + headerSize + 20, durationUnits, false);
                } else if (version === 1) {
                    const high = Math.floor(durationUnits / 4294967296);
                    const low = durationUnits >>> 0;
                    view.setUint32(pos + headerSize + 28, high, false);
                    view.setUint32(pos + headerSize + 32, low, false);
                }
            } else if (currentPath.endsWith("mdhd")) {
                const version = view.getUint8(pos + headerSize);
                if (version === 0) {
                    const mediaTimescale = view.getUint32(pos + headerSize + 12, false) || movieTimescale;
                    const durationUnits = Math.round((durationMs / 1000) * mediaTimescale);
                    view.setUint32(pos + headerSize + 16, durationUnits, false);
                } else if (version === 1) {
                    const mediaTimescale = view.getUint32(pos + headerSize + 20, false) || movieTimescale;
                    const durationUnits = Math.round((durationMs / 1000) * mediaTimescale);
                    const high = Math.floor(durationUnits / 4294967296);
                    const low = durationUnits >>> 0;
                    view.setUint32(pos + headerSize + 24, high, false);
                    view.setUint32(pos + headerSize + 28, low, false);
                }
            } else if (["moov", "trak", "mdia", "minf"].includes(type)) {
                scanBox(pos + headerSize, Math.min(boxEnd, end), currentPath);
            }

            if (boxEnd <= pos) break;
            pos = boxEnd;
        }
    }

    try {
        scanBox(0, uint8.length, "");
    } catch (err) {
        console.warn("[AutoCallRecorder] MP4 duration patch warning:", err);
    }

    return uint8;
}

/**
 * Patches WebM/MKV buffer duration metadata with timeout safety.
 */
export async function fixWebmBufferDuration(buffer: Buffer | Uint8Array, durationMs: number): Promise<Uint8Array> {
    const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (typeof Blob === "undefined") return uint8;

    return new Promise<Uint8Array>(resolve => {
        const timeout = setTimeout(() => resolve(uint8), 1200);
        try {
            const blob = new Blob([uint8.slice()], { type: "video/webm" });
            fixWebmDuration(blob, durationMs, (fixedBlob: Blob) => {
                clearTimeout(timeout);
                if (fixedBlob && typeof fixedBlob.arrayBuffer === "function") {
                    fixedBlob.arrayBuffer().then(buf => resolve(new Uint8Array(buf))).catch(() => resolve(uint8));
                } else {
                    resolve(uint8);
                }
            });
        } catch {
            clearTimeout(timeout);
            resolve(uint8);
        }
    });
}

/**
 * Fixes media duration for any supported container (MP4, M4A, WebM, MKV, OGG).
 */
export async function fixMediaFileDuration(buffer: Buffer | Uint8Array, filename: string, durationMs: number): Promise<Buffer> {
    if (durationMs <= 0) {
        return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }

    const lower = filename.toLowerCase();
    let resultUint8: Uint8Array;

    if (lower.endsWith(".mp4") || lower.endsWith(".m4a")) {
        resultUint8 = fixMp4Duration(buffer, durationMs);
    } else if (lower.endsWith(".webm") || lower.endsWith(".mkv") || lower.endsWith(".ogg")) {
        try {
            resultUint8 = await fixWebmBufferDuration(buffer, durationMs);
        } catch {
            resultUint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        }
    } else {
        resultUint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    }

    return Buffer.from(resultUint8.buffer, resultUint8.byteOffset, resultUint8.byteLength);
}
