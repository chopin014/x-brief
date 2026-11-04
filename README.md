# X Brief

A Firefox / Zen extension that turns X’s **For you** feed into finite, scheduled editions. X still chooses and ranks the posts. The extension controls when a batch opens, how much it contains, and when reading ends.

## Daily use

Open `x.com/home` during a reading window and choose **Open edition**. Read one ranked batch with X’s native post rendering, Like, Reply, Bookmark, translation, polls, media controls, and Community Notes where X provides them. A live edition keeps native X feedback and telemetry intact; this project makes no claim about its long-term effect on recommendations.

The first response is capped and stripped of pagination, refresh alerts, ads, and extra recommendation modules **before X receives it**. There is no next batch button. Reaching the end gives a clear **Close edition** action. Closing, exhausting the active time budget, or reaching the 45-minute safety limit locks feed reading until the next scheduled window.

On first use, **Try it now** opens one edition immediately. After it is captured, the schedule applies.

Defaults: **09:00 and 18:00 local time**, a 60-minute window in which to start, at most **20 posts**, and **10 active reading minutes**. Starting near the end of a window still gives the full active-time budget. The timer pauses after 60 seconds without input and when X is hidden or unfocused. Tabs share one budget; the status control only shows a time warning near the end.

Refreshing switches to a **saved copy of the same edition**. It never grants a new batch. In that copy, open a post on X for native interaction. Changes to the reading schedule take effect the next local day after the first successfully captured edition. Failed captures do not consume an edition.

**Keep privately** saves a local copy to the shelf. It does not bookmark, like, or otherwise send feedback to X. The shelf is available between editions, and its posts can be opened on X during an active edition. Posting and private messages remain accessible. One notifications page can load during an active edition; its referenced posts can open as conversations. Other discovery feeds are closed, and author profiles from the edition show their header without an expanding timeline.

## Privacy

No server, account, API key, telemetry backend, or AI service is required. The extension stores only its schedule, the current normalized edition, local saved posts (up to 200), and session state in Firefox’s local extension storage. It does not request cookies, passwords, browsing history, or access to other websites. X’s normal requests and native feedback still go to X. Media and external links connect to their usual hosts when viewed.

## Development

```sh
npm ci
npm test
npm run lint
npm run build
```

The installable artifact is `dist/x-brief-0.1.2.xpi`. For temporary development, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `extension/manifest.json`. Temporary installation ends when the browser exits.

## Persistent local installation in Zen

This checkout includes a local installer for an **existing writable Zen application directory**, such as the per-user application overlay on this machine. It copies the packaged extension into `~/.local/share/x-brief/releases/` and adds a small Firefox AutoConfig resource registration. Firefox’s built-in-addon API loads this one local package at startup for the selected profile. It does not require a developer console after each restart.

```sh
python scripts/install-zen.py \
  --xpi dist/x-brief-0.1.2.xpi \
  --application /home/gabriel/.local/lib/openfdm/zen-private \
  --profile '/home/gabriel/.zen/yugim3sn.Default (release)'
```

Restart that Zen application after installation. The installer preserves a backup and records all integration paths in `~/.local/share/x-brief/installation.json`. It refuses to replace an unrelated AutoConfig. Local startup configuration applies to this application; automatic installation is restricted to the specified profile. A Zen update that replaces its per-user application directory may require running the installer again.

To stop using it, disable **X Brief** in `about:addons`, then remove startup integration:

```sh
python scripts/uninstall-zen.py
```

Restart Zen after running the command. Firefox treats this local package as a built-in extension, so the add-on manager provides **Disable**, rather than an uninstall button. The script removes the startup registration; the release copies and backups remain in `~/.local/share/x-brief` so they can be removed deliberately. Distribution through the public Firefox add-on store would require Mozilla signing; the included local installation is specific to your Zen application.

## Implementation and limits

- Manifest V2, Firefox 128+; persistent background script and Firefox response filters.
- Pure state and parser modules have automated tests, including service-worker fallback redirects, capture failure, shared timing, schedule changes, response pruning, and closed UI behavior.
- The background gate is authoritative. DOM guards hide stale content and alternative feeds.
- Unknown primary timeline schemas fail closed with a retry screen. Future X changes may require an update.
- The saved reader is a recovery view, not an exact reproduction of every native X feature. Sensitive media stays behind X’s native post view.
- Native conversations contain at most 11 post entries and no recognized related-post modules. Pagination is blocked.
- This is a voluntary attention tool. Disabling the extension, changing the device clock, another browser, or another Firefox profile can bypass it.

See [verification notes](docs/verification.md) for observed live behavior and the implementation decisions.
