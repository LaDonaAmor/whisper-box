import { useEffect, useState } from "react";
import { Search, Plus, Loader2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import * as api from "@/lib/api";
import type { ConversationSummary, UserPublicInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  selectedUserId: string | null;
  onSelect: (user: {
    id: string;
    display_name: string;
    username: string;
  }) => void;
  refreshKey: number;
  pinned?: { id: string; display_name: string; username: string }[];
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

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay)
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const diff = (now.getTime() - d.getTime()) / 86_400_000;
  if (diff < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function ConversationsSidebar({
  selectedUserId,
  onSelect,
  refreshKey,
  pinned = [],
}: Props) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserPublicInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await api.listConversations();
        if (!cancelled) setConversations(list);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // Search debounced
  useEffect(() => {
    if (!searching || query.trim().length < 1) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await api.searchUsers(query.trim());
        setResults(r);
      } catch {
        /* ignore */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, searching]);

  return (
    <aside className="flex h-full w-full flex-col border-r border-border bg-sidebar/60 backdrop-blur-xl">
      <header className="flex items-center justify-between gap-2 px-4 pt-5 pb-3">
        <h2 className="text-lg font-semibold tracking-tight">Messages</h2>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full hover:bg-accent"
          onClick={() => {
            setSearching((v) => !v);
            setQuery("");
            setResults([]);
          }}
          aria-label="New conversation"
        >
          {searching ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </Button>
      </header>

      <div className="px-4 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={searching ? "Find someone by username…" : "Search"}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!searching) setSearching(true);
            }}
            className="h-10 rounded-xl bg-muted/60 pl-9"
          />
        </div>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-3">
        {searching && query.trim() ? (
          <ul className="space-y-1">
            {results.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                No users found
              </li>
            ) : (
              results.map((u) => (
                <li key={u.id}>
                  <button
                    className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-accent"
                    onClick={() => {
                      onSelect({
                        id: u.id,
                        display_name: u.display_name,
                        username: u.username,
                      });
                      setSearching(false);
                      setQuery("");
                      setResults([]);
                    }}
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-mine text-sm font-semibold text-primary-foreground">
                      {initials(u.display_name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {u.display_name}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        @{u.username}
                      </div>
                    </div>
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          (() => {
            // Merge pinned (newly opened) chats with server conversations
            const map = new Map<string, ConversationSummary>();
            for (const p of pinned) {
              map.set(p.id, {
                user_id: p.id,
                display_name: p.display_name,
                username: p.username,
                last_message_at: null,
              });
            }
            for (const c of conversations) map.set(c.user_id, c);
            const merged = Array.from(map.values()).sort((a, b) => {
              const ta = a.last_message_at
                ? new Date(a.last_message_at).getTime()
                : 0;
              const tb = b.last_message_at
                ? new Date(b.last_message_at).getTime()
                : 0;
              return tb - ta;
            });
            if (merged.length === 0) {
              return (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No conversations yet. Tap{" "}
                  <span className="font-medium">+</span> to find someone.
                </div>
              );
            }
            return (
              <ul className="space-y-0.5">
                {merged.map((c) => (
                  <li key={c.user_id}>
                    <button
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition",
                        selectedUserId === c.user_id
                          ? "bg-accent"
                          : "hover:bg-accent/60",
                      )}
                      onClick={() =>
                        onSelect({
                          id: c.user_id,
                          display_name: c.display_name,
                          username: c.username,
                        })
                      }
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-mine text-sm font-semibold text-primary-foreground">
                        {initials(c.display_name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium">
                            {c.display_name}
                          </span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {formatTime(c.last_message_at)}
                          </span>
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          @{c.username}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            );
          })()
        )}
      </div>
    </aside>
  );
}
