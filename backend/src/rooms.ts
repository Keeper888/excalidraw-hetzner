import { Router } from "express";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  statSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { DATA_DIR } from "./config.js";

const ROOMS_DIR = resolve(DATA_DIR, "rooms");
mkdirSync(ROOMS_DIR, { recursive: true });

const SAFE_ROOM_ID = /^[a-fA-F0-9]{10,64}$/;
const MAX_ROOM_SIZE = 25 * 1024 * 1024;
const ROOM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function roomPath(roomId: string) {
  return join(ROOMS_DIR, `${roomId}.json`);
}

function roomFilesDir(roomId: string) {
  return join(ROOMS_DIR, roomId);
}

export const roomsRouter = Router();

roomsRouter.get("/:roomId", (req, res) => {
  const { roomId } = req.params;
  if (!SAFE_ROOM_ID.test(roomId)) {
    return res.status(400).json({ error: "invalid room id" });
  }

  const path = roomPath(roomId);
  if (!existsSync(path)) {
    return res.status(404).json({ error: "not found" });
  }

  const data = JSON.parse(readFileSync(path, "utf8"));
  res.json(data);
});

roomsRouter.put("/:roomId", (req, res) => {
  const { roomId } = req.params;
  if (!SAFE_ROOM_ID.test(roomId)) {
    return res.status(400).json({ error: "invalid room id" });
  }

  const body = req.body;
  if (
    !body ||
    typeof body.sceneVersion !== "number" ||
    typeof body.iv !== "string" ||
    typeof body.ciphertext !== "string"
  ) {
    return res.status(400).json({ error: "invalid payload" });
  }

  const rawSize = body.iv.length + body.ciphertext.length;
  if (rawSize > MAX_ROOM_SIZE) {
    return res.status(413).json({ error: "payload too large" });
  }

  const path = roomPath(roomId);
  if (existsSync(path)) {
    const existing = JSON.parse(readFileSync(path, "utf8"));
    if (existing.sceneVersion > body.sceneVersion) {
      return res.json(existing);
    }
  }

  const record = {
    sceneVersion: body.sceneVersion,
    iv: body.iv,
    ciphertext: body.ciphertext,
    updatedAt: Date.now(),
  };
  writeFileSync(path, JSON.stringify(record));
  res.json(record);
});

roomsRouter.get("/:roomId/files/:fileId", (req, res) => {
  const { roomId, fileId } = req.params;
  if (!SAFE_ROOM_ID.test(roomId)) {
    return res.status(400).json({ error: "invalid room id" });
  }

  const dir = roomFilesDir(roomId);
  const filePath = join(dir, fileId);
  if (!existsSync(filePath)) {
    return res.status(404).json({ error: "not found" });
  }

  res.set("Cache-Control", "public, max-age=31536000");
  res.set("Content-Type", "application/octet-stream");
  res.send(readFileSync(filePath));
});

roomsRouter.put("/:roomId/files/:fileId", (req, res) => {
  const { roomId, fileId } = req.params;
  if (!SAFE_ROOM_ID.test(roomId)) {
    return res.status(400).json({ error: "invalid room id" });
  }

  const dir = roomFilesDir(roomId);
  mkdirSync(dir, { recursive: true });

  const filePath = join(dir, fileId);
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    const buffer = Buffer.concat(chunks);
    writeFileSync(filePath, buffer);
    res.json({ ok: true });
  });
});

function cleanupOldRooms() {
  const now = Date.now();
  try {
    for (const file of readdirSync(ROOMS_DIR)) {
      const fullPath = join(ROOMS_DIR, file);
      if (file.endsWith(".json")) {
        const stat = statSync(fullPath);
        if (now - stat.mtimeMs > ROOM_TTL_MS) {
          unlinkSync(fullPath);
          const roomId = file.replace(".json", "");
          const filesDir = roomFilesDir(roomId);
          if (existsSync(filesDir)) {
            rmSync(filesDir, { recursive: true });
          }
        }
      }
    }
  } catch (err) {
    console.error("room cleanup error:", err);
  }
}

setInterval(cleanupOldRooms, 60 * 60 * 1000);
cleanupOldRooms();
