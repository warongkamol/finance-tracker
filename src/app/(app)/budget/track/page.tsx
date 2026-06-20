"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { BudgetTopNav } from "../_shared";

export default function BudgetTrackPage() {
  const now = new Date();
  const searchParams = useSearchParams();
  const [year, setYear] = useState(() => {
    const fromUrl = parseInt(searchParams.get("year") ?? "");
    return Number.isFinite(fromUrl) && fromUrl > 1900 && fromUrl < 3000 ? fromUrl : now.getFullYear();
  });

  return (
    <div className="py-5 space-y-5">
      <div className="flex items-center justify-between">
        <button onClick={() => setYear(y => y - 1)}
          className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-[20px] font-bold">งบการเงิน {year + 543}</h1>
        <button onClick={() => setYear(y => y + 1)}
          className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <BudgetTopNav year={year} />

      <div className="ios-card px-4 py-12 text-center">
        <p className="text-3xl mb-2">🚧</p>
        <p className="text-[14px] font-medium">ติดตามสถานะใช้จ่าย</p>
        <p className="text-[12px] text-muted-foreground mt-1">หน้านี้กำลังพัฒนา เร็วๆนี้</p>
      </div>
    </div>
  );
}
