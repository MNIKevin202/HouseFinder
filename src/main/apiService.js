const APILLOW_BASE_URL = "https://api.apillow.co";

class ApiError extends Error {
  constructor(message, code = "api_error") {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

class ApiProviderRegistry {
  constructor({ settingsStore }) {
    this.settingsStore = settingsStore;
    this.providers = {
      apillow: new ApillowProvider({ settingsStore })
    };
  }

  getProvider(name) {
    return this.providers[name] || null;
  }

  async testConnection() {
    return this.requireApillow().testConnection();
  }

  async searchHomes(criteria) {
    return this.requireApillow().search(criteria);
  }

  async enrichListing(url) {
    return this.requireApillow().enrichByUrl(url);
  }

  requireApillow() {
    const provider = this.getProvider("apillow");
    if (!provider) throw new ApiError("Apillow provider is not available.", "provider_missing");
    return provider;
  }
}

class ApillowProvider {
  constructor({ settingsStore }) {
    this.settingsStore = settingsStore;
  }

  async testConnection() {
    const results = await this.runPropertyJob({
      search: "Austin TX",
      type: "sale",
      max_items: 1
    });
    return {
      ok: true,
      message: results.length ? "Apillow connection works." : "Apillow connection works, but returned no test results.",
      resultsFound: results.length,
      settings: this.settingsStore.getPublicSettings()
    };
  }

  async search(criteria = {}) {
    const payload = buildSearchPayload(criteria);
    const results = await this.runPropertyJob(payload);
    return {
      ok: true,
      results: results.map(normalizeApillowResult),
      settings: this.settingsStore.getPublicSettings(),
      message: results.length ? "" : "Apillow returned no results for this search."
    };
  }

  async enrichByUrl(url) {
    if (!url) throw new ApiError("No listing URL was provided.", "missing_url");
    const results = await this.runPropertyJob({
      urls: [url],
      type: "sale",
      max_items: 1
    });
    if (!results.length) throw new ApiError("Apillow returned no listing details for this URL.", "empty_results");
    return {
      ok: true,
      home: normalizeApillowResult(results[0]),
      settings: this.settingsStore.getPublicSettings()
    };
  }

  async runPropertyJob(payload) {
    const submitted = await this.request("/v1/properties", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const jobId = submitted.job_id || submitted.jobId || submitted.id;
    if (!jobId) throw new ApiError("Apillow response changed: missing job id.", "response_changed");

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await wait(attempt === 0 ? 1200 : 3000);
      const result = await this.request(`/v1/results/${encodeURIComponent(jobId)}`, { method: "GET" });
      const status = String(result.status || "").toLowerCase();
      if (status === "complete" || status === "completed" || status === "done") {
        return Array.isArray(result.results) ? result.results : [];
      }
      if (status === "failed" || status === "error") {
        throw new ApiError(result.message || "Apillow could not complete the request.", "api_error");
      }
    }
    throw new ApiError("Apillow is still processing. Try again in a moment.", "network_timeout");
  }

  async request(path, options = {}) {
    const allowed = this.settingsStore.canSendApillowRequest();
    if (!allowed.ok) throw new ApiError(allowed.message, allowed.code);

    const apiKey = this.settingsStore.getApillowApiKey();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    this.settingsStore.noteApillowRequestSent();
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
      const data = text ? safeJson(text) : {};
      if (response.status === 401 || response.status === 403) {
        throw new ApiError("Apillow rejected the API key. Check the key in Settings.", "invalid_api_key");
      }
      if (response.status === 429) {
        throw new ApiError("Apillow rate limited the request. Try again later.", "rate_limited");
      }
      if (!response.ok) {
        throw new ApiError(data.message || `Apillow returned HTTP ${response.status}.`, "api_error");
      }
      if (!data || typeof data !== "object") {
        throw new ApiError("Apillow response changed: expected JSON.", "response_changed");
      }
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw new ApiError("Network timeout contacting Apillow.", "network_failure");
      if (error instanceof ApiError) throw error;
      throw new ApiError("Network failure contacting Apillow.", "network_failure");
    } finally {
      clearTimeout(timeout);
    }
  }
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

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("Apillow response changed: invalid JSON.", "response_changed");
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { ApiProviderRegistry, ApillowProvider, ApiError, buildSearchPayload, normalizeApillowResult };
