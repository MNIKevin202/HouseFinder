const { app, dialog, shell } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = "MNIKevin202/HouseFinder";
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE_URL = `https://github.com/${REPO}/releases`;

function parseVersion(version) {
  return String(version || "0.0.0")
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

function isNewerVersion(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

function scoreAsset(asset, platform = process.platform, arch = process.arch) {
  const name = asset.name.toLowerCase();
  if (platform === "win32") return name.endsWith(".exe") && name.includes("setup") ? 10 : 0;
  if (platform === "darwin") {
    if (!name.endsWith(".dmg")) return 0;
    if (arch === "arm64" && name.includes("arm64")) return 10;
    if (arch === "x64" && (name.includes("x64") || name.includes("x86_64"))) return 10;
    return 5;
  }
  return 0;
}

async function checkForUpdates({ silent = false } = {}) {
  const currentVersion = app.getVersion();
  const response = await fetch(RELEASES_URL, {
    headers: {
      "User-Agent": `HouseFinder/${currentVersion}`,
      Accept: "application/vnd.github+json"
    }
  });
  if (response.status === 404) {
    return {
      repo: REPO,
      currentVersion,
      latestVersion: "",
      releaseUrl: RELEASES_PAGE_URL,
      hasUpdate: false,
      assetName: "",
      assetUrl: "",
      setupRequired: true,
      message: "No published GitHub Release was found yet. Publish a version tag such as v0.1.0, then attach the installer assets to that release."
    };
  }
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  const release = await response.json();
  const latestVersion = release.tag_name || release.name;
  const newer = isNewerVersion(latestVersion, currentVersion);
  const asset = (release.assets || [])
    .map((candidate) => ({ candidate, score: scoreAsset(candidate) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.candidate;

  const result = {
    repo: REPO,
    currentVersion,
    latestVersion,
    releaseUrl: release.html_url,
    hasUpdate: newer,
    assetName: asset?.name || "",
    assetUrl: asset?.browser_download_url || ""
  };

  if (!silent && !newer) {
    await dialog.showMessageBox({
      type: "info",
      title: "HouseFinder is up to date",
      message: `HouseFinder ${currentVersion} is the latest installed version.`
    });
  }

  return result;
}

async function downloadAndOpenUpdate(assetUrl, assetName) {
  if (!assetUrl) throw new Error("No installer asset was found for this platform.");
  const response = await fetch(assetUrl);
  if (!response.ok) throw new Error(`Download failed with ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const targetPath = path.join(os.tmpdir(), assetName || "HouseFinder-update-installer");
  fs.writeFileSync(targetPath, buffer);
  const openResult = await shell.openPath(targetPath);
  if (openResult) {
    shell.showItemInFolder(targetPath);
    throw new Error(openResult);
  }
  return targetPath;
}

module.exports = {
  REPO,
  RELEASES_URL,
  RELEASES_PAGE_URL,
  checkForUpdates,
  downloadAndOpenUpdate,
  isNewerVersion,
  scoreAsset
};
