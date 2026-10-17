import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("F:\\.openclaw\\agents\\telegram\\agent\\openclaw-agent.sqlite", {
  readOnly: true,
});
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all();
console.log("tables", tables.map((r) => r.name).join(", "));

for (const table of tables.map((r) => r.name)) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  console.log(
    table,
    cols.map((c) => c.name).join(","),
  );
}
