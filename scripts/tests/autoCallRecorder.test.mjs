/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { compileFunction } from "node:vm";

import { transform } from "esbuild";

async function loadSource(file, dependencies = {}, globals = {}) {
    const source = await readFile(new URL(`../../src/${file}`, import.meta.url), "utf8");
    const { code } = await transform(source, { loader: "ts", format: "cjs" });
    const module = { exports: {} };
    const require = name => {
        assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
        return dependencies[name];
    };
    compileFunction(code, ["require", "module", "exports", ...Object.keys(globals)])(require, module, module.exports, ...Object.values(globals));
    return module.exports;
}

class Track {
    #enabled = true;
    constructor(kind, label) {
        this.kind = kind;
        this.label = label;
        this.readyState = "live";
    }
    get enabled() { return this.#enabled; }
    set enabled(value) { this.#enabled = value; }
    stop() { this.readyState = "ended"; }
    clone() { return new Track(this.kind, this.label); }
    addEventListener() {}
    removeEventListener() {}
}

class Stream {
    constructor(tracks = []) { this.tracks = [...tracks]; }
    getTracks() { return this.tracks; }
    getAudioTracks() { return this.tracks.filter(track => track.kind === "audio"); }
    getVideoTracks() { return this.tracks.filter(track => track.kind === "video"); }
    clone() { return new Stream(this.tracks.map(track => track.clone())); }
}

class AudioContext {
    constructor() { this.sources = []; }
    createMediaStreamDestination() { return { stream: new Stream([new Track("audio", "mix")]) }; }
    createMediaStreamSource(stream) { this.sources.push(stream); return { connect() {} }; }
    createOscillator() { return { connect() {}, start() {} }; }
    createGain() { return { gain: {}, connect() {} }; }
    close() {}
}

class MediaRecorder {
    static isTypeSupported() { return true; }
    constructor(stream, options = {}) {
        this.stream = stream;
        this.state = "inactive";
        this.mimeType = options.mimeType ?? "audio/webm";
    }
    start() { this.state = "recording"; }
    requestData() {}
    stop() { this.state = "inactive"; this.onstop?.(); }
}

const RECORDING = {
    mode: "voice",
    maxStorageGB: 0,
    shadowplayMinutes: 0,
    autoSave: true,
    savePath: "",
    showSaveToast: false,
};

async function fixture({ privacy: privacyOverrides = {}, mode = "PUSH_TO_TALK", selfMute = false, inCall = true } = {}) {
    const session = await loadSource("illegalcordplugins/DiscordHardened/session.ts");
    const captured = { microphones: [], desktop: [] };
    const toasts = [];

    const mediaDevices = {
        getUserMedia: async constraints => {
            if (constraints?.audio?.mandatory || constraints?.video?.mandatory) {
                const stream = new Stream([new Track("audio", "system"), new Track("video", "screen")]);
                captured.desktop.push(...stream.getTracks());
                return stream;
            }
            const track = new Track("audio", "microphone");
            captured.microphones.push(track);
            return new Stream([track]);
        },
    };

    const navigator = { mediaDevices };
    const window = Object.assign(new EventTarget(), {
        AudioContext,
        VencordNative: { pluginHelpers: { AutoCallRecorder: { getWindowSourceId: async () => "window:1" } } },
        setTimeout,
        clearTimeout,
    });

    const privacySettings = {
        allowCamera: true,
        allowMicrophone: true,
        privatePushToTalk: true,
        lockMicrophoneWhenMuted: true,
        blockMicrophoneOutsideCalls: false,
        releaseMicrophoneOnDisconnect: true,
        lockPttOnWindowBlur: true,
        maximumPttSeconds: 60,
        ...privacyOverrides,
    };

    const privacy = await loadSource("illegalcordplugins/DiscordHardened/microphonePrivacy.ts", {
        "@utils/Logger": { Logger: class { warn() {} } },
        "@utils/misc": { isObject: value => typeof value === "object" && value !== null },
        "@webpack/common": {
            FluxDispatcher: { dispatch() {} },
            VoiceActions: { setVideoEnabled() {} },
            MediaEngineStore: { getMediaEngine: () => ({ connections: [] }), getMode: () => mode, isSelfMute: () => selfMute },
            SelectedChannelStore: { getVoiceChannelId: () => inCall ? "call" : null },
        },
        "./session": session,
    }, { window, MediaStreamTrack: Track });

    const runtime = await loadSource("illegalcordplugins/DiscordHardened/runtime.ts", {
        "@api/PluginManager": { isPluginEnabled: () => false },
        "@api/UserSettings": { getUserSetting: () => null },
        "@utils/Logger": { Logger: class { warn() {} info() {} } },
        "@utils/text": { escapeRegExp: value => value },
        "./microphonePrivacy": privacy,
        "./session": session,
    }, {
        navigator, window, Navigator: undefined, HTMLCanvasElement: undefined, Notification: undefined, Element: undefined,
        XMLHttpRequest: class { open() {} send() {} },
        MediaStream: Stream, MediaStreamTrack: Track,
        location: { href: "https://discord.com/channels/@me", origin: "https://discord.com" },
    });

    const recorder = await loadSource("userplugins/AutoCallRecorder/recorder.ts", {
        "@testcordplugins/autoTranslateNightcord": { t: key => key },
        "@webpack/common": {
            Toasts: {
                show: toast => toasts.push(toast),
                create: (message, type) => ({ message, type }),
                Type: { SUCCESS: "success", FAILURE: "failure", MESSAGE: "message" },
            },
        },
        "./mediaFixer": { fixMp4Duration: value => value, fixWebmBufferDuration: async value => value },
    }, {
        navigator, window, MediaStream: Stream, MediaRecorder,
        setInterval: () => 0, clearInterval: () => {},
        console: { warn() {}, error() {} },
    });

    const hardening = { ...privacySettings, blockUnauthorizedLegacyCapture: false, allowDisplayCapture: true, ...privacyOverrides };
    runtime.startHardening(hardening, () => false);
    privacy.startMicrophonePrivacy(privacySettings);

    return { recorder, privacy, runtime, session, captured, toasts, hardening };
}

test("The recorder cannot escape the DiscordHardened microphone gate", async t => {
    const { recorder, privacy, runtime, captured } = await fixture();
    t.after(() => { runtime.stopHardening(); privacy.stopMicrophonePrivacy(); });

    assert.equal(await recorder.startRecording(RECORDING), true);
    assert.equal(captured.microphones.length, 1);
    assert.ok(captured.microphones.every(track => !track.enabled));

    // Desktop loopback audio is requested through getUserMedia, so the gate covers it too
    const systemAudio = captured.desktop.filter(track => track.kind === "audio");
    assert.equal(systemAudio.length, 1);
    assert.ok(systemAudio.every(track => !track.enabled));

    privacy.setPrivatePttActive(true);
    assert.ok(captured.microphones.every(track => track.enabled));
    assert.ok(systemAudio.every(track => track.enabled));

    privacy.setPrivatePttActive(false);
    assert.ok(captured.microphones.every(track => !track.enabled));
    assert.ok(systemAudio.every(track => !track.enabled));
});

test("Voice activity mode records a live microphone track", async t => {
    const { recorder, privacy, runtime, captured, toasts } = await fixture({ mode: "VOICE_ACTIVITY" });
    t.after(() => { runtime.stopHardening(); privacy.stopMicrophonePrivacy(); });

    assert.equal(await recorder.startRecording(RECORDING), true);
    assert.ok(captured.microphones.every(track => track.enabled));
    assert.deepEqual(toasts, []);
});

test("Blocked system audio capture warns instead of failing silently", async t => {
    const { recorder, privacy, runtime, captured, toasts } = await fixture({
        mode: "VOICE_ACTIVITY",
        privacy: { blockUnauthorizedLegacyCapture: true },
    });
    t.after(() => { runtime.stopHardening(); privacy.stopMicrophonePrivacy(); });

    assert.equal(await recorder.startRecording(RECORDING), true);
    assert.deepEqual(captured.desktop, []);
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0].type, "failure");
    assert.match(toasts[0].message, /System audio capture is blocked/);
});

test("Blocked microphone access warns instead of failing silently", async t => {
    const { recorder, privacy, runtime, captured, toasts } = await fixture({
        mode: "VOICE_ACTIVITY",
        privacy: { allowMicrophone: false },
    });
    t.after(() => { runtime.stopHardening(); privacy.stopMicrophonePrivacy(); });

    assert.equal(await recorder.startRecording(RECORDING), true);
    assert.deepEqual(captured.microphones, []);
    // Denying the microphone also denies the desktop loopback, which is requested with audio
    assert.deepEqual(captured.desktop, []);
    assert.ok(toasts.every(toast => toast.type === "failure"));
    assert.match(toasts[0].message, /Microphone access is blocked/);
    assert.match(toasts[1].message, /System audio capture is blocked/);
    assert.equal(toasts.length, 2);
});
