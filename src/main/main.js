const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { HouseFinderDatabase } = require("./database");
const { checkForUpdates, downloadAndOpenUpdate, REPO, RELEASES_URL, RELEASES_PAGE_URL } = require("./updater");
const { SettingsStore } = require("./settingsStore");
const { ApiProviderRegistry } = require("./apiService");

let mainWindow;
let store;
let settingsStore;
let apiRegistry;

const releaseNotesSummary = [
  "Push version tags like v0.1.0 to publish update releases.",
  "GitHub Releases are the updater feed; GitHub Actions artifacts are only build checks.",
  "Windows installers are built by GitHub Actions; macOS DMG/zip are usually built locally on the signing Mac.",
  "Asset names are expected to follow HouseFinder-Setup-${version}-${arch}.exe and HouseFinder-${version}-${arch}.dmg."
];

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    title: "HouseFinder",
    backgroundColor: "#111318",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  });

  await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

function registerIpc() {
  ipcMain.handle("homes:list", (_event, filters) => store.listHomes(filters));
  ipcMain.handle("homes:get", (_event, id) => {
    const home = store.markViewed(id);
    if (!home) throw new Error("Home not found.");
    return home;
  });
  ipcMain.handle("homes:save", (_event, home) => store.saveHome(home));
  ipcMain.handle("homes:update", (_event, id, home) => store.updateHome(id, home));
  ipcMain.handle("homes:delete", async (_event, id) => {
    const response = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["Delete", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      title: "Delete saved home?",
      message: "This removes the saved home from your local database."
    });
    if (response.response !== 0) return false;
    return store.deleteHome(id);
  });
  ipcMain.handle("homes:dashboard", () => store.dashboard());
  ipcMain.handle("app:metadata", () => ({
    version: app.getVersion(),
    userDataPath: app.getPath("userData"),
    databasePath: store.dbPath,
    screenshotsPath: store.screenshotDir,
    settingsPath: settingsStore.settingsPath,
    repo: REPO,
    releasesUrl: RELEASES_URL,
    releasesPageUrl: RELEASES_PAGE_URL,
    releaseNotesSummary
  }));
  ipcMain.handle("settings:get-api", () => settingsStore.getPublicSettings());
  ipcMain.handle("settings:get-apillow-key", () => settingsStore.getApillowApiKey());
  ipcMain.handle("settings:save-api", (_event, settings) => settingsStore.updateApiSettings(settings));
  ipcMain.handle("settings:clear-apillow-key", () => settingsStore.clearApiKey());
  ipcMain.handle("settings:reset-api-usage", () => settingsStore.resetUsageCounter());
  ipcMain.handle("api:test-connection", () => apiRegistry.testConnection());
  ipcMain.handle("api:search-homes", (_event, criteria) => apiRegistry.searchHomes(criteria));
  ipcMain.handle("api:enrich-listing", (_event, url) => apiRegistry.enrichListing(url));
  ipcMain.handle("screenshots:save", (_event, dataUrl) => saveScreenshot(dataUrl));
  ipcMain.handle("data:export-json", () => exportData("json"));
  ipcMain.handle("data:export-csv", () => exportData("csv"));
  ipcMain.handle("data:import-json", () => importJson());
  ipcMain.handle("data:backup", () => backupDatabase());
  ipcMain.handle("data:restore", () => restoreDatabase());
  ipcMain.handle("data:reset", () => resetDatabase());
  ipcMain.handle("updates:check", (_event, options) => checkForUpdates(options));
  ipcMain.handle("updates:download-open", (_event, assetUrl, assetName) => downloadAndOpenUpdate(assetUrl, assetName));
  ipcMain.handle("shell:open-path", (_event, targetPath) => shell.openPath(targetPath));
  ipcMain.handle("shell:show-item", (_event, targetPath) => shell.showItemInFolder(targetPath));
  ipcMain.handle("shell:open-external", (_event, url) => shell.openExternal(url));
}

function saveScreenshot(dataUrl) {
  if (!dataUrl || !dataUrl.startsWith("data:image/png;base64,")) {
    throw new Error("Screenshot data was not a PNG data URL.");
  }
  fs.mkdirSync(store.screenshotDir, { recursive: true });
  const fileName = `listing-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  const targetPath = path.join(store.screenshotDir, fileName);
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  fs.writeFileSync(targetPath, Buffer.from(base64, "base64"));
  return targetPath;
}

async function exportData(type) {
  const filters = type === "json" ? [{ name: "JSON", extensions: ["json"] }] : [{ name: "CSV", extensions: ["csv"] }];
  const result = await dialog.showSaveDialog(mainWindow, {
    title: `Export HouseFinder ${type.toUpperCase()}`,
    defaultPath: `housefinder-export.${type}`,
    filters
  });
  if (result.canceled || !result.filePath) return null;
  const contents = type === "json" ? store.exportJson() : store.exportCsv();
  fs.writeFileSync(result.filePath, contents, "utf8");
  return result.filePath;
}

async function importJson() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Import HouseFinder JSON",
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (result.canceled || !result.filePaths[0]) return 0;
  const parsed = JSON.parse(fs.readFileSync(result.filePaths[0], "utf8"));
  const homes = Array.isArray(parsed) ? parsed : parsed.homes;
  if (!Array.isArray(homes)) throw new Error("JSON file must contain a homes array.");
  return store.importHomes(homes);
}

async function backupDatabase() {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Back up HouseFinder database",
    defaultPath: "housefinder-backup.sqlite",
    filters: [{ name: "SQLite Database", extensions: ["sqlite"] }]
  });
  if (result.canceled || !result.filePath) return null;
  fs.copyFileSync(store.dbPath, result.filePath);
  return result.filePath;
}

async function restoreDatabase() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Restore HouseFinder database",
    properties: ["openFile"],
    filters: [{ name: "SQLite Database", extensions: ["sqlite", "db"] }]
  });
  if (result.canceled || !result.filePaths[0]) return false;
  const confirm = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: ["Restore", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: "Replace local database?",
    message: "This will replace the current HouseFinder database with the selected backup."
  });
  if (confirm.response !== 0) return false;
  store.replaceDatabaseFrom(result.filePaths[0]);
  return true;
}

async function resetDatabase() {
  const confirm = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: ["Reset Local Data", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: "Reset all local data?",
    message: "This permanently removes saved homes from this computer."
  });
  if (confirm.response !== 0) return false;
  store.reset();
  return true;
}

app.whenReady().then(async () => {
  store = new HouseFinderDatabase({ appDataDir: app.getPath("userData") });
  await store.init();
  settingsStore = new SettingsStore({ appDataDir: app.getPath("userData") });
  settingsStore.init();
  apiRegistry = new ApiProviderRegistry({ settingsStore });
  registerIpc();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
