# Token Login Manager

Save account labels and tokens in an encrypted local vault, then log in through Discord's token-login action. This refactors the [original third-party plugin](https://github.com/stealtech/EquicordPlugins/tree/main/tokenLogin) for this Illegalcord checkout.

## Requirements

- Git, Node.js 22 or newer, and the pnpm version pinned in the repository's `package.json` (currently 12.18.0).
- A source checkout containing this plugin and its native module.
- Desktop Discord with this checkout's Illegalcord development build installed.
- Working operating system credential storage. Browser extensions and userscripts are not supported.

This implementation targets the APIs in this repository. It is not a drop-in plugin for an arbitrary Vencord or older Equicord release.

## Installation

Run these commands from the repository root in a normal, non-administrator terminal:

```powershell
pnpm install --frozen-lockfile
pnpm build
```

Fully quit Discord, including its system tray process. Install the local development build:

```powershell
pnpm inject
```

The injection command may download and run the repository's installer. Follow its prompts to select the intended Discord installation. It modifies that installation; building alone does not install the plugin.

Restart Discord, open **User Settings**, find the **Illegalcord Settings** section, and open **Plugins**. Search for `TokenLoginManager` and enable it. Close and reopen settings if the new **Token Login Manager** page is not immediately visible.

Open that page, enter an account label and a token for an account you own, and choose **Save Account**. The label is descriptive and is not verified against Discord. Saving checks input structure, not whether Discord accepts the token. Choose **Login** to attempt authentication.

If this checkout is already injected, rebuilding updates its local build files. Fully quit and restart Discord after rebuilding because this plugin includes main-process native code; a renderer reload alone is insufficient.

Do not enable the original plugin alongside this version. They share the same plugin name and storage key. Do not downgrade to the original plugin after migration because it does not understand the encrypted format.

## Storage and migration

- The whole account collection, including labels, is encrypted by Electron's `safeStorage` in the main process.
- On Windows, `safeStorage` uses Windows DPAPI. Other supported desktop systems use Electron's operating system credential-storage integration.
- The renderer persists only `{ version: 1, ciphertext: "..." }` under `tokenLoginManager.data` in the `VencordData` IndexedDB database's `VencordStore` object store.
- No encryption key is saved beside the ciphertext. There is no plaintext fallback. Linux's insecure `basic_text` backend is rejected.
- Opening the accounts page detects the original plaintext account record and replaces it with the encrypted envelope only after encryption and persistence succeed. Migration uses the same key and does not create a separate plaintext backup.
- If migration fails, the original record is left untouched, so any legacy plaintext remains until migration succeeds. Load failures block editing. Save and delete operations update the visible list only after persistence succeeds.
- Disabling the plugin removes its settings entry but does not delete saved accounts. To remove accounts, use **Delete** while the plugin is enabled and storage is accessible.

Encryption protects stored data, not tokens in the running client. Other code running with the same privileges may access decrypted tokens. Do not treat a copied ciphertext record as a portable backup; successful decryption depends on the operating system profile, application context, and available credential store. Migration and deletion do not securely erase old database pages, system backups, or tokens previously saved elsewhere.

## Automated verification

Run from the repository root:

```powershell
node --test scripts/tests/tokenLogin.test.mjs
pnpm test:runtime
pnpm testTsc
pnpm exec oxlint src/equicordplugins/tokenLogin.desktop scripts/tests/tokenLogin.test.mjs
pnpm exec oxfmt --check src/equicordplugins/tokenLogin.desktop/styles.css
pnpm build
```

Expected results: the targeted tests and full runtime suite pass, TypeScript and lint report no errors, the stylesheet passes formatting checks, and desktop bundles build successfully.

The targeted tests cover:

- Encrypted persistence and round trips of the complete account collection.
- Migration of the old plaintext record.
- Unavailable encryption and insecure Linux backends without plaintext fallback.
- Failed writes and deletions preserving previous saved data.
- Corrupt ciphertext, unsupported formats, invalid account data, and simulated profile-key changes.
- Native IPC caller restrictions, payload limits, and sanitized errors.
- Current settings registration and cleanup, masked input, serialized login attempts, and failed-deletion feedback.

Tests use synthetic credentials, mocked Electron APIs, and an in-memory encryption implementation. They do not prove that the real operating system key store or Discord login works on a particular machine.

## Manual desktop verification

Use only an account you own and can recover through Discord's normal login process. Do not paste tokens into terminal commands, logs, screenshots, or bug reports.

1. **Registration:** Enable the plugin and reopen settings. Confirm that exactly one **Token Login Manager** entry appears. Disable it, reopen settings, and confirm the entry disappears. Re-enable it and confirm there are no duplicates.
2. **Input and persistence:** Add a test account. Confirm the token input is masked and the input fields clear after a successful save. Fully quit and restart Discord, then confirm the account remains.
3. **Visibility:** Confirm the saved token starts hidden and **Show Token** and **Hide Token** work. Perform this check privately, without screen sharing or recording.
4. **Stored format:** If inspecting storage with developer tools, locate `VencordData` / `VencordStore` / `tokenLoginManager.data`. Confirm the record has `version: 1` and a ciphertext string, not plaintext account fields. Do not export or share the vault. Close developer tools before quitting Discord.
5. **Login:** Choose **Login** for the saved account and verify that Discord authenticates the expected user. This invokes Discord's own login action without an iframe, repeated localStorage writes, or a forced reload timer. Runtime compatibility still depends on Discord exposing that action.
6. **Deletion:** Delete the test entry, fully restart Discord, and confirm it does not return. Deleting a saved entry does not revoke its token or log out an already active session.
7. **Migration, if applicable:** If the original plugin had saved accounts in this same Discord profile, open the page and confirm those entries remain available and their storage is now the encrypted envelope. Do not create a real plaintext token record merely to test migration; use the automated synthetic-data test instead.

Failure paths such as locked key stores, corrupt records, and failed persistence are covered automatically. If reproducing them manually, use an isolated test profile with synthetic data rather than altering a live vault.

## Troubleshooting

- **Plugin missing:** Confirm you ran `pnpm build`, injected this checkout, fully restarted Discord, and are using desktop Discord rather than a web build.
- **Secure storage unavailable:** Unlock or restore access to the operating system credential store. On Linux, configure a supported keyring instead of using `basic_text`. The plugin will not save plaintext to work around this error.
- **Could not unlock saved accounts:** Return to the original operating system profile and application context and check key-store availability. Do not overwrite the vault with an empty record or share it for diagnosis.
- **Login fails:** Confirm the token is still valid and belongs to your account, or use Discord's normal login. If valid tokens fail after a Discord update, the internal `loginToken` action may need a compatibility update.
- **Native helper unavailable after rebuilding:** Fully exit Discord and relaunch it. If needed, rerun `pnpm inject` against the intended installation after a successful build.
