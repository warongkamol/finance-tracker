"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Receipt, CreditCard, BarChart3, WalletCards } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard",    label: "หน้าหลัก",  icon: Home },
  { href: "/transactions", label: "รายการ",    icon: Receipt },
  { href: "/accounts",     label: "กระเป๋า",   icon: WalletCards },
  { href: "/debts",        label: "หนี้สิน",   icon: CreditCard },
  { href: "/budget",       label: "งบการเงิน", icon: BarChart3 },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-t border-border/50">
      <div className="flex items-stretch max-w-lg mx-auto" style={{ height: "64px" }}>
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className="flex flex-1 flex-col items-center justify-center gap-0.5 pt-2 pb-1 transition-colors"
            >
              <Icon
                className={cn(
                  "h-[22px] w-[22px] transition-colors",
                  active ? "text-primary" : "text-muted-foreground"
                )}
                strokeWidth={active ? 2.5 : 1.75}
              />
              <span className={cn(
                "text-[10px] leading-none font-medium transition-colors",
                active ? "text-primary" : "text-muted-foreground"
              )}>
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
