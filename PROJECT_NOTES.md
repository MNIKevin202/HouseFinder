# HouseFinder Project Notes

## What Was Built

HouseFinder is a local-first Electron desktop application for macOS and Windows. It includes:

- Dark desktop app shell with Dashboard, Browse, Saved Homes, Compare, Calculator, and Settings.
- Built-in `webview` browser for Zillow and other real estate websites.
- Save Current Listing flow that captures the current URL, detects the source website, attempts a page title hint, always opens a manual edit form, and saves locally.
- Local SQLite database using `sql.js`, written to Electron's user data folder as `housefinder.sqlite`.
- Saved home fields for listing details, pricing, beds/baths/square footage, HOA/taxes/payment estimates, notes, tags, dates, screenshots, research fields, FHA notes, favorites, and status.
- Manual editing for every saved field.
- Local screenshot support when Electron can capture the current webview page.
- Saved homes search/filter/sort, favorites, archive/rejected status, side-by-side comparison, dashboard summaries, JSON import, JSON/CSV export, database backup/restore, reset with confirmation, and a standalone affordability calculator.
- Optional Apillow API integration for listing enrichment and API-powered property search while keeping Manual Mode fully functional.
- GitHub Release based update-checking code for `MNIKevin202/HouseFinder`.
- GitHub Actions workflows for Windows build checks and tag-based release publishing.

## How To Run The App

Install dependencies:

```bash
npm install
```

Run HouseFinder in development:

```bash
npm start
```

Run the syntax checks:

```bash
npm run lint
```

## How Local Storage Works

All user data stays on the user's computer. There is no login, cloud database, or backend.

Electron stores data in the app user data directory:

- macOS: usually `~/Library/Application Support/HouseFinder`
- Windows: usually `%APPDATA%/HouseFinder`

The main local files are:

- `housefinder.sqlite`: local SQLite database.
- `screenshots/`: local PNG snapshots captured from the built-in browser.
- `api-cache/`: monthly Apillow search and enrichment responses saved locally to avoid repeating the same API request during the same calendar month.

The renderer cannot directly write arbitrary local files. It uses IPC methods exposed by `src/preload/preload.js`, and the Electron main process owns database, backup, restore, export, screenshot, and update operations.

API settings are also local only:

- `settings.json`: API provider, monthly usage limit, current month, and usage counter.
- Apillow API key: stored in `settings.json`, encrypted with Electron `safeStorage` when available.

If Electron `safeStorage` is not available on the user's platform/keychain setup, HouseFinder falls back to local settings storage. That fallback keeps the key out of GitHub and app logs, but it is not cryptographic protection.

## How To Add The Apillow API Key

Open Settings in the app and use the API settings section:

1. Set API Provider to `Apillow`.
2. Paste the Apillow API key into the masked API key field.
3. Enter a Monthly API Usage Limit.
4. Click Save API Settings.
5. Click Test Connection to verify the key.

The API key is masked by default. Use Show API Key only when you need to inspect or replace the locally saved key. Use Clear API Key to remove it from local settings.

## How The Monthly API Usage Counter Works

The usage counter tracks Apillow API requests sent by HouseFinder during the current calendar month.

- The counter resets automatically when a new month begins.
- Cached Apillow search/enrichment results are reused during the same calendar month and do not increment the usage counter.
- Missing API key checks and locally blocked monthly-limit checks are not counted.
- Requests that are actually sent to Apillow are counted, including requests that return no results, API errors, or network failures.
- Settings displays usage like `23 / 100 requests used this month`.
- At 80% of the monthly limit, HouseFinder shows a warning.
- At 95% of the monthly limit, HouseFinder shows a stronger warning.
- When the monthly limit is reached, Apillow requests are blocked with: `Monthly API limit reached. Increase your limit in Settings or switch to Manual Mode.`
- Manual Mode, saved homes, manual editing, exports, backups, and local browsing continue to work when the API limit is reached.

## How To Test The Apillow Connection

In Settings, click Test Connection. HouseFinder sends a small Apillow property request through the provider layer and polls for completion. This validates the saved API key and updates the monthly usage counter because the request is actually sent to Apillow.

## Apillow Provider Abstraction

The reusable API layer lives in:

- `src/main/apiService.js`: provider registry, Apillow client, request/polling flow, error mapping, search payload creation, and Apillow-to-HouseFinder result normalization.
- `src/main/settingsStore.js`: local API settings, secure/local API key storage, monthly counter reset, monthly limit checks, and request counting.
- `src/main/main.js`: IPC wiring for settings, connection tests, search, and enrichment.
- `src/preload/preload.js`: safe renderer-facing API methods.
- `src/renderer/app.js`: API Settings UI, API Search page, and Save Current Listing enrichment fallback.
- `src/renderer/styles/app.css`: API search/settings UI and usage warning styles.

Future providers can be added by implementing another provider class in `apiService.js`, registering it in `ApiProviderRegistry`, and adding a provider option in Settings.

## Apillow Integration Limitations

- HouseFinder does not hardcode or ship any Apillow API key.
- Apillow is used only for enrichment and search. Saved homes remain local in SQLite.
- Apillow search and listing-enrichment responses are cached locally by month using a hash of the request payload. The same search or listing URL within the same month is loaded from `api-cache/` instead of calling Apillow again.
- The Apillow client uses the documented async flow: `POST /v1/properties`, then poll `GET /v1/results/{job_id}`.
- Search currently supports city/state/ZIP, min/max price, beds, baths, and property type. If Apillow changes accepted filter names, the provider mapping may need an update.
- Enrichment by URL falls back to the manual save form whenever Apillow is disabled, missing a key, capped by the monthly limit, unavailable, or returns no details.
- Test Connection consumes real Apillow request usage because it verifies the key with a real API request.

## How To Package For macOS And Windows

The package scripts follow `GITHUB_DESKTOP_RELEASE_PROCESS.md`.

Build macOS DMG and zip locally:

```bash
npm run dist:mac
```

Build Windows NSIS installer:

```bash
npm run dist:win
```

Expected release asset names:

```text
HouseFinder-Setup-X.Y.Z-x64.exe
HouseFinder-X.Y.Z-arm64.dmg
HouseFinder-X.Y.Z-arm64-mac.zip
```

The exact generated architecture depends on the machine or CI runner used.

## How GitHub Pushing Works

The intended GitHub repository is:

```text
https://github.com/MNIKevin202/HouseFinder
```

Recommended first setup from this folder:

```bash
git init
git remote add origin https://github.com/MNIKevin202/HouseFinder.git
git add .
git commit -m "Initial HouseFinder desktop app"
git branch -M main
git push -u origin main
```

For releases, keep the package version, git tag, and GitHub Release aligned:

```bash
npm version patch
git push
git push origin vX.Y.Z
```

Pushing a `v*` tag runs `.github/workflows/release-installers.yml`, creates the GitHub Release, builds the Windows installer, and uploads the `.exe`.

## How Auto-Updating Works

The updater checks:

```text
https://api.github.com/repos/MNIKevin202/HouseFinder/releases/latest
```

It compares the latest release tag, such as `v0.1.1`, with the installed app version from Electron metadata. If the release is newer, it picks a platform installer asset:

- Windows: `.exe` with `Setup` in the filename.
- macOS Apple Silicon: `arm64.dmg`.
- macOS Intel: `x64.dmg` or `x86_64.dmg`.

When the user chooses to download an update, HouseFinder downloads the installer to a temporary folder and asks the operating system to open it. If opening fails, it reveals the downloaded installer in Finder or Explorer.

GitHub Actions artifacts are not used as the update feed. The update feed is GitHub Releases.

If the repository has no published GitHub Release yet, GitHub returns 404 for `/releases/latest`. HouseFinder now treats that as a setup state instead of a broken network error and shows a message that the first version tag/release still needs to be published.

## Remaining TODOs

- Add polished app icons for macOS and Windows.
- Add optional safe extraction helpers for visible listing details only when sites allow it.
- Add CSV import if needed.
- Add richer screenshot gallery support per home instead of one screenshot path.
- Add validation and formatting for currency and numeric fields.
- Add signed and notarized macOS release configuration when Apple Developer credentials are available.
- Add Windows code signing when a certificate is available.
- Add automated renderer/UI tests.
