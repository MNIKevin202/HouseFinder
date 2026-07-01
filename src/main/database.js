const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

const TEXT_FIELDS = [
  "listingUrl",
  "sourceWebsite",
  "address",
  "city",
  "state",
  "zip",
  "lotSize",
  "hoaFee",
  "propertyTaxes",
  "estimatedMortgage",
  "listingStatus",
  "notes",
  "tags",
  "pros",
  "cons",
  "realtorQuestions",
  "inspectionConcerns",
  "estimatedRepairs",
  "estimatedMonthlyCost",
  "fhaMinimumDownPayment",
  "fhaClosingCostsEstimate",
  "fhaConditionConcerns",
  "fhaRequiredRepairs",
  "fhaDtiNotes",
  "screenshotPath"
];

const NUMERIC_FIELDS = ["price", "beds", "baths", "squareFootage", "personalRating"];
const BOOLEAN_FIELDS = ["favorite"];

function nowIso() {
  return new Date().toISOString();
}

function normalizeHome(input = {}) {
  const home = {};
  for (const field of TEXT_FIELDS) {
    home[field] = input[field] == null ? "" : String(input[field]);
  }
  for (const field of NUMERIC_FIELDS) {
    const value = input[field];
    home[field] = value === "" || value == null ? null : Number(value);
  }
  for (const field of BOOLEAN_FIELDS) {
    home[field] = input[field] ? 1 : 0;
  }
  home.id = input.id ? Number(input.id) : null;
  home.dateSaved = input.dateSaved || nowIso();
  home.lastViewedDate = input.lastViewedDate || "";
  home.listingStatus = home.listingStatus || "active";
  return home;
}

function rowToHome(row) {
  if (!row) return null;
  return {
    ...row,
    favorite: Boolean(row.favorite),
    price: row.price ?? null,
    beds: row.beds ?? null,
    baths: row.baths ?? null,
    squareFootage: row.squareFootage ?? null,
    personalRating: row.personalRating ?? null
  };
}

class HouseFinderDatabase {
  constructor({ appDataDir }) {
    this.appDataDir = appDataDir;
    this.dbPath = path.join(appDataDir, "housefinder.sqlite");
    this.screenshotDir = path.join(appDataDir, "screenshots");
    this.db = null;
    this.SQL = null;
  }

  async init() {
    fs.mkdirSync(this.appDataDir, { recursive: true });
    fs.mkdirSync(this.screenshotDir, { recursive: true });
    this.SQL = await initSqlJs();
    if (fs.existsSync(this.dbPath)) {
      this.db = new this.SQL.Database(fs.readFileSync(this.dbPath));
    } else {
      this.db = new this.SQL.Database();
    }
    this.migrate();
    this.persist();
  }

  migrate() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS homes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        listingUrl TEXT NOT NULL,
        sourceWebsite TEXT,
        address TEXT,
        city TEXT,
        state TEXT,
        zip TEXT,
        price REAL,
        beds REAL,
        baths REAL,
        squareFootage REAL,
        lotSize TEXT,
        hoaFee TEXT,
        propertyTaxes TEXT,
        estimatedMortgage TEXT,
        listingStatus TEXT DEFAULT 'active',
        notes TEXT,
        tags TEXT,
        dateSaved TEXT NOT NULL,
        lastViewedDate TEXT,
        favorite INTEGER DEFAULT 0,
        pros TEXT,
        cons TEXT,
        realtorQuestions TEXT,
        inspectionConcerns TEXT,
        estimatedRepairs TEXT,
        estimatedMonthlyCost TEXT,
        personalRating REAL,
        fhaMinimumDownPayment TEXT,
        fhaClosingCostsEstimate TEXT,
        fhaConditionConcerns TEXT,
        fhaRequiredRepairs TEXT,
        fhaDtiNotes TEXT,
        screenshotPath TEXT
      );
    `);
    this.db.run("CREATE INDEX IF NOT EXISTS idx_homes_status ON homes(listingStatus);");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_homes_city ON homes(city);");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_homes_tags ON homes(tags);");
  }

  persist() {
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  all(sql, params = {}) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  one(sql, params = {}) {
    return this.all(sql, params)[0] || null;
  }

  listHomes(filters = {}) {
    const where = [];
    const params = {};
    if (filters.query) {
      params.$query = `%${String(filters.query).toLowerCase()}%`;
      where.push(`(
        lower(address) LIKE $query OR lower(city) LIKE $query OR lower(notes) LIKE $query OR
        lower(tags) LIKE $query OR lower(listingUrl) LIKE $query OR lower(sourceWebsite) LIKE $query
      )`);
    }
    if (filters.status && filters.status !== "all") {
      params.$status = filters.status;
      where.push("listingStatus = $status");
    }
    if (filters.favoriteOnly) where.push("favorite = 1");
    if (filters.minPrice) {
      params.$minPrice = Number(filters.minPrice);
      where.push("price >= $minPrice");
    }
    if (filters.maxPrice) {
      params.$maxPrice = Number(filters.maxPrice);
      where.push("price <= $maxPrice");
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const sort = {
      priceAsc: "price ASC NULLS LAST",
      priceDesc: "price DESC NULLS LAST",
      beds: "beds DESC NULLS LAST",
      baths: "baths DESC NULLS LAST",
      sqft: "squareFootage DESC NULLS LAST",
      city: "city COLLATE NOCASE ASC",
      rating: "personalRating DESC NULLS LAST",
      newest: "dateSaved DESC"
    }[filters.sort || "newest"];
    return this.all(`SELECT * FROM homes ${whereSql} ORDER BY ${sort}`).map(rowToHome);
  }

  getHome(id) {
    return rowToHome(this.one("SELECT * FROM homes WHERE id = $id", { $id: Number(id) }));
  }

  saveHome(input) {
    const home = normalizeHome(input);
    if (home.id) return this.updateHome(home.id, home);
    const fields = [
      ...TEXT_FIELDS,
      ...NUMERIC_FIELDS,
      ...BOOLEAN_FIELDS,
      "dateSaved",
      "lastViewedDate"
    ];
    const columns = fields.join(", ");
    const placeholders = fields.map((field) => `$${field}`).join(", ");
    const params = Object.fromEntries(fields.map((field) => [`$${field}`, home[field]]));
    this.db.run(`INSERT INTO homes (${columns}) VALUES (${placeholders})`, params);
    const insertedId = this.one("SELECT last_insert_rowid() AS id").id;
    this.persist();
    return this.getHome(insertedId);
  }

  updateHome(id, input) {
    const current = this.getHome(id);
    if (!current) throw new Error("Home not found.");
    const home = normalizeHome({ ...current, ...input, id, dateSaved: current.dateSaved });
    const fields = [
      ...TEXT_FIELDS,
      ...NUMERIC_FIELDS,
      ...BOOLEAN_FIELDS,
      "lastViewedDate"
    ];
    const assignments = fields.map((field) => `${field} = $${field}`).join(", ");
    const params = Object.fromEntries(fields.map((field) => [`$${field}`, home[field]]));
    params.$id = Number(id);
    this.db.run(`UPDATE homes SET ${assignments} WHERE id = $id`, params);
    this.persist();
    return this.getHome(id);
  }

  deleteHome(id) {
    this.db.run("DELETE FROM homes WHERE id = $id", { $id: Number(id) });
    this.persist();
    return true;
  }

  markViewed(id) {
    this.db.run("UPDATE homes SET lastViewedDate = $date WHERE id = $id", {
      $id: Number(id),
      $date: nowIso()
    });
    this.persist();
    return this.getHome(id);
  }

  dashboard() {
    const homes = this.listHomes({});
    const active = homes.filter((home) => home.listingStatus !== "archived" && home.listingStatus !== "rejected");
    const prices = active.map((home) => Number(home.price)).filter((price) => Number.isFinite(price) && price > 0);
    const cityCounts = {};
    const tagCounts = {};
    for (const home of active) {
      if (home.city) cityCounts[home.city] = (cityCounts[home.city] || 0) + 1;
      for (const tag of splitTags(home.tags)) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
    return {
      totalSaved: homes.length,
      activeSaved: active.length,
      averagePrice: prices.length ? Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length) : 0,
      lowestPrice: prices.length ? Math.min(...prices) : 0,
      highestPrice: prices.length ? Math.max(...prices) : 0,
      favorites: homes.filter((home) => home.favorite).length,
      homesByCity: cityCounts,
      homesByTag: tagCounts
    };
  }

  exportJson() {
    return JSON.stringify({ exportedAt: nowIso(), homes: this.listHomes({}) }, null, 2);
  }

  exportCsv() {
    const homes = this.listHomes({});
    const fields = [
      "id",
      "listingUrl",
      "sourceWebsite",
      "address",
      "city",
      "state",
      "zip",
      "price",
      "beds",
      "baths",
      "squareFootage",
      "lotSize",
      "hoaFee",
      "propertyTaxes",
      "estimatedMortgage",
      "listingStatus",
      "favorite",
      "tags",
      "notes",
      "pros",
      "cons",
      "realtorQuestions",
      "inspectionConcerns",
      "estimatedRepairs",
      "estimatedMonthlyCost",
      "personalRating",
      "dateSaved",
      "lastViewedDate",
      "screenshotPath"
    ];
    const escape = (value) => {
      const text = value == null ? "" : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return [fields.join(","), ...homes.map((home) => fields.map((field) => escape(home[field])).join(","))].join("\n");
  }

  importHomes(homes = []) {
    let count = 0;
    for (const home of homes) {
      this.saveHome({ ...home, id: null, dateSaved: home.dateSaved || nowIso() });
      count += 1;
    }
    return count;
  }

  replaceDatabaseFrom(filePath) {
    if (!fs.existsSync(filePath)) throw new Error("Backup file does not exist.");
    const backup = fs.readFileSync(filePath);
    const testDb = new this.SQL.Database(backup);
    testDb.exec("SELECT name FROM sqlite_master LIMIT 1");
    testDb.close();
    fs.copyFileSync(filePath, this.dbPath);
    this.db = new this.SQL.Database(fs.readFileSync(this.dbPath));
    this.migrate();
    this.persist();
  }

  reset() {
    this.db.close();
    if (fs.existsSync(this.dbPath)) fs.rmSync(this.dbPath);
    this.db = new this.SQL.Database();
    this.migrate();
    this.persist();
  }
}

function splitTags(tags = "") {
  return String(tags)
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

module.exports = { HouseFinderDatabase, splitTags };
