export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-secondary flex flex-col items-center justify-center px-5 py-12">
      {/* App icon + wordmark */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-[22px] bg-primary shadow-lg mb-4">
          <span className="text-3xl select-none">💰</span>
        </div>
        <h1 className="text-[28px] font-bold text-foreground tracking-tight">Finance</h1>
        <p className="text-[15px] text-muted-foreground mt-1">บันทึกรายรับ-รายจ่าย</p>
      </div>

      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
