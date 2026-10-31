/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { compileFunction } from "node:vm";

import { transform } from "esbuild";

const source = await readFile(new URL("../../src/userplugins/showMyToken/index.tsx", import.meta.url), "utf8");
const { code } = await transform(source, { loader: "tsx", format: "cjs", jsxFactory: "React.createElement" });
const syntheticToken = "synthetic-test-value-not-a-credential-".repeat(2);

function fixture({ token = syntheticToken, fallback = false, clipboardFails = false } = {}) {
    const copied = [], messages = [], toasts = [], buttons = new Map(), state = [];
    let cursor = 0;
    const React = {
        createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
        useState(initial) {
            const index = cursor++;
            if (!(index in state)) state[index] = initial;
            return [state[index], value => { state[index] = value; }];
        }
    };
    const chunks = [];
    chunks.push = entry => entry[2]({ c: { test: { exports: { default: { getToken: () => token } } } } });
    const dependencies = {
        "@api/Commands": {
            ApplicationCommandInputType: { BUILT_IN: 0 },
            sendBotMessage: (id, data) => messages.push({ id, ...data })
        },
        "@api/UserArea": {
            addUserAreaButton: (id, render) => buttons.set(id, render),
            removeUserAreaButton: id => buttons.delete(id),
            UserAreaButton: "UserAreaButton"
        },
        "@components/Button": { Button: "Button" },
        "@utils/discord": {
            copyWithToast: async value => {
                if (clipboardFails) throw new Error("Synthetic clipboard failure");
                copied.push(value);
            }
        },
        "@utils/types": { default: value => value, __esModule: true },
        "@webpack/common": {
            AuthenticationStore: fallback ? {} : { getToken: () => token },
            React,
            showToast: toast => {
                assert.ok(["default", "success", "critical"].includes(toast.variant));
                toasts.push(toast);
            }
        }
    };
    const module = { exports: {} };
    compileFunction(code, ["require", "module", "exports", "window"])(name => {
        assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
        return dependencies[name];
    }, module, module.exports, { webpackChunkdiscord_app: chunks });
    const plugin = module.exports.default;
    return {
        plugin, copied, messages, toasts, buttons,
        renderSettings() {
            cursor = 0;
            return plugin.settingsAboutComponent().type();
        },
        async command() {
            plugin.commands[0].execute([], { channel: { id: "synthetic-channel" } });
            await setImmediate();
        }
    };
}

test("Command copies the store value without including it in confirmation", async () => {
    const f = fixture();
    await f.command();
    assert.deepEqual(f.copied, [syntheticToken]);
    assert.equal(f.messages.length, 1);
    assert.match(f.messages[0].content, /Token copied/);
    assert.ok(!f.messages[0].content.includes(syntheticToken));
});

test("Webpack fallback copies a synthetic value", async () => {
    const f = fixture({ fallback: true });
    await f.command();
    assert.deepEqual(f.copied, [syntheticToken]);
});

test("Missing token reports failure without copying", async () => {
    const f = fixture({ token: null });
    await f.command();
    assert.deepEqual(f.copied, []);
    assert.equal(f.toasts[0].variant, "critical");
    assert.match(f.toasts[0].text, /No token found/);
    assert.match(f.messages[0].content, /Couldn't copy/);
});

test("Clipboard failure is not misreported as a missing token", async () => {
    const f = fixture({ clipboardFails: true });
    await f.command();
    assert.deepEqual(f.copied, []);
    assert.match(f.toasts[0].text, /clipboard/);
    assert.match(f.messages[0].content, /Couldn't copy/);
    assert.doesNotMatch(f.messages[0].content, /No token found/);
    assert.ok(!f.messages[0].content.includes(syntheticToken));
});

test("User area button registers, copies, and unregisters", async () => {
    const f = fixture();
    f.plugin.start();
    assert.equal(f.buttons.size, 1);
    f.buttons.values().next().value().props.onClick();
    await setImmediate();
    assert.deepEqual(f.copied, [syntheticToken]);
    f.plugin.stop();
    assert.equal(f.buttons.size, 0);
});

test("Settings show and hide the synthetic value", () => {
    const f = fixture();
    let tree = f.renderSettings();
    tree.props.children[1].props.children[1].props.onClick();
    tree = f.renderSettings();
    assert.equal(tree.props.children[2].props.value, syntheticToken);
    tree.props.children[1].props.children[1].props.onClick();
    tree = f.renderSettings();
    assert.ok(!tree.props.children[2]);
});

test("User area integration declares its API dependency", () => {
    assert.ok(fixture().plugin.dependencies.includes("UserAreaAPI"));
});
