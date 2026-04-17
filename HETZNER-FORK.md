# Excalidraw Hetzner Fork

Customizations on top of upstream excalidraw:

| Change | Where |
|---|---|
| Plain mouse-wheel zooms (Ctrl+wheel pans, Shift+wheel = horizontal) | `packages/excalidraw/components/App.tsx` `handleWheel` |
| `MIN_ZOOM` lowered from 0.1 → 0.01 (10× deeper zoom-out) | `packages/common/src/constants.ts:303` |
| "Save to Excalidraw+" button replaced with "Save to Hetzner" | `excalidraw-app/components/ExportToHetzner.tsx` |
| AES-GCM client-side encryption + WebAuthn-PRF key wrapping | `excalidraw-app/data/hetzner.ts` |
| Tiny opaque-blob storage backend on `:4242` | `backend/` |

## Crypto model

```
masterKey  = WebAuthn-PRF(salt = "excalidraw-hetzner:master-key:v1")  [32 bytes, in-memory only]
sceneKey   = random AES-GCM 256                                        [per save]
wrappedKey = AES-GCM(masterKey, sceneKey)                              [stored on server]
ciphertext = AES-GCM(sceneKey, sceneJSON)                              [stored on server]
```

Server only ever sees opaque ciphertext + wrappedKey. Without your passkey gesture (Windows Hello / Touch ID / hardware key with PRF support), the master key cannot be regenerated and nothing on the server is decryptable.

The session JWT (8h TTL) gates *access* to your blobs but not *decryption*. After a page reload you keep the JWT but must tap your passkey again to recover the in-memory master key.

## Run locally

```bash
# terminal 1 — backend on :4242
cd backend
yarn install        # one-time
yarn dev

# terminal 2 — frontend on :4243
yarn install        # one-time, from repo root
yarn start
```

Open http://localhost:4243, click export → "Save to Hetzner". First click triggers passkey registration (Windows Hello prompt on this machine).

## Deploying to Hetzner (later)

Set in `backend/.env`:
```
PORT=4242
RP_ID=excalidraw.gison.it           # or wherever you host the frontend
ORIGIN=https://excalidraw.gison.it
```

Deploy via Coolify as a Node service. Bind data volume so `data/` survives restarts.

## Browser support

WebAuthn PRF extension is required:
- Chrome / Edge ≥ 116
- Safari ≥ 18
- Firefox: not yet (would need PBKDF2-passphrase fallback — not built)
