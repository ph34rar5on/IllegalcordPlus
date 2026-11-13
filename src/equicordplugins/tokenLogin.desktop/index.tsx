/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { UserIcon } from "@components/Icons";
import { Text } from "@components/Text";
import SettingsPlugin from "@plugins/_core/settings";
import { Devs } from "@utils/constants";
import { removeFromArray } from "@utils/misc";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { React, TextInput, useEffect, useRef, useState } from "@webpack/common";

import { type Account, loadAccounts, saveAccounts } from "./storage";

const LoginActions = findByPropsLazy("loginToken") as { loginToken(token: string): Promise<void> | void; };

interface AccountEntryProps {
    account: Account;
    busy: boolean;
    onLogin: () => void;
    onDelete: () => void;
}

function AccountEntry({ account, busy, onLogin, onDelete }: AccountEntryProps) {
    const [showToken, setShowToken] = useState(false);
    return (
        <div className="vc-token-login-account">
            <Text weight="semibold">{account.username}</Text>
            <Text className="vc-token-login-token" selectable>{showToken ? account.token : "••••••••••••••••"}</Text>
            <div className="vc-token-login-actions">
                <Button size="small" variant="secondary" disabled={busy} onClick={() => setShowToken(!showToken)}>
                    {showToken ? "Hide Token" : "Show Token"}
                </Button>
                <Button size="small" disabled={busy} onClick={onLogin}>Login</Button>
                <Button size="small" variant="dangerSecondary" disabled={busy} onClick={onDelete}>Delete</Button>
            </div>
        </div>
    );
}

function AccountsTab() {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [username, setUsername] = useState("");
    const [token, setToken] = useState("");
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const pending = useRef(false);
    const mounted = useRef(false);

    useEffect(() => {
        mounted.current = true;
        let cancelled = false;
        loadAccounts().then(value => {
            if (cancelled) return;
            setAccounts(value);
            setLoaded(true);
        }).catch((failure: unknown) => {
            if (!cancelled) setError(failure instanceof Error ? failure.message : "Could not load the saved accounts.");
        });
        return () => { cancelled = true; mounted.current = false; };
    }, []);

    async function persist(next: Account[], clearInput = false) {
        if (pending.current || !loaded) return;
        pending.current = true;
        setBusy(true);
        setError("");
        try {
            await saveAccounts(next);
            if (!mounted.current) return;
            setAccounts(next);
            if (clearInput) {
                setUsername("");
                setToken("");
            }
        } catch (failure) {
            if (mounted.current) setError(failure instanceof Error ? failure.message : "Could not save the accounts.");
        } finally {
            pending.current = false;
            if (mounted.current) setBusy(false);
        }
    }

    async function login(account: Account) {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setError("");
        try {
            await LoginActions.loginToken(account.token);
        } catch {
            if (mounted.current) setError("Could not log in. Check that the token is valid and try again.");
        } finally {
            pending.current = false;
            if (mounted.current) setBusy(false);
        }
    }

    return (
        <div className="vc-token-login-container">
            <Text tag="h2" size="lg" weight="semibold">Token Login Manager</Text>
            <Text>
                Saved accounts are encrypted for this operating system profile. Encryption does not protect tokens from code running in this client.
            </Text>
            {error ? <Text role="alert" color="text-danger">{error}</Text> : null}
            {!loaded && !error ? <Text>Loading saved accounts…</Text> : null}
            <TextInput
                aria-label="Account label"
                placeholder="Account label"
                value={username}
                maxLength={128}
                disabled={!loaded || busy}
                onChange={(value: string) => setUsername(value)}
            />
            <TextInput
                aria-label="User token"
                placeholder="User token"
                type="password"
                autoComplete="off"
                value={token}
                maxLength={4096}
                disabled={!loaded || busy}
                onChange={(value: string) => setToken(value)}
            />
            <Button
                disabled={!loaded || busy || !username.trim() || !token.trim() || /\s/.test(token.trim())}
                onClick={() => persist([...accounts, { id: crypto.randomUUID(), username: username.trim(), token: token.trim() }], true)}
            >
                Save Account
            </Button>
            {loaded && !accounts.length ? <Text>No saved accounts.</Text> : null}
            {accounts.map(account => (
                <AccountEntry
                    key={account.id}
                    account={account}
                    busy={busy}
                    onLogin={() => login(account)}
                    onDelete={() => persist(accounts.filter(value => value.id !== account.id))}
                />
            ))}
        </div>
    );
}

const settingsEntry = {
    key: "equicord_token_login_manager",
    title: "Token Login Manager",
    Component: ErrorBoundary.wrap(AccountsTab, { noop: true }),
    Icon: UserIcon
};

export default definePlugin({
    name: "TokenLoginManager",
    description: "Manage accounts with encrypted token storage and log in using their tokens.",
    authors: [Devs.clrxxo],
    dependencies: ["Settings"],

    start() {
        if (!SettingsPlugin.customEntries.includes(settingsEntry))
            SettingsPlugin.customEntries.push(settingsEntry);
    },

    stop() {
        removeFromArray(SettingsPlugin.customEntries, entry => entry === settingsEntry);
    }
});
