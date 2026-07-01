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
- Optional multi-provider API integration for listing enrichment and API-powered property search while keeping Manual Mode fully functional.
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
- `api-cache/`: monthly provider search and enrichment responses saved locally to avoid repeating the same API request during the same calendar month.

The renderer cannot directly write arbitrary local files. It uses IPC methods exposed by `src/preload/preload.js`, and the Electron main process owns database, backup, restore, export, screenshot, and update operations.

API settings are also local only:

- `settings.json`: API mode, provider enabled states, provider priority, monthly usage limits, current month counters, last test status, last successful request date, and last error messages.
- API keys: stored per provider in `settings.json`, encrypted with Electron `safeStorage` when available.

If Electron `safeStorage` is not available on the user's platform/keychain setup, HouseFinder falls back to local settings storage. That fallback keeps the key out of GitHub and app logs, but it is not cryptographic protection.

## How Multi-Provider API Support Works

Settings includes an API Providers section. Current providers:

- Apillow: fully implemented for API-powered property search and listing URL enrichment.
- RentCast: stub/TODO, disabled by default.
- Realty Mole: stub/TODO, disabled by default.
- Manual Mode / No API: always available.

Each provider has its own enabled toggle, masked API key field, monthly usage limit, usage counter, priority number, test button, reset counter button, and clear key button. API keys are masked by default and can be revealed per provider.

## How Provider Priority And Fallback Work

When API mode is set to automatic fallback, HouseFinder starts with the lowest priority number and uses the first provider that is:

- Enabled.
- Implemented.
- Configured with a saved API key.
- Under its monthly app usage limit.
- Capable of the requested operation.

If that provider is exhausted, unsupported, rate-limited, unavailable, returns an invalid response, or otherwise fails, the provider manager tries the next eligible provider. If no provider succeeds, HouseFinder falls back to Manual Mode and still opens the manual save form or keeps local saved homes usable.

The UI does not choose providers directly. Renderer code calls the provider manager through IPC, and the manager handles selection, capability checks, usage checks, counting, caching, fallback, and user-friendly errors.

## How To Add API Keys

Open Settings in the app and use the API Providers section:

1. Set API Mode to automatic provider fallback, unless you want Manual Mode.
2. Enable the providers you want to use.
3. Paste each provider's API key into its masked key field.
4. Set each provider's monthly usage limit.
5. Set priority order. Lower numbers are tried first.
6. Click Save API Settings.
7. Click Test Connection for implemented providers.

The API key is masked by default. Use Show API Key only when you need to inspect or replace the locally saved key. Use Clear API Key to remove it from local settings.

## How The Monthly API Usage Counter Works

Usage is tracked separately per provider during the current calendar month.

- Each provider counter resets automatically when a new month begins.
- Cached search/enrichment results are reused during the same calendar month and do not increment usage.
- Settings and API Search show an aggregate dashboard for enabled providers: total allowed, total used, total left, and enabled provider count.
- Missing API key checks, disabled provider checks, unsupported operation checks, and locally blocked monthly-limit checks are not counted.
- Requests actually sent to a provider are counted, including requests that return no results, API errors, or network failures.
- Settings displays usage like `Apillow: 23 / 100 used`.
- At 80% of a provider's monthly limit, HouseFinder shows a warning.
- At 95% or exhausted, HouseFinder shows a stronger warning.
- When one provider reaches its monthly limit, it is skipped and the next eligible provider is tried.
- Manual Mode, saved homes, manual editing, exports, backups, and local browsing continue to work when the API limit is reached.

## How To Test The Apillow Connection

In Settings, click Test Connection on an implemented provider. For Apillow, HouseFinder sends a small property request through the provider manager and polls for completion. This validates the saved API key and updates Apillow usage because the request is actually sent. RentCast and Realty Mole currently report that they are stubs/TODOs.

## Apillow Provider Abstraction

The reusable API layer lives in:

- `src/main/apiService.js`: provider manager, fallback order, capability checks, Apillow client, RentCast/Realty Mole stubs, request/polling flow, error mapping, search payload creation, and Apillow-to-HouseFinder result normalization.
- `src/main/settingsStore.js`: provider settings, secure/local API key storage, per-provider monthly counter reset, monthly limit checks, request counting, priority, and status metadata.
- `src/main/apiCache.js`: monthly provider response cache keyed by provider, operation, request payload, and month.
- `src/main/main.js`: IPC wiring for settings, connection tests, search, and enrichment.
- `src/preload/preload.js`: safe renderer-facing API methods.
- `src/renderer/app.js`: multi-provider Settings UI, API Search page, API status indicators, and Save Current Listing enrichment fallback.
- `src/renderer/styles/app.css`: API search/settings UI and usage warning styles.

Future providers can be added by implementing another provider class in `apiService.js`, declaring capabilities in `settingsStore.js`, registering it in `ApiProviderManager`, and mapping its response fields into HouseFinder's saved-home shape.

## Apillow Integration Limitations

- HouseFinder does not hardcode or ship any Apillow API key.
- API providers are used only for enrichment and search. Saved homes remain local in SQLite.
- Provider search and listing-enrichment responses are cached locally by month using a hash of provider, operation, request payload, and month.
- The Apillow client uses the documented async flow: `POST /v1/properties`, then poll `GET /v1/results/{job_id}`.
- Search currently supports city/state/ZIP, min/max price, beds, baths, and property type. If Apillow changes accepted filter names, the provider mapping may need an update.
- Enrichment by URL falls back to the manual save form whenever all providers are disabled, missing keys, capped by monthly limits, unsupported, unavailable, or return no details.
- Test Connection consumes real provider request usage for implemented providers because it verifies the key with a real API request.
- RentCast and Realty Mole are present as disabled-by-default stubs. Their API request/response mapping still needs implementation.

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
