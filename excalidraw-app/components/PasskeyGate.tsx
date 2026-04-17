import React, { useCallback, useEffect, useState } from "react";

import {
  ensureAuthenticated,
  getAuthStatus,
  getSessionToken,
  hasMasterKey,
} from "../data/hetzner";

import "./PasskeyGate.scss";

type GateState =
  | "checking"
  | "needs-register"
  | "needs-login"
  | "authenticating"
  | "ready"
  | "error";

export const PasskeyGate: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [state, setState] = useState<GateState>("checking");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (getSessionToken() && hasMasterKey()) {
      setState("ready");
      return;
    }
    getAuthStatus()
      .then((s) => {
        setState(s.registered ? "needs-login" : "needs-register");
      })
      .catch(() => {
        setState("needs-login");
      });
  }, []);

  const handleAuth = useCallback(async () => {
    setState("authenticating");
    setError("");
    try {
      await ensureAuthenticated();
      setState("ready");
    } catch (err: any) {
      setError(err?.message || "Authentication failed");
      setState(
        (await getAuthStatus().catch(() => ({ registered: true }))).registered
          ? "needs-login"
          : "needs-register",
      );
    }
  }, []);

  if (state === "ready") {
    return <>{children}</>;
  }

  return (
    <div className="passkey-gate">
      <div className="passkey-gate__card">
        <div className="passkey-gate__icon">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            <circle cx="12" cy="16" r="1.5" />
          </svg>
        </div>

        {state === "checking" && (
          <p className="passkey-gate__status">Connecting...</p>
        )}

        {state === "needs-register" && (
          <>
            <h2>Set up your passkey</h2>
            <p>
              Register a passkey (Windows Hello, Touch ID, or a hardware key) to
              encrypt and protect your drawings.
            </p>
            <button className="passkey-gate__btn" onClick={handleAuth}>
              Register passkey
            </button>
          </>
        )}

        {state === "needs-login" && (
          <>
            <h2>Tap your passkey</h2>
            <p>Authenticate to access your encrypted workspace.</p>
            <button className="passkey-gate__btn" onClick={handleAuth}>
              Unlock
            </button>
          </>
        )}

        {state === "authenticating" && (
          <p className="passkey-gate__status">Waiting for passkey...</p>
        )}

        {error && <p className="passkey-gate__error">{error}</p>}
      </div>
    </div>
  );
};
