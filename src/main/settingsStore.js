const fs = require("fs");
const path = require("path");
const { safeStorage } = require("electron");

const DEFAULT_SETTINGS = {
  apiProvider: "manual",
  apillowApiKey: "",
  apillowApiKeyEncrypted: false,
  monthlyUsageLimit: 50,
  usageMonth: currentMonth(),
  usageCount: 0
};

function currentMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

class SettingsStore {
  constructor({ appDataDir }) {
    this.settingsPath = path.join(appDataDir, "settings.json");
    this.settings = { ...DEFAULT_SETTINGS };
  }

  init() {
    if (fs.existsSync(this.settingsPath)) {
      const parsed = JSON.parse(fs.readFileSync(this.settingsPath, "utf8"));
      this.settings = { ...DEFAULT_SETTINGS, ...parsed };
    }
    this.resetUsageIfNeeded();
    this.persist();
  }

  getPublicSettings() {
    this.resetUsageIfNeeded();
    const limit = Number(this.settings.monthlyUsageLimit) || 0;
    const count = Number(this.settings.usageCount) || 0;
    return {
      apiProvider: this.settings.apiProvider,
      monthlyUsageLimit: limit,
      usageMonth: this.settings.usageMonth,
      usageCount: count,
      hasApillowApiKey: Boolean(this.getApillowApiKey()),
      usageLabel: `${count} / ${limit || "unlimited"} requests used this month`,
      usageWarning: usageWarning(count, limit),
      secureStorage: safeStorage.isEncryptionAvailable()
    };
  }

  getApillowApiKey() {
    const value = this.settings.apillowApiKey || "";
    if (!value) return "";
    if (!this.settings.apillowApiKeyEncrypted) return value;
    try {
      return safeStorage.decryptString(Buffer.from(value, "base64"));
    } catch {
      return "";
    }
  }

  updateApiSettings(input = {}) {
    const nextProvider = input.apiProvider === "apillow" ? "apillow" : "manual";
    this.settings.apiProvider = nextProvider;
    this.settings.monthlyUsageLimit = Math.max(0, Number(input.monthlyUsageLimit) || 0);
    if (Object.prototype.hasOwnProperty.call(input, "apillowApiKey")) {
      const key = String(input.apillowApiKey || "").trim();
      if (key) this.settings.apillowApiKey = this.encodeSecret(key);
      this.settings.apillowApiKeyEncrypted = key ? safeStorage.isEncryptionAvailable() : this.settings.apillowApiKeyEncrypted;
    }
    this.resetUsageIfNeeded();
    this.persist();
    return this.getPublicSettings();
  }

  clearApiKey() {
    this.settings.apillowApiKey = "";
    this.settings.apillowApiKeyEncrypted = false;
    this.persist();
    return this.getPublicSettings();
  }

  resetUsageCounter() {
    this.settings.usageMonth = currentMonth();
    this.settings.usageCount = 0;
    this.persist();
    return this.getPublicSettings();
  }

  canSendApillowRequest() {
    this.resetUsageIfNeeded();
    if (this.settings.apiProvider !== "apillow") {
      return { ok: false, code: "manual_mode", message: "Manual Mode is enabled." };
    }
    if (!this.getApillowApiKey()) {
      return { ok: false, code: "missing_api_key", message: "Add your Apillow API key in Settings first." };
    }
    const limit = Number(this.settings.monthlyUsageLimit) || 0;
    const count = Number(this.settings.usageCount) || 0;
    if (limit > 0 && count >= limit) {
      return {
        ok: false,
        code: "monthly_limit_reached",
        message: "Monthly API limit reached. Increase your limit in Settings or switch to Manual Mode."
      };
    }
    return { ok: true };
  }

  noteApillowRequestSent() {
    this.resetUsageIfNeeded();
    this.settings.usageCount = (Number(this.settings.usageCount) || 0) + 1;
    this.persist();
    return this.getPublicSettings();
  }

  resetUsageIfNeeded() {
    const month = currentMonth();
    if (this.settings.usageMonth !== month) {
      this.settings.usageMonth = month;
      this.settings.usageCount = 0;
    }
  }

  encodeSecret(secret) {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(secret).toString("base64");
    }
    // Electron safeStorage can be unavailable on some Linux/desktop keychain setups.
    // In that case this local-only app falls back to settings.json so the key never
    // enters source control, but it is not cryptographic protection.
    return secret;
  }

  persist() {
    fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
    fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
  }
}

function usageWarning(count, limit) {
  if (!limit) return "";
  const ratio = count / limit;
  if (ratio >= 0.95) return "critical";
  if (ratio >= 0.8) return "warning";
  return "";
}

module.exports = { SettingsStore, currentMonth, usageWarning };
