/*
 * ShowMyToken — personal Equicord userplugin.
 * Reads the token of the account logged into THIS client and copies it locally.
 * It does not send the token in chat, log it, or transmit it anywhere.
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { addUserAreaButton, removeUserAreaButton, UserAreaButton } from "@api/UserArea";
import { Button } from "@components/Button";
import { copyWithToast } from "@utils/discord";
import definePlugin from "@utils/types";
import { AuthenticationStore, React, showToast } from "@webpack/common";

const BUTTON_ID = "vc-show-my-token";

function isToken(value: unknown): value is string {
    return typeof value === "string" && value.length > 40;
}

function scanWebpackToken(): string | null {
    const chunks = (window as any).webpackChunkdiscord_app;
    if (!Array.isArray(chunks)) return null;

    let token: string | null = null;
    chunks.push([
        [Symbol("show-my-token")],
        {},
        (req: any) => {
            if (token) return;
            for (const id of Object.keys(req.c ?? {})) {
                const mod = req.c[id]?.exports;
                if (!mod || mod === window) continue;
                for (const exp of [mod, mod.default]) {
                    if (typeof exp?.getToken !== "function") continue;
                    try {
                        const value = exp.getToken();
                        if (isToken(value)) {
                            token = value;
                            return;
                        }
                    } catch {
                        // not the auth module
                    }
                }
            }
        }
    ]);

    return token;
}

function readOwnToken(): string | null {
    try {
        const token = (AuthenticationStore as { getToken?: () => string; }).getToken?.();
        if (isToken(token)) return token;
    } catch {
        // fall through to the webpack scan
    }
    return scanWebpackToken();
}

async function copyOwnToken(): Promise<boolean> {
    const token = readOwnToken();
    if (!token) {
        showToast({ text: "No token found. Are you logged in?", variant: "danger" });
        return false;
    }

    try {
        await copyWithToast(token, "Token copied. Don't paste it anywhere you don't trust.");
        return true;
    } catch {
        showToast({ text: "Couldn't write to the clipboard.", variant: "danger" });
        return false;
    }
}

function KeyIcon() {
    return (
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12.65 10A6 6 0 1 0 7 16a5.99 5.99 0 0 0 5.65-4H17v4h4v-4h2v-4h-10.35zM7 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" />
        </svg>
    );
}

function SettingsPanel() {
    const [token, setToken] = React.useState<string | null>(null);
    const [visible, setVisible] = React.useState(false);

    const load = () => {
        const next = readOwnToken();
        setToken(next);
        if (!next) showToast({ text: "No token found. Are you logged in?", variant: "danger" });
        return next;
    };

    return (
        <div>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.45, margin: "0 0 12px" }}>
                Copies the token for the account signed into this client. It stays on this device:
                nothing is posted in chat and nothing is uploaded. Anyone who gets this string can
                use your account. If it leaks, change your password — that kills the token.
                Using it in your own scripts still breaks Discord's rules and can get the account banned.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button
                    variant="primary"
                    size="small"
                    onClick={() => void copyOwnToken()}
                >
                    Copy token
                </Button>
                <Button
                    variant="secondary"
                    size="small"
                    onClick={() => {
                        if (visible) {
                            setVisible(false);
                            return;
                        }
                        if (load()) setVisible(true);
                    }}
                >
                    {visible ? "Hide" : "Show"}
                </Button>
            </div>
            {visible && token && (
                <input
                    readOnly
                    spellCheck={false}
                    value={token}
                    onFocus={e => e.currentTarget.select()}
                    style={{
                        display: "block",
                        width: "100%",
                        boxSizing: "border-box",
                        marginTop: 12,
                        padding: "8px 10px",
                        borderRadius: 4,
                        border: "1px solid var(--background-modifier-accent)",
                        background: "var(--input-background)",
                        color: "var(--text-normal)",
                        fontFamily: "var(--font-code)",
                        fontSize: 12
                    }}
                />
            )}
        </div>
    );
}

export default definePlugin({
    name: "ShowMyToken",
    description: "Copy your own account token from a button or /mytoken. Local only — never sent.",
    authors: [{ name: "ph34rar5on", id: 0n }],
    settingsAboutComponent: () => <SettingsPanel />,

    commands: [
        {
            name: "mytoken",
            description: "Copy your token to the clipboard. Does not send it.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (_args, ctx) => {
                void copyOwnToken().then(ok => {
                    const channelId = ctx?.channel?.id;
                    if (!channelId) return;
                    sendBotMessage(channelId, {
                        content: ok
                            ? "Token copied to your clipboard. Nothing was sent to Discord."
                            : "No token found. Are you logged in?"
                    });
                });
            }
        }
    ],

    start() {
        addUserAreaButton(BUTTON_ID, () => (
            <UserAreaButton
                icon={<KeyIcon />}
                tooltipText="Copy my token"
                aria-label="Copy my token"
                onClick={() => void copyOwnToken()}
            />
        ));
    },

    stop() {
        removeUserAreaButton(BUTTON_ID);
    }
});
