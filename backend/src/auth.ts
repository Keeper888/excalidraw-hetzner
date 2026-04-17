import { randomBytes } from "node:crypto";
import { Router } from "express";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/types";
import { SignJWT, jwtVerify } from "jose";

import { JWT_SECRET, ORIGIN, RP_ID, RP_NAME, SESSION_TTL_HOURS } from "./config.js";
import { loadUser, saveUser, type UserRecord } from "./store.js";

const CHALLENGE_TTL_MS = 5 * 60_000;
const PRF_FIRST_SALT = new TextEncoder().encode(
  "excalidraw-hetzner:master-key:v1",
);

function ensureUser(): UserRecord {
  let user = loadUser();
  if (!user) {
    user = {
      id: randomBytes(16).toString("hex"),
      username: "owner",
      credentials: [],
    };
    saveUser(user);
  }
  return user;
}

async function issueJwt(user: UserRecord): Promise<string> {
  return await new SignJWT({ uid: user.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_HOURS}h`)
    .sign(JWT_SECRET);
}

export async function verifyJwt(token: string): Promise<{ uid: string } | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return { uid: payload.uid as string };
  } catch {
    return null;
  }
}

export const authRouter = Router();

authRouter.get("/status", (_req, res) => {
  const user = loadUser();
  res.json({
    registered: !!user && user.credentials.length > 0,
    credentialCount: user?.credentials.length ?? 0,
  });
});

authRouter.post("/register/start", async (_req, res) => {
  const user = ensureUser();

  // After the first credential is registered, further registrations require a
  // valid session JWT. Phase 1 single-user model: only the owner can add keys.
  if (user.credentials.length > 0) {
    res.status(403).json({ error: "owner already registered" });
    return;
  }

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: user.username,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: user.credentials.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransportFuture[] | undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
    extensions: { prf: {} } as any,
  });

  user.currentChallenge = options.challenge;
  user.currentChallengeKind = "register";
  user.currentChallengeExpires = Date.now() + CHALLENGE_TTL_MS;
  saveUser(user);

  res.json(options);
});

authRouter.post("/register/finish", async (req, res) => {
  const user = ensureUser();
  if (
    !user.currentChallenge ||
    user.currentChallengeKind !== "register" ||
    (user.currentChallengeExpires ?? 0) < Date.now()
  ) {
    res.status(400).json({ error: "no pending registration challenge" });
    return;
  }

  const response = req.body as RegistrationResponseJSON;
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: user.currentChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
    return;
  }

  if (!verification.verified || !verification.registrationInfo) {
    res.status(400).json({ error: "registration not verified" });
    return;
  }

  const { credential } = verification.registrationInfo;
  user.credentials.push({
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: response.response.transports,
    createdAt: Date.now(),
  });
  user.currentChallenge = undefined;
  user.currentChallengeKind = undefined;
  user.currentChallengeExpires = undefined;
  saveUser(user);

  const token = await issueJwt(user);
  res.json({ verified: true, token });
});

authRouter.post("/login/start", async (_req, res) => {
  const user = loadUser();
  if (!user || user.credentials.length === 0) {
    res.status(404).json({ error: "no registered owner" });
    return;
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "required",
    allowCredentials: user.credentials.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransportFuture[] | undefined,
    })),
    extensions: {
      prf: {
        eval: { first: Buffer.from(PRF_FIRST_SALT).toString("base64url") },
      },
    } as any,
  });

  user.currentChallenge = options.challenge;
  user.currentChallengeKind = "login";
  user.currentChallengeExpires = Date.now() + CHALLENGE_TTL_MS;
  saveUser(user);

  res.json(options);
});

authRouter.post("/login/finish", async (req, res) => {
  const user = loadUser();
  if (
    !user ||
    !user.currentChallenge ||
    user.currentChallengeKind !== "login" ||
    (user.currentChallengeExpires ?? 0) < Date.now()
  ) {
    res.status(400).json({ error: "no pending login challenge" });
    return;
  }

  const response = req.body as AuthenticationResponseJSON;
  const stored = user.credentials.find((c) => c.id === response.id);
  if (!stored) {
    res.status(400).json({ error: "unknown credential" });
    return;
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: user.currentChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
      credential: {
        id: stored.id,
        publicKey: Buffer.from(stored.publicKey, "base64url"),
        counter: stored.counter,
        transports: stored.transports as AuthenticatorTransportFuture[] | undefined,
      },
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
    return;
  }

  if (!verification.verified) {
    res.status(400).json({ error: "authentication not verified" });
    return;
  }

  stored.counter = verification.authenticationInfo.newCounter;
  user.currentChallenge = undefined;
  user.currentChallengeKind = undefined;
  user.currentChallengeExpires = undefined;
  saveUser(user);

  const token = await issueJwt(user);
  res.json({ verified: true, token });
});
