const { DatabaseSync } = require("node:sqlite");
const XLSX = require("xlsx");
const db = new DatabaseSync(":memory:");
const wb = XLSX.readFile("Inventory_Main.csv");
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });
function parseNonNegativeNumber(value) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "0").replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
function roundMoney(value) { return Math.round(value * 100) / 100; }
function roundQuantity(value) { return Math.round(value * 10000) / 10000; }
const merged = new Map();
for (const row of rows) {
  const name = typeof row.Name === "string" ? row.Name.trim() : "";
  if (!name) continue;
  const category = typeof row.Category === "string" && row.Category.trim() !== "" ? row.Category.trim().toUpperCase() : "UNCATEGORIZED";
  const quantity = roundQuantity(parseNonNegativeNumber(row["Stock Qty"]));
  const cost = roundMoney(parseNonNegativeNumber(row.Cost));
  const key = category + "::" + name.toLowerCase();
  const existing = merged.get(key);
  if (existing) {
    const totalQuantity = existing.quantity + quantity;
    existing.cost = totalQuantity > 0 ? roundMoney((existing.cost * existing.quantity + cost * quantity) / totalQuantity) : roundMoney((existing.cost + cost) / 2);
    existing.quantity = totalQuantity;
  } else {
    merged.set(key, { name, category, quantity, cost });
  }
}
const check = db.prepare("SELECT ? = round(?, 2) AS ok");
const qcheck = db.prepare("SELECT ? = round(?, 4) AS ok");
let bad = 0;
for (const r of merged.values()) {
  const okCost = check.get(r.cost, r.cost).ok;
  const okQty = qcheck.get(r.quantity, r.quantity).ok;
  if (!okCost || !okQty) { bad++; console.log("BAD", JSON.stringify(r), "okCost", okCost, "okQty", okQty); }
}
console.log("bad:", bad, "total merged:", merged.size);
