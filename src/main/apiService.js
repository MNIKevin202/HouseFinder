const APILLOW_BASE_URL = "https://api.apillow.co";

class ApiError extends Error {
  constructor(message, code = "api_error", providerId = "") {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.providerId = providerId;
  }
}

class ApiProviderManager {
  constructor({ settingsStore, apiCache }) {
    this.settingsStore = settingsStore;
    this.apiCache = apiCache;
    this.providers = {
      apillow: new ApillowProvider({ settingsStore, apiCache }),
      rentcast: new StubProvider({
        id: "rentcast",
        name: "RentCast",
        message: "RentCast provider is ready in Settings but needs an implementation before it can send API requests."
      }),
      realtyMole: new StubProvider({
        id: "realtyMole",
        name: "Realty Mole",
        message: "Realty Mole provider is ready in Settings but needs an implementation before it can send API requests."
      })
    };
  }

  getProvider(id) {
    return this.providers[id] || null;
  }

  async testConnection(providerId = "apillow") {
    const provider = this.getProvider(providerId);
    if (!provider) throw new ApiError("Provider is not configured.", "provider_missing", providerId);
    try {
      const result = await provider.testConnection();
      this.settingsStore.setProviderTestResult(providerId, "success", result.message);
      return { ...result, settings: this.settingsStore.getPublicSettings() };
    } catch (error) {
      this.settingsStore.setProviderTestResult(providerId, "failed", error.message);
      throw error;
    }
  }

  async searchHomes(criteria) {
    return this.runWithFallback("propertySearch", (provider) => provider.search(criteria));
  }

  async enrichListing(url) {
    return this.runWithFallback("listingDetails", (provider) => provider.enrichByUrl(url));
  }

  async runWithFallback(capability, operation) {
    const attempts = [];
    for (const providerInfo of this.settingsStore.getProvidersByPriority()) {
      const provider = this.getProvider(providerInfo.id);
      const allowed = this.settingsStore.canSendProviderRequest(providerInfo.id, capability);
      if (!allowed.ok) {
        attempts.push({ provider: providerInfo.name, code: allowed.code, message: allowed.message });
        continue;
      }
      try {
        const result = await operation(provider);
        this.settingsStore.noteProviderSuccess(providerInfo.id);
        return {
          ...result,
          providerId: providerInfo.id,
          providerName: providerInfo.name,
          attempts,
          settings: this.settingsStore.getPublicSettings()
        };
      } catch (error) {
        this.settingsStore.noteProviderError(providerInfo.id, error.message);
        attempts.push({
          provider: providerInfo.name,
          code: error.code || "api_error",
          message: error.message || `${providerInfo.name} failed.`
        });
      }
    }
    throw new ApiError(formatAllProvidersFailed(capability, attempts), "no_providers_available");
  }
}

class ApillowProvider {
  constructor({ settingsStore, apiCache }) {
    this.id = "apillow";
    this.name = "Apillow";
    this.settingsStore = settingsStore;
    this.apiCache = apiCache;
  }

  async testConnection() {
    const results = await this.runPropertyJob({
      search: "Austin TX",
      type: "sale",
      max_items: 1
    });
    return {
      ok: true,
      providerId: this.id,
      providerName: this.name,
      message: results.length ? "Apillow connection works." : "Apillow connection works, but returned no test results.",
      resultsFound: results.length
    };
  }

  async search(criteria = {}) {
    const payload = buildSearchPayload(criteria);
    const { results, fromCache } = await this.runCachedPropertyJob("search", payload);
    return {
      ok: true,
      results: results.map(normalizeApillowResult),
      fromCache,
      message: results.length
        ? fromCache ? "Loaded from this month's saved Apillow data. No API request was used." : ""
        : "Apillow returned no results for this search."
    };
  }

  async enrichByUrl(url) {
    if (!url) throw new ApiError("No listing URL was provided.", "missing_url", this.id);
    const { results, fromCache } = await this.runCachedPropertyJob("enrich", {
      urls: [url],
      type: "sale",
      max_items: 1
    });
    if (!results.length) throw new ApiError("Apillow returned no listing details for this URL.", "empty_results", this.id);
    return {
      ok: true,
      home: normalizeApillowResult(results[0]),
      fromCache
    };
  }

  async runCachedPropertyJob(scope, payload) {
    const cached = this.apiCache?.get(this.id, scope, payload);
    if (cached) return { results: cached.results || [], fromCache: true };
    const results = await this.runPropertyJob(payload);
    this.apiCache?.set(this.id, scope, payload, { results });
    return { results, fromCache: false };
  }

  async runPropertyJob(payload) {
    const submitted = await this.request("/v1/properties", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const jobId = submitted.job_id || submitted.jobId || submitted.id;
    if (!jobId) throw new ApiError("Apillow response changed: missing job id.", "response_changed", this.id);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await wait(attempt === 0 ? 1200 : 3000);
      const result = await this.request(`/v1/results/${encodeURIComponent(jobId)}`, { method: "GET" });
      const status = String(result.status || "").toLowerCase();
      if (status === "complete" || status === "completed" || status === "done") {
        return Array.isArray(result.results) ? result.results : [];
      }
      if (status === "failed" || status === "error") {
        throw new ApiError(result.message || "Apillow could not complete the request.", "api_error", this.id);
      }
    }
    throw new ApiError("Apillow is still processing. Try again in a moment.", "network_timeout", this.id);
  }

  async request(path, options = {}) {
    const allowed = this.settingsStore.canSendProviderRequest(this.id);
    if (!allowed.ok) throw new ApiError(allowed.message, allowed.code, this.id);

    const apiKey = this.settingsStore.getProviderApiKey(this.id);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    this.settingsStore.noteProviderRequestSent(this.id);
    try {
      const response = await fetch(`${APILLOW_BASE_URL}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
          ...(options.headers || {})
        }
      });
      const text = await response.text();
      const data = text ? safeJson(text, this.id) : {};
      if (response.status === 401 || response.status === 403) {
        throw new ApiError("Apillow rejected the API key. Check the key in Settings.", "invalid_api_key", this.id);
      }
      if (response.status === 429) {
        throw new ApiError("Apillow rate limited the request. Trying the next provider if available.", "rate_limited", this.id);
      }
      if (!response.ok) {
        throw new ApiError(data.message || `Apillow returned HTTP ${response.status}.`, "api_error", this.id);
      }
      if (!data || typeof data !== "object") {
        throw new ApiError("Apillow response changed: expected JSON.", "response_changed", this.id);
      }
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw new ApiError("Network timeout contacting Apillow.", "network_failure", this.id);
      if (error instanceof ApiError) throw error;
      throw new ApiError("Network failure contacting Apillow.", "network_failure", this.id);
    } finally {
      clearTimeout(timeout);
    }
  }
}

class StubProvider {
  constructor({ id, name, message }) {
    this.id = id;
    this.name = name;
    this.message = message;
  }

  async testConnection() {
    throw new ApiError(this.message, "provider_stub", this.id);
  }

  async search() {
    throw new ApiError(this.message, "provider_stub", this.id);
  }

  async enrichByUrl() {
    throw new ApiError(this.message, "provider_stub", this.id);
  }
}

function formatAllProvidersFailed(capability, attempts) {
  if (!attempts.length) return "No API providers are available. Manual Mode is active.";
  const readable = capability === "propertySearch" ? "search" : "listing enrichment";
  const summary = attempts.map((attempt) => `${attempt.provider}: ${attempt.message}`).join(" ");
  return `All API providers were skipped or failed for ${readable}. Manual Mode is still available. ${summary}`;
}

function buildSearchPayload(criteria = {}) {
  const cityState = [criteria.city, criteria.state].filter(Boolean).join(" ");
  const search = [cityState, criteria.zip].filter(Boolean).join(" ").trim();
  const payload = {
    type: "sale",
    max_items: 12
  };
  if (search) payload.search = search;
  if (criteria.zip) payload.zipcodes = [String(criteria.zip).trim()];
  if (criteria.minPrice) payload.price_min = Number(criteria.minPrice);
  if (criteria.maxPrice) payload.price_max = Number(criteria.maxPrice);
  if (criteria.propertyType) payload.property_type = criteria.propertyType;
  if (criteria.beds) payload.beds_min = Number(criteria.beds);
  if (criteria.baths) payload.baths_min = Number(criteria.baths);
  if (!payload.search && !payload.zipcodes) throw new ApiError("Enter a city/state or ZIP code before searching.", "missing_search");
  return payload;
}

function normalizeApillowResult(item = {}) {
  const property = item.property || item;
  const address = property.street_address || property.address || property.formatted_address || "";
  const city = property.city || "";
  const state = property.state || "";
  const zip = property.zipcode || property.zip || "";
  const photos = property.image_urls || property.photos || property.photo_urls || [];
  const listingUrl = property.zillow_url || property.listing_url || property.url || property.detail_url || "";
  const taxPaid = Array.isArray(property.tax_history) && property.tax_history[0]?.tax_paid
    ? String(property.tax_history[0].tax_paid)
    : "";
  return {
    listingUrl,
    sourceWebsite: "Apillow",
    address,
    city,
    state,
    zip,
    price: property.price ?? "",
    beds: property.bedrooms ?? property.beds ?? "",
    baths: property.bathrooms ?? property.baths ?? "",
    squareFootage: property.living_area ?? property.square_feet ?? property.sqft ?? "",
    lotSize: property.lot_size ? String(property.lot_size) : "",
    hoaFee: property.hoa_fee ? String(property.hoa_fee) : "",
    propertyTaxes: taxPaid,
    estimatedMortgage: property.monthly_payment ? String(property.monthly_payment) : "",
    listingStatus: normalizeStatus(property.home_status || property.status || "active"),
    notes: property.description || "",
    tags: [property.property_type, property.zpid ? `zpid:${property.zpid}` : ""].filter(Boolean).join(", "),
    thumbnailUrl: Array.isArray(photos) ? photos[0] || "" : "",
    raw: property
  };
}

function normalizeStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("sold")) return "sold";
  if (value.includes("pending")) return "pending";
  return "active";
}

function safeJson(text, providerId) {
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("Provider response changed: invalid JSON.", "response_changed", providerId);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  ApiProviderManager,
  ApiProviderRegistry: ApiProviderManager,
  ApillowProvider,
  StubProvider,
  ApiError,
  buildSearchPayload,
  normalizeApillowResult
};
