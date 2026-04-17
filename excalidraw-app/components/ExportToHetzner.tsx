import React, { useState } from "react";
import { nanoid } from "nanoid";

import { trackEvent } from "@excalidraw/excalidraw/analytics";
import { Card } from "@excalidraw/excalidraw/components/Card";
import { ExcalidrawLogo } from "@excalidraw/excalidraw/components/ExcalidrawLogo";
import { ToolButton } from "@excalidraw/excalidraw/components/ToolButton";
import { getFrame } from "@excalidraw/common";
import { serializeAsJSON } from "@excalidraw/excalidraw/data/json";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

import { ensureAuthenticated, saveSceneToHetzner } from "../data/hetzner";

export const exportToHetzner = async (
  elements: readonly NonDeletedExcalidrawElement[],
  appState: Partial<AppState>,
  files: BinaryFiles,
  name: string,
) => {
  await ensureAuthenticated();

  const id = nanoid(12);
  const sceneJSON = serializeAsJSON(elements, appState, files, "database");
  const result = await saveSceneToHetzner(id, name, sceneJSON);

  const url = `${window.location.origin}/#hetzner=${id}`;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // clipboard may be unavailable
  }
  return { url, ...result };
};

export const ExportToHetzner: React.FC<{
  elements: readonly NonDeletedExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
  name: string;
  onError: (error: Error) => void;
  onSuccess: () => void;
}> = ({ elements, appState, files, name, onError, onSuccess }) => {
  const [sceneName, setSceneName] = useState(name || "");

  return (
    <Card color="primary">
      <div className="Card-icon">
        <ExcalidrawLogo
          style={{
            [`--color-logo-icon` as any]: "#fff",
            width: "2.8rem",
            height: "2.8rem",
          }}
        />
      </div>
      <h2>Save to Hetzner</h2>
      <div className="Card-details">
        <input
          type="text"
          value={sceneName}
          onChange={(e) => setSceneName(e.target.value)}
          placeholder="Drawing name"
          style={{
            width: "100%",
            padding: "0.5rem 0.75rem",
            borderRadius: "6px",
            border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(0,0,0,0.2)",
            color: "inherit",
            fontSize: "0.9rem",
            marginBottom: "0.5rem",
            boxSizing: "border-box",
          }}
          autoFocus
        />
      </div>
      <ToolButton
        className="Card-button"
        type="button"
        title="Save to Hetzner"
        aria-label="Save to Hetzner"
        showAriaLabel={true}
        onClick={async () => {
          const finalName = sceneName.trim() || "Untitled";
          try {
            trackEvent("export", "hetzner", `ui (${getFrame()})`);
            await exportToHetzner(elements, appState, files, finalName);
            onSuccess();
          } catch (error: any) {
            console.error(error);
            if (error.name !== "AbortError") {
              onError(new Error(error?.message || "Failed to save to Hetzner"));
            }
          }
        }}
      />
    </Card>
  );
};
