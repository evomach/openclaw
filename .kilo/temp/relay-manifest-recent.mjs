import fs from "node:fs";
import path from "node:path";

const root = "F:\\LLM_Connector\\activity_log";
const manifestText = fs.readFileSync(path.join(root, "manifest.json"), "utf8");
const manifest = JSON.parse(manifestText.replace(/^\uFEFF/, ""));
const rows = Array.isArray(manifest) ? manifest : manifest.entries ?? manifest.items ?? [];
const recent = rows
  .filter((e) => {
    const t = e.timestamp ?? e.time ?? e.created_at ?? e.date ?? "";
    return String(t).includes("2026-10-11") || String(e.file ?? e.path ?? "").includes("20261011_19");
  })
  .slice(-80);
for (const e of recent) {
  const file = e.file ?? e.path ?? e.payload ?? e.request ?? "";
  const full = file && !path.isAbsolute(file) ? path.join(root, file) : file;
  console.log(
    JSON.stringify({
      t: e.timestamp ?? e.time ?? e.created_at ?? e.date,
      model: e.model ?? e.model_id,
      file,
      full,
      exists: full ? fs.existsSync(full) : false,
      size: full && fs.existsSync(full) ? fs.statSync(full).size : undefined,
    }),
  );
}
