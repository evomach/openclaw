import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(process.argv[2], { readOnly: true });
const rows = db.prepare(`
  select session_id, seq, created_at, substr(event_json,1,1500) as event_json
  from transcript_events
  where event_json like '%provider does not support native video%'
     or event_json like '%video omitted%'
     or event_json like '%handed-to-native-vision%'
     or event_json like '%no-model%'
  order by created_at desc
  limit 20
`).all();
for (const row of rows) {
  console.log(JSON.stringify(row, null, 2));
}
