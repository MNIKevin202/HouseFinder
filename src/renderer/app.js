const api = window.housefinder;

const state = {
  route: "dashboard",
  homes: [],
  dashboard: null,
  selectedHome: null,
  saveDraft: null,
  compareIds: [],
  filters: {
    query: "",
    status: "active",
    sort: "newest",
    minPrice: "",
    maxPrice: "",
    favoriteOnly: false
  },
  calc: {
    purchasePrice: 250000,
    downPayment: 8750,
    interestRate: 6.75,
    loanType: "FHA",
    propertyTax: 260,
    insurance: 120,
    pmiMip: 175,
    hoa: 0,
    utilities: 250,
    maintenance: 200
  },
  metadata: null,
  apiSettings: null,
  showApiKey: false,
  apiSearch: {
    city: "",
    state: "",
    zip: "",
    minPrice: "",
    maxPrice: "",
    beds: "",
    baths: "",
    propertyType: ""
  },
  apiResults: [],
  apiMessage: "",
  settingsMessage: ""
};

const navItems = [
  ["dashboard", "Dashboard", "Overview"],
  ["browse", "Browse", "Search listings"],
  ["apiSearch", "API Search", "Apillow lookup"],
  ["saved", "Saved Homes", "Research list"],
  ["compare", "Compare", "Side by side"],
  ["calculator", "Calculator", "Monthly cost"],
  ["settings", "Settings", "Local data"]
];

const fieldGroups = [
  {
    title: "Listing",
    fields: [
      ["listingUrl", "Listing URL", "url"],
      ["sourceWebsite", "Source website", "text"],
      ["address", "Address", "text"],
      ["city", "City", "text"],
      ["state", "State", "text"],
      ["zip", "ZIP", "text"],
      ["listingStatus", "Status", "select", ["active", "shortlist", "pending", "sold", "archived", "rejected"]],
      ["tags", "Tags", "text"],
      ["favorite", "Favorite", "checkbox"]
    ]
  },
  {
    title: "Numbers",
    fields: [
      ["price", "Price", "number"],
      ["beds", "Beds", "number"],
      ["baths", "Baths", "number"],
      ["squareFootage", "Square footage", "number"],
      ["lotSize", "Lot size", "text"],
      ["hoaFee", "HOA fee", "text"],
      ["propertyTaxes", "Property taxes", "text"],
      ["estimatedMortgage", "Estimated mortgage/payment", "text"],
      ["estimatedMonthlyCost", "Estimated monthly cost", "text"],
      ["personalRating", "Personal rating 1-10", "number"]
    ]
  },
  {
    title: "Research",
    fields: [
      ["notes", "Notes", "textarea"],
      ["pros", "Pros", "textarea"],
      ["cons", "Cons", "textarea"],
      ["realtorQuestions", "Questions to ask realtor", "textarea"],
      ["inspectionConcerns", "Inspection concerns", "textarea"],
      ["estimatedRepairs", "Estimated repairs", "textarea"]
    ]
  },
  {
    title: "FHA Checklist",
    fields: [
      ["fhaMinimumDownPayment", "Minimum down payment", "text"],
      ["fhaClosingCostsEstimate", "Closing costs estimate", "text"],
      ["fhaConditionConcerns", "FHA property condition concerns", "textarea"],
      ["fhaRequiredRepairs", "Required repairs", "textarea"],
      ["fhaDtiNotes", "Debt-to-income notes", "textarea"]
    ]
  }
];

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "$0";
  return number.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function numberText(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number.toLocaleString() : "Not set";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function detectSource(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const simple = host.split(".")[0];
    return simple ? `${simple[0].toUpperCase()}${simple.slice(1)}` : host;
  } catch {
    return "";
  }
}

function getBrowser() {
  return document.querySelector("#listingBrowser");
}

async function refreshData() {
  state.homes = await api.homes.list(state.filters);
  state.dashboard = await api.homes.dashboard();
  state.apiSettings = await api.settings.getApi();
}

async function setRoute(route) {
  state.route = route;
  if (route !== "browse") state.saveDraft = null;
  await refreshData();
  render();
}

function shell() {
  return `
    <aside class="sidebar">
      <div class="brand">
        <div class="brandMark">HF</div>
        <div>
          <h1>HouseFinder</h1>
          <p>Local home research</p>
        </div>
      </div>
      <nav class="nav">
        ${navItems
          .map(([key, label, hint]) => `
            <button class="navItem ${state.route === key ? "active" : ""}" data-route="${key}">
              <span>${label}</span>
              <small>${hint}</small>
            </button>
          `)
          .join("")}
      </nav>
    </aside>
    <main class="main">
      ${routeContent()}
    </main>
    ${state.saveDraft ? saveDialog(state.saveDraft) : ""}
  `;
}

function routeContent() {
  if (state.route === "browse") return browsePage();
  if (state.route === "apiSearch") return apiSearchPage();
  if (state.route === "saved") return savedPage();
  if (state.route === "detail") return detailPage();
  if (state.route === "compare") return comparePage();
  if (state.route === "calculator") return calculatorPage();
  if (state.route === "settings") return settingsPage();
  return dashboardPage();
}

function pageHeader(title, subtitle, actions = "") {
  return `
    <header class="pageHeader">
      <div>
        <h2>${title}</h2>
        <p>${subtitle}</p>
      </div>
      <div class="headerActions">${actions}</div>
    </header>
  `;
}

function dashboardPage() {
  const data = state.dashboard || {};
  const cityRows = Object.entries(data.homesByCity || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const tagRows = Object.entries(data.homesByTag || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const favorites = state.homes.filter((home) => home.favorite).slice(0, 4);
  return `
    ${pageHeader("Dashboard", "A quick read on the homes you are tracking locally.", `<button class="primary" data-route="browse">Browse listings</button>`)}
    <section class="statGrid">
      ${statCard("Total saved", data.totalSaved || 0)}
      ${statCard("Average price", money(data.averagePrice))}
      ${statCard("Lowest price", money(data.lowestPrice))}
      ${statCard("Highest price", money(data.highestPrice))}
      ${statCard("Favorites", data.favorites || 0)}
    </section>
    <section class="twoColumn">
      ${simplePanel("Homes by city", cityRows)}
      ${simplePanel("Homes by tag", tagRows)}
    </section>
    <section class="panel">
      <div class="panelTitle">Favorite homes</div>
      <div class="cardGrid">${favorites.length ? favorites.map(homeCard).join("") : emptyState("No favorites yet.")}</div>
    </section>
  `;
}

function statCard(label, value) {
  return `<div class="statCard"><span>${label}</span><strong>${value}</strong></div>`;
}

function simplePanel(title, rows) {
  return `
    <section class="panel">
      <div class="panelTitle">${title}</div>
      <div class="miniRows">
        ${rows.length ? rows.map(([label, count]) => `<div><span>${escapeHtml(label)}</span><strong>${count}</strong></div>`).join("") : emptyState("Nothing to show yet.")}
      </div>
    </section>
  `;
}

function browsePage() {
  const apiHint = state.apiSettings?.apiProvider === "apillow"
    ? `<span class="apiPill">Apillow enrichment ${state.apiSettings.hasApillowApiKey ? "enabled" : "needs key"}</span>`
    : `<span class="apiPill muted">Manual Mode</span>`;
  return `
    ${pageHeader("Browse", "Use the built-in browser, then save the current listing into your local database.", `
      ${apiHint}
      <button id="captureListing" class="primary">Save Current Listing</button>
    `)}
    <section class="browserShell">
      <div class="browserToolbar">
        <button title="Back" id="browserBack">‹</button>
        <button title="Forward" id="browserForward">›</button>
        <button title="Reload" id="browserReload">↻</button>
        <input id="browserUrl" value="https://www.zillow.com/" />
        <button id="browserGo">Go</button>
      </div>
      <webview id="listingBrowser" src="https://www.zillow.com/" allowpopups></webview>
    </section>
  `;
}

function apiSearchPage() {
  const settings = state.apiSettings || {};
  return `
    ${pageHeader("API Search", "Search Apillow without scraping listing sites, then save anything useful locally.", `
      <button data-route="settings">API Settings</button>
    `)}
    <section class="panel apiNotice ${settings.usageWarning || ""}">
      <div>
        <strong>${escapeHtml(settings.usageLabel || "API usage unavailable")}</strong>
        <p>${apiUsageCopy(settings)}</p>
      </div>
    </section>
    <section class="apiSearchLayout">
      <form id="apiSearchForm" class="apiSearchForm">
        ${apiSearchInput("city", "City")}
        ${apiSearchInput("state", "State")}
        ${apiSearchInput("zip", "ZIP code")}
        ${apiSearchInput("minPrice", "Minimum price", "number")}
        ${apiSearchInput("maxPrice", "Maximum price", "number")}
        ${apiSearchInput("beds", "Beds", "number")}
        ${apiSearchInput("baths", "Baths", "number")}
        <label class="field"><span>Property type</span><select name="propertyType">
          ${["", "house", "condo", "townhouse", "land", "apartment", "manufactured", "multi_family"].map((type) => `<option value="${type}" ${state.apiSearch.propertyType === type ? "selected" : ""}>${type || "Any"}</option>`).join("")}
        </select></label>
        <button class="primary wide" type="submit">Search Apillow</button>
      </form>
      <div class="apiResults">
        ${state.apiMessage ? `<div class="apiMessage">${escapeHtml(state.apiMessage)}</div>` : ""}
        ${state.apiResults.length ? state.apiResults.map(apiResultCard).join("") : emptyState("Run an API search to see results here.")}
      </div>
    </section>
  `;
}

function apiSearchInput(name, label, type = "text") {
  return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${escapeHtml(state.apiSearch[name])}" /></label>`;
}

function apiResultCard(home, index) {
  return `
    <article class="apiResult">
      ${home.thumbnailUrl ? `<img class="apiThumb" src="${escapeHtml(home.thumbnailUrl)}" alt="" />` : `<div class="apiThumb placeholder">No photo</div>`}
      <div>
        <h3>${escapeHtml(home.address || "Untitled home")}</h3>
        <p>${escapeHtml([home.city, home.state, home.zip].filter(Boolean).join(", "))}</p>
        <div class="facts">
          <span>${money(home.price)}</span>
          <span>${home.beds || "?"} bd</span>
          <span>${home.baths || "?"} ba</span>
          <span>${numberText(home.squareFootage)} sqft</span>
          <span>${escapeHtml(home.listingStatus || "active")}</span>
          <span>${escapeHtml(home.sourceWebsite || "Apillow")}</span>
        </div>
      </div>
      <div class="apiResultActions">
        <button data-view-api-result="${index}">View details</button>
        <button class="primary" data-save-api-result="${index}">Save home</button>
      </div>
    </article>
  `;
}

function savedPage() {
  return `
    ${pageHeader("Saved Homes", "Search, filter, favorite, archive, and open details for every local record.")}
    <section class="filters">
      <input placeholder="Search address, city, notes, tags, URL" id="filterQuery" value="${escapeHtml(state.filters.query)}" />
      <select id="filterStatus">
        ${["all", "active", "shortlist", "pending", "sold", "archived", "rejected"].map((status) => `<option value="${status}" ${state.filters.status === status ? "selected" : ""}>${status}</option>`).join("")}
      </select>
      <select id="filterSort">
        ${[
          ["newest", "Newest"],
          ["priceAsc", "Price low to high"],
          ["priceDesc", "Price high to low"],
          ["beds", "Beds"],
          ["baths", "Baths"],
          ["sqft", "Square footage"],
          ["city", "City"],
          ["rating", "Rating"]
        ].map(([value, label]) => `<option value="${value}" ${state.filters.sort === value ? "selected" : ""}>${label}</option>`).join("")}
      </select>
      <input id="filterMinPrice" type="number" placeholder="Min price" value="${escapeHtml(state.filters.minPrice)}" />
      <input id="filterMaxPrice" type="number" placeholder="Max price" value="${escapeHtml(state.filters.maxPrice)}" />
      <label class="check"><input id="filterFavorites" type="checkbox" ${state.filters.favoriteOnly ? "checked" : ""} /> Favorites</label>
    </section>
    <section class="cardGrid">${state.homes.length ? state.homes.map(homeCard).join("") : emptyState("No saved homes match these filters.")}</section>
  `;
}

function homeCard(home) {
  return `
    <article class="homeCard" data-open-home="${home.id}">
      <div class="homeCardTop">
        <span class="status">${escapeHtml(home.listingStatus || "active")}</span>
        <button class="iconButton" data-toggle-favorite="${home.id}" title="Favorite">${home.favorite ? "★" : "☆"}</button>
      </div>
      ${home.screenshotPath ? `<img class="thumb" src="file://${escapeHtml(home.screenshotPath)}" alt="" />` : `<div class="thumb placeholder">No screenshot</div>`}
      <h3>${escapeHtml(home.address || "Untitled home")}</h3>
      <p>${escapeHtml([home.city, home.state, home.zip].filter(Boolean).join(", ")) || "Location not set"}</p>
      <div class="facts">
        <span>${money(home.price)}</span>
        <span>${home.beds ?? "?"} bd</span>
        <span>${home.baths ?? "?"} ba</span>
        <span>${numberText(home.squareFootage)} sqft</span>
      </div>
      <div class="tagLine">${escapeHtml(home.tags || "No tags")}</div>
    </article>
  `;
}

function detailPage() {
  const home = state.selectedHome;
  if (!home) return emptyState("Select a saved home first.");
  return `
    ${pageHeader(escapeHtml(home.address || "Home detail"), escapeHtml(home.listingUrl), `
      <button data-route="saved">Back</button>
      <button class="danger" data-delete-home="${home.id}">Delete</button>
      <button class="primary" id="saveDetail">Save changes</button>
    `)}
    <section class="detailLayout">
      <form id="detailForm" class="formGrid">
        ${formGroups(home)}
      </form>
      <aside class="detailAside">
        ${home.screenshotPath ? `<img class="detailImage" src="file://${escapeHtml(home.screenshotPath)}" alt="" />` : `<div class="detailImage placeholder">No screenshot saved</div>`}
        <button data-open-url="${escapeHtml(home.listingUrl)}">Open listing in browser</button>
        <button data-show-file="${escapeHtml(home.screenshotPath || "")}" ${home.screenshotPath ? "" : "disabled"}>Show screenshot file</button>
        <div class="metaBox">
          <span>Date saved</span><strong>${new Date(home.dateSaved).toLocaleString()}</strong>
          <span>Last viewed</span><strong>${home.lastViewedDate ? new Date(home.lastViewedDate).toLocaleString() : "Not viewed"}</strong>
        </div>
      </aside>
    </section>
  `;
}

function formGroups(home) {
  return fieldGroups.map((group) => `
    <fieldset>
      <legend>${group.title}</legend>
      ${group.fields.map((field) => fieldInput(field, home)).join("")}
    </fieldset>
  `).join("");
}

function fieldInput([name, label, type, options], home) {
  const value = home[name] ?? "";
  if (type === "textarea") {
    return `<label class="field wide"><span>${label}</span><textarea name="${name}">${escapeHtml(value)}</textarea></label>`;
  }
  if (type === "select") {
    return `<label class="field"><span>${label}</span><select name="${name}">${options.map((option) => `<option value="${option}" ${value === option ? "selected" : ""}>${option}</option>`).join("")}</select></label>`;
  }
  if (type === "checkbox") {
    return `<label class="field checkField"><input name="${name}" type="checkbox" ${value ? "checked" : ""} /><span>${label}</span></label>`;
  }
  return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${escapeHtml(value)}" /></label>`;
}

function saveDialog(home) {
  return `
    <div class="modalBackdrop">
      <section class="modal">
        <header>
          <div>
            <h2>Save Current Listing</h2>
            <p>The URL and source are captured. Fill in or correct anything before saving.</p>
          </div>
          <button id="closeSaveDialog">×</button>
        </header>
        <form id="saveForm" class="formGrid">
          ${formGroups(home)}
          ${state.apiMessage ? `<div class="apiMessage">${escapeHtml(state.apiMessage)}</div>` : ""}
          <fieldset>
            <legend>Screenshot</legend>
            <label class="checkField"><input name="captureScreenshot" type="checkbox" checked /> <span>Save a local snapshot of this page if the webview allows it</span></label>
          </fieldset>
          <div class="modalActions">
            <button type="button" id="cancelSave">Cancel</button>
            <button class="primary" type="submit">Save home locally</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function comparePage() {
  const chosen = state.homes.filter((home) => state.compareIds.includes(String(home.id))).slice(0, 4);
  return `
    ${pageHeader("Compare", "Select two to four saved homes and compare the details side by side.")}
    <section class="comparePicker">
      ${state.homes.map((home) => `
        <label><input type="checkbox" class="compareCheck" value="${home.id}" ${state.compareIds.includes(String(home.id)) ? "checked" : ""} ${!state.compareIds.includes(String(home.id)) && state.compareIds.length >= 4 ? "disabled" : ""} /> ${escapeHtml(home.address || home.listingUrl)}</label>
      `).join("") || emptyState("Save a home before comparing.")}
    </section>
    <section class="compareGrid" style="--cols:${Math.max(chosen.length, 1)}">
      ${chosen.map(compareColumn).join("") || emptyState("Choose homes to compare.")}
    </section>
  `;
}

function compareColumn(home) {
  const rows = [
    ["Price", money(home.price)],
    ["Beds", home.beds ?? "Not set"],
    ["Baths", home.baths ?? "Not set"],
    ["Square footage", numberText(home.squareFootage)],
    ["Monthly estimate", home.estimatedMonthlyCost || home.estimatedMortgage || "Not set"],
    ["HOA", home.hoaFee || "Not set"],
    ["Taxes", home.propertyTaxes || "Not set"],
    ["Status", home.listingStatus || "active"],
    ["Rating", home.personalRating || "Not set"],
    ["Tags", home.tags || "None"],
    ["Pros", home.pros || "Not set"],
    ["Cons", home.cons || "Not set"]
  ];
  return `
    <article class="compareColumn">
      <h3>${escapeHtml(home.address || "Untitled")}</h3>
      ${rows.map(([label, value]) => `<div><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}
    </article>
  `;
}

function calculatorPage() {
  const result = calculatePayment(state.calc);
  return `
    ${pageHeader("Affordability Calculator", "Estimate monthly cost across loan, tax, insurance, PMI/MIP, HOA, utilities, and maintenance.")}
    <section class="calculator">
      <form id="calcForm" class="calcInputs">
        ${calcInput("purchasePrice", "Purchase price")}
        ${calcInput("downPayment", "Down payment")}
        ${calcInput("interestRate", "Interest rate %", "number", "0.01")}
        <label class="field"><span>Loan type</span><select name="loanType">
          ${["FHA", "Conventional", "VA", "USDA"].map((type) => `<option ${state.calc.loanType === type ? "selected" : ""}>${type}</option>`).join("")}
        </select></label>
        ${calcInput("propertyTax", "Monthly property tax")}
        ${calcInput("insurance", "Monthly insurance")}
        ${calcInput("pmiMip", "Monthly PMI/MIP")}
        ${calcInput("hoa", "Monthly HOA")}
        ${calcInput("utilities", "Utilities estimate")}
        ${calcInput("maintenance", "Maintenance estimate")}
      </form>
      <aside class="paymentResult">
        <span>Total estimated monthly payment</span>
        <strong>${money(result.total)}</strong>
        <div><span>Principal and interest</span><b>${money(result.principalInterest)}</b></div>
        <div><span>Loan amount</span><b>${money(result.loanAmount)}</b></div>
        <div><span>FHA 3.5% minimum down</span><b>${money(Number(state.calc.purchasePrice) * 0.035)}</b></div>
      </aside>
    </section>
  `;
}

function calcInput(name, label, type = "number", step = "1") {
  return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" step="${step}" value="${escapeHtml(state.calc[name])}" /></label>`;
}

function calculatePayment(input) {
  const price = Number(input.purchasePrice) || 0;
  const down = Number(input.downPayment) || 0;
  const loanAmount = Math.max(price - down, 0);
  const monthlyRate = ((Number(input.interestRate) || 0) / 100) / 12;
  const months = 360;
  const principalInterest = monthlyRate
    ? loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1)
    : loanAmount / months;
  const extras = ["propertyTax", "insurance", "pmiMip", "hoa", "utilities", "maintenance"].reduce((sum, key) => sum + (Number(input[key]) || 0), 0);
  return { loanAmount, principalInterest, total: principalInterest + extras };
}

function settingsPage() {
  const meta = state.metadata || {};
  const settings = state.apiSettings || {};
  return `
    ${pageHeader("Settings", "Manage local data, backups, and release/update information.")}
    <section class="settingsGrid">
      <div class="panel">
        <div class="panelTitle">Local storage</div>
        <p>Database: ${escapeHtml(meta.databasePath || "")}</p>
        <p>Screenshots: ${escapeHtml(meta.screenshotsPath || "")}</p>
        <div class="buttonRow">
          <button id="backupDb">Backup database</button>
          <button id="restoreDb">Restore database</button>
          <button id="importJson">Import JSON</button>
          <button id="exportJson">Export JSON</button>
          <button id="exportCsv">Export CSV</button>
          <button class="danger" id="resetData">Reset local data</button>
        </div>
      </div>
      <div class="panel">
        <div class="panelTitle">API settings</div>
        <form id="apiSettingsForm" class="settingsForm">
          <label class="field"><span>API Provider</span><select name="apiProvider">
            <option value="manual" ${settings.apiProvider !== "apillow" ? "selected" : ""}>Manual Mode / No API</option>
            <option value="apillow" ${settings.apiProvider === "apillow" ? "selected" : ""}>Apillow</option>
          </select></label>
          <label class="field"><span>Apillow API Key</span><input name="apillowApiKey" id="apillowApiKey" type="${state.showApiKey ? "text" : "password"}" placeholder="${settings.hasApillowApiKey ? "Saved API key" : "Paste API key"}" /></label>
          <label class="field"><span>Monthly API Usage Limit</span><input name="monthlyUsageLimit" type="number" min="0" value="${escapeHtml(settings.monthlyUsageLimit ?? 50)}" /></label>
          <div class="usageBox ${settings.usageWarning || ""}">
            <strong>${escapeHtml(settings.usageLabel || "0 / 50 requests used this month")}</strong>
            <span>${apiUsageCopy(settings)}</span>
          </div>
          <p class="settingsHint">API keys are stored only on this computer. Secure storage: ${settings.secureStorage ? "available" : "not available, using local settings fallback"}.</p>
          <div class="buttonRow">
            <button type="button" id="toggleApiKey">${state.showApiKey ? "Hide API Key" : "Show API Key"}</button>
            <button type="button" id="clearApiKey">Clear API Key</button>
            <button type="button" id="resetApiUsage">Reset Usage Counter</button>
            <button type="button" id="testApiConnection">Test Connection</button>
            <button class="primary" type="submit">Save API Settings</button>
          </div>
          <div id="apiSettingsResult" class="updateResult">${escapeHtml(state.settingsMessage)}</div>
        </form>
      </div>
      <div class="panel">
        <div class="panelTitle">Version and updates</div>
        <p>App version: ${escapeHtml(meta.version || "")}</p>
        <p>GitHub repo: ${escapeHtml(meta.repo || "")}</p>
        <p>Updater feed: ${escapeHtml(meta.releasesUrl || "")}</p>
        <div class="buttonRow">
          <button id="checkUpdates" class="primary">Check for updates</button>
        </div>
        <div id="updateResult" class="updateResult"></div>
      </div>
      <div class="panel widePanel">
        <div class="panelTitle">Release process from project notes</div>
        <ul>${(meta.releaseNotesSummary || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>
    </section>
  `;
}

function apiUsageCopy(settings = {}) {
  if (settings.apiProvider !== "apillow") return "Manual Mode is active. Saved homes and manual entry continue to work normally.";
  if (!settings.hasApillowApiKey) return "Add an Apillow API key to enable enrichment and API search.";
  if (settings.usageWarning === "critical") return "You have used at least 95% of this month's API request limit.";
  if (settings.usageWarning === "warning") return "You have used at least 80% of this month's API request limit.";
  return "Apillow API usage resets automatically when a new calendar month begins.";
}

function emptyState(text) {
  return `<div class="empty">${text}</div>`;
}

function readForm(form) {
  const data = {};
  for (const element of form.elements) {
    if (!element.name || element.name === "captureScreenshot") continue;
    if (element.type === "checkbox") data[element.name] = element.checked;
    else data[element.name] = element.value;
  }
  return data;
}

function bindEvents() {
  document.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", () => setRoute(button.dataset.route));
  });
  document.querySelectorAll("[data-open-home]").forEach((card) => {
    card.addEventListener("click", async (event) => {
      if (event.target.closest("button")) return;
      state.selectedHome = await api.homes.get(card.dataset.openHome);
      await setRoute("detail");
    });
  });
  document.querySelectorAll("[data-toggle-favorite]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const home = state.homes.find((item) => String(item.id) === button.dataset.toggleFavorite);
      await api.homes.update(home.id, { favorite: !home.favorite });
      await setRoute(state.route);
    });
  });

  bindBrowse();
  bindFilters();
  bindDetail();
  bindSaveForm();
  bindApiSearch();
  bindCompare();
  bindCalculator();
  bindSettings();
}

function bindBrowse() {
  const webview = getBrowser();
  if (!webview) return;
  const urlInput = document.querySelector("#browserUrl");
  const go = () => {
    let url = urlInput.value.trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    webview.src = url;
  };
  document.querySelector("#browserGo").addEventListener("click", go);
  urlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") go();
  });
  document.querySelector("#browserBack").addEventListener("click", () => webview.canGoBack() && webview.goBack());
  document.querySelector("#browserForward").addEventListener("click", () => webview.canGoForward() && webview.goForward());
  document.querySelector("#browserReload").addEventListener("click", () => webview.reload());
  webview.addEventListener("did-navigate", (event) => { urlInput.value = event.url; });
  webview.addEventListener("did-navigate-in-page", (event) => { urlInput.value = event.url; });
  document.querySelector("#captureListing").addEventListener("click", async () => {
    const url = webview.getURL() || urlInput.value;
    let title = "";
    try {
      title = await webview.executeJavaScript("document.title", false);
    } catch {
      title = "";
    }
    const draft = {
      listingUrl: url,
      sourceWebsite: detectSource(url),
      address: title,
      city: "",
      state: "",
      zip: "",
      listingStatus: "active",
      tags: "",
      favorite: false
    };
    state.apiMessage = "";
    if (state.apiSettings?.apiProvider === "apillow" && state.apiSettings?.hasApillowApiKey) {
      try {
        const enriched = await api.realEstateApi.enrichListing(url);
        state.apiSettings = enriched.settings || await api.settings.getApi();
        Object.assign(draft, enriched.home, {
          listingUrl: enriched.home.listingUrl || url,
          sourceWebsite: enriched.home.sourceWebsite || detectSource(url)
        });
        state.apiMessage = "Apillow filled in available listing details. Review everything before saving.";
      } catch (error) {
        state.apiSettings = await api.settings.getApi();
        state.apiMessage = error.message || "Apillow enrichment was skipped. You can still save manually.";
      }
    }
    state.saveDraft = draft;
    render();
  });
}

function bindApiSearch() {
  const form = document.querySelector("#apiSearchForm");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    for (const element of form.elements) {
      if (element.name) state.apiSearch[element.name] = element.value;
    }
    state.apiMessage = "Searching Apillow...";
    state.apiResults = [];
    render();
    try {
      const result = await api.realEstateApi.searchHomes(state.apiSearch);
      state.apiSettings = result.settings || await api.settings.getApi();
      state.apiResults = result.results || [];
      state.apiMessage = result.message || `${state.apiResults.length} result${state.apiResults.length === 1 ? "" : "s"} found.`;
    } catch (error) {
      state.apiSettings = await api.settings.getApi();
      state.apiMessage = error.message || "API search failed. Manual Mode and saved homes still work.";
      state.apiResults = [];
    }
    render();
  });

  document.querySelectorAll("[data-view-api-result]").forEach((button) => {
    button.addEventListener("click", () => {
      state.saveDraft = state.apiResults[Number(button.dataset.viewApiResult)];
      render();
    });
  });
  document.querySelectorAll("[data-save-api-result]").forEach((button) => {
    button.addEventListener("click", async () => {
      const saved = await api.homes.save(state.apiResults[Number(button.dataset.saveApiResult)]);
      state.selectedHome = saved;
      await setRoute("detail");
    });
  });
}

function bindFilters() {
  const ids = ["filterQuery", "filterStatus", "filterSort", "filterMinPrice", "filterMaxPrice", "filterFavorites"];
  if (!document.querySelector("#filterQuery")) return;
  for (const id of ids) {
    document.querySelector(`#${id}`).addEventListener("input", async () => {
      state.filters = {
        query: document.querySelector("#filterQuery").value,
        status: document.querySelector("#filterStatus").value,
        sort: document.querySelector("#filterSort").value,
        minPrice: document.querySelector("#filterMinPrice").value,
        maxPrice: document.querySelector("#filterMaxPrice").value,
        favoriteOnly: document.querySelector("#filterFavorites").checked
      };
      await refreshData();
      render();
    });
  }
}

function bindDetail() {
  const saveButton = document.querySelector("#saveDetail");
  if (saveButton) {
    saveButton.addEventListener("click", async () => {
      const data = readForm(document.querySelector("#detailForm"));
      state.selectedHome = await api.homes.update(state.selectedHome.id, data);
      await refreshData();
      render();
    });
  }
  document.querySelectorAll("[data-delete-home]").forEach((button) => {
    button.addEventListener("click", async () => {
      const deleted = await api.homes.delete(button.dataset.deleteHome);
      if (deleted) {
        state.selectedHome = null;
        await setRoute("saved");
      }
    });
  });
  document.querySelectorAll("[data-open-url]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.route = "browse";
      render();
      const webview = getBrowser();
      if (webview) webview.src = button.dataset.openUrl;
      const input = document.querySelector("#browserUrl");
      if (input) input.value = button.dataset.openUrl;
    });
  });
  document.querySelectorAll("[data-show-file]").forEach((button) => {
    button.addEventListener("click", () => api.shell.showItem(button.dataset.showFile));
  });
}

function bindSaveForm() {
  const form = document.querySelector("#saveForm");
  if (!form) return;
  document.querySelector("#closeSaveDialog").addEventListener("click", () => { state.saveDraft = null; render(); });
  document.querySelector("#cancelSave").addEventListener("click", () => { state.saveDraft = null; render(); });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = readForm(form);
    if (form.elements.captureScreenshot.checked) {
      const webview = getBrowser();
      try {
        const image = await webview.capturePage();
        data.screenshotPath = await api.screenshots.save(image.toDataURL());
      } catch {
        data.screenshotPath = "";
      }
    }
    const saved = await api.homes.save(data);
    state.saveDraft = null;
    state.selectedHome = saved;
    await setRoute("detail");
  });
}

function bindCompare() {
  document.querySelectorAll(".compareCheck").forEach((check) => {
    check.addEventListener("change", () => {
      state.compareIds = Array.from(document.querySelectorAll(".compareCheck:checked")).map((input) => input.value).slice(0, 4);
      render();
    });
  });
}

function bindCalculator() {
  const form = document.querySelector("#calcForm");
  if (!form) return;
  form.addEventListener("input", () => {
    for (const element of form.elements) {
      if (!element.name) continue;
      state.calc[element.name] = element.value;
    }
    render();
  });
}

function bindSettings() {
  const backup = document.querySelector("#backupDb");
  if (!backup) return;
  backup.addEventListener("click", async () => api.data.backup());
  document.querySelector("#restoreDb").addEventListener("click", async () => {
    const restored = await api.data.restore();
    if (restored) await setRoute("dashboard");
  });
  document.querySelector("#exportJson").addEventListener("click", () => api.data.exportJson());
  document.querySelector("#exportCsv").addEventListener("click", () => api.data.exportCsv());
  document.querySelector("#importJson").addEventListener("click", async () => {
    await api.data.importJson();
    await setRoute("saved");
  });
  document.querySelector("#resetData").addEventListener("click", async () => {
    const reset = await api.data.reset();
    if (reset) await setRoute("dashboard");
  });
  document.querySelector("#checkUpdates").addEventListener("click", async () => {
    const resultBox = document.querySelector("#updateResult");
    resultBox.textContent = "Checking GitHub Releases...";
    try {
      const result = await api.updates.check({ silent: true });
      if (!result.hasUpdate) {
        resultBox.textContent = `No update found. Installed: ${result.currentVersion}. Latest: ${result.latestVersion || "none"}.`;
      } else if (result.assetUrl) {
        resultBox.innerHTML = `Update ${escapeHtml(result.latestVersion)} is available. <button id="downloadUpdate">Download and open installer</button>`;
        document.querySelector("#downloadUpdate").addEventListener("click", () => api.updates.downloadAndOpen(result.assetUrl, result.assetName));
      } else {
        resultBox.textContent = `Update ${result.latestVersion} is available, but no installer asset matched this platform.`;
      }
    } catch (error) {
      resultBox.textContent = `Update check failed: ${error.message}`;
    }
  });
  bindApiSettings();
}

function bindApiSettings() {
  const form = document.querySelector("#apiSettingsForm");
  if (!form) return;
  const resultBox = document.querySelector("#apiSettingsResult");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const settings = {
      apiProvider: form.elements.apiProvider.value,
      monthlyUsageLimit: form.elements.monthlyUsageLimit.value
    };
    if (form.elements.apillowApiKey.value.trim()) {
      settings.apillowApiKey = form.elements.apillowApiKey.value.trim();
    }
    state.apiSettings = await api.settings.saveApi(settings);
    state.settingsMessage = "API settings saved locally.";
    render();
  });
  document.querySelector("#toggleApiKey").addEventListener("click", async () => {
    state.showApiKey = !state.showApiKey;
    render();
    if (state.showApiKey) {
      const key = await api.settings.getApillowKey();
      const input = document.querySelector("#apillowApiKey");
      if (input) input.value = key;
    }
  });
  document.querySelector("#clearApiKey").addEventListener("click", async () => {
    state.apiSettings = await api.settings.clearApillowKey();
    state.settingsMessage = "Apillow API key cleared.";
    render();
  });
  document.querySelector("#resetApiUsage").addEventListener("click", async () => {
    state.apiSettings = await api.settings.resetApiUsage();
    state.settingsMessage = "Usage counter reset for the current month.";
    render();
  });
  document.querySelector("#testApiConnection").addEventListener("click", async () => {
    resultBox.textContent = "Testing Apillow connection...";
    try {
      const result = await api.realEstateApi.testConnection();
      state.apiSettings = result.settings || await api.settings.getApi();
      state.settingsMessage = result.message;
    } catch (error) {
      state.apiSettings = await api.settings.getApi();
      state.settingsMessage = error.message || "Apillow connection test failed.";
    }
    render();
  });
}

async function render() {
  const root = document.querySelector("#app");
  root.innerHTML = shell();
  bindEvents();
}

async function init() {
  state.metadata = await api.app.metadata();
  await refreshData();
  await render();
}

init().catch((error) => {
  document.querySelector("#app").innerHTML = `<div class="fatal">HouseFinder failed to start: ${escapeHtml(error.message)}</div>`;
});
