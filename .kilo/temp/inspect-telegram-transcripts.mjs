import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("F:\\.openclaw\\agents\\telegram\\agent\\openclaw-agent.sqlite", {
  readOnly: true,
});
const rows = db
  .prepare(
    "SELECT session_id, seq, created_at, event_utf8_bytes, substr(event_json,1,3000) AS event_json FROM transcript_events WHERE event_json LIKE '%video%' OR event_json LIKE '%Video%' OR event_json LIKE '%IMG_6003%' ORDER BY rowid DESC LIMIT 10",
  )
  .all();
for (const row of rows) {
  console.log("---");
  console.log(row.session_id, row.seq, row.created_at, row.event_utf8_bytes);
  console.log(row.event_json);
}
