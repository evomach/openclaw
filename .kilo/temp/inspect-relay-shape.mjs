import fs from "node:fs";
import path from "node:path";

const base = "F:\\LLM_Connector";
const file = path.join(base, process.argv[2]);
const body = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
console.log(Object.keys(body));
console.log(JSON.stringify(body, null, 2).slice(0, 2000));
