/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compileFunction } from "node:vm";

import { transformSync } from "esbuild";

const { code } = transformSync(readFileSync(new URL("../index.tsx", import.meta.url), "utf8"), { loader: "tsx", format: "cjs" });

function fixture() {
    const f = {
        friendIds: ["1", "2", "3"],
        users: { "1": { username: "Zoe" }, "2": { globalName: "Amy", username: "amy" }, "3": { username: "Bob" } },
        statuses: { "1": "online", "2": "online", "3": "offline" },
        guildId: "guild",
        channelId: "voice",
        members: new Set(["1"]),
        guildVoiceStates: { "2": { channelId: "other-voice" } },
        channelVoiceStates: { "1": { channelId: "voice" }, "stranger": { channelId: "voice" } },
        voiceStates: { "3": { channelId: "another-server-voice" } },
        privateMessages: [],
        publicMessages: [],
        requests: [],
        delays: [],
        onSleep: () => {}
    };
    const dependencies = {
        "@api/Commands": {
            ApplicationCommandInputType: { BUILT_IN: 1 },
            ApplicationCommandOptionType: { STRING: 3, BOOLEAN: 5 },
            findOption: (args, name, fallback) => args.find(arg => arg.name === name)?.value ?? fallback,
            sendBotMessage: (channelId, message) => f.privateMessages.push({ channelId, ...message })
        },
        "@utils/constants": { EquicordDevs: { Bluscream: { name: "Bluscream", id: 467777925790564352n } } },
        "@utils/discord": { sendMessage: async (...args) => f.publicMessages.push(args) },
        "@utils/misc": { sleep: async ms => { f.delays.push(ms); f.onSleep(); } },
        "@utils/types": plugin => plugin,
        "@webpack/common": {
            ChannelStore: { getChannel: () => ({ guild_id: f.guildId }) },
            FluxDispatcher: { dispatch: request => f.requests.push(request) },
            GuildMemberStore: { isMember: (guildId, id) => guildId === f.guildId && f.members.has(id) },
            PresenceStore: { getStatus: id => f.statuses[id] },
            RelationshipStore: { getFriendIDs: () => f.friendIds },
            SelectedChannelStore: { getVoiceChannelId: () => f.channelId },
            UserStore: { getUser: id => f.users[id] },
            VoiceStateStore: {
                getVoiceStates: guildId => guildId ? f.guildVoiceStates : {},
                getVoiceStatesForChannel: () => f.channelVoiceStates,
                getVoiceStateForUser: id => f.voiceStates[id]
            }
        }
    };
    const module = { exports: {} };
    compileFunction(code, ["require", "module", "exports"])(name => {
        assert.ok(Object.hasOwn(dependencies, name), name);
        return dependencies[name];
    }, module, module.exports);
    f.plugin = module.exports.default;
    f.execute = options => f.plugin.commands[0].execute(
        Object.entries(options ?? {}).map(([name, value]) => ({ name, value })),
        { channel: { id: "text" } }
    );
    return f;
}

test("Registers /friends and returns status-sorted results privately by default", async () => {
    const f = fixture();
    assert.equal(f.plugin.commands[0].name, "friends");
    await f.execute();
    assert.equal(f.publicMessages.length, 0);
    assert.equal(f.privateMessages.length, 1);
    const { content } = f.privateMessages[0];
    assert.match(content, /Friends on this account \(3\)/);
    assert.ok(content.indexOf("<@2>") < content.indexOf("<@1>"));
    assert.ok(content.indexOf("<@1>") < content.indexOf("<@3>"));
    assert.match(content, /<@2> <#other-voice>/);
    assert.match(content, /<@3> <#another-server-voice>/);
    assert.equal(f.requests.length, 0);
});

test("Server filtering includes cached members and friends in server voice channels", async () => {
    const f = fixture();
    await f.execute({ filter: "guild" });
    assert.match(f.privateMessages[0].content, /Friends in this server \(2\)/);
    assert.doesNotMatch(f.privateMessages[0].content, /<@3>/);
    assert.deepEqual(f.requests[0].userIds, ["2", "3"]);
    assert.deepEqual(f.delays, [2500]);
});

test("Missing guild members are requested in batches and stores are reread after syncing", async () => {
    const f = fixture();
    f.friendIds = Array.from({ length: 205 }, (_, i) => String(i + 100));
    f.members.clear();
    f.guildVoiceStates = {};
    f.onSleep = () => f.members.add("100");
    await f.execute({ filter: "guild" });
    assert.deepEqual(f.requests.map(request => request.userIds.length), [100, 100, 5]);
    assert.ok(f.requests.every(request => request.type === "GUILD_MEMBERS_REQUEST" && request.guildIds[0] === "guild"));
    assert.match(f.privateMessages[0].content, /Friends in this server \(1\)/);
    assert.match(f.privateMessages[0].content, /<@100>/);
});

test("Voice filtering lists only friends in the selected voice channel", async () => {
    const f = fixture();
    await f.execute({ filter: "channel" });
    assert.match(f.privateMessages[0].content, /Friends in this voice channel \(1\)/);
    assert.match(f.privateMessages[0].content, /<@1> <#voice>/);
    assert.doesNotMatch(f.privateMessages[0].content, /<@2>|<@3>|stranger/);
    assert.equal(f.requests.length, 0);
});

test("Missing filter contexts produce private guidance instead of listing all friends", async () => {
    const f = fixture();
    f.guildId = undefined;
    await f.execute({ filter: "guild", share: true });
    assert.match(f.privateMessages[0].content, /Run this command in a server/);
    f.channelId = undefined;
    await f.execute({ filter: "channel", share: true });
    assert.match(f.privateMessages[1].content, /Join a voice channel/);
    assert.equal(f.publicMessages.length, 0);
});

test("Empty accounts and empty filtered results receive private feedback", async () => {
    const f = fixture();
    f.friendIds = [];
    await f.execute({ share: true });
    assert.match(f.privateMessages[0].content, /don't have any friends/);
    f.friendIds = ["3"];
    await f.execute({ filter: "channel", share: true });
    assert.match(f.privateMessages[1].content, /No friends were found/);
    assert.equal(f.publicMessages.length, 0);
});

test("Public sharing splits long lists without losing friends or enabling mention pings", async () => {
    const f = fixture();
    f.friendIds = Array.from({ length: 200 }, (_, i) => String(100000000000000000n + BigInt(i)));
    await f.execute({ share: true });
    assert.equal(f.privateMessages.length, 0);
    assert.ok(f.publicMessages.length > 1);
    for (const [channelId, message, wait, options] of f.publicMessages) {
        assert.equal(channelId, "text");
        assert.ok(message.content.length <= 2000);
        assert.equal(wait, true);
        assert.deepEqual(options.allowedMentions, { parse: [], replied_user: false });
    }
    const output = f.publicMessages.map(([, message]) => message.content).join("\n");
    assert.equal((output.match(/<@\d+>/g) ?? []).length, 200);
    for (const id of f.friendIds) assert.ok(output.includes(`<@${id}>`));
});

test("Repeated commands use current relationships instead of cached friend data", async () => {
    const f = fixture();
    await f.execute();
    f.friendIds = ["4"];
    await f.execute();
    assert.match(f.privateMessages[1].content, /<@4>/);
    assert.doesNotMatch(f.privateMessages[1].content, /<@1>|<@2>|<@3>/);
});
