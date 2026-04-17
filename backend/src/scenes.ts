import { Router, type Request, type Response, type NextFunction } from "express";

import { verifyJwt } from "./auth.js";
import {
  deleteScene,
  getSceneBlob,
  getSceneMeta,
  isSafeId,
  listScenes,
  putScene,
  totalStorageBytes,
} from "./store.js";

const MAX_SCENE_BYTES = 25 * 1024 * 1024; // 25 MB per scene

async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "missing bearer token" });
    return;
  }
  const session = await verifyJwt(auth.slice("Bearer ".length));
  if (!session) {
    res.status(401).json({ error: "invalid or expired token" });
    return;
  }
  next();
}

export const scenesRouter = Router();

scenesRouter.use(requireAuth);

scenesRouter.get("/", (_req, res) => {
  res.json({
    scenes: listScenes().map((s) => ({
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      size: s.size,
    })),
    totalBytes: totalStorageBytes(),
  });
});

scenesRouter.put("/:id", (req, res) => {
  const { id } = req.params;
  if (!isSafeId(id)) {
    res.status(400).json({ error: "invalid scene id" });
    return;
  }

  const wrappedKey = req.header("x-wrapped-key");
  const wrappedKeyIv = req.header("x-wrapped-key-iv");
  const blobIv = req.header("x-blob-iv");
  const name = req.header("x-scene-name") || "Untitled";

  if (!wrappedKey || !wrappedKeyIv || !blobIv) {
    res.status(400).json({ error: "missing wrap headers" });
    return;
  }

  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    res.status(400).json({ error: "empty body" });
    return;
  }
  if (body.length > MAX_SCENE_BYTES) {
    res.status(413).json({ error: "scene too large" });
    return;
  }

  const meta = putScene(id, body, {
    name: decodeURIComponent(name),
    wrappedKey,
    wrappedKeyIv,
    blobIv,
  });
  res.json(meta);
});

scenesRouter.get("/:id", (req, res) => {
  const { id } = req.params;
  const meta = getSceneMeta(id);
  const blob = getSceneBlob(id);
  if (!meta || !blob) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({
    meta,
    ciphertext: blob.toString("base64"),
  });
});

scenesRouter.delete("/:id", (req, res) => {
  const ok = deleteScene(req.params.id);
  res.status(ok ? 204 : 404).end();
});
