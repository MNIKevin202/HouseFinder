const fs = require("fs");
const path = require("path");
const { safeStorage } = require("electron");

const PROVIDER_DEFINITIONS = [
  {
    id: "apillow",
    name: "Apillow",
    implemented: true,
    defaultEnabled: false,
    defaultLimit: 50,
    capabilities: {
      propertySearch: true,
      listingDetails: true,
      addressLookup: true,
      homeValueEstimate: true,
      rentEstimate: true,
      comparableProperties: true,
      photos: true
    }
  },
  {
    id: "rentcast",
    name: "RentCast",
    implemented: false,
    defaultEnabled: false,
    defaultLimit: 50,
    capabilities: {
      propertySearch: false,
      listingDetails: false,
      addressLookup: false,
      homeValueEstimate: false,
      rentEstimate: false,
      comparableProperties: false,
      photos: false
    }
  },
  {
    id: "realtyMole",
    name: "Realty Mole",
    implemented: false,
    defaultEnabled: false,
    defaultLimit: 100,
    capabilities: {
      propertySearch: false,
      listingDetails: false,
      addressLookup: false,
      homeValueEstimate: false,
      rentEstimate: false,
      comparableProperties: false,
      photos: false
    }
  }
];

const DEFAULT_SETTINGS = {
  apiProvider: "auto",
  providers: Object.fromEntries(PROVIDER_DEFINITIONS.map((definition, index) => [
    definition.id,
    defaultProviderSettings(definition, index)
  ]))
};

function currentMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

class SettingsStore {
  constructor({ appDataDir }) {
    this.settingsPath = path.join(appDataDir, "settings.json");
    this.settings = clone(DEFAULT_SETTINGS);
  }

  init() {
    if (fs.existsSync(this.settingsPath)) {
      const parsed = JSON.parse(fs.readFileSync(this.settingsPath, "utf8"));
      this.settings = this.normalizeSettings(parsed);
    } else {
      this.settings = clone(DEFAULT_SETTINGS);
    }
    this.resetUsageIfNeeded();
    this.persist();
  }

  normalizeSettings(input = {}) {
    const migrated = {
      apiProvider: input.apiProvider === "manual" ? "manual" : "auto",
      providers: clone(DEFAULT_SETTINGS.providers)
    };

    for (const definition of PROVIDER_DEFINITIONS) {
      const existing = input.providers?.[definition.id] || {};
      migrated.providers[definition.id] = {
        ...migrated.providers[definition.id],
        ...existing,
        id: definition.id
      };
    }

    // Migrate the original single-provider Apillow settings forward.
    if (!input.providers && (input.apillowApiKey || input.monthlyUsageLimit || input.usageCount)) {
      migrated.providers.apillow.enabled = input.apiProvider === "apillow";
      migrated.providers.apillow.apiKey = input.apillowApiKey || "";
      migrated.providers.apillow.apiKeyEncrypted = Boolean(input.apillowApiKeyEncrypted);
      migrated.providers.apillow.monthlyUsageLimit = Number(input.monthlyUsageLimit) || 50;
      migrated.providers.apillow.usageMonth = input.usageMonth || currentMonth();
      migrated.providers.apillow.usageCount = Number(input.usageCount) || 0;
    }

    return migrated;
  }

  getPublicSettings() {
    this.resetUsageIfNeeded();
    const providers = PROVIDER_DEFINITIONS
      .map((definition) => this.publicProvider(definition))
      .sort((a, b) => a.priority - b.priority);
    const apillow = providers.find((provider) => provider.id === "apillow");
    return {
      apiProvider: this.settings.apiProvider,
      providers,
      aggregateUsage: aggregateProviderUsage(providers),
      activeProviderStatus: this.getActiveProviderStatus(),
      hasApillowApiKey: Boolean(this.getProviderApiKey("apillow")),
      monthlyUsageLimit: apillow?.monthlyUsageLimit || 0,
      usageMonth: apillow?.usageMonth || currentMonth(),
      usageCount: apillow?.usageCount || 0,
      usageLabel: apillow?.usageLabel || "",
      usageWarning: apillow?.usageWarning || "",
      secureStorage: encryptionAvailable()
    };
  }

  publicProvider(definition) {
    const provider = this.settings.providers[definition.id] || defaultProviderSettings(definition, 0);
    const limit = Number(provider.monthlyUsageLimit) || 0;
    const count = Number(provider.usageCount) || 0;
    const warning = usageWarning(count, limit);
    return {
      id: definition.id,
      name: definition.name,
      implemented: definition.implemented,
      enabled: Boolean(provider.enabled),
      hasApiKey: Boolean(this.getProviderApiKey(definition.id)),
      monthlyUsageLimit: limit,
      usageMonth: provider.usageMonth || currentMonth(),
      usageCount: count,
      usageRemaining: limit > 0 ? Math.max(limit - count, 0) : null,
      usageLabel: `${count} / ${limit || "unlimited"} used`,
      usageWarning: warning,
      priority: Number(provider.priority) || 99,
      lastTestStatus: provider.lastTestStatus || "",
      lastSuccessfulRequestDate: provider.lastSuccessfulRequestDate || "",
      lastErrorMessage: provider.lastErrorMessage || "",
      capabilities: definition.capabilities
    };
  }

  getActiveProviderStatus() {
    if (this.settings.apiProvider === "manual") {
      return { label: "Manual Mode active", providerId: "manual", manual: true };
    }
    const candidates = this.getProvidersByPriority()
      .filter((provider) => provider.enabled && provider.hasApiKey && !providerExhausted(provider));
    const first = candidates[0];
    if (!first) return { label: "No API providers ready - Manual Mode active", providerId: "manual", manual: true };
    return { label: `Using ${first.name} • ${first.usageLabel}`, providerId: first.id, manual: false };
  }

  getProviderApiKey(providerId) {
    const provider = this.settings.providers[providerId];
    const value = provider?.apiKey || "";
    if (!value) return "";
    if (!provider.apiKeyEncrypted) return value;
    try {
      return safeStorage.decryptString(Buffer.from(value, "base64"));
    } catch {
      return "";
    }
  }

  updateApiSettings(input = {}) {
    this.settings.apiProvider = input.apiProvider === "manual" ? "manual" : "auto";
    const providers = Array.isArray(input.providers) ? input.providers : [];
    for (const providerInput of providers) {
      const provider = this.settings.providers[providerInput.id];
      if (!provider) continue;
      provider.enabled = Boolean(providerInput.enabled);
      provider.monthlyUsageLimit = Math.max(0, Number(providerInput.monthlyUsageLimit) || 0);
      provider.priority = Math.max(1, Number(providerInput.priority) || provider.priority || 99);
      if (Object.prototype.hasOwnProperty.call(providerInput, "apiKey")) {
        const key = String(providerInput.apiKey || "").trim();
        if (key) {
          provider.apiKey = this.encodeSecret(key);
          provider.apiKeyEncrypted = encryptionAvailable();
        }
      }
    }
    this.resetUsageIfNeeded();
    this.persist();
    return this.getPublicSettings();
  }

  clearApiKey(providerId = "apillow") {
    const provider = this.settings.providers[providerId];
    if (!provider) return this.getPublicSettings();
    provider.apiKey = "";
    provider.apiKeyEncrypted = false;
    provider.lastTestStatus = "";
    this.persist();
    return this.getPublicSettings();
  }

  resetUsageCounter(providerId = "apillow") {
    const provider = this.settings.providers[providerId];
    if (!provider) return this.getPublicSettings();
    provider.usageMonth = currentMonth();
    provider.usageCount = 0;
    this.persist();
    return this.getPublicSettings();
  }

  canSendProviderRequest(providerId, capability) {
    this.resetUsageIfNeeded();
    if (this.settings.apiProvider === "manual") {
      return { ok: false, code: "manual_mode", message: "Manual Mode is enabled." };
    }
    const publicProvider = this.getProvidersByPriority().find((provider) => provider.id === providerId);
    if (!publicProvider) return { ok: false, code: "provider_missing", message: "Provider is not configured." };
    if (!publicProvider.implemented) return { ok: false, code: "provider_stub", message: `${publicProvider.name} is a stub provider and is not implemented yet.` };
    if (!publicProvider.enabled) return { ok: false, code: "provider_disabled", message: `${publicProvider.name} is disabled.` };
    if (!publicProvider.hasApiKey) return { ok: false, code: "missing_api_key", message: `${publicProvider.name} needs an API key in Settings.` };
    if (capability && !publicProvider.capabilities[capability]) {
      return { ok: false, code: "unsupported_operation", message: `${publicProvider.name} does not support this operation yet.` };
    }
    const limit = Number(publicProvider.monthlyUsageLimit) || 0;
    const count = Number(publicProvider.usageCount) || 0;
    if (limit > 0 && count >= limit) {
      return { ok: false, code: "monthly_limit_reached", message: `${publicProvider.name} reached its monthly API limit.` };
    }
    return { ok: true };
  }

  noteProviderRequestSent(providerId) {
    this.resetUsageIfNeeded();
    const provider = this.settings.providers[providerId];
    if (!provider) return this.getPublicSettings();
    provider.usageCount = (Number(provider.usageCount) || 0) + 1;
    this.persist();
    return this.getPublicSettings();
  }

  noteProviderSuccess(providerId) {
    const provider = this.settings.providers[providerId];
    if (!provider) return;
    provider.lastSuccessfulRequestDate = new Date().toISOString();
    provider.lastErrorMessage = "";
    this.persist();
  }

  noteProviderError(providerId, message) {
    const provider = this.settings.providers[providerId];
    if (!provider) return;
    provider.lastErrorMessage = String(message || "");
    this.persist();
  }

  setProviderTestResult(providerId, status, message = "") {
    const provider = this.settings.providers[providerId];
    if (!provider) return this.getPublicSettings();
    provider.lastTestStatus = status;
    provider.lastErrorMessage = status === "success" ? "" : String(message || "");
    this.persist();
    return this.getPublicSettings();
  }

  resetUsageIfNeeded() {
    const month = currentMonth();
    for (const provider of Object.values(this.settings.providers)) {
      if (provider.usageMonth !== month) {
        provider.usageMonth = month;
        provider.usageCount = 0;
      }
    }
  }

  getProvidersByPriority() {
    return PROVIDER_DEFINITIONS
      .map((definition) => this.publicProvider(definition))
      .sort((a, b) => a.priority - b.priority);
  }

  encodeSecret(secret) {
    if (encryptionAvailable()) {
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

function defaultProviderSettings(definition, index) {
  return {
    id: definition.id,
    enabled: definition.defaultEnabled,
    apiKey: "",
    apiKeyEncrypted: false,
    monthlyUsageLimit: definition.defaultLimit,
    usageMonth: currentMonth(),
    usageCount: 0,
    priority: index + 1,
    lastTestStatus: "",
    lastSuccessfulRequestDate: "",
    lastErrorMessage: ""
  };
}

function usageWarning(count, limit) {
  if (!limit) return "";
  const ratio = count / limit;
  if (count >= limit) return "critical";
  if (ratio >= 0.95) return "critical";
  if (ratio >= 0.8) return "warning";
  return "";
}

function providerExhausted(provider) {
  return provider.monthlyUsageLimit > 0 && provider.usageCount >= provider.monthlyUsageLimit;
}

function aggregateProviderUsage(providers = []) {
  const enabled = providers.filter((provider) => provider.enabled);
  const limited = enabled.filter((provider) => provider.monthlyUsageLimit > 0);
  const unlimited = enabled.filter((provider) => provider.monthlyUsageLimit === 0);
  const totalLimit = limited.reduce((sum, provider) => sum + provider.monthlyUsageLimit, 0);
  const totalUsed = enabled.reduce((sum, provider) => sum + provider.usageCount, 0);
  const totalRemaining = limited.reduce((sum, provider) => sum + Math.max(provider.monthlyUsageLimit - provider.usageCount, 0), 0);
  const warning = totalLimit > 0 ? usageWarning(totalUsed, totalLimit) : "";
  return {
    enabledProviders: enabled.length,
    totalLimit,
    totalUsed,
    totalRemaining,
    hasUnlimited: unlimited.length > 0,
    usageWarning: warning,
    usageLabel: unlimited.length
      ? `${totalUsed} used • ${totalRemaining} limited requests left • ${unlimited.length} unlimited provider${unlimited.length === 1 ? "" : "s"}`
      : `${totalUsed} / ${totalLimit} used • ${totalRemaining} left`
  };
}

function encryptionAvailable() {
  return Boolean(safeStorage?.isEncryptionAvailable?.());
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = { SettingsStore, currentMonth, usageWarning, PROVIDER_DEFINITIONS, aggregateProviderUsage };
