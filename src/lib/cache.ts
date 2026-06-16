import { promises as fs } from "node:fs";
import path from "node:path";
import type { AlertBundle } from "@/lib/types";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
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
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(bundle, null, 2), "utf-8");
}
