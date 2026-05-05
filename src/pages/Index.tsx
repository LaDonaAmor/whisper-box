import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import {
  Bell,
  LogOut,
  Lock,
  ShieldCheck,
  User,
  Wifi,
  WifiOff,
} from "lucide-react";
import AuthCard from "@/components/AuthCard";
import ConversationsSidebar from "@/components/ConversationsSidebar";
import ChatThread from "@/components/ChatThread";
import ThemeToggle from "@/components/ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { onMessage, onStatus } from "@/lib/ws";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Peer {
  id: string;
  display_name: string;
  username: string;
}

const Index = () => {
  const { user, loading, locked, logout } = useAuth();
  const [peer, setPeer] = useState<Peer | null>(null);
  const [openedChats, setOpenedChats] = useState<Peer[]>([]);
  const [hiddenChats, setHiddenChats] = useState<string[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [convRefresh, setConvRefresh] = useState(0);
  const [wsStatus, setWsStatus] = useState<"connecting" | "open" | "closed">(
    "closed",
  );

  useEffect(() => onStatus(setWsStatus), []);

  useEffect(() => {
    if (!user || locked || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => undefined);
    }
  }, [user, locked]);

  useEffect(() => {
    if (!user) return;
    return onMessage((msg) => {
      if (msg.from_user_id === user.id) return;
      const senderId = msg.from_user_id;
      const isActiveChat = peer?.id === senderId && document.hasFocus();

      if (!isActiveChat) {
        setUnreadCounts((prev) => ({
          ...prev,
          [senderId]: (prev[senderId] ?? 0) + 1,
        }));
        toast.info("New encrypted message", {
          description: "Open the chat to decrypt it on this device.",
        });
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("WhisperBox", {
            body: "New encrypted message. Open WhisperBox to decrypt it.",
            tag: msg.id,
          });
        }
      }

      setConvRefresh((n) => n + 1);
    });
  }, [peer?.id, user]);

  function selectPeer(p: Peer) {
    setPeer(p);
    setHiddenChats((prev) => prev.filter((id) => id !== p.id));
    setUnreadCounts((prev) => {
      if (!prev[p.id]) return prev;
      const next = { ...prev };
      delete next[p.id];
      return next;
    });
    setOpenedChats((prev) =>
      prev.some((x) => x.id === p.id) ? prev : [p, ...prev],
    );
  }

  function deleteActiveConversation() {
    if (!peer) return;
    setHiddenChats((prev) =>
      prev.includes(peer.id) ? prev : [...prev, peer.id],
    );
    setOpenedChats((prev) => prev.filter((p) => p.id !== peer.id));
    setUnreadCounts((prev) => {
      const next = { ...prev };
      delete next[peer.id];
      return next;
    });
    setPeer(null);
    toast.success("Conversation hidden on this device");
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </main>
    );
  }

  if (!user || locked) {
    return (
      <>
        <Helmet>
          <title>WhisperBox - End-to-End Encrypted Messaging</title>
          <meta
            name="description"
            content="Private messaging with end-to-end encryption. Keys generated in your browser, never seen by the server."
          />
          <link rel="canonical" href="/" />
        </Helmet>
        <main className="flex min-h-screen items-center justify-center px-4 py-10">
          <h1 className="sr-only">WhisperBox - sign in</h1>
          <AuthCard initialMode={locked ? "unlock" : "login"} />
        </main>
      </>
    );
  }

  return (
    <>
      <Helmet>
        <title>WhisperBox - Secure Chat</title>
        <meta
          name="description"
          content="End-to-end encrypted messaging. Your conversations stay between you and the recipient."
        />
        <link rel="canonical" href="/" />
      </Helmet>

      <main className="flex h-dvh w-full overflow-hidden bg-background/70">
        <div
          className={cn(
            "flex w-full flex-col border-r border-border bg-sidebar md:w-85 md:max-w-95",
            peer && "hidden md:flex",
          )}
        >
          <header className="flex items-center justify-between gap-3 border-b border-border bg-surface-glass/95 px-4 py-3 backdrop-blur">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-mine text-primary-foreground shadow-bubble">
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
                      <Wifi className="h-3 w-3 animate-pulse" /> Connecting...
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-lg"
                    aria-label="Profile"
                  >
                    <User className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel>
                    <div className="truncate text-sm">{user.display_name}</div>
                    <div className="truncate text-xs font-normal text-muted-foreground">
                      @{user.username}
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      if (!("Notification" in window)) return;
                      Notification.requestPermission().then((permission) => {
                        toast[permission === "granted" ? "success" : "info"](
                          permission === "granted"
                            ? "Notifications enabled"
                            : "Notifications not enabled",
                        );
                      });
                    }}
                  >
                    <Bell className="mr-2 h-4 w-4" /> Enable notifications
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout}>
                    <LogOut className="mr-2 h-4 w-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          <div className="min-h-0 flex-1">
            <ConversationsSidebar
              selectedUserId={peer?.id ?? null}
              onSelect={selectPeer}
              refreshKey={convRefresh}
              pinned={openedChats}
              unreadCounts={unreadCounts}
              hiddenUserIds={hiddenChats}
            />
          </div>
        </div>

        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col bg-background",
            !peer && "hidden md:flex",
          )}
        >
          {peer ? (
            <ChatThread
              peer={peer}
              onBack={() => setPeer(null)}
              onMessageSent={() => setConvRefresh((n) => n + 1)}
              onDeleteConversation={deleteActiveConversation}
            />
          ) : (
            <div className="chat-grid flex h-full flex-1 flex-col items-center justify-center px-6 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-lg bg-mine text-primary-foreground shadow-pop">
                <Lock className="h-7 w-7" />
              </div>
              <h2 className="text-xl font-semibold tracking-tight">
                Pick a conversation
              </h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Or tap <span className="font-medium">+</span> to start a new
                encrypted chat. Messages are encrypted on this device; the
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
