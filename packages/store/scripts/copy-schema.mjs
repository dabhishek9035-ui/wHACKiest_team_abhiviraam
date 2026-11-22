// Copies src/schema.sql into dist/ so the runtime schema loader can find it
// next to the compiled modules. Owner: M4.
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // packages/store/scripts
const root = join(here, "..");
copyFileSync(join(root, "src", "schema.sql"), join(root, "dist", "schema.sql"));
console.log("copied src/schema.sql -> dist/schema.sql");
