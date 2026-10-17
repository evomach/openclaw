import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(process.argv[2], { readOnly: true });
const tables = db.prepare("select name from sqlite_master where type='table' order by name").all();
console.log(tables.map((r) => r.name).join("\n"));
