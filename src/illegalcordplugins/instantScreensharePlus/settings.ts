/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import { CameraFallbackSettingSection, CameraSettingSection, FallbackSettingSection, SettingSection } from "./utils";

export const settings = definePluginSettings({
    includeVideoDevices: {
        type: OptionType.BOOLEAN,
        description: "Include cameras and capture cards in the streaming source list.",
        default: false
    },
    streamMedia: {
        type: OptionType.COMPONENT,
        component: SettingSection,
        default: ""
    },
    streamMediaFallback: {
        type: OptionType.COMPONENT,
        component: FallbackSettingSection,
        default: ""
    },
    cameraDevice: {
        type: OptionType.COMPONENT,
        component: CameraSettingSection,
        default: ""
    },
    cameraDeviceFallback: {
        type: OptionType.COMPONENT,
        component: CameraFallbackSettingSection,
        default: ""
    },
    autoMuteDeafen: {
        type: OptionType.SELECT,
        description: "Choose whether to mute or deafen when joining a voice channel.",
        options: [
            { label: "Do nothing", value: "none", default: true },
            { label: "Mute", value: "mute" },
            { label: "Mute and deafen", value: "deafen" }
        ]
    },
    autoMute: {
        type: OptionType.BOOLEAN,
        description: "Automatically apply the selected mute or deafen action when joining a voice channel.",
        default: false
    },
    autoMicMode: {
        type: OptionType.SELECT,
        description: "Choose the microphone input mode to use when joining a voice channel.",
        options: [
            { label: "Do nothing", value: "none", default: true },
            { label: "Voice activity", value: "VOICE_ACTIVITY" },
            { label: "Push to talk", value: "PUSH_TO_TALK" }
        ]
    },
    autoMicModeToggle: {
        type: OptionType.BOOLEAN,
        description: "Automatically apply the selected microphone input mode when joining a voice channel.",
        default: false
    },
    autoStream: {
        type: OptionType.BOOLEAN,
        description: "Automatically start streaming when joining a voice channel.",
        default: true
    },
    autoCamera: {
        type: OptionType.BOOLEAN,
        description: "Automatically enable the selected camera when joining a voice channel.",
        default: false
    }
});
