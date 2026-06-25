import { cp } from "node:fs/promises";
import { resolve } from "node:path";

await cp(resolve("public"), resolve("dist"), { recursive: true });
