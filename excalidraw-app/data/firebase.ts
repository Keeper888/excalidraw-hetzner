import { reconcileElements } from "@excalidraw/excalidraw";
import { MIME_TYPES, toBrandedType } from "@excalidraw/common";
import { decompressData } from "@excalidraw/excalidraw/data/encode";
import {
  encryptData,
  decryptData,
} from "@excalidraw/excalidraw/data/encryption";
import { restoreElements } from "@excalidraw/excalidraw/data/restore";
import { getSceneVersion } from "@excalidraw/element";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type {
  ExcalidrawElement,
  FileId,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFileMetadata,
  DataURL,
} from "@excalidraw/excalidraw/types";

import { getSyncableElements } from ".";

import type { SyncableExcalidrawElement } from ".";
import type Portal from "../collab/Portal";
import type { Socket } from "socket.io-client";

const COLLAB_BACKEND =
  import.meta.env.VITE_APP_COLLAB_BACKEND_URL || "";

const isBackendConfigured = () => !!COLLAB_BACKEND;

// ---------------------------------------------------------------------------

const encryptElements = async (
  key: string,
  elements: readonly ExcalidrawElement[],
): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array }> => {
  const json = JSON.stringify(elements);
  const encoded = new TextEncoder().encode(json);
  const { encryptedBuffer, iv } = await encryptData(key, encoded);
  return { ciphertext: encryptedBuffer, iv };
};

interface StoredScene {
  sceneVersion: number;
  iv: string;
  ciphertext: string;
}

const decryptElements = async (
  data: StoredScene,
  roomKey: string,
): Promise<readonly ExcalidrawElement[]> => {
  const ciphertext = Uint8Array.from(atob(data.ciphertext), (c) =>
    c.charCodeAt(0),
  ) as Uint8Array<ArrayBuffer>;
  const iv = Uint8Array.from(atob(data.iv), (c) =>
    c.charCodeAt(0),
  ) as Uint8Array<ArrayBuffer>;

  const decrypted = await decryptData(iv, ciphertext, roomKey);
  const decodedData = new TextDecoder("utf-8").decode(
    new Uint8Array(decrypted),
  );
  return JSON.parse(decodedData);
};

function toBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes =
    buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------

class SceneVersionCache {
  private static cache = new WeakMap<Socket, number>();
  static get = (socket: Socket) => SceneVersionCache.cache.get(socket);
  static set = (
    socket: Socket,
    elements: readonly SyncableExcalidrawElement[],
  ) => {
    SceneVersionCache.cache.set(socket, getSceneVersion(elements));
  };
}

export const isSavedToFirebase = (
  portal: Portal,
  elements: readonly ExcalidrawElement[],
): boolean => {
  if (!isBackendConfigured()) return true;
  if (portal.socket && portal.roomId && portal.roomKey) {
    const sceneVersion = getSceneVersion(elements);
    return SceneVersionCache.get(portal.socket) === sceneVersion;
  }
  return true;
};

export const saveFilesToFirebase = async ({
  prefix,
  files,
}: {
  prefix: string;
  files: { id: FileId; buffer: Uint8Array }[];
}) => {
  if (!isBackendConfigured()) {
    return {
      savedFiles: [] as FileId[],
      erroredFiles: files.map((f) => f.id),
    };
  }

  const erroredFiles: FileId[] = [];
  const savedFiles: FileId[] = [];

  await Promise.all(
    files.map(async ({ id, buffer }) => {
      try {
        const res = await fetch(
          `${COLLAB_BACKEND}/api/files/${encodeURIComponent(prefix)}/${id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/octet-stream" },
            body: buffer as unknown as BodyInit,
          },
        );
        if (res.ok) {
          savedFiles.push(id);
        } else {
          erroredFiles.push(id);
        }
      } catch {
        erroredFiles.push(id);
      }
    }),
  );

  return { savedFiles, erroredFiles };
};

export const saveToFirebase = async (
  portal: Portal,
  elements: readonly SyncableExcalidrawElement[],
  appState: AppState,
) => {
  const { roomId, roomKey, socket } = portal;
  if (
    !isBackendConfigured() ||
    !roomId ||
    !roomKey ||
    !socket ||
    isSavedToFirebase(portal, elements)
  ) {
    return null;
  }

  try {
    const existingRes = await fetch(
      `${COLLAB_BACKEND}/api/rooms/${roomId}`,
    );

    let reconciledElements: readonly SyncableExcalidrawElement[] = elements;

    if (existingRes.ok) {
      const existing: StoredScene = await existingRes.json();
      const prevStoredElements = getSyncableElements(
        restoreElements(
          await decryptElements(existing, roomKey),
          null,
        ),
      );
      reconciledElements = getSyncableElements(
        reconcileElements(
          elements,
          prevStoredElements as OrderedExcalidrawElement[] as RemoteExcalidrawElement[],
          appState,
        ),
      );
    }

    const sceneVersion = getSceneVersion(reconciledElements);
    const { ciphertext, iv } = await encryptElements(
      roomKey,
      reconciledElements,
    );

    const body: StoredScene = {
      sceneVersion,
      iv: toBase64(iv),
      ciphertext: toBase64(ciphertext),
    };

    await fetch(`${COLLAB_BACKEND}/api/rooms/${roomId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    SceneVersionCache.set(socket, reconciledElements);
    return toBrandedType<RemoteExcalidrawElement[]>(
      reconciledElements as SyncableExcalidrawElement[],
    );
  } catch (error: any) {
    console.error("saveToFirebase (self-hosted) failed:", error);
    return null;
  }
};

export const loadFromFirebase = async (
  roomId: string,
  roomKey: string,
  socket: Socket | null,
): Promise<readonly SyncableExcalidrawElement[] | null> => {
  if (!isBackendConfigured()) return null;

  try {
    const res = await fetch(`${COLLAB_BACKEND}/api/rooms/${roomId}`);
    if (!res.ok) return null;

    const storedScene: StoredScene = await res.json();
    const elements = getSyncableElements(
      restoreElements(await decryptElements(storedScene, roomKey), null, {
        deleteInvisibleElements: true,
      }),
    );

    if (socket) {
      SceneVersionCache.set(socket, elements);
    }

    return elements;
  } catch (error: any) {
    console.error("loadFromFirebase (self-hosted) failed:", error);
    return null;
  }
};

export const loadFilesFromFirebase = async (
  prefix: string,
  decryptionKey: string,
  filesIds: readonly FileId[],
) => {
  const loadedFiles: BinaryFileData[] = [];
  const erroredFiles = new Map<FileId, true>();

  if (!isBackendConfigured()) {
    return { loadedFiles, erroredFiles };
  }

  await Promise.all(
    [...new Set(filesIds)].map(async (id) => {
      try {
        const url = `${COLLAB_BACKEND}/api/files/${encodeURIComponent(
          prefix.replace(/^\//, ""),
        )}/${id}`;
        const response = await fetch(url);
        if (response.status < 400) {
          const arrayBuffer = await response.arrayBuffer();

          const { data, metadata } = await decompressData<BinaryFileMetadata>(
            new Uint8Array(arrayBuffer),
            {
              decryptionKey,
            },
          );

          const dataURL = new TextDecoder().decode(data) as DataURL;

          loadedFiles.push({
            mimeType: metadata.mimeType || MIME_TYPES.binary,
            id,
            dataURL,
            created: metadata?.created || Date.now(),
            lastRetrieved: metadata?.created || Date.now(),
          });
        } else {
          erroredFiles.set(id, true);
        }
      } catch (error: any) {
        erroredFiles.set(id, true);
        console.error(error);
      }
    }),
  );

  return { loadedFiles, erroredFiles };
};

export const loadFirebaseStorage = async () => {
  return null;
};
