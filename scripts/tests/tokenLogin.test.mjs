/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { compileFunction } from "node:vm";

import { transform } from "esbuild";

const account = { id: "fixture-id", username: "Fixture", token: "fixture-token" };
const key = "tokenLoginManager.data";

async function loadSource(name, dependencies, globals = {}) {
    const source = await readFile(new URL(`../../src/equicordplugins/tokenLogin.desktop/${name}`, import.meta.url), "utf8");
    const { code } = await transform(source, { loader: name.endsWith("tsx") ? "tsx" : "ts", format: "cjs", jsxFactory: "React.createElement" });
    const module = { exports: {} };
    const require = name => {
        assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
        return dependencies[name];
    };
    compileFunction(code, ["require", "module", "exports", ...Object.keys(globals)])(require, module, module.exports, ...Object.values(globals));
    return module.exports;
}

async function nativeFixture({ available = true, backend = "gnome_libsecret", platform = "win32" } = {}) {
    const secretKey = randomBytes(32);
    let encryptCalls = 0;
    let decryptCalls = 0;
    const safeStorage = {
        isEncryptionAvailable: () => available,
        getSelectedStorageBackend: () => backend,
        encryptString(value) {
            encryptCalls++;
            const iv = randomBytes(12);
            const cipher = createCipheriv("aes-256-gcm", secretKey, iv);
            const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
            return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
        },
        decryptString(value) {
            decryptCalls++;
            const cipher = createDecipheriv("aes-256-gcm", secretKey, value.subarray(0, 12));
            cipher.setAuthTag(value.subarray(12, 28));
            return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString("utf8");
        }
    };
    const native = await loadSource("native.ts", { electron: { safeStorage } }, { process: { platform } });
    const frame = { url: "https://discord.com/channels/@me" };
    const event = { sender: { isDestroyed: () => false, mainFrame: frame }, senderFrame: frame };
    return { native, safeStorage, event, calls: () => ({ encryptCalls, decryptCalls }) };
}

async function storageFixture(initial, nativeOptions = {}) {
    const fixture = await nativeFixture(nativeOptions);
    let stored = structuredClone(initial);
    let failWrite = false;
    let writeCount = 0;
    const storage = await loadSource("storage.ts", {
        "@api/DataStore": {
            async get(requestedKey) { assert.equal(requestedKey, key); return structuredClone(stored); },
            async set(requestedKey, value) {
                assert.equal(requestedKey, key);
                if (failWrite) throw new Error("Private database path");
                stored = structuredClone(value);
                writeCount++;
            }
        }
    }, {
        VencordNative: { pluginHelpers: { TokenLoginManager: {
            encrypt: value => fixture.native.encrypt(fixture.event, value),
            decrypt: value => fixture.native.decrypt(fixture.event, value)
        } } }
    });
    return { ...fixture, storage, stored: () => stored, writes: () => writeCount, failWrites: () => { failWrite = true; } };
}

test("Persists only ciphertext and round trips the complete account collection", async () => {
    const { storage, stored, writes } = await storageFixture();
    assert.deepEqual(await storage.loadAccounts(), []);
    assert.equal(writes(), 0);
    await storage.saveAccounts([account]);
    assert.equal(stored().version, 1);
    assert.deepEqual(Object.keys(stored()).sort(), ["ciphertext", "version"]);
    assert.ok(!JSON.stringify(stored()).includes(account.token));
    assert.ok(!JSON.stringify(stored()).includes(account.username));
    assert.deepEqual(await storage.loadAccounts(), [account]);
    await storage.saveAccounts([]);
    assert.deepEqual(await storage.loadAccounts(), []);
});

test("Migrates the original plaintext key in place before returning accounts", async () => {
    const { storage, stored, writes } = await storageFixture({ [account.id]: account });
    assert.deepEqual(await storage.loadAccounts(), [account]);
    assert.equal(stored().version, 1);
    assert.equal(writes(), 1);
    assert.deepEqual(await storage.loadAccounts(), [account]);
    assert.equal(writes(), 1);
});

test("Unavailable and insecure backends never save or destroy legacy accounts", async () => {
    for (const options of [{ available: false }, { platform: "linux", backend: "basic_text" }]) {
        const legacy = { [account.id]: account };
        const { storage, stored, writes, native, event } = await storageFixture(legacy, options);
        await assert.rejects(storage.loadAccounts(), /unavailable/);
        await assert.rejects(storage.saveAccounts([account]), /unavailable/);
        assert.equal(native.decrypt(event, "YQ==").success, false);
        assert.deepEqual(stored(), legacy);
        assert.equal(writes(), 0);
    }
});

test("Failed migration, save, and deletion preserve the previous persisted data", async () => {
    const legacy = { [account.id]: account };
    const migration = await storageFixture(legacy);
    migration.failWrites();
    await assert.rejects(migration.storage.loadAccounts(), /Could not save/);
    assert.deepEqual(migration.stored(), legacy);
    const encrypted = await storageFixture();
    await encrypted.storage.saveAccounts([account]);
    const previous = structuredClone(encrypted.stored());
    encrypted.failWrites();
    await assert.rejects(encrypted.storage.saveAccounts([]), /Could not save/);
    assert.deepEqual(encrypted.stored(), previous);
    assert.deepEqual(await encrypted.storage.loadAccounts(), [account]);
});

test("Malformed or unsupported persisted data is never replaced", async () => {
    for (const initial of [null, [], "invalid", { version: 2 }, { version: 1 }, { bad: { ...account, token: 42 } }]) {
        const { storage, stored, writes } = await storageFixture(initial);
        await assert.rejects(storage.loadAccounts(), /invalid|unsupported/);
        assert.deepEqual(stored(), initial);
        assert.equal(writes(), 0);
    }
    const { storage, writes } = await storageFixture();
    for (const accounts of [[account, account], [{ ...account, token: "bad token" }], [{ ...account, username: "" }]]) {
        await assert.rejects(storage.saveAccounts(accounts), /invalid/);
    }
    assert.equal(writes(), 0);
});

test("Corrupt ciphertext and data encrypted for another profile remain untouched", async () => {
    const original = await storageFixture();
    await original.storage.saveAccounts([account]);
    const envelope = structuredClone(original.stored());
    for (const ciphertext of [envelope.ciphertext, "not base64", "YQ=="]) {
        const initial = { version: 1, ciphertext };
        const { storage, writes, stored } = await storageFixture(initial);
        await assert.rejects(storage.loadAccounts(), /unlock|encrypted data/);
        assert.deepEqual(stored(), initial);
        assert.equal(writes(), 0);
    }
});

test("Decrypted invalid JSON and invalid account arrays are rejected without writes", async () => {
    const fixture = await storageFixture();
    for (const value of ["not json", "null", "[{}]"]) {
        const encrypted = fixture.native.encrypt(fixture.event, value);
        assert.equal(encrypted.success, true);
        const storage = await loadSource("storage.ts", {
            "@api/DataStore": { get: async () => ({ version: 1, ciphertext: encrypted.data }), set: () => assert.fail("Unexpected write") }
        }, {
            VencordNative: { pluginHelpers: { TokenLoginManager: {
                decrypt: value => fixture.native.decrypt(fixture.event, value)
            } } }
        });
        await assert.rejects(storage.loadAccounts(), /invalid/);
    }
});

test("Native IPC rejects malformed, oversized, and unrelated encrypted input", async () => {
    const { native, event, safeStorage, calls } = await nativeFixture();
    for (const value of [undefined, null, {}, [], 42, "", "a".repeat(1_048_577), "😀".repeat(262_145)])
        assert.equal(native.encrypt(event, value).success, false);
    for (const value of [undefined, null, {}, 42, "", "a".repeat(2_097_153), "YQ", "YQ==\n"])
        assert.equal(native.decrypt(event, value).success, false);
    assert.deepEqual(calls(), { encryptCalls: 0, decryptCalls: 0 });
    assert.equal(native.decrypt(event, safeStorage.encryptString("Unrelated application data").toString("base64")).success, false);
    safeStorage.encryptString = () => { throw new Error("Private path and credentials"); };
    assert.deepEqual(native.encrypt(event, "fixture"), { success: false, error: "Could not encrypt the saved accounts." });
});

test("Native IPC accepts only trusted Discord main frames", async () => {
    for (const url of [
        "https://attacker.test", "https://discord.com.attacker.test", "https://support.discord.com",
        "https://discord.com:444", "https://user:password@discord.com", "http://discord.com", "file:///discord.com", "not a URL"
    ]) {
        const { native, event, calls } = await nativeFixture();
        event.senderFrame.url = url;
        assert.equal(native.encrypt(event, "fixture").success, false);
        assert.equal(native.decrypt(event, "YQ==").success, false);
        assert.deepEqual(calls(), { encryptCalls: 0, decryptCalls: 0 });
    }
    for (const host of ["discord.com", "ptb.discord.com", "canary.discord.com"]) {
        const { native, event } = await nativeFixture();
        event.senderFrame.url = `https://${host}/login`;
        assert.equal(native.encrypt(event, "fixture").success, true);
    }
    for (const kind of ["subframe", "missing", "destroyed"]) {
        const { native, event } = await nativeFixture();
        if (kind === "subframe") event.senderFrame = { ...event.senderFrame };
        if (kind === "missing") event.senderFrame = null;
        if (kind === "destroyed") event.sender.isDestroyed = () => true;
        assert.equal(native.encrypt(event, "fixture").success, false);
    }
});

async function uiFixture({ failLoad = false, failSave = false, failLogin = false } = {}) {
    const entries = [];
    const slots = [];
    const cleanups = [];
    const logins = [];
    const saves = [];
    let cursor = 0;
    let loginResolve;
    const loginPending = new Promise(resolve => { loginResolve = resolve; });
    const common = {
        React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.flat() } }) },
        TextInput: "input",
        useState(initial) {
            const index = cursor++;
            if (!(index in slots)) slots[index] = initial;
            return [slots[index], value => { slots[index] = value; }];
        },
        useRef(initial) {
            const index = cursor++;
            slots[index] ??= { current: initial };
            return slots[index];
        },
        useEffect(effect) {
            const index = cursor++;
            if (!(index in slots)) {
                slots[index] = true;
                cleanups.push(effect());
            }
        }
    };
    const plugin = (await loadSource("index.tsx", {
        "./styles.css": {},
        "@components/Button": { Button: "button" },
        "@components/ErrorBoundary": { wrap: component => component },
        "@components/Icons": { UserIcon: "icon" },
        "@components/Text": { Text: "text" },
        "@plugins/_core/settings": { customEntries: entries },
        "@utils/constants": { Devs: { clrxxo: { name: "Fixture", id: 0n } } },
        "@utils/misc": { removeFromArray: (array, predicate) => { const i = array.findIndex(predicate); if (i !== -1) array.splice(i, 1); } },
        "@utils/types": plugin => plugin,
        "@webpack": { findByPropsLazy: name => {
            assert.equal(name, "loginToken");
            return { loginToken: async token => {
                logins.push(token);
                if (failLogin) throw new Error("Private authentication error");
                await loginPending;
            } };
        } },
        "@webpack/common": common,
        "./storage": {
            loadAccounts: async () => {
                if (failLoad) throw new Error("Saved accounts are locked.");
                return [account];
            },
            saveAccounts: async value => {
                if (failSave) throw new Error("Could not save the accounts.");
                saves.push(value);
            }
        }
    })).default;
    plugin.start();
    const render = () => { cursor = 0; return entries[0].Component(); };
    render();
    await setImmediate();
    return {
        plugin, entries, logins, saves, render, loginResolve,
        unmount: () => cleanups.forEach(cleanup => cleanup())
    };
}

function nodes(tree) {
    if (!tree || typeof tree !== "object") return [];
    return [tree, ...(tree.props.children ?? []).flatMap(nodes)];
}

test("Registers current settings once and removes only its own entry on stop", async () => {
    const { plugin, entries } = await uiFixture();
    const other = { key: "other" };
    entries.push(other);
    plugin.start();
    assert.equal(entries.length, 2);
    plugin.stop();
    assert.deepEqual(entries, [other]);
    plugin.stop();
    assert.deepEqual(entries, [other]);
    plugin.start();
    assert.equal(entries.length, 2);
});

test("Login uses the Discord action, blocks concurrent clicks, and releases busy state", async () => {
    const fixture = await uiFixture();
    const entry = nodes(fixture.render()).find(node => node.props.account);
    const pending = entry.props.onLogin();
    await entry.props.onLogin();
    assert.deepEqual(fixture.logins, [account.token]);
    assert.equal(nodes(fixture.render()).find(node => node.props.account).props.busy, true);
    fixture.loginResolve();
    await pending;
    assert.equal(nodes(fixture.render()).find(node => node.props.account).props.busy, false);
    fixture.unmount();
});

test("Failed deletion keeps the account visible and displays the storage failure", async () => {
    const fixture = await uiFixture({ failSave: true });
    await nodes(fixture.render()).find(node => node.props.account).props.onDelete();
    const tree = nodes(fixture.render());
    assert.ok(tree.find(node => node.props.account));
    assert.match(tree.find(node => node.props.role === "alert").props.children.join(""), /Could not save/);
    assert.deepEqual(fixture.saves, []);
});

test("Load failures block editing and login failures show no private exception details", async () => {
    const locked = await uiFixture({ failLoad: true });
    const lockedTree = nodes(locked.render());
    assert.ok(lockedTree.filter(node => node.type === "input" || node.type === "button").every(node => node.props.disabled));
    assert.match(lockedTree.find(node => node.props.role === "alert").props.children.join(""), /locked/);
    const fixture = await uiFixture({ failLogin: true });
    const tree = nodes(fixture.render());
    assert.equal(tree.find(node => node.props["aria-label"] === "User token").props.type, "password");
    await tree.find(node => node.props.account).props.onLogin();
    const error = nodes(fixture.render()).find(node => node.props.role === "alert").props.children.join("");
    assert.match(error, /Could not log in/);
    assert.ok(!error.includes("Private"));
});
