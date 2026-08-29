/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { t } from "@testcordplugins/autoTranslateNightcord";
import definePlugin, { OptionType, PluginSettingComponentProps } from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { Avatar, FluxDispatcher, IconUtils, React, RelationshipStore, SelectedChannelStore, Toasts,UserStore } from "@webpack/common";
import { Button, SearchableSelect, TextInput } from "@webpack/common/components";

import { getRecordingDurationMs,isCurrentlyRecording, startRecording, stopRecording } from "./recorder";

const VoiceStateStore = findStoreLazy("VoiceStateStore") ?? findByPropsLazy("getVoiceState");

const BlacklistSelector = (props: PluginSettingComponentProps) => {
    const friends = RelationshipStore?.getFriendIDs?.()?.map((id: string) => UserStore?.getUser?.(id))?.filter(Boolean) || [];
    const blacklistVal = settings.store.blacklist;
    const val = Array.isArray(blacklistVal) ? blacklistVal : (blacklistVal ? [blacklistVal] : []);

    return (
        <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: "#e3e5e8", marginBottom: 8, fontFamily: "var(--font-primary)" }}>
                {t("Blacklisted Users")}
            </div>
            <SearchableSelect
                options={friends.map((f: any) => ({
                    label: f.globalName || f.username,
                    value: f.id
                }))}
                value={val}
                onChange={(v: string[]) => props.setValue(v)}
                placeholder={t("Select friends...")}
                multi={true}
                {...{
                    renderOption: (opt: any) => {
                        const u = UserStore?.getUser?.(opt.value);
                        return (
                            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 16px 10px 14px" }}>
                                <div style={{ marginLeft: 8 }}>
                                    <Avatar src={IconUtils?.getUserAvatarURL?.(u) || ""} size={"SIZE_32" as any} />
                                </div>
                                <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-normal)" }}>{opt.label}</span>
                            </div>
                        );
                    },
                    renderOptionLabel: (opt: any) => {
                        const u = UserStore?.getUser?.(opt.value);
                        return (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <Avatar src={IconUtils?.getUserAvatarURL?.(u) || ""} size={"SIZE_20" as any} />
                                <span style={{ color: "var(--text-normal)" }}>{opt.label}</span>
                            </div>
                        );
                    }
                } as any}
            />
        </div>
    );
};

const SavePathSelector = (props: PluginSettingComponentProps) => {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ flex: 1 }}>
                <TextInput
                    value={settings.store.savePath || ""}
                    placeholder={t("Save directory path (Leave empty for default Downloads)")}
                    onChange={(v: string) => props.setValue(v)}
                />
            </div>
            <Button
                size={Button.Sizes.SMALL}
                onClick={async () => {
                    try {
                        const native = (window as any).VencordNative?.pluginHelpers?.AutoCallRecorder;
                        if (native?.pickDirectory) {
                            const dir = await native.pickDirectory();
                            if (dir) {
                                props.setValue(dir);
                            }
                        } else {
                            alert("VencordNative is required for folder picking.");
                        }
                    } catch (e) {
                        console.error(e);
                    }
                }}
            >
                {t("Browse...")}
            </Button>
        </div>
    );
};

const settings = definePluginSettings({
    mode: {
        type: OptionType.SELECT,
        description: t("Recording Mode"),
        options: [
            { label: t("Only Voice"), value: "voice", default: true },
            { label: t("Image + Voice"), value: "video" }
        ]
    },
    videoQuality: {
        type: OptionType.SELECT,
        description: t("Video Quality"),
        options: [
            { label: "720p 30fps", value: "720p30", default: true },
            { label: "1080p 60fps", value: "1080p60" },
            { label: "480p 25fps", value: "480p25" }
        ]
    },
    videoFormat: {
        type: OptionType.SELECT,
        description: t("Video Format"),
        options: [
            { label: "MP4 (MPEG-4 AVC / Seekable)", value: "mp4", default: true },
            { label: "WebM", value: "webm" },
            { label: "MKV", value: "mkv" }
        ]
    },
    audioFormat: {
        type: OptionType.SELECT,
        description: t("Audio Format"),
        options: [
            { label: "MP4 / AAC (MPEG-4 Audio / Seekable)", value: "mp4", default: true },
            { label: "OGG (Opus)", value: "ogg" },
            { label: "WebM", value: "webm" }
        ]
    },
    blacklist: {
        type: OptionType.COMPONENT,
        component: BlacklistSelector,
        default: []
    },
    maxStorage: {
        type: OptionType.NUMBER,
        description: t("Max Storage (GB) - 0 for unlimited"),
        default: 0
    },
    shadowplayMinutes: {
        type: OptionType.NUMBER,
        description: t("Record last X minutes (0 to disable/keep all)"),
        default: 0
    },
    autoSave: {
        type: OptionType.BOOLEAN,
        description: t("Autosave without prompting"),
        default: true
    },
    savePath: {
        type: OptionType.COMPONENT,
        component: SavePathSelector,
        default: ""
    },
    showTimes: {
        type: OptionType.BOOLEAN,
        description: t("Show Times (Visual indicator)"),
        default: true
    },
    showSaveToast: {
        type: OptionType.BOOLEAN,
        description: t("Show Save Notification"),
        default: true
    }
});

let domUpdateInterval: any;
let lastChannelId: string | null | undefined = null;

function formatTime(ms: number) {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
    const s = (totalSeconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
}

function getConnectedVoiceChannelId(): string | null {
    const vcId = SelectedChannelStore?.getVoiceChannelId?.();
    if (vcId) return vcId;
    try {
        const currentUserId = UserStore?.getCurrentUser?.()?.id;
        if (currentUserId && VoiceStateStore?.getVoiceStateForUser) {
            const state = VoiceStateStore.getVoiceStateForUser(currentUserId);
            if (state?.channelId) return state.channelId;
        }
    } catch { }
    return null;
}

function updateUI() {
    if (isCurrentlyRecording()) {
        const activeChannelId = getConnectedVoiceChannelId();
        if (!activeChannelId) {
            stopRecording();
            lastChannelId = null;
        }
    }

    if (!settings.store.showTimes) {
        const indicator = document.getElementById("autocall-indicator");
        if (indicator) indicator.remove();
        return;
    }

    if (isCurrentlyRecording()) {
        const titleContainer =
            document.querySelector('div[class*="titleWrapper_"] > h1') ||
            document.querySelector('div[class*="children_"]') ||
            document.querySelector('section[class*="themed_"] [class*="toolbar_"]') ||
            document.querySelector(".vc-header-bar-btns");

        if (!titleContainer) return;

        let indicator = document.getElementById("autocall-indicator");
        if (!indicator) {
            indicator = document.createElement("div");
            indicator.id = "autocall-indicator";
            titleContainer.appendChild(indicator);
        } else if (indicator.parentElement !== titleContainer) {
            titleContainer.appendChild(indicator);
        }

        let timeSpan = indicator.querySelector(".autocall-time");
        if (!timeSpan) {
            indicator.innerHTML = "<span class=\"autocall-time\"></span>";
            timeSpan = indicator.querySelector(".autocall-time");
        }

        if (timeSpan) {
            timeSpan.textContent = formatTime(getRecordingDurationMs());
        }
    } else {
        const indicator = document.getElementById("autocall-indicator");
        if (indicator) {
            indicator.remove();
        }
    }
}

function isBlacklistedUserInChannel(channelId: string): boolean {
    const states = VoiceStateStore?.getVoiceStatesForChannel?.(channelId) || {};
    const blacklist = Array.isArray(settings.store.blacklist) ? settings.store.blacklist : [];
    if (blacklist.length === 0) return false;
    return blacklist.some((id: string) => states[id] !== undefined);
}

function startUIInterval() {
    if (!domUpdateInterval) {
        updateUI();
        domUpdateInterval = setInterval(updateUI, 1000);
    }
}

function stopUIInterval() {
    if (domUpdateInterval) {
        clearInterval(domUpdateInterval);
        domUpdateInterval = null;
    }
    updateUI();
}

async function handleVoiceStateUpdates(e: any) {
    if (!isCurrentlyRecording() || !lastChannelId) return;

    const updates = Array.isArray(e.voiceStates) ? e.voiceStates : (e.voiceState ? [e.voiceState] : []);
    for (const update of updates) {
        if (update.userId === UserStore?.getCurrentUser?.()?.id) {
            if (!update.channelId) {
                await stopRecording();
                stopUIInterval();
                lastChannelId = null;
                return;
            }
        }

        if (update.channelId === lastChannelId) {
            if (isBlacklistedUserInChannel(lastChannelId)) {
                Toasts.show(Toasts.create(t("Blacklisted user in channel."), Toasts.Type.FAILURE));
                await stopRecording();
                stopUIInterval();
                break;
            }
        }
    }
}

async function handleVoiceChannelSelect(e: any) {
    const newChannelId = e.channelId || getConnectedVoiceChannelId();

    if (lastChannelId && lastChannelId !== newChannelId) {
        await stopRecording();
        stopUIInterval();
    }

    if (newChannelId && lastChannelId !== newChannelId) {
        if (isBlacklistedUserInChannel(newChannelId)) {
            Toasts.show(Toasts.create(t("Blacklisted user in channel."), Toasts.Type.FAILURE));
        } else {
            await startRecording({
                mode: settings.store.mode as any,
                videoQuality: settings.store.videoQuality as any,
                videoFormat: settings.store.videoFormat as any,
                audioFormat: settings.store.audioFormat as any,
                maxStorageGB: settings.store.maxStorage,
                shadowplayMinutes: settings.store.shadowplayMinutes,
                autoSave: settings.store.autoSave,
                savePath: settings.store.savePath,
                showSaveToast: settings.store.showSaveToast
            });
            startUIInterval();
        }
    }

    lastChannelId = newChannelId;
}

export default definePlugin({
    name: "AutoCallRecorder",
    description: "Automatically records your voice calls when you join them, with advanced limits and shadowplay buffering.",
    authors: [{ name: "Nightcord", id: 0n }],
    enabledByDefault: false,
    settings,

    start() {
        lastChannelId = getConnectedVoiceChannelId();
        if (lastChannelId) {
            if (isBlacklistedUserInChannel(lastChannelId)) {
                Toasts.show(Toasts.create(t("Blacklisted user in channel."), Toasts.Type.FAILURE));
            } else {
                startRecording({
                    mode: settings.store.mode as any,
                    videoQuality: settings.store.videoQuality as any,
                    videoFormat: settings.store.videoFormat as any,
                    audioFormat: settings.store.audioFormat as any,
                    maxStorageGB: settings.store.maxStorage,
                    shadowplayMinutes: settings.store.shadowplayMinutes,
                    autoSave: settings.store.autoSave,
                    savePath: settings.store.savePath,
                    showSaveToast: settings.store.showSaveToast
                }).then(() => {
                    startUIInterval();
                });
            }
        }

        FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", handleVoiceChannelSelect);
        FluxDispatcher.subscribe("VOICE_STATE_UPDATES", handleVoiceStateUpdates);
    },

    stop() {
        FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", handleVoiceChannelSelect);
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", handleVoiceStateUpdates);
        stopUIInterval();

        if (isCurrentlyRecording()) {
            stopRecording();
        }

        const indicator = document.getElementById("autocall-indicator");
        if (indicator) indicator.remove();
    }
});
