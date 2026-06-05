import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { BottomNav } from "@/components/layout/bottom-nav";
import { Toaster } from "@/components/ui/toaster";
import Link from "next/link";
import { Bell, Settings } from "lucide-react";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen bg-secondary">
      {/* iOS-style navigation bar — frosted glass */}
      <header className="fixed top-0 left-0 right-0 z-40 h-14 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="flex items-center justify-between h-full px-4 max-w-lg mx-auto">
          <span className="text-[17px] font-semibold tracking-tight">💰 Finance</span>
          <div className="flex items-center gap-1">
            <Link
              href="/notifications"
              className="h-8 w-8 flex items-center justify-center rounded-full text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
            >
              <Bell className="h-[18px] w-[18px]" />
            </Link>
            <Link
              href="/settings"
              className="h-8 w-8 flex items-center justify-center rounded-full text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
            >
              <Settings className="h-[18px] w-[18px]" />
            </Link>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="pt-14 pb-24 max-w-lg mx-auto px-4 min-h-screen">
        {children}
      </main>

      <BottomNav />
      <Toaster />
    </div>
  );
}
