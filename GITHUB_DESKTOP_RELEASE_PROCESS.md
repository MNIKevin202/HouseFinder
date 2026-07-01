# GitHub Desktop App Release And Auto-Update Process

This guide explains the preferred release process for an Electron desktop app that publishes installers through GitHub Releases and supports in-app update checks.

It is written generically so it can be reused across projects. Replace placeholders like `APP_NAME`, `OWNER/REPO`, `X.Y.Z`, and package script names with the real values for the app being worked on.

## Goal

The release system should do four things:

- Build a Windows `.exe` installer.
- Build a macOS `.dmg` installer, usually on the Mac that has the Apple signing identity.
- Publish those installers as assets on a GitHub Release.
- Let the app check GitHub Releases for newer versions and download the right installer for the user's operating system.

GitHub Actions artifacts are useful for testing build output, but they are not the update source. The update source should be GitHub Releases.

## Normal Shape Of The System

The app version lives in `package.json`.

The release version should be a git tag that matches that package version:

```text
package.json version: 1.2.3
git tag:              v1.2.3
GitHub Release:       v1.2.3
```

When a version tag is pushed, GitHub Actions should create or update the GitHub Release and upload release assets.

The app should check the latest GitHub Release, compare the latest tag against its installed version, and offer to download the right installer if the release is newer.

## Recommended Asset Names

Use predictable installer filenames. The updater should be able to find assets by platform and version.

Recommended examples:

```text
APP_NAME-Setup-X.Y.Z-x64.exe
APP_NAME-X.Y.Z-arm64.dmg
APP_NAME-X.Y.Z-arm64-mac.zip
```

The exact names can vary, but they must stay consistent between:

- `electron-builder` config.
- GitHub Actions upload steps.
- The app's update-checking code.
- Any release documentation.

## Package Scripts

The project should usually have scripts like these:

```json
{
  "scripts": {
    "start": "electron .",
    "dist:mac": "electron-builder --mac dmg zip --publish never",
    "dist:win": "electron-builder --win nsis --publish never"
  }
}
```

Use the repo's existing scripts if they already exist. Do not invent a second release path unless the existing path is broken.

## Electron Builder Basics

The Electron Builder config should define:

- `productName`
- `appId`
- macOS targets: `dmg` and usually `zip`
- Windows target: `nsis`
- stable artifact names
- icons for both platforms

Generic example:

```json
{
  "build": {
    "appId": "com.example.appname",
    "productName": "APP_NAME",
    "mac": {
      "target": ["dmg", "zip"],
      "hardenedRuntime": true
    },
    "dmg": {
      "artifactName": "APP_NAME-${version}-${arch}.${ext}"
    },
    "win": {
      "target": ["nsis"]
    },
    "nsis": {
      "oneClick": false,
      "perMachine": false,
      "allowToChangeInstallationDirectory": true,
      "artifactName": "APP_NAME-Setup-${version}-${arch}.${ext}"
    }
  }
}
```

## Why Mac Builds Are Often Local

Windows installers can usually be built on GitHub's `windows-latest` runner.

macOS installers are different because signing and notarization depend on Apple credentials. If the developer's Apple Developer ID certificate is only on their Mac, GitHub cannot produce the same trusted DMG unless the signing certificate and notarization credentials are securely configured in GitHub Actions secrets.

The preferred simple setup is:

1. GitHub Actions creates the release and builds/uploads the Windows `.exe`.
2. The developer builds the macOS `.dmg` and `.zip` locally on the signing Mac.
3. The developer uploads those local Mac assets to the same GitHub Release.

This avoids accidentally publishing an unsigned or wrongly signed Mac build.

## GitHub Actions: Build Test Workflow

Use one workflow for regular build checks on pushes, pull requests, or manual runs. This proves the Windows installer can be built without publishing it as an update.

Example:

```yaml
name: Build Installers

on:
  push:
    branches:
      - main
  pull_request:
  workflow_dispatch:

jobs:
  windows:
    name: Build Windows EXE
    runs-on: windows-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build EXE
        run: npm run dist:win
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: false

      - name: Upload Windows artifacts
        uses: actions/upload-artifact@v4
        with:
          name: windows-installer
          path: dist/*.exe
          if-no-files-found: error
```

These artifacts are for inspection and testing only. They are not what the app should check for updates.

## GitHub Actions: Release Workflow

Use a separate workflow that runs only on version tags.

Example:

```yaml
name: Release Installers

on:
  push:
    tags:
      - "v*"

permissions:
  contents: write

jobs:
  create-release:
    name: Create GitHub Release
    runs-on: ubuntu-latest
    steps:
      - name: Create release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh release create "${GITHUB_REF_NAME}" \
            --repo "${GITHUB_REPOSITORY}" \
            --title "APP_NAME ${GITHUB_REF_NAME}" \
            --notes "APP_NAME ${GITHUB_REF_NAME} desktop installers."

  windows:
    name: Release Windows EXE
    runs-on: windows-latest
    needs: create-release
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build EXE
        run: npm run dist:win
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: false

      - name: Upload release assets
        env:
          GH_TOKEN: ${{ github.token }}
        run: Get-ChildItem dist -Filter *.exe | ForEach-Object { gh release upload $env:GITHUB_REF_NAME $_.FullName --clobber }
```

If macOS signing and notarization are configured in GitHub Actions secrets, a macOS job can be added. If not, keep Mac builds local and upload the DMG manually.

## Publishing A New Version

From the repo folder, first make sure the working tree is clean:

```bash
git status --short
```

Bump the version:

```bash
npm version patch
```

Use `npm version minor` or `npm version major` for larger releases.

`npm version` updates `package.json` and `package-lock.json`, creates a commit, and creates a git tag like `vX.Y.Z`.

Push the version commit:

```bash
git push
```

Push the tag:

```bash
git push origin vX.Y.Z
```

Or push all tags:

```bash
git push --tags
```

After the tag is pushed, the release workflow should create the GitHub Release and upload the Windows `.exe`.

## Building And Uploading The Mac DMG Locally

After pushing the tag, build the Mac installer on the Mac that has the signing identity:

```bash
npm run dist:mac
```

Then upload the Mac assets to the same GitHub Release:

```bash
gh release upload vX.Y.Z \
  dist/APP_NAME-X.Y.Z-arm64.dmg \
  dist/APP_NAME-X.Y.Z-arm64-mac.zip \
  --repo OWNER/REPO \
  --clobber
```

If the app also ships Intel Mac builds, upload those too. Keep the updater's asset selection logic in sync with the asset names.

## Verifying The Release

Open the release page:

```bash
gh release view vX.Y.Z --repo OWNER/REPO --web
```

Inspect release assets:

```bash
gh release view vX.Y.Z --repo OWNER/REPO --json assets,url
```

The release should include the expected installers, for example:

```text
APP_NAME-Setup-X.Y.Z-x64.exe
APP_NAME-X.Y.Z-arm64.dmg
APP_NAME-X.Y.Z-arm64-mac.zip
```

Check recent workflow runs:

```bash
gh run list --repo OWNER/REPO --limit 5
```

Watch a release workflow run:

```bash
gh run watch RUN_ID --repo OWNER/REPO --exit-status
```

## How The In-App Updater Should Work

The app should check:

```text
https://api.github.com/repos/OWNER/REPO/releases/latest
```

Then it should:

1. Read the latest release tag, such as `v1.2.3`.
2. Compare that version against the installed app version from `package.json` or the app runtime metadata.
3. If the latest release is newer, inspect the release assets.
4. Pick the correct asset for the current OS and CPU architecture.
5. Download the installer to a temporary folder.
6. Ask the OS to open the downloaded installer.
7. If opening fails, reveal the downloaded installer in Finder or Explorer.

The app should not update from GitHub Actions artifacts. Actions artifacts expire and are not the public release channel.

## Platform Asset Selection

Typical updater behavior:

- Windows should look for a `.exe`, often with `Setup` in the filename.
- Apple Silicon macOS should look for an `arm64.dmg`.
- Intel macOS should look for an `x64.dmg`, if Intel builds are shipped.

The updater should be tolerant about small filename differences, but it should not accidentally download the wrong platform's installer.

## Mac Signing And Notarization Notes

A signed local Mac build is better than an unsigned build, but modern macOS usually also expects notarization for a smooth downloaded-app experience.

Without proper Developer ID signing and notarization, users may see warnings such as:

```text
"APP_NAME" is damaged and can't be opened.
```

The long-term fix is:

- Apple Developer ID Application certificate.
- Hardened runtime enabled.
- Correct entitlements.
- Notarization with Apple.
- Stapling the notarization ticket where appropriate.

For local testing only, a developer can remove quarantine after copying the app to Applications:

```bash
xattr -dr com.apple.quarantine /Applications/APP_NAME.app
```

Do not present that command as the normal customer install path. It is only a local testing workaround.

## Windows Signing Notes

The Windows `.exe` can be built unsigned, but users may see SmartScreen warnings until the app has code signing and reputation.

The long-term polished Windows release setup is:

- Windows code signing certificate.
- Signing configured in the release workflow.
- Installer assets uploaded to GitHub Releases after signing.

If there is no Windows signing certificate yet, disable accidental certificate autodiscovery in CI:

```yaml
env:
  CSC_IDENTITY_AUTO_DISCOVERY: false
```

## Important Rules For Future AI Agents

- Use the repo's existing package manager and build scripts first.
- Keep version, git tag, release title, and uploaded asset names consistent.
- Do not treat GitHub Actions artifacts as the updater feed.
- Publish update installers through GitHub Releases.
- Build Windows on GitHub Actions unless the repo has a better reason not to.
- Build macOS locally when the signing identity is only on the developer's Mac.
- Only move macOS builds fully into GitHub Actions after signing and notarization secrets are deliberately configured.
- Make the updater select installer assets by platform and architecture.
- Verify the final GitHub Release actually contains the `.exe`, `.dmg`, and any `.zip` assets the updater expects.
- Do not commit private platform folders, local credentials, signing certificates, or secrets.

## Minimal Release Checklist

Use this checklist when publishing:

```text
[ ] Working tree is clean.
[ ] Version bumped with npm version patch/minor/major.
[ ] Version commit pushed.
[ ] Version tag pushed.
[ ] GitHub release workflow completed successfully.
[ ] Windows .exe is attached to the GitHub Release.
[ ] Mac DMG/zip built locally on the signing Mac.
[ ] Mac DMG/zip uploaded to the same GitHub Release.
[ ] Release assets match the updater's expected filenames.
[ ] A currently installed older app can detect the new release.
[ ] The downloaded installer opens, or failure reveals it in Finder/Explorer.
```
