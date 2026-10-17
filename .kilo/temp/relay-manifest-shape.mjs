import fs from "node:fs";
import path from "node:path";

const root = "F:\\LLM_Connector\\activity_log";
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8").replace(/^\uFEFF/, ""));
console.log(Object.keys(manifest));
const rows = Array.isArray(manifest) ? manifest : manifest.entries ?? manifest.items ?? [];
console.log(rows.length);
console.log(JSON.stringify(rows.at(-1), null, 2).slice(0, 3000));
