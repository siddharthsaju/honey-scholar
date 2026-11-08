import { readFile, writeFile } from "node:fs/promises";

const engineSource = await readFile(
  new URL("../dist/engine.mjs", import.meta.url),
  "utf8",
);
const serverSource = await readFile(
  new URL("../server/worker.mjs", import.meta.url),
  "utf8",
);
const engineImport =
  /^import \{ result \} from ["']\.\.\/dist\/engine\.mjs["'];\r?\n/m;

// Direct uploads need one Worker module; the browser and server share grading code.
if (!engineImport.test(serverSource)) {
  throw new Error(
    "Worker entry point must import result from dist/engine.mjs.",
  );
}
const engine = engineSource.replace(/^export (?=(?:const|function) )/gm, "");
const server = serverSource.replace(engineImport, "");
await writeFile(
  new URL("../dist/_worker.js", import.meta.url),
  `${engine}\n${server}`,
);
await writeFile(
  new URL("../dist/_routes.json", import.meta.url),
  JSON.stringify({ version: 1, include: ["/api/*"], exclude: [] }, null, 2) +
    "\n",
);
