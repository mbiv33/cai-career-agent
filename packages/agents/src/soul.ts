/**
 * Hermes persona loader (spec §7). Every coaching-flavored call, on any
 * backend or channel (dashboard chat, Telegram, briefings), loads the same
 * SOUL.md so the voice is identical everywhere. Persona consumes factual
 * campaign state — it never controls deterministic business logic.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const DEFAULT_SOUL_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/SOUL.md",
);

let cached: string | null = null;

export async function loadSoul(path = process.env.SOUL_PATH ?? DEFAULT_SOUL_PATH): Promise<string> {
  if (cached) return cached;
  cached = await readFile(path, "utf8");
  return cached;
}
