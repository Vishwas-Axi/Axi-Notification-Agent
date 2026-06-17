import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AlertBundle } from "@/lib/types";

// On serverless hosts (Vercel/Netlify/Lambda) the project directory is read-only —
// only the system temp dir is writable. Detect that and cache there instead.
const IS_SERVERLESS = !!(
  process.env.VERCEL ||
  process.env.NETLIFY ||
  process.env.AWS_LAMBDA_FUNCTION_NAME
);

const CACHE_DIR = IS_SERVERLESS
  ? path.join(os.tmpdir(), "market-alert-center")
  : path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "alerts.json");

export async function readCache(): Promise<AlertBundle | null> {
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf-8");
    return JSON.parse(raw) as AlertBundle;
  } catch {
    return null;
  }
}

export async function writeCache(bundle: AlertBundle): Promise<void> {
  // Best-effort: a failed cache write (e.g. read-only FS) must never break
  // alert delivery — the caller already holds the in-memory bundle.
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(bundle, null, 2), "utf-8");
  } catch {
    /* ignore */
  }
}
