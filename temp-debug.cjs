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
const check = db.prepare("SELECT ? = round(?, 2) AS ok");
let bad = 0;
for (const row of rows) {
  const cost = roundMoney(parseNonNegativeNumber(row.Cost));
  const r = check.get(cost, cost);
  if (!r.ok) { bad++; console.log("BAD COST", row.Name, row.Cost, cost, JSON.stringify(r)); if (bad > 10) break; }
}
console.log("bad count:", bad, "total:", rows.length);
