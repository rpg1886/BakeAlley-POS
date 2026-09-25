const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const { initializeSchema } = require("./dist/main/db/schema.js");
const { seedDatabase } = require("./dist/main/db/seed.js");
const { AuthService } = require("./dist/main/main/auth/authService.js");
const { InventoryImportService } = require("./dist/main/main/inventory/inventoryImportService.js");

const real = new DatabaseSync(":memory:");
// Adapter shim so code written against better-sqlite3's API works against node:sqlite.
const db = {
  pragma: () => {},
  exec: (sql) => real.exec(sql),
  prepare: (sql) => {
    const stmt = real.prepare(sql);
    return {
      get: (...args) => stmt.get(...args),
      all: (...args) => stmt.all(...args),
      run: (...args) => stmt.run(...args),
    };
  },
  transaction: (fn) => (...args) => { real.exec("BEGIN"); try { const r = fn(...args); real.exec("COMMIT"); return r; } catch (e) { real.exec("ROLLBACK"); throw e; } },
};

try {
  initializeSchema(db);
  seedDatabase(db);
  const auth = new AuthService(db);
  const login = auth.login("admin", "BakeAlleyAdmin123!");
  const token = login.token;
  const svc = new InventoryImportService(db, auth);
  const bytes = new Uint8Array(fs.readFileSync("Inventory_Main.csv"));
  const r1 = svc.importStockTakeWorkbook(token, bytes, "Inventory_Main.csv");
  const counts = () => Object.fromEntries(["categories","products","product_variants","inventory_lots","product_prices"].map(t => [t, db.prepare(`SELECT COUNT(*) AS count FROM ${t}`).get().count]));
  console.log("first:", JSON.stringify(r1));
  console.log("counts1:", JSON.stringify(counts()));
  const r2 = svc.importStockTakeWorkbook(token, bytes, "Inventory_Main.csv");
  console.log("second:", JSON.stringify(r2));
  console.log("counts2:", JSON.stringify(counts()));
  console.log("SAMPLE PRODUCTS:", JSON.stringify(db.prepare("SELECT p.name, c.name AS category, v.sku, v.initial_cost, l.quantity_on_hand FROM products p JOIN categories c ON c.category_id=p.category_id JOIN product_variants v ON v.product_id=p.product_id JOIN inventory_lots l ON l.variant_id=v.variant_id LIMIT 5").all()));
} catch (e) {
  console.error("IMPORT ERROR:", e && e.stack || e);
  process.exitCode = 1;
}
