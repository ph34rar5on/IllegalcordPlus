/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import type { PluginNative } from "@utils/types";

const STORE_KEY = "tokenLoginManager.data";
const Native = VencordNative.pluginHelpers.TokenLoginManager as PluginNative<typeof import("./native")>;

export interface Account {
    id: string;
    username: string;
    token: string;
}

function isAccount(value: unknown): value is Account {
    return typeof value === "object" && value !== null
        && "id" in value && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 128
        && "username" in value && typeof value.username === "string" && value.username.trim().length > 0 && value.username.length <= 128
        && "token" in value && typeof value.token === "string" && value.token.length > 0 && value.token.length <= 4096
        && !/\s/.test(value.token);
}

function validateAccounts(value: unknown): Account[] {
    if (!Array.isArray(value) || !value.every(isAccount) || new Set(value.map(account => account.id)).size !== value.length)
        throw new Error("The saved account data is invalid. Nothing was changed.");
    return value.map(({ id, username, token }) => ({ id, username, token }));
}

export async function saveAccounts(accounts: Account[]) {
    const validated = validateAccounts(accounts);
    let result: Awaited<ReturnType<typeof Native.encrypt>>;
    try {
        result = await Native.encrypt(JSON.stringify(validated));
    } catch {
        throw new Error("Could not access secure operating system storage.");
    }
    if (!result.success) throw new Error(result.error);
    try {
        await DataStore.set(STORE_KEY, { version: 1, ciphertext: result.data });
    } catch {
        throw new Error("Could not save the accounts. The previous saved data was kept.");
    }
}

export async function loadAccounts(): Promise<Account[]> {
    let stored: unknown;
    try {
        stored = await DataStore.get<unknown>(STORE_KEY);
    } catch {
        throw new Error("Could not read the saved accounts.");
    }
    if (stored === undefined) return [];
    if (typeof stored !== "object" || stored === null || Array.isArray(stored))
        throw new Error("The saved account data is invalid. Nothing was changed.");
    if ("version" in stored) {
        if (stored.version !== 1 || !("ciphertext" in stored) || typeof stored.ciphertext !== "string")
            throw new Error("The saved account format is unsupported. Nothing was changed.");
        let result: Awaited<ReturnType<typeof Native.decrypt>>;
        try {
            result = await Native.decrypt(stored.ciphertext);
        } catch {
            throw new Error("Could not access secure operating system storage.");
        }
        if (!result.success) throw new Error(result.error);
        let parsed: unknown;
        try {
            parsed = JSON.parse(result.data);
        } catch {
            throw new Error("The unlocked account data is invalid. Nothing was changed.");
        }
        return validateAccounts(parsed);
    }
    const accounts = validateAccounts(Object.values(stored));
    await saveAccounts(accounts);
    return accounts;
}
