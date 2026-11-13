/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type IpcMainInvokeEvent, safeStorage } from "electron";

const PREFIX = "TokenLoginManager:1:";
const MAX_PLAINTEXT = 1_048_576;
const MAX_CIPHERTEXT = 2_097_152;

type Result = { success: true; data: string; } | { success: false; error: string; };

function isTrustedSender(event: IpcMainInvokeEvent) {
    if (event.sender.isDestroyed() || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
    try {
        const url = new URL(event.senderFrame.url);
        return url.protocol === "https:" && !url.port && !url.username && !url.password
            && ["discord.com", "ptb.discord.com", "canary.discord.com"].includes(url.hostname);
    } catch {
        return false;
    }
}

function isEncryptionAvailable() {
    return safeStorage.isEncryptionAvailable()
        && (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text");
}

export function encrypt(event: IpcMainInvokeEvent, value: unknown): Result {
    try {
        if (!isTrustedSender(event) || typeof value !== "string" || !value.length || Buffer.byteLength(value) > MAX_PLAINTEXT)
            return { success: false, error: "Invalid encryption request." };
        if (!isEncryptionAvailable())
            return { success: false, error: "Secure operating system storage is unavailable. Nothing was saved." };
        return { success: true, data: safeStorage.encryptString(PREFIX + value).toString("base64") };
    } catch {
        return { success: false, error: "Could not encrypt the saved accounts." };
    }
}

export function decrypt(event: IpcMainInvokeEvent, value: unknown): Result {
    try {
        if (!isTrustedSender(event) || typeof value !== "string" || !value.length || value.length > MAX_CIPHERTEXT)
            return { success: false, error: "Invalid decryption request." };
        if (!isEncryptionAvailable())
            return { success: false, error: "Secure operating system storage is unavailable. Saved accounts are locked." };
        const buffer = Buffer.from(value, "base64");
        if (buffer.toString("base64") !== value)
            return { success: false, error: "The saved accounts are not valid encrypted data." };
        const plaintext = safeStorage.decryptString(buffer);
        if (!plaintext.startsWith(PREFIX) || Buffer.byteLength(plaintext) > MAX_PLAINTEXT + PREFIX.length)
            return { success: false, error: "The saved accounts are not valid encrypted data." };
        return { success: true, data: plaintext.slice(PREFIX.length) };
    } catch {
        return { success: false, error: "Could not unlock the saved accounts on this operating system profile." };
    }
}
