const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("housefinder", {
  homes: {
    list: (filters) => ipcRenderer.invoke("homes:list", filters),
    get: (id) => ipcRenderer.invoke("homes:get", id),
    save: (home) => ipcRenderer.invoke("homes:save", home),
    update: (id, home) => ipcRenderer.invoke("homes:update", id, home),
    delete: (id) => ipcRenderer.invoke("homes:delete", id),
    dashboard: () => ipcRenderer.invoke("homes:dashboard")
  },
  screenshots: {
    save: (dataUrl) => ipcRenderer.invoke("screenshots:save", dataUrl)
  },
  data: {
    exportJson: () => ipcRenderer.invoke("data:export-json"),
    exportCsv: () => ipcRenderer.invoke("data:export-csv"),
    importJson: () => ipcRenderer.invoke("data:import-json"),
    backup: () => ipcRenderer.invoke("data:backup"),
    restore: () => ipcRenderer.invoke("data:restore"),
    reset: () => ipcRenderer.invoke("data:reset")
  },
  settings: {
    getApi: () => ipcRenderer.invoke("settings:get-api"),
    getProviderKey: (providerId) => ipcRenderer.invoke("settings:get-provider-key", providerId),
    saveApi: (settings) => ipcRenderer.invoke("settings:save-api", settings),
    clearProviderKey: (providerId) => ipcRenderer.invoke("settings:clear-provider-key", providerId),
    resetApiUsage: (providerId) => ipcRenderer.invoke("settings:reset-api-usage", providerId)
  },
  realEstateApi: {
    testConnection: (providerId) => ipcRenderer.invoke("api:test-connection", providerId),
    searchHomes: (criteria) => ipcRenderer.invoke("api:search-homes", criteria),
    enrichListing: (url) => ipcRenderer.invoke("api:enrich-listing", url)
  },
  updates: {
    check: (options) => ipcRenderer.invoke("updates:check", options),
    downloadAndOpen: (assetUrl, assetName) => ipcRenderer.invoke("updates:download-open", assetUrl, assetName)
  },
  shell: {
    openPath: (targetPath) => ipcRenderer.invoke("shell:open-path", targetPath),
    showItem: (targetPath) => ipcRenderer.invoke("shell:show-item", targetPath),
    openExternal: (url) => ipcRenderer.invoke("shell:open-external", url)
  },
  app: {
    metadata: () => ipcRenderer.invoke("app:metadata")
  }
});
