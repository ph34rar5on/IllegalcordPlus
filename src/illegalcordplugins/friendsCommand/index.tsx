/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { EquicordDevs } from "@utils/constants";
import { sendMessage } from "@utils/discord";
import { sleep } from "@utils/misc";
import definePlugin from "@utils/types";
import { CommandArgument, CommandContext } from "@vencord/discord-types";
import { ChannelStore, FluxDispatcher, GuildMemberStore, PresenceStore, RelationshipStore, SelectedChannelStore, UserStore, VoiceStateStore } from "@webpack/common";

type FriendFilter = "all" | "guild" | "channel";

const STATUS_ORDER: Record<string, number> = {
    online: 0,
    streaming: 1,
    idle: 2,
    dnd: 3,
    offline: 4,
    invisible: 5
};

const STATUS_EMOJIS: Record<string, string> = {
    online: "🟢",
    streaming: "🟢",
    idle: "🟡",
    dnd: "🔴",
    offline: "⚫",
    invisible: "⚫"
};

export default definePlugin({
    name: "FriendsCommand",
    description: "Adds a /friends command to list your friends, their status, and known voice channel locations.",
    authors: [EquicordDevs.Bluscream],
    tags: ["Friends", "Utility"],
    commands: [{
        name: "friends",
        description: "List friends and their known voice channel locations.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        options: [
            {
                name: "filter",
                description: "Filter friends by location.",
                type: ApplicationCommandOptionType.STRING,
                choices: [
                    { name: "all", label: "All friends", value: "all" },
                    { name: "guild", label: "Current server", value: "guild" },
                    { name: "channel", label: "Current voice channel", value: "channel" }
                ]
            },
            {
                name: "share",
                description: "Post the list publicly instead of showing it only to you.",
                type: ApplicationCommandOptionType.BOOLEAN
            }
        ],
        async execute(args: CommandArgument[], ctx: CommandContext) {
            const filter = findOption<FriendFilter>(args, "filter", "all");
            const share = findOption(args, "share", false);
            const guildId = ctx.guild?.id ?? ChannelStore.getChannel(ctx.channel.id)?.guild_id;
            const channelId = SelectedChannelStore.getVoiceChannelId();

            if (filter === "guild" && !guildId) {
                sendBotMessage(ctx.channel.id, { content: "Run this command in a server to use the server filter." });
                return;
            }
            if (filter === "channel" && !channelId) {
                sendBotMessage(ctx.channel.id, { content: "Join a voice channel to use the voice channel filter." });
                return;
            }

            const friendIds = RelationshipStore.getFriendIDs();
            if (friendIds.length === 0) {
                sendBotMessage(ctx.channel.id, { content: "You don't have any friends on this account." });
                return;
            }

            // If we're in a guild context, try to sync members who aren't cached
            if (filter === "guild" && guildId) {
                const missing = friendIds.filter(id => !GuildMemberStore.isMember(guildId, id));
                for (let i = 0; i < missing.length; i += 100) {
                    FluxDispatcher.dispatch({
                        type: "GUILD_MEMBERS_REQUEST",
                        guildIds: [guildId],
                        userIds: missing.slice(i, i + 100),
                        presences: true
                    });
                }
                if (missing.length > 0) await sleep(2500);
            }

            const guildVoiceStates = VoiceStateStore.getVoiceStates(guildId);
            const channelVoiceStates = channelId ? VoiceStateStore.getVoiceStatesForChannel(channelId) : {};
            const targetIds = RelationshipStore.getFriendIDs().filter(id => {
                if (filter === "guild" && guildId) return GuildMemberStore.isMember(guildId, id) || Boolean(guildVoiceStates[id]);
                if (filter === "channel") return Boolean(channelVoiceStates[id]);
                return true;
            });

            if (targetIds.length === 0) {
                sendBotMessage(ctx.channel.id, {
                    content: filter === "guild"
                        ? "No friends were found in this server. Some members may still be syncing."
                        : "No friends were found in this voice channel."
                });
                return;
            }

            // Capture info for sorting and display
            const friends = targetIds.map(id => {
                const user = UserStore.getUser(id);
                return {
                    id,
                    name: user?.globalName || user?.username || id,
                    status: PresenceStore.getStatus(id) || "unknown",
                    channelId: (filter === "channel" ? channelVoiceStates[id] : guildVoiceStates[id] ?? VoiceStateStore.getVoiceStateForUser(id))?.channelId
                };
            });

            // Sort by status priority then name
            friends.sort((a, b) => (STATUS_ORDER[a.status] ?? 6) - (STATUS_ORDER[b.status] ?? 6) || a.name.localeCompare(b.name));

            const scope = filter === "guild" ? "in this server" : filter === "channel" ? "in this voice channel" : "on this account";
            const header = `## Friends ${scope} (${friends.length})\n`;
            const messages: string[] = [];
            let content = header;
            for (const friend of friends) {
                const location = friend.channelId ? ` <#${friend.channelId}>` : "";
                const line = `${STATUS_EMOJIS[friend.status] ?? "⚪"} <@${friend.id}>${location}\n`;
                if (content.length + line.length > 2000) {
                    messages.push(content.trimEnd());
                    content = header;
                }
                content += line;
            }
            messages.push(content.trimEnd());

            for (const content of messages) {
                if (share) {
                    await sendMessage(ctx.channel.id, { content }, true, {
                        allowedMentions: { parse: [], replied_user: false }
                    });
                } else {
                    sendBotMessage(ctx.channel.id, { content });
                }
            }
        }
    }]
});
