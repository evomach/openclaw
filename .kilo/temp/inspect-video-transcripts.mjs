import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(process.argv[2], { readOnly: true });
const rows = db.prepare(`
  select session_id, seq, created_at, substr(event_json,1,1500) as event_json
  from transcript_events
  where event_json like '%Video attachment not analyzed%'
     or event_json like '%video-understanding model%'
     or event_json like '%IMG_6014%'
     or event_json like '%video/mp4%'
  order by created_at desc
  limit 20
`).all();
for (const row of rows) {
  console.log(JSON.stringify(row, null, 2));
}
