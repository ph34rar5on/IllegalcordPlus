/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Plugin originally written for Equicord at 2026-02-16 by https://github.com/Bluscream, https://antigravity.google
import { getUserSettingLazy } from "@api/UserSettings";
import { Paragraph } from "@components/Paragraph";
import { Devs, EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { VoiceState } from "@vencord/discord-types";
import { findByCodeLazy } from "@webpack";
import { ApplicationStreamingSettingsStore, ChannelStore, FluxDispatcher, MediaEngineStore, PermissionsBits, PermissionStore, SelectedChannelStore, showToast, UserStore, VoiceActions } from "@webpack/common";

import { settings } from "./settings";
import { getCurrentCamera, getCurrentMedia } from "./utils";

const startStream: (guildId: string | null, channelId: string, options: {
    pid: null;
    sourceId: string;
    sourceName: string;
    audioSourceId: string;
    sound: boolean;
    previewDisabled: boolean;
}) => void = findByCodeLazy('type:"STREAM_START"');
const StreamPreviewSettings = getUserSettingLazy<boolean>("voiceAndVideo", "disableStreamPreviews");
let hasStreamed = false;
let session = 0;

async function autoStartStream() {
    const selected = SelectedChannelStore.getVoiceChannelId();
    if (!selected) return;

    const channel = ChannelStore.getChannel(selected);
    if (!channel || channel.isGuildStageVoice()) return;
    if (!channel.isDM() && !channel.isGroupDM() && !PermissionStore.can(PermissionsBits.STREAM, channel)) return;

    const { autoMute, autoMuteDeafen, autoMicModeToggle, autoMicMode, autoCamera, autoStream } = settings.store;

    // Auto mute/deafen if enabled
    if (autoMute && autoMuteDeafen === "deafen" && !MediaEngineStore.isSelfDeaf()) {
        VoiceActions.toggleSelfDeaf();
    } else if (autoMute && autoMuteDeafen === "mute" && !MediaEngineStore.isSelfMute()) {
        VoiceActions.toggleSelfMute();
    }

    // Set microphone input mode if configured and enabled
    if (autoMicModeToggle && autoMicMode !== "none" && MediaEngineStore.getMode() !== autoMicMode) {
        FluxDispatcher.dispatch({
            type: "AUDIO_SET_MODE",
            context: "default",
            mode: autoMicMode,
            options: MediaEngineStore.getModeOptions()
        });
    }

    // Enable camera and set device if configured and autoCamera is enabled
    if (autoCamera) {
        const camera = getCurrentCamera();
        if (camera) {
            FluxDispatcher.dispatch({ type: "MEDIA_ENGINE_SET_VIDEO_DEVICE", id: camera.id });
            if (!MediaEngineStore.isVideoEnabled()) {
                FluxDispatcher.dispatch({ type: "MEDIA_ENGINE_SET_VIDEO_ENABLED", enabled: true });
            }
        }
    }

    // Start streaming if autoStream is enabled
    if (autoStream) {
        const currentSession = session;
        const streamMedia = await getCurrentMedia();
        if (currentSession !== session || SelectedChannelStore.getVoiceChannelId() !== selected || !settings.store.autoStream) return;

        const preview = StreamPreviewSettings?.getSetting();
        if (preview === undefined) return;

        startStream(channel.guild_id ?? null, selected, {
            pid: null,
            sourceId: streamMedia.type === "video_device" ? `camera:${streamMedia.id}` : streamMedia.id,
            sourceName: streamMedia.name,
            audioSourceId: streamMedia.name,
            sound: ApplicationStreamingSettingsStore.getState().soundshareEnabled,
            previewDisabled: preview
        });
    }
}

export default definePlugin({
    name: "InstantScreensharePlus",
    description: "Instantly screenshare when joining a voice channel with fallback sources, automatic camera activation, and microphone controls.",
    authors: [Devs.HAHALOSAH, Devs.thororen, EquicordDevs.mart, EquicordDevs.Bluscream],
    tags: ["Media", "Voice"],
    dependencies: ["EquicordToolbox", "UserSettingsAPI"],
    settings,

    settingsAboutComponent: () => (
        <Paragraph>
            Based on the bluscream-vencord-plugins/instantScreenshare plugin.
            Disable the original InstantScreenshare plugin to avoid both starting a stream.
            If neither configured streaming source is available, the first available source is shared.
            Discord's sound and stream preview settings are respected.
            On Wayland, the system source picker may still appear. X11 support varies.
        </Paragraph>
    ),

    start() {
        hasStreamed = Boolean(SelectedChannelStore.getVoiceChannelId());
        session++;
    },

    stop() {
        hasStreamed = false;
        session++;
    },

    flux: {
        async VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            const myId = UserStore.getCurrentUser().id;
            for (const { userId, channelId } of voiceStates) {
                if (userId !== myId) continue;
                if (!channelId) {
                    hasStreamed = false;
                    session++;
                } else if (!hasStreamed) {
                    hasStreamed = true;
                    await autoStartStream();
                }
                break;
            }
        }
    },

    toolboxActions: {
        "Auto Stream"() {
            settings.store.autoStream = !settings.store.autoStream;
            showToast({ text: `Auto stream ${settings.store.autoStream ? "enabled" : "disabled"}.`, variant: "success" });
        },
        "Auto Camera"() {
            settings.store.autoCamera = !settings.store.autoCamera;
            showToast({ text: `Auto camera ${settings.store.autoCamera ? "enabled" : "disabled"}.`, variant: "success" });
        },
        "Auto Mute"() {
            settings.store.autoMute = !settings.store.autoMute;
            showToast({ text: `Auto mute ${settings.store.autoMute ? "enabled" : "disabled"}.`, variant: "success" });
        },
        "Auto Mic Mode"() {
            settings.store.autoMicModeToggle = !settings.store.autoMicModeToggle;
            showToast({ text: `Auto microphone mode ${settings.store.autoMicModeToggle ? "enabled" : "disabled"}.`, variant: "success" });
        }
    }
});
