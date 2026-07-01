const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { currentMonth } = require("./settingsStore");

class ApiCache {
  constructor({ appDataDir }) {
    this.cacheDir = path.join(appDataDir, "api-cache");
  }

  init() {
    fs.mkdirSync(this.cacheDir, { recursive: true });
    this.pruneOldMonths();
  }

  get(provider, scope, payload) {
    const filePath = this.filePath(provider, scope, payload);
    if (!fs.existsSync(filePath)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (parsed.month !== currentMonth()) return null;
      return parsed.data;
    } catch {
      return null;
    }
  }

  set(provider, scope, payload, data) {
    fs.mkdirSync(this.cacheDir, { recursive: true });
    const filePath = this.filePath(provider, scope, payload);
    fs.writeFileSync(filePath, JSON.stringify({
      provider,
      scope,
      month: currentMonth(),
      cachedAt: new Date().toISOString(),
      data
    }, null, 2));
  }

  filePath(provider, scope, payload) {
    const key = stableHash({ provider, scope, payload, month: currentMonth() });
    return path.join(this.cacheDir, `${provider}-${scope}-${key}.json`);
  }

  pruneOldMonths() {
    if (!fs.existsSync(this.cacheDir)) return;
    for (const fileName of fs.readdirSync(this.cacheDir)) {
      if (!fileName.endsWith(".json")) continue;
      const filePath = path.join(this.cacheDir, fileName);
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (parsed.month !== currentMonth()) fs.rmSync(filePath);
      } catch {
        fs.rmSync(filePath, { force: true });
      }
    }
  }
}

function stableHash(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 24);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

module.exports = { ApiCache, stableHash, stableStringify };
