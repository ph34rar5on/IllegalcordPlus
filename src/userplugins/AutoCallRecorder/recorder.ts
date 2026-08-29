/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { t } from "@testcordplugins/autoTranslateNightcord";
import { Toasts } from "@webpack/common";

import { fixMp4Duration, fixWebmBufferDuration } from "./mediaFixer";

export interface RecordingOptions {
    mode: "voice" | "video";
    videoQuality?: string;
    videoFormat?: string;
    audioFormat?: string;
    maxStorageGB: number;
    shadowplayMinutes: number;
    autoSave: boolean;
    savePath: string;
    showSaveToast?: boolean;
}

let activeOpts: RecordingOptions | null = null;

let isRecording = false;
let isStopping = false; // guard against concurrent stopRecording calls
let mediaRecorder: MediaRecorder | null = null;
let recordCtx: AudioContext | null = null;
let recordDest: MediaStreamAudioDestinationNode | null = null;
let micStream: MediaStream | null = null;
let systemStream: MediaStream | null = null;

let currentFilename: string = "";
let isStreamMode = false;
let recordedChunks: Blob[] = [];
let pendingChunkPromises: Promise<any>[] = [];
const CHUNK_TIME_MS = 5000;
let startTimeMs = 0;
let memoryCheckInterval: any;

export function getRecordingDurationMs(): number {
    if (!isRecording) return 0;
    return Date.now() - startTimeMs;
}

export function isCurrentlyRecording(): boolean {
    return isRecording;
}

function getMediaRecordingConfig(opts: RecordingOptions): { mimeType: string; ext: string; } {
    if (opts.mode === "video") {
        if (opts.videoFormat === "mkv") {
            const mimes = [
                "video/x-matroska;codecs=avc1,opus",
                "video/x-matroska;codecs=avc1,aac",
                "video/x-matroska",
                "video/webm;codecs=vp8,opus",
                "video/webm"
            ];
            for (const m of mimes) {
                if (MediaRecorder.isTypeSupported(m)) return { mimeType: m, ext: "mkv" };
            }
            return { mimeType: "video/webm", ext: "mkv" };
        } else if (opts.videoFormat === "webm") {
            const mimes = [
                "video/webm;codecs=vp9,opus",
                "video/webm;codecs=vp8,opus",
                "video/webm;codecs=h264,opus",
                "video/webm"
            ];
            for (const m of mimes) {
                if (MediaRecorder.isTypeSupported(m)) return { mimeType: m, ext: "webm" };
            }
            return { mimeType: "video/webm", ext: "webm" };
        } else {
            // Default: MP4 (H.264 / AVC + AAC / Opus in MP4)
            const mimes = [
                "video/mp4;codecs=avc1,mp4a.40.2",
                "video/mp4;codecs=avc1,opus",
                "video/mp4;codecs=h264,aac",
                "video/mp4;codecs=avc1",
                "video/mp4;codecs=h264",
                "video/mp4",
                "video/webm;codecs=vp9,opus",
                "video/webm;codecs=vp8,opus",
                "video/webm"
            ];
            for (const m of mimes) {
                if (MediaRecorder.isTypeSupported(m)) {
                    const ext = m.includes("mp4") ? "mp4" : "webm";
                    return { mimeType: m, ext };
                }
            }
            return { mimeType: "video/mp4", ext: "mp4" };
        }
    } else {
        // Voice only
        if (opts.audioFormat === "ogg") {
            const mimes = [
                "audio/ogg;codecs=opus",
                "audio/ogg",
                "audio/webm;codecs=opus",
                "audio/webm"
            ];
            for (const m of mimes) {
                if (MediaRecorder.isTypeSupported(m)) return { mimeType: m, ext: "ogg" };
            }
            return { mimeType: "audio/ogg", ext: "ogg" };
        } else if (opts.audioFormat === "webm") {
            const mimes = [
                "audio/webm;codecs=opus",
                "audio/webm"
            ];
            for (const m of mimes) {
                if (MediaRecorder.isTypeSupported(m)) return { mimeType: m, ext: "webm" };
            }
            return { mimeType: "audio/webm", ext: "webm" };
        } else {
            // Default: MP4 / AAC or WebM Opus
            const mimes = [
                "audio/mp4;codecs=mp4a.40.2",
                "audio/mp4;codecs=aac",
                "audio/mp4;codecs=opus",
                "audio/mp4",
                "video/mp4;codecs=mp4a.40.2",
                "video/mp4;codecs=avc1,opus",
                "video/mp4",
                "audio/webm;codecs=opus",
                "audio/webm"
            ];
            for (const m of mimes) {
                if (MediaRecorder.isTypeSupported(m)) {
                    const ext = m.includes("mp4") ? "mp4" : "webm";
                    return { mimeType: m, ext };
                }
            }
            return { mimeType: "audio/webm", ext: "webm" };
        }
    }
}

export async function startRecording(opts: RecordingOptions): Promise<boolean> {
    if (isRecording) return false;
    activeOpts = opts;
    isStopping = false;

    try {
        recordedChunks = [];
        pendingChunkPromises = [];
        startTimeMs = Date.now();

        const { mimeType, ext } = getMediaRecordingConfig(opts);
        const dateStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        currentFilename = `AutoCall_${dateStr}.${ext}`;

        const native = (window as any).VencordNative?.pluginHelpers?.AutoCallRecorder;
        if (native?.initStreamRecording && native?.appendRecordingChunk && native?.finalizeStreamRecording) {
            try {
                isStreamMode = await native.initStreamRecording(currentFilename);
            } catch {
                isStreamMode = false;
            }
        } else {
            isStreamMode = false;
        }

        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        recordCtx = new AudioCtxClass();
        recordDest = recordCtx.createMediaStreamDestination();

        let capturedMic = false;
        let capturedSystem = false;

        // 1. Capture microphone
        try {
            micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });
            if (micStream && micStream.getAudioTracks().length > 0) {
                const micSource = recordCtx.createMediaStreamSource(micStream);
                micSource.connect(recordDest);
                capturedMic = true;
            }
        } catch (e) {
            try {
                micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                if (micStream && micStream.getAudioTracks().length > 0) {
                    const micSource = recordCtx.createMediaStreamSource(micStream);
                    micSource.connect(recordDest);
                    capturedMic = true;
                }
            } catch (err) {
                console.warn("[AutoCallRecorder] Mic capture failed:", err);
            }
        }

        // 2. Capture desktop system audio / video loopback
        try {
            let desktopSourceId: string | null = null;
            const nativeCapture = (window as any).VencordNative?.desktopCapture;
            if (nativeCapture?.getSources) {
                const sources = await nativeCapture.getSources();
                const screenSource = sources.find((s: any) => s.id?.startsWith("screen:"));
                if (screenSource) desktopSourceId = screenSource.id;
            }

            if (desktopSourceId) {
                let videoConstraints: any;
                if (opts.mode === "video") {
                    let minWidth = 1280;
                    let minHeight = 720;
                    let maxFrameRate = 30;

                    if (opts.videoQuality === "1080p60") {
                        minWidth = 1920;
                        minHeight = 1080;
                        maxFrameRate = 60;
                    } else if (opts.videoQuality === "480p25") {
                        minWidth = 854;
                        minHeight = 480;
                        maxFrameRate = 25;
                    }

                    videoConstraints = {
                        mandatory: {
                            chromeMediaSource: "desktop",
                            chromeMediaSourceId: desktopSourceId,
                            minWidth,
                            minHeight,
                            maxFrameRate
                        }
                    };
                } else {
                    videoConstraints = {
                        mandatory: {
                            chromeMediaSource: "desktop",
                            chromeMediaSourceId: desktopSourceId,
                            minWidth: 640,
                            minHeight: 360,
                            maxFrameRate: 5
                        }
                    };
                }

                const constraints: any = {
                    audio: {
                        mandatory: {
                            chromeMediaSource: "desktop",
                            chromeMediaSourceId: desktopSourceId
                        }
                    },
                    video: videoConstraints
                };

                systemStream = await navigator.mediaDevices.getUserMedia(constraints);

                if (systemStream && systemStream.getAudioTracks().length > 0) {
                    const sysAudioStream = new MediaStream(systemStream.getAudioTracks());
                    const systemSource = recordCtx.createMediaStreamSource(sysAudioStream);
                    systemSource.connect(recordDest);
                    capturedSystem = true;

                    // In voice mode, stop video tracks immediately to free 100% GPU/CPU
                    if (opts.mode === "voice") {
                        systemStream.getVideoTracks().forEach(t => t.stop());
                    }
                }
            }
        } catch (e) {
            console.warn("[AutoCallRecorder] Desktop loopback capture failed:", e);
        }

        // Failsafe: if neither mic nor system audio could be captured, attach a silent oscillator so recorder runs reliably
        if (!capturedMic && !capturedSystem) {
            const osc = recordCtx.createOscillator();
            const gain = recordCtx.createGain();
            gain.gain.value = 0;
            osc.connect(gain);
            gain.connect(recordDest);
            osc.start();
        }

        let finalStream = recordDest.stream;
        if (opts.mode === "video" && systemStream && systemStream.getVideoTracks().length > 0) {
            finalStream = new MediaStream([
                ...systemStream.getVideoTracks(),
                ...recordDest.stream.getAudioTracks()
            ]);
        }

        let videoBitsPerSecond: number | undefined;
        if (opts.mode === "video") {
            if (opts.videoQuality === "1080p60") videoBitsPerSecond = 8000000;
            else if (opts.videoQuality === "720p30") videoBitsPerSecond = 3000000;
            else if (opts.videoQuality === "480p25") videoBitsPerSecond = 1500000;
        }

        const recorderOptions: any = {
            mimeType,
            audioBitsPerSecond: 128000
        };
        if (videoBitsPerSecond) {
            recorderOptions.videoBitsPerSecond = videoBitsPerSecond;
        }

        try {
            mediaRecorder = new MediaRecorder(finalStream, recorderOptions);
        } catch {
            mediaRecorder = new MediaRecorder(finalStream);
        }

        mediaRecorder.ondataavailable = e => {
            if (!e.data || e.data.size === 0) return;

            // Always store in memory array as backup, even in stream mode
            recordedChunks.push(e.data);

            if (isStreamMode && native?.appendRecordingChunk) {
                const p = (async () => {
                    try {
                        const buf = await e.data.arrayBuffer();
                        await native.appendRecordingChunk(new Uint8Array(buf));
                    } catch (err) {
                        console.error("[AutoCallRecorder] Stream chunk append failed:", err);
                    }
                })();
                pendingChunkPromises.push(p);
            }
        };

        mediaRecorder.start(CHUNK_TIME_MS);
        isRecording = true;

        memoryCheckInterval = setInterval(() => {
            if (!isRecording) return;

            if (opts.maxStorageGB > 0) {
                const maxBytes = opts.maxStorageGB * 1024 * 1024 * 1024;
                let currentBytes = recordedChunks.reduce((acc, chunk) => acc + chunk.size, 0);
                while (currentBytes > maxBytes && recordedChunks.length > 1) {
                    const removed = recordedChunks.shift();
                    currentBytes -= (removed?.size || 0);
                }
            }

            if (opts.shadowplayMinutes > 0) {
                const maxChunks = (opts.shadowplayMinutes * 60 * 1000) / CHUNK_TIME_MS;
                while (recordedChunks.length > maxChunks) {
                    recordedChunks.shift();
                }
            }
        }, CHUNK_TIME_MS);

        return true;
    } catch (e) {
        console.error("[AutoCallRecorder] Failed to start recording:", e);
        cleanup();
        return false;
    }
}

export function stopRecording(): Promise<void> {
    return new Promise(resolve => {
        if (isStopping) { resolve(); return; }

        const opts = activeOpts;
        if (!isRecording || !mediaRecorder || !opts) {
            cleanup();
            resolve();
            return;
        }

        isStopping = true;
        const durationSecs = (Date.now() - startTimeMs) / 1000;
        const shouldSave = durationSecs >= 0.8;
        const mimeType = mediaRecorder.mimeType || "audio/webm";

        mediaRecorder.onstop = async () => {
            if (pendingChunkPromises.length > 0) {
                await Promise.allSettled(pendingChunkPromises);
                pendingChunkPromises = [];
            }

            if (shouldSave) {
                const native = (window as any).VencordNative?.pluginHelpers?.AutoCallRecorder;
                const durationMs = Math.max(0, Math.round(Date.now() - startTimeMs));
                let saved = false;

                if (isStreamMode && native?.finalizeStreamRecording) {
                    try {
                        saved = await native.finalizeStreamRecording(opts.savePath, currentFilename, durationMs);
                    } catch (e) {
                        console.error("[AutoCallRecorder] Finalize stream failed:", e);
                    }
                }

                if (saved) {
                    if (opts.showSaveToast !== false) {
                        Toasts.show(Toasts.create(t("Save record"), Toasts.Type.SUCCESS));
                    }
                } else if (recordedChunks.length > 0) {
                    const blob = new Blob(recordedChunks, { type: mimeType });
                    await saveBlobFallback(blob, opts, currentFilename);
                }
            }
            cleanup();
            resolve();
        };

        try {
            if (mediaRecorder.state !== "inactive") {
                mediaRecorder.requestData();
                mediaRecorder.stop();
            } else {
                cleanup();
                resolve();
            }
        } catch (e) {
            cleanup();
            resolve();
        }
    });
}

function cleanup() {
    isRecording = false;
    isStopping = false;
    isStreamMode = false;
    clearInterval(memoryCheckInterval);
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    if (systemStream) { systemStream.getTracks().forEach(t => t.stop()); systemStream = null; }
    if (recordCtx) { recordCtx.close(); recordCtx = null; }
    recordDest = null;
    mediaRecorder = null;
    recordedChunks = [];
    pendingChunkPromises = [];
    activeOpts = null;
}

async function saveBlobFallback(blob: Blob, opts: RecordingOptions, filename: string) {
    const notifySuccess = () => {
        if (opts.showSaveToast !== false) {
            Toasts.show(Toasts.create(t("Save record"), Toasts.Type.SUCCESS));
        }
    };

    const durationMs = Math.max(0, Date.now() - startTimeMs);
    const lower = filename.toLowerCase();
    let uint8Array: Uint8Array;
    try {
        const arrayBuffer = await blob.arrayBuffer();
        const rawUint8 = new Uint8Array(arrayBuffer);
        if (lower.endsWith(".mp4") || lower.endsWith(".m4a")) {
            uint8Array = fixMp4Duration(rawUint8, durationMs);
        } else if (lower.endsWith(".webm") || lower.endsWith(".mkv") || lower.endsWith(".ogg")) {
            uint8Array = await fixWebmBufferDuration(rawUint8, durationMs);
        } else {
            uint8Array = rawUint8;
        }
    } catch {
        const arrayBuffer = await blob.arrayBuffer();
        uint8Array = new Uint8Array(arrayBuffer);
    }

    const native = (window as any).VencordNative?.pluginHelpers?.AutoCallRecorder;
    if (native?.saveRecording) {
        try {
            if (!opts.autoSave && native?.promptSaveRecording) {
                const success = await native.promptSaveRecording(uint8Array, filename);
                if (success) notifySuccess();
                return;
            } else {
                const success = await native.saveRecording(uint8Array, opts.savePath, filename);
                if (success) notifySuccess();
                return;
            }
        } catch (e) {
            console.error("Native fallback save failed", e);
        }
    }

    const finalBlob = new Blob([uint8Array.slice()], { type: blob.type });
    const url = URL.createObjectURL(finalBlob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 1000);

    notifySuccess();
}
