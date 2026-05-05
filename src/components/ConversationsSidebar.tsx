import { useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, Plus, Search, X } from "lucide-react";
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
  unreadCounts?: Record<string, number>;
  hiddenUserIds?: string[];
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
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const diff = (now.getTime() - d.getTime()) / 86_400_000;
  if (diff < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function ConversationsSidebar({
  selectedUserId,
  onSelect,
  refreshKey,
  pinned = [],
  unreadCounts = {},
  hiddenUserIds = [],
}: Props) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserPublicInfo[]>([]);
  const [searchError, setSearchError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const trimmedQuery = query.trim();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await api.listConversations();
        if (!cancelled) setConversations(list);
      } catch {
        if (!cancelled) setConversations([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  useEffect(() => {
    if (searching) inputRef.current?.focus();
  }, [searching]);

  useEffect(() => {
    if (!searching || trimmedQuery.length < 1) {
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        setSearchError("");
        const r = await api.searchUsers(trimmedQuery);
        setResults(r);
      } catch {
        setResults([]);
        setSearchError("Search unavailable");
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [searching, trimmedQuery]);

  const merged = (() => {
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
    const hidden = new Set(hiddenUserIds);

    return Array.from(map.values())
      .filter((c) => !hidden.has(c.user_id))
      .sort((a, b) => {
        const ta = a.last_message_at
          ? new Date(a.last_message_at).getTime()
          : 0;
        const tb = b.last_message_at
          ? new Date(b.last_message_at).getTime()
          : 0;
        return tb - ta;
      });
  })();

  return (
    <aside className="flex h-full w-full flex-col bg-sidebar">
      <header className="flex items-center justify-between gap-2 px-4 pt-5 pb-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Messages</h2>
          <p className="text-xs text-muted-foreground">
            {merged.length} conversation{merged.length === 1 ? "" : "s"}
          </p>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-lg hover:bg-accent"
          onClick={() => {
            setSearching((v) => !v);
            setQuery("");
            setResults([]);
            setSearchError("");
          }}
          aria-label={searching ? "Close search" : "New conversation"}
        >
          {searching ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </Button>
      </header>

      <div className="px-4 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <label htmlFor="search" className="sr-only">
            Search users
          </label>
          <Input
            id="search"
            ref={inputRef}
            tabIndex={0}
            placeholder={searching ? "Find by username" : "Search"}
            value={query}
            onChange={(e) => {
              const next = e.target.value;
              setQuery(next);
              if (!next.trim()) {
                setResults([]);
                setSearchError("");
              }
              if (!searching) setSearching(true);
            }}
            className="h-10 rounded-lg bg-surface pl-9"
          />
        </div>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-3">
        {searching && trimmedQuery ? (
          <ul className="space-y-1">
            {searchError ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                {searchError}
              </li>
            ) : results.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                No users found
              </li>
            ) : (
              results.map((u) => (
                <li key={u.id}>
                  <button
                    className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-accent"
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
        ) : loading && merged.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : merged.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            <MessageCircle className="mx-auto mb-3 h-8 w-8 opacity-60" />
            No conversations yet. Tap{" "}
            <span className="font-medium text-foreground">+</span> to find someone.
          </div>
        ) : (
          <ul className="space-y-0.5">
            {merged.map((c) => {
              const unread = unreadCounts[c.user_id] ?? 0;
              return (
              <li key={c.user_id}>
                <button
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition",
                    selectedUserId === c.user_id
                      ? "bg-accent text-accent-foreground"
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
                      <div className="flex shrink-0 items-center gap-1.5">
                        {unread > 0 && (
                          <span
                            className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-none text-primary-foreground"
                            aria-label={`${unread} unread messages`}
                          >
                            {unread > 9 ? "9+" : unread}
                          </span>
                        )}
                        <span className="text-[11px] text-muted-foreground">
                          {formatTime(c.last_message_at)}
                        </span>
                      </div>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      @{c.username}
                    </div>
                  </div>
                </button>
              </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
