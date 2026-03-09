import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const targets = [
  ["esm", { type: "module" }],
  ["cjs", { type: "commonjs" }],
];

for (const [format, pkg] of targets) {
  const dir = join("dist", format);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, "package.json");
  await writeFile(filePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}
