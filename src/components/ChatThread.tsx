import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCheck,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Lock,
  MoreVertical,
  Paperclip,
  Send,
  ShieldCheck,
  Trash2,
  UserCircle,
  X,
} from "lucide-react";
import * as api from "@/lib/api";
import {
  decryptMessage,
  encryptMessage,
  importPublicKey,
  publicKeyFingerprint,
} from "@/lib/crypto";
import { getOwnPrivateKey, getOwnPublicKey } from "@/lib/session";
import { onMessage, sendWs } from "@/lib/ws";
import type {
  DecryptedMessage,
  EncryptedPayload,
  MessageContent,
  MessageResponse,
} from "@/lib/types";
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
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Props {
  peer: { id: string; display_name: string; username: string };
  onBack?: () => void;
  onMessageSent?: () => void;
  onDeleteConversation?: () => void;
}

const FILE_LIMIT_BYTES = 2 * 1024 * 1024;
const MESSAGE_VERSION = "wb.message.v1";

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fmtDay(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function serializeContent(content: MessageContent) {
  return JSON.stringify({ v: MESSAGE_VERSION, content });
}

function parseContent(raw: string): MessageContent {
  try {
    const parsed = JSON.parse(raw) as { v?: string; content?: MessageContent };
    if (
      parsed.v === MESSAGE_VERSION &&
      parsed.content &&
      (parsed.content.kind === "text" || parsed.content.kind === "file")
    ) {
      return parsed.content;
    }
  } catch {
    /* support old plaintext messages */
  }
  return { kind: "text", text: raw };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export default function ChatThread({
  peer,
  onBack,
  onMessageSent,
  onDeleteConversation,
}: Props) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [peerFingerprint, setPeerFingerprint] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const appendMessage = (msg: DecryptedMessage) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  };

  useEffect(() => {
    window.setTimeout(() => textareaRef.current?.focus(), 80);
  }, [peer.id]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setMessages([]);
      setSelectedFile(null);
      setText("");

      try {
        const [pubB64, history] = await Promise.all([
          api.getUserPublicKey(peer.id),
          api.listMessages(peer.id, undefined, 50),
        ]);

        if (cancelled) return;

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
                const raw = await decryptMessage(
                  m.payload as EncryptedPayload,
                  priv,
                  isMine,
                );
                const content = parseContent(raw);
                return {
                  id: m.id,
                  fromUserId: m.from_user_id,
                  toUserId: m.to_user_id,
                  text:
                    content.kind === "text"
                      ? content.text
                      : content.caption ?? "",
                  content,
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

  useEffect(() => {
    const unsubscribe = onMessage(async (msg: MessageResponse) => {
      const isMine = msg.from_user_id === user?.id;
      const otherId = isMine ? msg.to_user_id : msg.from_user_id;

      if (otherId !== peer.id) return;

      try {
        const priv = getOwnPrivateKey();
        const raw = await decryptMessage(
          msg.payload as EncryptedPayload,
          priv,
          isMine,
        );
        const content = parseContent(raw);

        appendMessage({
          id: msg.id,
          fromUserId: msg.from_user_id,
          toUserId: msg.to_user_id,
          text: content.kind === "text" ? content.text : content.caption ?? "",
          content,
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
      unsubscribe();
    };
  }, [peer.id, user?.id, onMessageSent]);

  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  }, [messages, loading]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  async function buildOutgoingContent(): Promise<MessageContent> {
    const caption = text.trim();
    if (!selectedFile) return { kind: "text", text: caption };
    if (selectedFile.size > FILE_LIMIT_BYTES) {
      throw new Error("File must be 2 MB or smaller until attachment API lands");
    }
    return {
      kind: "file",
      name: selectedFile.name,
      mimeType: selectedFile.type || "application/octet-stream",
      size: selectedFile.size,
      dataUrl: await readFileAsDataUrl(selectedFile),
      caption,
    };
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if ((!text.trim() && !selectedFile) || !user) return;

    setSending(true);
    const tempId = `tmp-${Date.now()}`;

    try {
      const content = await buildOutgoingContent();
      appendMessage({
        id: tempId,
        fromUserId: user.id,
        toUserId: peer.id,
        text: content.kind === "text" ? content.text : content.caption ?? "",
        content,
        createdAt: new Date().toISOString(),
        pending: true,
      });

      setText("");
      setSelectedFile(null);

      const ownPub = await getOwnPublicKey();
      const peerPubB64 = await api.getUserPublicKey(peer.id);
      const pubKey = await importPublicKey(peerPubB64);
      const payload = await encryptMessage(
        serializeContent(content),
        pubKey,
        ownPub,
      );
      const sentRealtime = sendWs({
        event: "message.send",
        to: peer.id,
        payload,
      });

      if (sentRealtime) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, pending: false } : m)),
        );
      } else {
        const saved = await api.sendMessageRest(peer.id, payload);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId
              ? {
                  ...m,
                  id: saved.id,
                  createdAt: saved.created_at,
                  pending: false,
                }
              : m,
          ),
        );
      }

      onMessageSent?.();
      window.setTimeout(() => textareaRef.current?.focus(), 40);
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      toast.error(err instanceof Error ? err.message : "Failed to send message");
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
      <header className="flex items-center gap-3 border-b border-border bg-surface-glass/95 px-4 py-3 backdrop-blur">
        {onBack && (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-lg md:hidden"
            onClick={onBack}
            aria-label="Back to conversations"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-mine text-sm font-semibold text-primary-foreground">
          {initials(peer.display_name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold leading-tight">
            {peer.display_name}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3 w-3 text-success" />
            <span className="truncate">
              E2E encrypted - key {peerFingerprint || "..."}
            </span>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-lg"
              aria-label="Conversation options"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-mine text-sm font-semibold text-primary-foreground">
                  {initials(peer.display_name)}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm">{peer.display_name}</div>
                  <div className="truncate text-xs font-normal text-muted-foreground">
                    @{peer.username}
                  </div>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => navigator.clipboard.writeText(peerFingerprint)}
            >
              <UserCircle className="mr-2 h-4 w-4" /> Copy key fingerprint
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setMessages([]);
                toast.success("Messages cleared on this device");
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Clear local thread
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDeleteConversation}>
              <Trash2 className="mr-2 h-4 w-4" /> Hide conversation
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div
        ref={scrollRef}
        className="chat-grid scrollbar-thin flex-1 overflow-y-auto px-3 py-4 sm:px-6"
      >
        {loading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="mx-auto mt-10 max-w-sm text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <Lock className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium">Start an encrypted conversation</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Only you and {peer.display_name} can decrypt this chat.
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
                  const content = m.content;
                  const isImage =
                    content?.kind === "file" &&
                    content.mimeType.startsWith("image/");
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "group/message flex animate-pop-in",
                        isMine ? "justify-end" : "justify-start",
                      )}
                    >
                      <div className="flex max-w-[78%] items-end gap-1">
                        {isMine && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-lg opacity-0 transition group-hover/message:opacity-100"
                            onClick={() =>
                              setMessages((prev) =>
                                prev.filter((x) => x.id !== m.id),
                              )
                            }
                            aria-label="Delete local message"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <div
                          className={cn(
                            "rounded-2xl px-4 py-2 text-[15px] leading-snug",
                            isMine ? "bubble-mine" : "bubble-theirs",
                            isMine
                              ? cn(
                                  groupedWithPrev ? "rounded-tr" : "",
                                  groupedWithNext ? "rounded-br" : "",
                                )
                              : cn(
                                  groupedWithPrev ? "rounded-tl" : "",
                                  groupedWithNext ? "rounded-bl" : "",
                                ),
                            m.pending && "opacity-70",
                          )}
                        >
                          {m.failed ? (
                            <span className="flex items-center gap-1.5 text-xs italic opacity-90">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              Could not decrypt this message
                            </span>
                          ) : content?.kind === "file" ? (
                            <div className="space-y-2">
                              {isImage ? (
                                <img
                                  src={content.dataUrl}
                                  alt={content.name}
                                  className="max-h-64 rounded-lg object-contain"
                                />
                              ) : (
                                <a
                                  href={content.dataUrl}
                                  download={content.name}
                                  className={cn(
                                    "flex items-center gap-3 rounded-lg border p-3 text-sm",
                                    isMine
                                      ? "border-white/25 bg-white/10"
                                      : "border-border bg-background/40",
                                  )}
                                >
                                  <FileText className="h-5 w-5 shrink-0" />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate font-medium">
                                      {content.name}
                                    </span>
                                    <span className="block text-xs opacity-70">
                                      {formatBytes(content.size)}
                                    </span>
                                  </span>
                                  <Download className="h-4 w-4 shrink-0" />
                                </a>
                              )}
                              {content.caption && (
                                <span className="block whitespace-pre-wrap break-words">
                                  {content.caption}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="whitespace-pre-wrap break-words">
                              {m.text}
                            </span>
                          )}
                          {!groupedWithNext && (
                            <div
                              className={cn(
                                "mt-1 flex items-center justify-end gap-1 text-[10px]",
                                isMine
                                  ? "text-primary-foreground/75"
                                  : "text-muted-foreground",
                              )}
                            >
                              <span>{fmtTime(m.createdAt)}</span>
                              {isMine &&
                                (m.pending ? (
                                  <span>sending...</span>
                                ) : (
                                  <CheckCheck className="h-3 w-3" />
                                ))}
                            </div>
                          )}
                        </div>
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
        className="border-t border-border bg-surface-glass/95 px-3 py-3 backdrop-blur sm:px-6"
      >
        <div className="mx-auto max-w-3xl">
          {selectedFile && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-bubble">
              {selectedFile.type.startsWith("image/") ? (
                <ImageIcon className="h-4 w-4 text-primary" />
              ) : (
                <FileText className="h-4 w-4 text-primary" />
              )}
              <span className="min-w-0 flex-1 truncate">{selectedFile.name}</span>
              <span className="text-xs text-muted-foreground">
                {formatBytes(selectedFile.size)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg"
                onClick={() => setSelectedFile(null)}
                aria-label="Remove attachment"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              title="Attach encrypted file"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                e.target.value = "";
                if (file && file.size > FILE_LIMIT_BYTES) {
                  toast.error("File must be 2 MB or smaller");
                  return;
                }
                setSelectedFile(file);
                textareaRef.current?.focus();
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-lg"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach encrypted file"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <div className="flex flex-1 items-end rounded-lg border border-border bg-surface px-3 py-2 shadow-bubble focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20">
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
                placeholder={selectedFile ? "Add a caption" : "Message"}
                className="max-h-40 min-h-6 flex-1 resize-none bg-transparent text-[15px] leading-snug outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Button
              type="submit"
              disabled={(!text.trim() && !selectedFile) || sending}
              size="icon"
              className="h-10 w-10 rounded-lg bg-mine text-primary-foreground shadow-bubble hover:opacity-95 disabled:opacity-40"
              aria-label="Send"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
        <p className="mx-auto mt-2 flex max-w-3xl items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <Lock className="h-3 w-3" /> Text, images, and files are encrypted before upload
        </p>
      </form>
    </section>
  );
}
