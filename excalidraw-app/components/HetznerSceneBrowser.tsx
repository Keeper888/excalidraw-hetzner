import React, { useCallback, useEffect, useRef, useState } from "react";

import { Dialog } from "@excalidraw/excalidraw/components/Dialog";

import {
  ensureAuthenticated,
  hasMasterKey,
  listScenes,
  renameScene,
  type SceneListItem,
} from "../data/hetzner";

import "./HetznerSceneBrowser.scss";

export const HetznerSceneBrowser: React.FC<{
  onLoad: (id: string) => void;
  onClose: () => void;
}> = ({ onLoad, onClose }) => {
  const [scenes, setScenes] = useState<SceneListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (!hasMasterKey()) {
        await ensureAuthenticated();
      }
      const data = await listScenes();
      setScenes(data.scenes);
    } catch (err: any) {
      setError(err?.message || "Failed to load scenes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (editingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [editingId]);

  const handleRenameStart = (scene: SceneListItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(scene.id);
    setEditingName(scene.name || "");
  };

  const handleRenameSubmit = async () => {
    if (!editingId) {
      return;
    }
    const trimmed = editingName.trim();
    if (trimmed) {
      try {
        await renameScene(editingId, trimmed);
        setScenes((prev) =>
          prev.map((s) => (s.id === editingId ? { ...s, name: trimmed } : s)),
        );
      } catch {
        // silently fail
      }
    }
    setEditingId(null);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleRenameSubmit();
    } else if (e.key === "Escape") {
      setEditingId(null);
    }
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) {
      return "just now";
    }
    if (diffMins < 60) {
      return `${diffMins}m ago`;
    }
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) {
      return `${diffDays}d ago`;
    }
    return d.toLocaleDateString();
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Dialog
      onCloseRequest={onClose}
      title="Your Drawings"
      size="small"
    >
      {loading && <div className="hetzner-browser__empty">Loading...</div>}

      {error && <div className="hetzner-browser__error">{error}</div>}

      {!loading && !error && scenes.length === 0 && (
        <div className="hetzner-browser__empty">
          No saved drawings yet. Use Export &rarr; Save to Hetzner to save your
          first drawing.
        </div>
      )}

      {!loading && scenes.length > 0 && (
        <ul className="hetzner-browser__list">
          {scenes.map((scene) => (
            <li key={scene.id} className="hetzner-browser__item">
              {editingId === scene.id ? (
                <div className="hetzner-browser__rename-row">
                  <input
                    ref={renameInputRef}
                    className="hetzner-browser__rename-input"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={handleRenameKeyDown}
                    onBlur={handleRenameSubmit}
                  />
                </div>
              ) : (
                <button
                  className="hetzner-browser__item-btn"
                  onClick={() => onLoad(scene.id)}
                >
                  <span className="hetzner-browser__item-name">
                    {scene.name || "Untitled"}
                  </span>
                  <span className="hetzner-browser__item-right">
                    <span className="hetzner-browser__item-meta">
                      {formatDate(scene.updatedAt)} &middot;{" "}
                      {formatSize(scene.size)}
                    </span>
                    <span
                      className="hetzner-browser__rename-btn"
                      title="Rename"
                      onClick={(e) => handleRenameStart(scene, e)}
                    >
                      &#9998;
                    </span>
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
};
