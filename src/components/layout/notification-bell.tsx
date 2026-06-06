"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

export function NotificationBell() {
  const [unread, setUnread] = useState(0);

  const fetchUnread = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/notifications");
      if (!res.ok) return;
      const json = await res.json();
      setUnread(json.data?.unreadCount ?? 0);
    } catch {}
  }, []);

  useEffect(() => {
    fetchUnread();
    // re-check every 60s
    const interval = setInterval(fetchUnread, 60_000);
    return () => clearInterval(interval);
  }, [fetchUnread]);

  return (
    <Link
      href="/notifications"
      className="relative h-8 w-8 flex items-center justify-center rounded-full text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
    >
      <Bell className="h-[18px] w-[18px]" />
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-0.5 rounded-full bg-destructive text-[10px] font-bold text-white flex items-center justify-center leading-none">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
