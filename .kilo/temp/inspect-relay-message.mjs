import fs from "node:fs";
import path from "node:path";

const base = "F:\\LLM_Connector";
const file = path.join(base, process.argv[2]);
const idx = Number(process.argv[3]);
const payload = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
console.log(JSON.stringify(payload.body.messages[idx], null, 2).slice(0, 5000));
