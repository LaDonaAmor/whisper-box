import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { LogOut, Lock, Wifi, WifiOff, ShieldCheck } from "lucide-react";
import AuthCard from "@/components/AuthCard";
import ConversationsSidebar from "@/components/ConversationsSidebar";
import ChatThread from "@/components/ChatThread";
import ThemeToggle from "@/components/ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { onStatus } from "@/lib/ws";
import { cn } from "@/lib/utils";

interface Peer {
  id: string;
  display_name: string;
  username: string;
}

const Index = () => {
  const { user, loading, locked, logout } = useAuth();
  const [peer, setPeer] = useState<Peer | null>(null);
  const [openedChats, setOpenedChats] = useState<Peer[]>([]);
  const [convRefresh, setConvRefresh] = useState(0);
  const [wsStatus, setWsStatus] = useState<"connecting" | "open" | "closed">(
    "closed",
  );

  useEffect(() => onStatus(setWsStatus), []);

  function selectPeer(p: Peer) {
    setPeer(p);
    setOpenedChats((prev) =>
      prev.some((x) => x.id === p.id) ? prev : [p, ...prev],
    );
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </main>
    );
  }

  if (!user || locked) {
    return (
      <>
        <Helmet>
          <title>WhisperBox — End-to-End Encrypted Messaging</title>
          <meta
            name="description"
            content="Private messaging with end-to-end encryption. Keys generated in your browser, never seen by the server."
          />
          <link rel="canonical" href="/" />
        </Helmet>
        <main className="flex min-h-screen items-center justify-center px-4 py-10">
          <h1 className="sr-only">WhisperBox — sign in</h1>
          <AuthCard initialMode={locked ? "unlock" : "login"} />
        </main>
      </>
    );
  }

  return (
    <>
      <Helmet>
        <title>WhisperBox — Secure Chat</title>
        <meta
          name="description"
          content="End-to-end encrypted messaging. Your conversations stay between you and the recipient."
        />
        <link rel="canonical" href="/" />
      </Helmet>

      <main className="flex h-[100dvh] w-full overflow-hidden">
        {/* Sidebar column */}
        <div
          className={cn(
            "flex w-full flex-col border-r border-border md:w-[340px] md:max-w-[380px]",
            peer && "hidden md:flex",
          )}
        >
          <header className="flex items-center justify-between gap-3 border-b border-border bg-surface-glass/60 px-4 py-3 backdrop-blur-xl">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-mine text-primary-foreground shadow-bubble">
                <ShieldCheck className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold leading-tight">
                  {user.display_name}
                </div>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  {wsStatus === "open" ? (
                    <>
                      <Wifi className="h-3 w-3 text-success" /> Connected
                    </>
                  ) : wsStatus === "connecting" ? (
                    <>
                      <Wifi className="h-3 w-3 animate-pulse" /> Connecting…
                    </>
                  ) : (
                    <>
                      <WifiOff className="h-3 w-3" /> Offline
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full"
                onClick={logout}
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </header>
          <div className="min-h-0 flex-1">
            <ConversationsSidebar
              selectedUserId={peer?.id ?? null}
              onSelect={selectPeer}
              refreshKey={convRefresh}
              pinned={openedChats}
            />
          </div>
        </div>

        {/* Chat column */}
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col",
            !peer && "hidden md:flex",
          )}
        >
          {peer ? (
            <ChatThread
              peer={peer}
              onBack={() => setPeer(null)}
              onMessageSent={() => setConvRefresh((n) => n + 1)}
            />
          ) : (
            <div className="flex h-full flex-1 flex-col items-center justify-center px-6 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-mine text-primary-foreground shadow-pop">
                <Lock className="h-7 w-7" />
              </div>
              <h2 className="text-xl font-semibold tracking-tight">
                Pick a conversation
              </h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Or tap <span className="font-medium">+</span> to start a new
                encrypted chat. Messages are encrypted on this device — the
                server only stores ciphertext.
              </p>
            </div>
          )}
        </div>
      </main>
    </>
  );
};

export default Index;
