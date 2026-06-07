"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, CheckCheck, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: "DEBT_REMINDER" | "RECURRING_REMINDER" | "OVERDUE_ALERT" | "BUDGET_ALERT" | "SYSTEM";
  referenceId: string | null;
  referenceType: string | null;
  isRead: boolean;
  createdAt: string;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "เมื่อกี้";
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ชั่วโมงที่แล้ว`;
  return new Date(dateStr).toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

function typeIcon(type: NotificationItem["type"]) {
  if (type === "RECURRING_REMINDER") return "🔔";
  if (type === "DEBT_REMINDER") return "💳";
  if (type === "OVERDUE_ALERT") return "⚠️";
  if (type === "BUDGET_ALERT") return "🚨";
  return "📢";
}

export default function NotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/notifications");
      const data = await res.json();
      if (data.success) setItems(data.data.notifications);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  async function markRead(id: string) {
    await fetch(`/api/v1/notifications/${id}/read`, { method: "PUT" });
    setItems(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  }

  async function markAllRead() {
    setMarkingAll(true);
    try {
      await fetch("/api/v1/notifications/read-all", { method: "PUT" });
      setItems(prev => prev.map(n => ({ ...n, isRead: true })));
    } finally {
      setMarkingAll(false);
    }
  }

  function handleClick(item: NotificationItem) {
    if (!item.isRead) markRead(item.id);
    if (item.type === "RECURRING_REMINDER" && item.referenceId) {
      router.push(`/transactions/new?recurringId=${item.referenceId}`);
    } else if (item.type === "DEBT_REMINDER" && item.referenceId) {
      router.push(`/debts`);
    } else if (item.type === "BUDGET_ALERT") {
      router.push(`/budget`);
    }
  }

  const unread = items.filter(n => !n.isRead).length;

  return (
    <div className="py-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold">การแจ้งเตือน</h1>
          {unread > 0 && <p className="text-[13px] text-muted-foreground">{unread} รายการที่ยังไม่อ่าน</p>}
        </div>
        {unread > 0 && (
          <Button variant="ghost" size="sm" onClick={markAllRead} disabled={markingAll} className="text-primary">
            <CheckCheck className="h-4 w-4 mr-1" />
            {markingAll ? "กำลังทำ..." : "อ่านทั้งหมด"}
          </Button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="animate-pulse h-20 rounded-2xl bg-border/50" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-4xl mb-3">🔔</p>
          <p className="text-[16px] font-medium">ยังไม่มีการแจ้งเตือน</p>
          <p className="text-[14px] text-muted-foreground mt-1">การแจ้งเตือนจะปรากฏที่นี่</p>
        </div>
      ) : (
        <div className="ios-card overflow-hidden divide-y divide-border/50">
          {items.map(item => {
            const isActionable = item.type === "RECURRING_REMINDER" || item.type === "DEBT_REMINDER" || item.type === "BUDGET_ALERT";
            return (
              <div
                key={item.id}
                className={cn(
                  "px-4 py-4 flex items-start gap-3 transition-colors",
                  !item.isRead && "bg-primary/5",
                  isActionable && "cursor-pointer active:bg-muted/50"
                )}
                onClick={() => isActionable && handleClick(item)}
              >
                {/* Unread dot */}
                <div className="relative mt-1 shrink-0">
                  <span className="text-xl">{typeIcon(item.type)}</span>
                  {!item.isRead && (
                    <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className={cn("text-[14px] leading-snug", !item.isRead ? "font-semibold" : "font-medium")}>
                    {item.title}
                  </p>
                  <p className="text-[13px] text-muted-foreground mt-0.5 leading-snug">{item.message}</p>

                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[11px] text-muted-foreground">{timeAgo(item.createdAt)}</span>

                    {item.type === "RECURRING_REMINDER" && (
                      <span className="flex items-center gap-0.5 text-[12px] text-primary font-semibold">
                        บันทึกเลย <ChevronRight className="h-3.5 w-3.5" />
                      </span>
                    )}
                    {item.type === "BUDGET_ALERT" && (
                      <span className="flex items-center gap-0.5 text-[12px] text-[#FF3B30] font-semibold">
                        ดูงบการเงิน <ChevronRight className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </div>
                </div>

                {!item.isRead && !isActionable && (
                  <button
                    onClick={(e) => { e.stopPropagation(); markRead(item.id); }}
                    className="text-[11px] text-muted-foreground hover:text-primary shrink-0 mt-1"
                  >
                    <BellRing className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
