import { useState, type FormEvent } from "react";
import { KeyRound, Lock, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

type Mode = "login" | "register" | "unlock";

interface Props {
  initialMode?: Mode;
}

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/;

export default function AuthCard({ initialMode = "login" }: Props) {
  const { login, register, unlock, locked, user } = useAuth();
  const [mode, setMode] = useState<Mode>(locked ? "unlock" : initialMode);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") {
        await login(username.trim().toLowerCase(), password);
      } else if (mode === "register") {
        const cleanUsername = username.trim().toLowerCase();
        if (!USERNAME_RE.test(cleanUsername)) {
          throw new Error("Username can use letters, numbers, _ or -");
        }
        if (password.length < 8) {
          throw new Error("Password must be at least 8 characters");
        }
        await register(cleanUsername, displayName.trim() || cleanUsername, password);
        toast.success("Account created. Keys generated on this device.");
      } else {
        await unlock(password);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const isUnlock = mode === "unlock";
  const isRegister = mode === "register";

  return (
    <div className="w-full max-w-md animate-pop-in">
      <div className="glass rounded-lg p-6 shadow-pop sm:p-7">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-mine text-primary-foreground shadow-bubble">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-tight">
                WhisperBox
              </h1>
              <p className="text-xs text-muted-foreground">
                End-to-end encrypted messaging
              </p>
            </div>
          </div>
          <div className="rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            E2EE
          </div>
        </div>

        <h2 className="mb-1 text-2xl font-semibold tracking-tight">
          {isUnlock
            ? `Welcome back, ${user?.display_name}`
            : isRegister
              ? "Create your account"
              : "Sign in"}
        </h2>
        <p className="mb-6 text-sm text-muted-foreground">
          {isUnlock
            ? "Enter your password to unwrap your private key in memory."
            : isRegister
              ? "A private RSA key is wrapped with a key derived from your password."
              : "Your password unlocks your wrapped private key on this device."}
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          {!isUnlock && (
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="alice_92"
                required
                minLength={3}
                maxLength={32}
                pattern="[A-Za-z0-9_-]{3,32}"
                className="h-11 rounded-lg bg-surface"
              />
            </div>
          )}
          {isRegister && (
            <div className="space-y-2">
              <Label htmlFor="display_name">Display name</Label>
              <Input
                id="display_name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Alice"
                maxLength={128}
                className="h-11 rounded-lg bg-surface"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete={isRegister ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={isRegister ? 8 : 1}
              maxLength={128}
              className="h-11 rounded-lg bg-surface"
            />
          </div>

          <Button
            type="submit"
            disabled={busy}
            className="h-11 w-full cursor-pointer rounded-lg bg-mine text-primary-foreground shadow-bubble transition hover:opacity-95"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isUnlock ? (
              <>
                <Lock className="mr-2 h-4 w-4" /> Unlock
              </>
            ) : isRegister ? (
              <>
                <KeyRound className="mr-2 h-4 w-4" /> Create account
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>

        {!isUnlock && (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "login" ? "New to WhisperBox?" : "Already have an account?"}{" "}
            <button
              type="button"
              className="cursor-pointer font-medium text-primary hover:underline"
              onClick={() => setMode(mode === "login" ? "register" : "login")}
            >
              {mode === "login" ? "Create account" : "Sign in"}
            </button>
          </p>
        )}

        <div className="mt-6 flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5 text-primary" />
          <span>Local keys. Ciphertext-only server.</span>
        </div>
      </div>
    </div>
  );
}
