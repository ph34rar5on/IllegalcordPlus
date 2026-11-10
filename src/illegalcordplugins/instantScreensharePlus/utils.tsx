/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { IS_WINDOWS } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { findByCodeLazy } from "@webpack";
import { MediaEngineStore, SearchableSelect, useEffect, useState, useStateFromStores } from "@webpack/common";

import { settings } from "./settings";

interface MediaSource {
    id: string;
    name: string;
    type?: string;
}

type SourceSettingKey = "streamMedia" | "streamMediaFallback" | "cameraDevice" | "cameraDeviceFallback";

interface SourcePickerProps {
    settingKey: SourceSettingKey;
    camera?: boolean;
}

const SETTING_KEYS = ["includeVideoDevices", "streamMedia", "streamMediaFallback", "cameraDevice", "cameraDeviceFallback"] satisfies (SourceSettingKey | "includeVideoDevices")[];
const getDesktopSources: (
    media: ReturnType<typeof MediaEngineStore.getMediaEngine>,
    useWindowsCapture: boolean,
    types: string[],
    options: null
) => Promise<MediaSource[] | null> = findByCodeLazy("desktop sources");
const logger = new Logger("InstantScreensharePlus");

async function getMediaSources(includeVideoDevices: boolean): Promise<MediaSource[]> {
    const sources = await getDesktopSources(MediaEngineStore.getMediaEngine(), IS_WINDOWS, ["screen", "window"], null) ?? [];
    if (includeVideoDevices) {
        const videoSources = Object.values(MediaEngineStore.getVideoDevices()).map(device => ({
            id: device.id,
            name: device.name,
            type: "video_device"
        }));
        sources.push(...videoSources);
    }
    return sources;
}

export async function getCurrentMedia(): Promise<MediaSource> {
    const { includeVideoDevices, streamMedia, streamMediaFallback } = settings.store;
    const sources = await getMediaSources(includeVideoDevices);
    const source = sources.find(source => source.id === streamMedia)
        ?? sources.find(source => source.id === streamMediaFallback)
        ?? sources[0];
    if (!source) throw new Error("No media sources are available.");
    return source;
}

export function getCurrentCamera() {
    const { cameraDevice, cameraDeviceFallback } = settings.store;
    if (!cameraDevice && !cameraDeviceFallback) return null;

    const cameras = Object.values(MediaEngineStore.getVideoDevices());
    return cameras.find(device => device.id === cameraDevice)
        ?? cameras.find(device => device.id === cameraDeviceFallback)
        ?? cameras[0]
        ?? null;
}

function SourcePicker({ settingKey, camera = false }: SourcePickerProps) {
    const values = settings.use(SETTING_KEYS);
    const { includeVideoDevices } = values;
    const videoDevices = useStateFromStores([MediaEngineStore], () => MediaEngineStore.getVideoDevices());
    const [sources, setSources] = useState<MediaSource[]>([]);
    const [loading, setLoading] = useState(!camera);
    const [error, setError] = useState(false);

    useEffect(() => {
        if (camera) return;
        let active = true;
        setLoading(true);
        setError(false);
        getMediaSources(includeVideoDevices).then(sources => {
            if (active) setSources(sources);
        }).catch(error => {
            logger.error("Could not load media sources.", error);
            if (active) setError(true);
        }).finally(() => {
            if (active) setLoading(false);
        });
        return () => { active = false; };
    }, [camera, includeVideoDevices, videoDevices]);

    if (loading) return <Paragraph>Loading media sources...</Paragraph>;
    if (error) return <Paragraph>Could not load media sources. Reopen settings to try again.</Paragraph>;

    const options = [
        { label: "None", value: "" },
        ...(camera ? Object.values(videoDevices) : sources).map(source => ({
            label: source.name,
            value: source.id
        }))
    ];

    return (
        <SearchableSelect
            placeholder={camera ? "Select a camera device" : "Select a media source to stream"}
            maxVisibleItems={5}
            options={options}
            value={values[settingKey]}
            onChange={(value: string) => settings.store[settingKey] = value}
            closeOnSelect
        />
    );
}

export function SettingSection() {
    return (
        <section>
            <Heading>Primary streaming source</Heading>
            <Paragraph>Primary source to use for streaming.</Paragraph>
            <SourcePicker settingKey="streamMedia" />
        </section>
    );
}

export function FallbackSettingSection() {
    return (
        <section>
            <Heading>Fallback streaming source</Heading>
            <Paragraph>Used if the primary source is unavailable.</Paragraph>
            <SourcePicker settingKey="streamMediaFallback" />
        </section>
    );
}

export function CameraSettingSection() {
    return (
        <section>
            <Heading>Primary camera device</Heading>
            <Paragraph>Primary camera to use when joining a voice channel.</Paragraph>
            <SourcePicker settingKey="cameraDevice" camera />
        </section>
    );
}

export function CameraFallbackSettingSection() {
    return (
        <section>
            <Heading>Fallback camera device</Heading>
            <Paragraph>Used if the primary camera is unavailable.</Paragraph>
            <SourcePicker settingKey="cameraDeviceFallback" camera />
        </section>
    );
}
