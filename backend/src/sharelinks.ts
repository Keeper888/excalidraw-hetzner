import { Router } from "express";
import { randomBytes } from "node:crypto";
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

const LINKS_DIR = resolve(DATA_DIR, "sharelinks");
mkdirSync(LINKS_DIR, { recursive: true });

const MAX_LINK_SIZE = 10 * 1024 * 1024;
const LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function linkBlobPath(id: string) {
  return join(LINKS_DIR, `${id}.bin`);
}

function linkFilesDir(id: string) {
  return join(LINKS_DIR, id);
}

export const shareLinksRouter = Router();

shareLinksRouter.post("/post/", (req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    const buffer = Buffer.concat(chunks);
    if (buffer.byteLength > MAX_LINK_SIZE) {
      return res
        .status(413)
        .json({ error_class: "RequestTooLargeError" });
    }

    const id = randomBytes(12).toString("hex");
    writeFileSync(linkBlobPath(id), buffer);
    res.json({ id });
  });
});

shareLinksRouter.get("/:id", (req, res) => {
  const { id } = req.params;
  const path = linkBlobPath(id);
  if (!existsSync(path)) {
    return res.status(404).json({ error: "not found" });
  }

  res.set("Content-Type", "application/octet-stream");
  res.send(readFileSync(path));
});

export const filesRouter = Router();

filesRouter.put("/:prefix/:fileId", (req, res) => {
  const { prefix, fileId } = req.params;
  const dir = join(LINKS_DIR, "files", decodeURIComponent(prefix));
  mkdirSync(dir, { recursive: true });

  const filePath = join(dir, fileId);
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    writeFileSync(filePath, Buffer.concat(chunks));
    res.json({ ok: true });
  });
});

filesRouter.get("/:prefix/:fileId", (req, res) => {
  const { prefix, fileId } = req.params;
  const dir = join(LINKS_DIR, "files", decodeURIComponent(prefix));
  const filePath = join(dir, fileId);

  if (!existsSync(filePath)) {
    return res.status(404).json({ error: "not found" });
  }

  res.set("Cache-Control", "public, max-age=31536000");
  res.set("Content-Type", "application/octet-stream");
  res.send(readFileSync(filePath));
});

function cleanupOldLinks() {
  const now = Date.now();
  try {
    for (const file of readdirSync(LINKS_DIR)) {
      const fullPath = join(LINKS_DIR, file);
      if (file.endsWith(".bin")) {
        const stat = statSync(fullPath);
        if (now - stat.mtimeMs > LINK_TTL_MS) {
          unlinkSync(fullPath);
          const id = file.replace(".bin", "");
          const filesDir = linkFilesDir(id);
          if (existsSync(filesDir)) {
            rmSync(filesDir, { recursive: true });
          }
        }
      }
    }
  } catch (err) {
    console.error("share link cleanup error:", err);
  }
}

setInterval(cleanupOldLinks, 60 * 60 * 1000);
cleanupOldLinks();
