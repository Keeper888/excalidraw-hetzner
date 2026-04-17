import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { resolve, join } from "node:path";

import { DATA_DIR } from "./config.js";

export interface StoredCredential {
  id: string; // base64url
  publicKey: string; // base64url
  counter: number;
  transports?: string[];
  aaguid?: string;
  createdAt: number;
}

export interface UserRecord {
  id: string;
  username: string;
  credentials: StoredCredential[];
  currentChallenge?: string;
  currentChallengeKind?: "register" | "login";
  currentChallengeExpires?: number;
}

const USER_FILE = resolve(DATA_DIR, "user.json");
const SCENES_DIR = resolve(DATA_DIR, "scenes");

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(SCENES_DIR, { recursive: true });

export function loadUser(): UserRecord | null {
  if (!existsSync(USER_FILE)) return null;
  return JSON.parse(readFileSync(USER_FILE, "utf8"));
}

export function saveUser(user: UserRecord): void {
  writeFileSync(USER_FILE, JSON.stringify(user, null, 2));
}

export interface SceneMeta {
  id: string;
  name: string;
  wrappedKey: string; // base64 — scene AES key wrapped with master key
  wrappedKeyIv: string; // base64
  blobIv: string; // base64 — IV used to encrypt the scene blob itself
  createdAt: number;
  updatedAt: number;
  size: number;
}

const sceneBlobPath = (id: string) => join(SCENES_DIR, `${id}.bin`);
const sceneMetaPath = (id: string) => join(SCENES_DIR, `${id}.json`);

const SAFE_ID = /^[A-Za-z0-9_-]{6,64}$/;
export const isSafeId = (id: string) => SAFE_ID.test(id);

export function putScene(
  id: string,
  blob: Buffer,
  meta: Omit<SceneMeta, "id" | "createdAt" | "updatedAt" | "size">,
): SceneMeta {
  if (!isSafeId(id)) throw new Error("invalid scene id");
  const now = Date.now();
  const existing = existsSync(sceneMetaPath(id))
    ? (JSON.parse(readFileSync(sceneMetaPath(id), "utf8")) as SceneMeta)
    : null;
  writeFileSync(sceneBlobPath(id), blob);
  const record: SceneMeta = {
    id,
    name: meta.name,
    wrappedKey: meta.wrappedKey,
    wrappedKeyIv: meta.wrappedKeyIv,
    blobIv: meta.blobIv,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    size: blob.byteLength,
  };
  writeFileSync(sceneMetaPath(id), JSON.stringify(record, null, 2));
  return record;
}

export function renameScene(id: string, name: string): SceneMeta | null {
  if (!isSafeId(id) || !existsSync(sceneMetaPath(id))) return null;
  const meta = JSON.parse(readFileSync(sceneMetaPath(id), "utf8")) as SceneMeta;
  meta.name = name;
  meta.updatedAt = Date.now();
  writeFileSync(sceneMetaPath(id), JSON.stringify(meta, null, 2));
  return meta;
}

export function getSceneMeta(id: string): SceneMeta | null {
  if (!isSafeId(id) || !existsSync(sceneMetaPath(id))) return null;
  return JSON.parse(readFileSync(sceneMetaPath(id), "utf8"));
}

export function getSceneBlob(id: string): Buffer | null {
  if (!isSafeId(id) || !existsSync(sceneBlobPath(id))) return null;
  return readFileSync(sceneBlobPath(id));
}

export function listScenes(): SceneMeta[] {
  return readdirSync(SCENES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(SCENES_DIR, f), "utf8")) as SceneMeta)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteScene(id: string): boolean {
  if (!isSafeId(id)) return false;
  let removed = false;
  if (existsSync(sceneBlobPath(id))) {
    unlinkSync(sceneBlobPath(id));
    removed = true;
  }
  if (existsSync(sceneMetaPath(id))) {
    unlinkSync(sceneMetaPath(id));
    removed = true;
  }
  return removed;
}

export function totalStorageBytes(): number {
  return readdirSync(SCENES_DIR).reduce((sum, f) => {
    try {
      return sum + statSync(join(SCENES_DIR, f)).size;
    } catch {
      return sum;
    }
  }, 0);
}
