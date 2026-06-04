export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">💰</div>
          <h1 className="text-xl font-bold text-foreground">Finance Tracker</h1>
          <p className="text-sm text-muted-foreground mt-1">บันทึกรายรับ-รายจ่าย</p>
        </div>
        {children}
      </div>
    </div>
  );
}
