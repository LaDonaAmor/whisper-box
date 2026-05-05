import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as api from "@/lib/api";
import {
  generateRsaKeypair,
  exportPublicKey,
  wrapPrivateKey,
  unwrapPrivateKey,
} from "@/lib/crypto";
import {
  setSessionKeys,
  clearSessionKeys,
  hasSessionKeys,
} from "@/lib/session";
import { startWs, stopWs } from "@/lib/ws";
import type { UserProfile } from "@/lib/types";

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (
    username: string,
    displayName: string,
    password: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  locked: boolean; // session restored but no private key — needs password
  unlock: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);

  // Try to restore via refresh token (no private key yet — user must unlock with password)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!api.hasRefreshToken()) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.getMe();
        if (cancelled) return;
        setUser(me);
        setLocked(true);
      } catch {
        api.clearTokens();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function doLogin(username: string, password: string) {
    const res = await api.login(username, password);
    const priv = await unwrapPrivateKey(
      res.user.wrapped_private_key,
      res.user.pbkdf2_salt,
      password,
    );
    setSessionKeys(priv, res.user.public_key);
    setUser(res.user);
    setLocked(false);
    startWs();
  }

  async function doRegister(
    username: string,
    displayName: string,
    password: string,
  ) {
    const kp = await generateRsaKeypair();
    const publicKeyB64 = await exportPublicKey(kp.publicKey);
    const { wrappedPrivateKey, salt } = await wrapPrivateKey(
      kp.privateKey,
      password,
    );
    const res = await api.register({
      username,
      display_name: displayName,
      password,
      public_key: publicKeyB64,
      wrapped_private_key: wrappedPrivateKey,
      pbkdf2_salt: salt,
    });
    // Re-unwrap to get a non-extractable session key
    const priv = await unwrapPrivateKey(wrappedPrivateKey, salt, password);
    setSessionKeys(priv, publicKeyB64);
    setUser(res.user);
    setLocked(false);
    startWs();
  }

  async function unlock(password: string) {
    if (!user) throw new Error("No user");
    const priv = await unwrapPrivateKey(
      user.wrapped_private_key,
      user.pbkdf2_salt,
      password,
    );
    setSessionKeys(priv, user.public_key);
    setLocked(false);
    startWs();
  }

  async function doLogout() {
    stopWs();
    await api.logout();
    clearSessionKeys();
    setUser(null);
    setLocked(false);
  }

  // If user is set & not locked, ensure WS is running
  useEffect(() => {
    if (user && !locked && hasSessionKeys()) startWs();
  }, [user, locked]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login: doLogin,
      register: doRegister,
      logout: doLogout,
      locked,
      unlock,
    }),
    [user, loading, locked],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
