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
    <div className="min-h-screen bg-muted/20">
      {/* Top header */}
      <header className="fixed top-0 left-0 right-0 z-40 h-14 bg-background border-b border-border flex items-center px-4">
        <div className="flex flex-1 items-center justify-between max-w-lg mx-auto w-full">
          <span className="font-semibold text-base">💰 Finance</span>
          <div className="flex items-center gap-2">
            <Link href="/notifications" className="p-2 text-muted-foreground hover:text-foreground rounded-lg">
              <Bell className="h-5 w-5" />
            </Link>
            <Link href="/settings" className="p-2 text-muted-foreground hover:text-foreground rounded-lg">
              <Settings className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Page content — padded for top header and bottom nav */}
      <main className="pt-14 pb-20 max-w-lg mx-auto px-4 min-h-screen">
        {children}
      </main>

      <BottomNav />
      <Toaster />
    </div>
  );
}
