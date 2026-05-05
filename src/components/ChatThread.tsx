import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Lock,
  Send,
  Loader2,
  ShieldCheck,
  AlertTriangle,
  ArrowLeft,
} from "lucide-react";
import * as api from "@/lib/api";
import {
  decryptMessage,
  encryptMessage,
  importPublicKey,
  publicKeyFingerprint,
} from "@/lib/crypto";
import { getOwnPrivateKey, getOwnPublicKey } from "@/lib/session";
import { sendWs, onMessage } from "@/lib/ws";
import type {
  DecryptedMessage,
  MessageResponse,
  EncryptedPayload,
} from "@/lib/types";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Props {
  peer: { id: string; display_name: string; username: string };
  onBack?: () => void;
  onMessageSent?: () => void;
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fmtDay(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ChatThread({ peer, onBack, onMessageSent }: Props) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  // Removed setPeerPubKey since it was never read
  const [peerFingerprint, setPeerFingerprint] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const appendMessage = (msg: DecryptedMessage) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  };

  // Load peer key + history
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Set loading state inside the async block to avoid cascading renders
      setLoading(true);
      setMessages([]);

      try {
        const [pubB64, history] = await Promise.all([
          api.getUserPublicKey(peer.id),
          api.listMessages(peer.id, undefined, 50),
        ]);

        if (cancelled) return;

        // Verify key and fingerprint
        await importPublicKey(pubB64);
        setPeerFingerprint(await publicKeyFingerprint(pubB64));

        const priv = getOwnPrivateKey();
        const decrypted = await Promise.all(
          history
            .slice()
            .reverse()
            .map(async (m): Promise<DecryptedMessage> => {
              const isMine = m.from_user_id === user?.id;
              try {
                const txt = await decryptMessage(
                  m.payload as EncryptedPayload,
                  priv,
                  isMine,
                );
                return {
                  id: m.id,
                  fromUserId: m.from_user_id,
                  toUserId: m.to_user_id,
                  text: txt,
                  createdAt: m.created_at,
                };
              } catch {
                return {
                  id: m.id,
                  fromUserId: m.from_user_id,
                  toUserId: m.to_user_id,
                  text: null,
                  failed: true,
                  createdAt: m.created_at,
                };
              }
            }),
        );

        if (!cancelled) {
          setMessages(decrypted);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          toast.error(
            e instanceof Error ? e.message : "Failed to load messages",
          );
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [peer.id, user?.id]);

  // Subscribe to WS for incoming messages
  useEffect(() => {
    const unsubscribe = onMessage(async (msg: MessageResponse) => {
      const isMine = msg.from_user_id === user?.id;
      const otherId = isMine ? msg.to_user_id : msg.from_user_id;

      if (otherId !== peer.id) return;

      try {
        const priv = getOwnPrivateKey();
        const txt = await decryptMessage(
          msg.payload as EncryptedPayload,
          priv,
          isMine,
        );

        appendMessage({
          id: msg.id,
          fromUserId: msg.from_user_id,
          toUserId: msg.to_user_id,
          text: txt,
          createdAt: msg.created_at,
        });

        onMessageSent?.();
      } catch {
        appendMessage({
          id: msg.id,
          fromUserId: msg.from_user_id,
          toUserId: msg.to_user_id,
          text: null,
          failed: true,
          createdAt: msg.created_at,
        });
      }
    });

    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [peer.id, user?.id, onMessageSent]); // Added onMessageSent to dependencies

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, loading]);

  // Smooth scroll for new message animations
  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  }, [messages]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || !user) return;

    setSending(true);
    const tempId = `tmp-${Date.now()}`;

    appendMessage({
      id: tempId,
      fromUserId: user.id,
      toUserId: peer.id,
      text: body,
      createdAt: new Date().toISOString(),
      pending: true,
    });

    setText("");

    try {
      const ownPub = await getOwnPublicKey();
      const peerPubB64 = await api.getUserPublicKey(peer.id);
      const pubKey = await importPublicKey(peerPubB64);
      const payload = await encryptMessage(body, pubKey, ownPub);

      sendWs({
        event: "message.send",
        to: peer.id,
        payload,
      });

      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, pending: false } : m)),
      );
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      toast.error("Failed to send message");
    } finally {
      setSending(false);
    }
  }

  const grouped = useMemo(() => {
    const out: { day: string; items: DecryptedMessage[] }[] = [];
    for (const m of messages) {
      const day = fmtDay(m.createdAt);
      const last = out[out.length - 1];
      if (!last || last.day !== day) out.push({ day, items: [m] });
      else last.items.push(m);
    }
    return out;
  }, [messages]);

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-surface-glass/60 px-4 py-3 backdrop-blur-xl">
        {onBack && (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full md:hidden"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-mine text-sm font-semibold text-primary-foreground">
          {peer.display_name
            .split(/\s+/)
            .map((p) => p[0])
            .filter(Boolean)
            .slice(0, 2)
            .join("")
            .toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold leading-tight">
            {peer.display_name}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3 w-3 text-success" />
            <span className="truncate">
              E2E encrypted • key {peerFingerprint || "…"}
            </span>
          </div>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="scrollbar-thin flex-1 overflow-y-auto px-3 py-4 sm:px-6"
      >
        {loading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="mx-auto mt-10 max-w-sm text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
              <Lock className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium">
              Start an encrypted conversation
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Messages are encrypted on this device and can only be read by{" "}
              {peer.display_name}.
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-6">
            {grouped.map((g, gi) => (
              <div key={gi} className="space-y-1.5">
                <div className="my-3 text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {g.day}
                </div>
                {g.items.map((m, i) => {
                  const isMine = m.fromUserId === user?.id;
                  const prev = g.items[i - 1];
                  const next = g.items[i + 1];
                  const groupedWithPrev =
                    prev && prev.fromUserId === m.fromUserId;
                  const groupedWithNext =
                    next && next.fromUserId === m.fromUserId;
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "flex animate-pop-in",
                        isMine ? "justify-end" : "justify-start",
                      )}
                    >
                      <div
                        className={cn(
                          "max-w-[78%] rounded-3xl px-4 py-2 text-[15px] leading-snug",
                          isMine ? "bubble-mine" : "bubble-theirs",
                          isMine
                            ? cn(
                                groupedWithPrev ? "rounded-tr-md" : "",
                                groupedWithNext ? "rounded-br-md" : "",
                              )
                            : cn(
                                groupedWithPrev ? "rounded-tl-md" : "",
                                groupedWithNext ? "rounded-bl-md" : "",
                              ),
                          m.pending && "opacity-70",
                        )}
                      >
                        {m.failed ? (
                          <span className="flex items-center gap-1.5 text-xs italic opacity-90">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Could not decrypt this message
                          </span>
                        ) : (
                          <span className="whitespace-pre-wrap wrap-break-words">
                            {m.text}
                          </span>
                        )}
                        {!groupedWithNext && (
                          <div
                            className={cn(
                              "mt-1 text-[10px]",
                              isMine
                                ? "text-primary-foreground/70"
                                : "text-muted-foreground",
                            )}
                          >
                            {fmtTime(m.createdAt)}
                            {m.pending ? " • sending…" : ""}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      <form
        onSubmit={send}
        className="border-t border-border bg-surface-glass/70 px-3 py-3 backdrop-blur-xl sm:px-6"
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <div className="flex flex-1 items-end rounded-3xl border border-border bg-surface px-4 py-2 shadow-bubble focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20">
            <textarea
              ref={textareaRef}
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="iMessage"
              className="max-h-40 flex-1 resize-none bg-transparent text-[15px] leading-snug outline-none placeholder:text-muted-foreground"
            />
          </div>
          <Button
            type="submit"
            disabled={!text.trim() || sending}
            size="icon"
            className="h-10 w-10 rounded-full bg-mine text-primary-foreground shadow-bubble hover:opacity-95 disabled:opacity-40"
            aria-label="Send"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="mx-auto mt-2 flex max-w-3xl items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <Lock className="h-3 w-3" /> Messages are end-to-end encrypted in your
          browser
        </p>
      </form>
    </section>
  );
}
