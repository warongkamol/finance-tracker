import { auth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const session = await auth();

  return (
    <div className="py-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold">สวัสดี, {session?.user?.name} 👋</h1>
        <p className="text-sm text-muted-foreground">ภาพรวมทางการเงิน</p>
      </div>

      {/* Summary cards — Phase 3 will populate these from real data */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">รายรับเดือนนี้</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-lg font-bold text-green-600">฿0.00</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs text-muted-foreground font-medium">รายจ่ายเดือนนี้</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-lg font-bold text-red-500">฿0.00</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-medium">คงเหลือสุทธิ</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <p className="text-2xl font-bold">฿0.00</p>
          <p className="text-xs text-muted-foreground mt-1">รายรับ - รายจ่าย</p>
        </CardContent>
      </Card>

      <Card className="border-dashed">
        <CardContent className="py-8 text-center text-muted-foreground">
          <p className="text-sm">กด + เพื่อบันทึกรายการแรก</p>
        </CardContent>
      </Card>
    </div>
  );
}
