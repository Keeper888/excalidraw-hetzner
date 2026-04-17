import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const env = process.env;

export const PORT = Number(env.PORT || 4242);
export const DATA_DIR = resolve(env.DATA_DIR || "./data");
export const RP_ID = env.RP_ID || "localhost";
export const RP_NAME = env.RP_NAME || "Excalidraw Hetzner";
export const ORIGIN = env.ORIGIN || "http://localhost:4243";
export const SESSION_TTL_HOURS = Number(env.SESSION_TTL_HOURS || 8);

const SECRET_FILE = resolve(DATA_DIR, ".jwt-secret");

function loadOrCreateJwtSecret(): Uint8Array {
  if (env.JWT_SECRET && env.JWT_SECRET !== "replace-with-random-32-bytes-base64") {
    return Buffer.from(env.JWT_SECRET, "base64");
  }
  if (existsSync(SECRET_FILE)) {
    return Buffer.from(readFileSync(SECRET_FILE, "utf8").trim(), "base64");
  }
  const buf = randomBytes(32);
  writeFileSync(SECRET_FILE, buf.toString("base64"), { mode: 0o600 });
  return buf;
}

export const JWT_SECRET = loadOrCreateJwtSecret();
