import fs from "node:fs";
import path from "node:path";

const base = "F:\\LLM_Connector";
const file = path.join(base, process.argv[2]);
const payload = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
const body = payload.body ?? {};
const messages = body.messages ?? [];
let idx = 0;
for (const m of messages) {
  idx++;
  const s = JSON.stringify(m);
  if (s.includes("video_url") || s.includes("video omitted")) {
    console.log(
      JSON.stringify({
        idx,
        role: m.role,
        types: Array.isArray(m.content) ? m.content.map((c) => c.type) : typeof m.content,
        snippet: s.slice(0, 500),
      }),
    );
  }
}
console.log("total messages", messages.length);
