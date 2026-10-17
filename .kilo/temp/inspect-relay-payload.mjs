import fs from "node:fs";
import path from "node:path";

const base = "F:\\LLM_Connector";
const files = process.argv.slice(2);
for (const rel of files) {
  const file = path.join(base, rel);
  const payload = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  const body = payload.body ?? {};
  const messages = body.messages ?? [];
  const summary = {
    file: rel,
    model: body.model,
    hasVideoUrl: JSON.stringify(body).includes("video_url"),
    hasVideoOmitted: JSON.stringify(body).includes("video omitted"),
    videoUrlCount: (JSON.stringify(body).match(/video_url/g) ?? []).length,
    markers: [...JSON.stringify(body).matchAll(/\(video omitted:[^)]*\)|\[Video attachment[^]]*\]/g)].map((m) => m[0]),
    userMedia: messages
      .filter((m) => m.role === "user")
      .map((m) => ({
        role: m.role,
        types: Array.isArray(m.content)
          ? m.content.map((c) =>
              c.type === "video_url"
                ? `video_url:${String(c.video_url?.url ?? "").slice(0, 32)}`
                : c.type,
            )
          : [typeof m.content],
      }))
      .slice(-5),
  };
  console.log(JSON.stringify(summary, null, 2));
}
