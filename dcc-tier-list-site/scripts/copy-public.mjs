import { cp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

await cp(resolve("public"), resolve("dist"), { recursive: true });

const buildId = (process.env.GITHUB_SHA ?? Date.now().toString(36)).slice(0, 12);
const gaMeasurementId = process.env.GA_MEASUREMENT_ID?.trim() ?? "";
const indexPath = resolve("dist", "index.html");
const indexHtml = await readFile(indexPath, "utf8");
const cacheBustedHtml = indexHtml
  .replace('href="styles.css"', `href="styles.css?v=${buildId}"`)
  .replace('src="analytics.js"', `src="analytics.js?v=${buildId}"`)
  .replace('src="app.js"', `src="app.js?v=${buildId}"`);

await writeFile(indexPath, cacheBustedHtml);

const analyticsPath = resolve("dist", "analytics.js");
const analyticsJs = await readFile(analyticsPath, "utf8");
await writeFile(
  analyticsPath,
  analyticsJs.replace("__GA_MEASUREMENT_ID__", gaMeasurementId)
);
