import { cp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

await cp(resolve("public"), resolve("dist"), { recursive: true });

const buildId = (process.env.GITHUB_SHA ?? Date.now().toString(36)).slice(0, 12);
const indexPath = resolve("dist", "index.html");
const indexHtml = await readFile(indexPath, "utf8");
const cacheBustedHtml = indexHtml
  .replace('href="styles.css"', `href="styles.css?v=${buildId}"`)
  .replace('src="app.js"', `src="app.js?v=${buildId}"`);

await writeFile(indexPath, cacheBustedHtml);
