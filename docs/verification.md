# Verification and design decisions

## Observed in logged-in Zen, 2026-11-04

- X requests `HomeTimeline` through Firefox’s service-worker fallback. The same request ID appears in two `onBeforeRequest` callbacks. The first stream filter reports `ServiceWorker fallback redirection`.
- The response contains `TimelineShowAlert`, `TimelineAddEntries`, top/bottom cursor entries, promoted posts, and ordinary post entries.
- A real response normalized successfully. Capping to five produced exactly five native rendered articles, with the native edition overlay hidden and the end control present.
- Scrolling to the bottom showed the same five articles and no loading spinner.
- Reloading showed the exact same five IDs in their original order through the saved reader. It did not grant another edition.
- Opening one saved post produced a native conversation with 11 visible articles. The background strips pagination and recognized related-post modules.
- Closing an edition produced the closed screen and no start action for the consumed slot.

## Persistent installation verified

- The final 0.1.0 package is installed in the main logged-in Zen profile through the per-user Zen application overlay.
- After a full browser exit and fresh launch, AddonManager reported `isActive: true`, `isBuiltin: true`, and `temporarilyInstalled: false`. No manual installation call was made after that launch.
- The successfully captured five-post test edition remained frozen and ended across the restart. Opening Home showed **Between editions** and the next edition at 18:00, with no fresh posts or start action.
- The restored settings were 09:00 / 18:00, 20 posts maximum, 10 active minutes, and a 60-minute start window. The main profile remained signed in to X.
- Zen’s enabled add-on scopes exclude the built-in scope from the optional `maybeInstallBuiltinAddon` helper. The integration therefore explicitly installs this single package when it is absent or its version changes, without changing add-on scopes or signature preferences.
- Automated checks: 29 passing tests; `web-ext lint` reports zero errors, notices, or warnings. The packaged XPI and extracted installed manifest both report version 0.1.0.

The installation record and backups are in `~/.local/share/x-brief/`. User feed fixtures and inspection screenshots are excluded from the project.

## Decisions

Two Opus 5.5 critiques at high effort with fast mode disabled informed the implementation. The first identified trust issues around failed capture, late starts, hard-to-read time pressure, and context loss. The second recommended native-first rendering and a saved recovery view.

The native view retains X’s original rich metadata and interaction controls. Repeated root requests are blocked after capture. The recovery view deliberately avoids replaying an old response over a new network request, since that would ask X to serve a new page that the user never sees.

There are no streaks, reading scores, achievement prompts, or notifications asking the user to return. The finite post batch is the primary boundary; active reading time and the wall-clock safety limit are additional boundaries. A private shelf preserves useful discoveries without adding fresh recommendations between editions.

## Scope of evidence

The normal native event metadata is retained. We have not measured long-term recommendation quality or proved a psychological outcome. A finite briefing can reduce the opportunity to keep consuming; it cannot guarantee that every selected post is valuable or that the user will never bypass the extension.

## 0.1.2 follow-up

- First use now offers a single immediate edition. Only a successfully captured batch consumes that opportunity; subsequent editions use the normal schedule. The earlier developer test edition was cleared from the installed profile.
- Removed taglines and redundant introductory copy from the reader, popup, and settings.
- Notification badge polling is blocked; cached unread badges are hidden, and the browser tab unread count is removed. Notification timelines remain limited to the existing edition gate.
- Installed 0.1.2 in the main Zen profile. Home visibly offers **Try it now**, with the 20-post / 10-minute limits. A representative cached badge inserted into the real notification link computed to `display: none`.
- 31 tests pass; extension validation reports zero errors, notices, or warnings.
