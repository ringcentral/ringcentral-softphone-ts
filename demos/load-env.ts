import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

if (existsSync(".env")) {
  Object.assign(process.env, parseEnv(readFileSync(".env", "utf8")));
}
