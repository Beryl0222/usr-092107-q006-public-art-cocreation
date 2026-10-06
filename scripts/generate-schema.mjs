// 重新生成 contracts/domain.schema.json：
//   node scripts/generate-schema.mjs
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildDomainSchema } from "../src/build-schema.js";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "contracts", "domain.schema.json");
const schema = buildDomainSchema();

await writeFile(target, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
console.log(`已写入 ${target}`);
