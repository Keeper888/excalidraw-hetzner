import express from "express";
import cors from "cors";

import { ORIGIN, PORT } from "./config.js";
import { authRouter } from "./auth.js";
import { scenesRouter } from "./scenes.js";

const app = express();

app.use(
  cors({
    origin: ORIGIN.split(",").map((o) => o.trim()),
    credentials: false,
    exposedHeaders: ["x-wrapped-key", "x-wrapped-key-iv", "x-blob-iv", "x-scene-name"],
  }),
);

app.use(express.json({ limit: "1mb" }));
app.use(
  "/api/scenes",
  express.raw({ type: "application/octet-stream", limit: "30mb" }),
);

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.use("/api/auth", authRouter);
app.use("/api/scenes", scenesRouter);

app.listen(PORT, () => {
  console.log(`excalidraw-hetzner backend listening on :${PORT}`);
  console.log(`  origin allowed: ${ORIGIN}`);
});
