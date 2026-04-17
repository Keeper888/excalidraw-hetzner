// Hetzner storage + WebAuthn-PRF crypto for the excalidraw fork.
//
// Key model:
//   masterKey     = WebAuthn PRF(salt = PRF_SALT)        — 32 bytes, in-memory only
//   sceneKey      = random AES-GCM 256                   — generated per save
//   wrappedKey    = AES-GCM(masterKey, sceneKey)         — stored on server
//   ciphertext    = AES-GCM(sceneKey, sceneJSON)         — stored on server
//
// Server never sees masterKey or sceneKey, only opaque ciphertext + wrappedKey.

const HETZNER_API: string =
  (import.meta as any).env?.VITE_HETZNER_API || "http://localhost:4242";

const SESSION_TOKEN_KEY = "hetzner_session";

// In-memory only — never persisted. Lost on page reload (forces re-auth).
let masterKey: CryptoKey | null = null;

// ----- base64url helpers -----

// helpers return ArrayBuffer (not Uint8Array) so they pass directly into the
// WebCrypto API without TS BufferSource complaints under newer node typings.
const b64uToBuffer = (s: string): ArrayBuffer => {
  const pad = s.length % 4 === 2 ? "==" : s.length % 4 === 3 ? "=" : "";
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out.buffer;
};

const bytesToB64u = (b: ArrayBuffer | Uint8Array): string => {
  const arr = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (let i = 0; i < arr.length; i++) {
    s += String.fromCharCode(arr[i]);
  }
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const bytesToB64 = (b: ArrayBuffer | Uint8Array): string => {
  const arr = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (let i = 0; i < arr.length; i++) {
    s += String.fromCharCode(arr[i]);
  }
  return btoa(s);
};

const b64ToBuffer = (s: string): ArrayBuffer => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out.buffer;
};

// Random IV as ArrayBuffer (instead of Uint8Array) so it satisfies
// AesGcmParams.iv typing across DOM lib versions.
const randomIvBuffer = (n = 12): ArrayBuffer => {
  const u = new Uint8Array(n);
  crypto.getRandomValues(u);
  return u.buffer;
};

// Convert a SimpleWebAuthn-style options payload into the structure
// `navigator.credentials.create/get` expects. base64url → ArrayBuffer for the
// challenge and credential ids; PRF salt → ArrayBuffer.
function decodeRegistrationOptions(opts: any): CredentialCreationOptions {
  return {
    publicKey: {
      ...opts,
      challenge: b64uToBuffer(opts.challenge),
      user: { ...opts.user, id: b64uToBuffer(opts.user.id) },
      excludeCredentials: (opts.excludeCredentials || []).map((c: any) => ({
        ...c,
        id: b64uToBuffer(c.id),
      })),
      extensions: { ...opts.extensions, prf: opts.extensions?.prf || {} },
    },
  };
}

function decodeAuthOptions(opts: any): CredentialRequestOptions {
  const prfEval = opts.extensions?.prf?.eval;
  return {
    publicKey: {
      ...opts,
      challenge: b64uToBuffer(opts.challenge),
      allowCredentials: (opts.allowCredentials || []).map((c: any) => ({
        ...c,
        id: b64uToBuffer(c.id),
      })),
      extensions: prfEval
        ? {
            ...opts.extensions,
            prf: { eval: { first: b64uToBuffer(prfEval.first) } },
          }
        : opts.extensions,
    },
  };
}

// ----- session token -----

export const getSessionToken = (): string | null =>
  localStorage.getItem(SESSION_TOKEN_KEY);

const setSessionToken = (token: string) =>
  localStorage.setItem(SESSION_TOKEN_KEY, token);

export const clearSession = () => {
  localStorage.removeItem(SESSION_TOKEN_KEY);
  masterKey = null;
};

export const hasMasterKey = () => masterKey !== null;

// ----- HTTP -----

async function api<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (
    !headers.has("content-type") &&
    init.body &&
    typeof init.body === "string"
  ) {
    headers.set("content-type", "application/json");
  }
  if (init.auth) {
    const tok = getSessionToken();
    if (!tok) {
      throw new Error("not authenticated");
    }
    headers.set("authorization", `Bearer ${tok}`);
  }
  const res = await fetch(`${HETZNER_API}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
}

export interface AuthStatus {
  registered: boolean;
  credentialCount: number;
}

export const getAuthStatus = () => api<AuthStatus>("/api/auth/status");

// ----- WebAuthn registration -----

export async function registerPasskey(): Promise<void> {
  const options = await api<any>("/api/auth/register/start", {
    method: "POST",
  });
  const cred = (await navigator.credentials.create(
    decodeRegistrationOptions(options),
  )) as PublicKeyCredential | null;
  if (!cred) {
    throw new Error("passkey creation cancelled");
  }

  const att = cred.response as AuthenticatorAttestationResponse;
  const body = {
    id: cred.id,
    rawId: bytesToB64u(cred.rawId),
    type: cred.type,
    response: {
      attestationObject: bytesToB64u(att.attestationObject),
      clientDataJSON: bytesToB64u(att.clientDataJSON),
      transports:
        typeof (att as any).getTransports === "function"
          ? (att as any).getTransports()
          : undefined,
    },
    clientExtensionResults: cred.getClientExtensionResults(),
  };

  const finish = await api<{ verified: boolean; token: string }>(
    "/api/auth/register/finish",
    { method: "POST", body: JSON.stringify(body) },
  );
  setSessionToken(finish.token);

  // Immediately do a login to obtain the PRF output and derive the master key.
  await loginWithPasskey();
}

// ----- WebAuthn auth + PRF master key -----

export async function loginWithPasskey(): Promise<void> {
  const options = await api<any>("/api/auth/login/start", { method: "POST" });
  const cred = (await navigator.credentials.get(
    decodeAuthOptions(options),
  )) as PublicKeyCredential | null;
  if (!cred) {
    throw new Error("passkey login cancelled");
  }

  const ext = cred.getClientExtensionResults() as any;
  const prfFirst: ArrayBuffer | undefined = ext?.prf?.results?.first;
  if (!prfFirst) {
    throw new Error(
      "your authenticator does not support the WebAuthn PRF extension — try a passkey on Chrome/Edge/Safari with a hardware security key, Touch ID, or Windows Hello",
    );
  }

  masterKey = await crypto.subtle.importKey(
    "raw",
    prfFirst,
    { name: "AES-GCM" },
    false,
    ["wrapKey", "unwrapKey", "encrypt", "decrypt"],
  );

  const ar = cred.response as AuthenticatorAssertionResponse;
  const body = {
    id: cred.id,
    rawId: bytesToB64u(cred.rawId),
    type: cred.type,
    response: {
      authenticatorData: bytesToB64u(ar.authenticatorData),
      clientDataJSON: bytesToB64u(ar.clientDataJSON),
      signature: bytesToB64u(ar.signature),
      userHandle: ar.userHandle ? bytesToB64u(ar.userHandle) : undefined,
    },
    clientExtensionResults: ext,
  };

  const finish = await api<{ verified: boolean; token: string }>(
    "/api/auth/login/finish",
    { method: "POST", body: JSON.stringify(body) },
  );
  setSessionToken(finish.token);
}

// ----- scene encryption -----

async function generateSceneKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

async function wrapSceneKey(
  sceneKey: CryptoKey,
): Promise<{ wrappedKey: string; wrappedKeyIv: string }> {
  if (!masterKey) {
    throw new Error("master key not loaded — log in first");
  }
  const iv = randomIvBuffer();
  const wrapped = await crypto.subtle.wrapKey("raw", sceneKey, masterKey, {
    name: "AES-GCM",
    iv,
  });
  return { wrappedKey: bytesToB64(wrapped), wrappedKeyIv: bytesToB64(iv) };
}

async function unwrapSceneKey(
  wrappedKey: string,
  wrappedKeyIv: string,
): Promise<CryptoKey> {
  if (!masterKey) {
    throw new Error("master key not loaded — log in first");
  }
  return crypto.subtle.unwrapKey(
    "raw",
    b64ToBuffer(wrappedKey),
    masterKey,
    { name: "AES-GCM", iv: b64ToBuffer(wrappedKeyIv) },
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface SaveResult {
  id: string;
  name: string;
  size: number;
}

export async function saveSceneToHetzner(
  id: string,
  name: string,
  sceneJSON: string,
): Promise<SaveResult> {
  const tok = getSessionToken();
  if (!tok || !masterKey) {
    throw new Error("not authenticated — tap your passkey first");
  }

  const sceneKey = await generateSceneKey();
  const blobIv = randomIvBuffer();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: blobIv },
    sceneKey,
    new TextEncoder().encode(sceneJSON),
  );
  const { wrappedKey, wrappedKeyIv } = await wrapSceneKey(sceneKey);

  const res = await fetch(`${HETZNER_API}/api/scenes/${id}`, {
    method: "PUT",
    headers: {
      "content-type": "application/octet-stream",
      authorization: `Bearer ${tok}`,
      "x-wrapped-key": wrappedKey,
      "x-wrapped-key-iv": wrappedKeyIv,
      "x-blob-iv": bytesToB64(blobIv),
      "x-scene-name": encodeURIComponent(name),
    },
    body: ciphertext,
  });

  if (!res.ok) {
    throw new Error(`save failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as SaveResult;
}

export async function loadSceneFromHetzner(id: string): Promise<string> {
  if (!masterKey) {
    throw new Error("not authenticated — tap your passkey first");
  }
  const data = await api<{
    meta: { wrappedKey: string; wrappedKeyIv: string; blobIv: string };
    ciphertext: string;
  }>(`/api/scenes/${id}`, { auth: true });

  const sceneKey = await unwrapSceneKey(
    data.meta.wrappedKey,
    data.meta.wrappedKeyIv,
  );
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBuffer(data.meta.blobIv) },
    sceneKey,
    b64ToBuffer(data.ciphertext),
  );
  return new TextDecoder().decode(plain);
}

// Ensures the user is authenticated and the master key is in memory. Used by
// both save (lazy register/login) and load (forced login if JWT expired or the
// master key was lost on page reload).
export async function ensureAuthenticated(): Promise<void> {
  if (getSessionToken() && hasMasterKey()) {
    return;
  }
  const status = await getAuthStatus();
  if (!status.registered) {
    await registerPasskey();
  } else {
    await loginWithPasskey();
  }
}

export interface ImportedHetznerScene {
  elements: any[] | null;
  appState: any | null;
}

// Used by App.tsx initializeScene() when the URL contains #hetzner=<id>.
// Triggers a passkey gesture if needed, then returns the parsed scene in the
// shape the editor expects.
export async function importFromHetzner(
  id: string,
): Promise<ImportedHetznerScene> {
  await ensureAuthenticated();
  const json = await loadSceneFromHetzner(id);
  const parsed = JSON.parse(json);
  return {
    elements: parsed.elements || null,
    appState: parsed.appState || null,
  };
}

export interface SceneListItem {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  size: number;
}

export const listScenes = () =>
  api<{ scenes: SceneListItem[]; totalBytes: number }>("/api/scenes", {
    auth: true,
  });

export const renameScene = (id: string, name: string) =>
  api<SceneListItem>(`/api/scenes/${id}/rename`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
    auth: true,
  });
