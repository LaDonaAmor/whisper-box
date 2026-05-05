import { useState, type FormEvent } from "react";
import { Lock, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

type Mode = "login" | "register" | "unlock";

interface Props {
  initialMode?: Mode;
}

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
        await login(username.trim(), password);
      } else if (mode === "register") {
        if (password.length < 8)
          throw new Error("Password must be at least 8 characters");
        if (username.trim().length < 3)
          throw new Error("Username must be at least 3 characters");
        await register(
          username.trim(),
          displayName.trim() || username.trim(),
          password,
        );
        toast.success("Account created — your keys are generated locally.");
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
      <div className="glass rounded-[2rem] p-8 shadow-pop">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-mine text-primary-foreground shadow-bubble">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">WhisperBox</h1>
            <p className="text-xs text-muted-foreground">
              End-to-end encrypted messaging
            </p>
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
            ? "Enter your password to unlock your private key on this device."
            : isRegister
              ? "Your encryption keys are generated in your browser. We never see them."
              : "Your password unlocks your private key — it never leaves this device."}
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
                className="h-11 rounded-xl"
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
                className="h-11 rounded-xl"
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
              className="h-11 rounded-xl"
            />
          </div>

          <Button
            type="submit"
            disabled={busy}
            className="h-11 w-full rounded-xl bg-mine text-primary-foreground shadow-bubble transition hover:opacity-95"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isUnlock ? (
              <>
                <Lock className="mr-2 h-4 w-4" /> Unlock
              </>
            ) : isRegister ? (
              "Create account"
            ) : (
              "Sign in"
            )}
          </Button>
        </form>

        {!isUnlock && (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "login"
              ? "New to WhisperBox?"
              : "Already have an account?"}{" "}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => setMode(mode === "login" ? "register" : "login")}
            >
              {mode === "login" ? "Create account" : "Sign in"}
            </button>
          </p>
        )}

        <div className="mt-6 flex items-center gap-2 rounded-xl bg-accent/60 px-3 py-2 text-xs text-accent-foreground">
          <Lock className="h-3.5 w-3.5" />
          <span>Keys generated locally • Server stores only ciphertext</span>
        </div>
      </div>
    </div>
  );
}
