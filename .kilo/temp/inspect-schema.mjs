import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(process.argv[2], { readOnly: true });
const tables = ["transcript_events", "session_entry_snapshots", "session_conversations"];
for (const table of tables) {
  console.log(table);
  console.log(db.prepare(`pragma table_info(${table})`).all().map((r) => `${r.name} ${r.type}`).join("\n"));
  console.log();
}
