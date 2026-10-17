import fs from "node:fs";
import path from "node:path";

const root = "F:\\LLM_Connector\\activity_log";
const base = "F:\\LLM_Connector";
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8").replace(/^﻿/, ""));
for (const e of manifest.entries) {
  const t = e.timestamp ?? "";
  if (t >= "2026-10-11T19:18:00" && t <= "2026-10-11T19:22:00") {
    const file = path.join(base, e.payloadFile);
    const resp = e.responsePayloadFile ? path.join(base, e.responsePayloadFile) : "";
    console.log(
      JSON.stringify({
        t,
        path: e.path,
        status: e.status,
        payloadFile: e.payloadFile,
        exists: fs.existsSync(file),
        size: fs.existsSync(file) ? fs.statSync(file).size : undefined,
        resp,
        respExists: resp ? fs.existsSync(resp) : false,
      }),
    );
  }
}
