"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Receipt, CreditCard, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "หน้าหลัก", icon: Home },
  { href: "/transactions", label: "รายการ", icon: Receipt },
  { href: "/debts", label: "หนี้สิน", icon: CreditCard },
  { href: "/budget", label: "งบการเงิน", icon: BarChart3 },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border">
      <div className="flex items-stretch h-16 max-w-lg mx-auto">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 text-xs transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className={cn("h-5 w-5", active && "fill-primary/20")} strokeWidth={active ? 2.5 : 1.5} />
              <span className="leading-none">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
