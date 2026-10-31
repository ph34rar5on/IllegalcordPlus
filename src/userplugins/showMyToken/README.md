# ShowMyToken

Personal Equicord / Equibop userplugin. Copies **your** logged-in account token to the clipboard.

It does not post the token, log it, or send it off the machine.

## Install

1. In your Equicord (or Equibop) source tree, create `src/userplugins/showMyToken/`.
2. Put `index.tsx` in that folder.
3. From the repo root, rebuild and inject:

```
pnpm build
pnpm inject
```

Fully quit Discord, then reopen it. Enable **ShowMyToken** under Equicord settings if it is not already on.

## Use

- Settings → Equicord → Plugins → ShowMyToken → **Copy token** or **Show**
- Key button at the bottom-left, next to the account controls
- `/mytoken` in any channel (local confirmation only; the token is not in the message)

Restart Discord once after the first build so the slash command registers.

## If it leaks

Change the account password. That invalidates the token. Don't paste it into websites, bots, or Discord chats.
