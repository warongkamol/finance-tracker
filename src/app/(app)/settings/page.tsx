"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { Pencil, Trash2, Plus, Check, X, Loader2, Users, LogOut, User, ChevronRight, FolderTree, Wallet, BellRing } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FamilyMember {
  id: string;
  name: string;
  createdAt: string;
  _count: { transactions: number };
}

// ─── Family Member Tag Row ────────────────────────────────────────────────────

function MemberRow({
  member,
  onDelete,
  onRename,
}: {
  member: FamilyMember;
  onDelete: (m: FamilyMember) => void;
  onRename: (m: FamilyMember, newName: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(member.name);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim() || name === member.name) { setEditing(false); setName(member.name); return; }
    setSaving(true);
    await onRename(member, name.trim());
    setSaving(false);
    setEditing(false);
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <User className="h-4 w-4 text-primary" />
      </div>

      {editing ? (
        <div className="flex-1 flex items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 text-[14px] bg-input border-0 rounded-lg"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setEditing(false); setName(member.name); } }}
          />
          <button onClick={save} disabled={saving} className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          </button>
          <button onClick={() => { setEditing(false); setName(member.name); }} className="h-7 w-7 rounded-full hover:bg-muted text-muted-foreground flex items-center justify-center">
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-medium">{member.name}</p>
          <p className="text-[11px] text-muted-foreground">{member._count.transactions} รายการ</p>
        </div>
      )}

      {!editing && (
        <div className="flex gap-0.5 shrink-0">
          <button onClick={() => setEditing(true)} className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => onDelete(member)} className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { data: session, update: updateSession } = useSession();

  // Profile state
  const [editingName, setEditingName] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState("");

  // Password change state
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  // Family member tag state
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [addName, setAddName] = useState("");
  const [adding, setAdding] = useState(false);
  const [showAddInput, setShowAddInput] = useState(false);
  const [deletingMember, setDeletingMember] = useState<FamilyMember | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchMembers = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/family-members");
      const data = await res.json();
      if (data.success) setMembers(data.data);
    } finally {
      setMembersLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  // ── Family Member Tag Actions ────────────────────────────────────────────

  async function handleAdd() {
    if (!addName.trim() || adding) return;
    setAdding(true);
    try {
      const res = await fetch("/api/v1/family-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: addName.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setMembers((prev) => [...prev, data.data]);
        setAddName("");
        setShowAddInput(false);
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleRename(member: FamilyMember, newName: string) {
    const res = await fetch(`/api/v1/family-members/${member.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    const data = await res.json();
    if (data.success) {
      setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, name: newName } : m)));
    }
  }

  async function handleDelete() {
    if (!deletingMember) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/v1/family-members/${deletingMember.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.success) {
        setMembers((prev) => prev.filter((m) => m.id !== deletingMember.id));
        setDeletingMember(null);
      }
    } finally {
      setDeleteLoading(false);
    }
  }

  // ── Profile Actions ──────────────────────────────────────────────────────

  function startEditingName() {
    setProfileName(session?.user?.name ?? "");
    setNameError("");
    setEditingName(true);
  }

  function cancelEditingName() {
    setEditingName(false);
    setProfileName(session?.user?.name ?? "");
    setNameError("");
  }

  async function handleSaveName() {
    const trimmed = profileName.trim();
    if (!trimmed || trimmed === session?.user?.name) { cancelEditingName(); return; }
    setSavingName(true);
    setNameError("");
    try {
      const res = await fetch("/api/v1/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (data.success) {
        await updateSession({ name: data.data.name });
        setEditingName(false);
      } else {
        setNameError(data.error?.message ?? "เกิดข้อผิดพลาด");
      }
    } finally {
      setSavingName(false);
    }
  }

  function closePasswordDialog() {
    setShowPasswordDialog(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setPasswordError("");
    setPasswordSuccess(false);
  }

  async function handleChangePassword() {
    if (changingPassword) return;
    setPasswordError("");
    if (newPassword !== confirmNewPassword) {
      setPasswordError("รหัสผ่านใหม่ไม่ตรงกัน");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร");
      return;
    }
    setChangingPassword(true);
    try {
      const res = await fetch("/api/v1/auth/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (data.success) {
        setPasswordSuccess(true);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmNewPassword("");
        setTimeout(closePasswordDialog, 1200);
      } else {
        setPasswordError(data.error?.message ?? "เกิดข้อผิดพลาด");
      }
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <div className="py-5 space-y-6">
      <div className="px-1">
        <h1 className="text-[22px] font-bold tracking-tight">ตั้งค่า</h1>
      </div>

      {/* Profile */}
      <div className="ios-card overflow-hidden">
        <div className="px-4 py-4 flex items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <span className="text-[20px]">👤</span>
          </div>
          <div className="flex-1 min-w-0">
            {editingName ? (
              <div className="flex items-center gap-2">
                <Input
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  className="h-9 text-[15px] bg-input border-0 rounded-lg flex-1"
                  maxLength={100}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveName();
                    if (e.key === "Escape") cancelEditingName();
                  }}
                />
                <button onClick={handleSaveName} disabled={savingName} className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  {savingName ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                </button>
                <button onClick={cancelEditingName} className="h-8 w-8 rounded-full hover:bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button onClick={startEditingName} className="flex items-center gap-1.5 min-w-0">
                <p className="text-[16px] font-semibold truncate">{session?.user?.name ?? "—"}</p>
                <Pencil className="h-3 w-3 text-muted-foreground shrink-0" />
              </button>
            )}
            <p className="text-[13px] text-muted-foreground truncate mt-0.5">{session?.user?.email ?? "—"}</p>
            {nameError && <p className="text-[12px] text-destructive mt-1">{nameError}</p>}
          </div>
        </div>

        <button
          onClick={() => setShowPasswordDialog(true)}
          className="w-full flex items-center justify-between px-4 py-3 border-t border-border/50 hover:bg-muted/50 transition-colors text-left"
        >
          <span className="text-[14px] font-medium">เปลี่ยนรหัสผ่าน</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>

        <Link
          href="/settings/categories"
          className="w-full flex items-center justify-between px-4 py-3 border-t border-border/50 hover:bg-muted/50 transition-colors text-left"
        >
          <span className="flex items-center gap-2 text-[14px] font-medium">
            <FolderTree className="h-4 w-4 text-muted-foreground" />
            หมวดหมู่
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>

        <Link
          href="/settings/payment-methods"
          className="w-full flex items-center justify-between px-4 py-3 border-t border-border/50 hover:bg-muted/50 transition-colors text-left"
        >
          <span className="flex items-center gap-2 text-[14px] font-medium">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            ช่องทางชำระเงิน
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>

        <Link
          href="/recurring"
          className="w-full flex items-center justify-between px-4 py-3 border-t border-border/50 hover:bg-muted/50 transition-colors text-left"
        >
          <span className="flex items-center gap-2 text-[14px] font-medium">
            <BellRing className="h-4 w-4 text-muted-foreground" />
            การแจ้งเตือนซ้ำ
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>

        <Link
          href="/settings/family"
          className="w-full flex items-center justify-between px-4 py-3 border-t border-border/50 hover:bg-muted/50 transition-colors text-left"
        >
          <span className="flex items-center gap-2 text-[14px] font-medium">
            <Users className="h-4 w-4 text-muted-foreground" />
            ครอบครัว
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </div>

      {/* ─── Family Member Tags ────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide">แท็กสมาชิก</p>
          </div>
          <button
            onClick={() => setShowAddInput((v) => !v)}
            className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/20 transition-colors"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <p className="text-[12px] text-muted-foreground px-1">ใช้แท็กเพื่อระบุว่ารายการนั้นเป็นของใคร เช่น แม่ พ่อ ลูก</p>

        <div className="ios-card overflow-hidden">
          {membersLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {members.length === 0 && !showAddInput && (
                <div className="px-4 py-6 text-center">
                  <p className="text-[14px] text-muted-foreground">ยังไม่มีแท็ก กด + เพื่อเพิ่ม</p>
                </div>
              )}
              {members.map((m, i) => (
                <div key={m.id} className={cn(i > 0 && "border-t border-border/50")}>
                  <MemberRow member={m} onDelete={setDeletingMember} onRename={handleRename} />
                </div>
              ))}
              {showAddInput && (
                <div className={cn("px-4 py-3 flex items-center gap-2", members.length > 0 && "border-t border-border/50")}>
                  <Input
                    placeholder="ชื่อแท็ก เช่น แม่, ลูก"
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    className="flex-1 h-9 text-[14px] bg-input border-0 rounded-lg"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") { setShowAddInput(false); setAddName(""); } }}
                  />
                  <button
                    onClick={handleAdd}
                    disabled={!addName.trim() || adding}
                    className="h-9 px-3 rounded-lg bg-primary text-white text-[13px] font-semibold disabled:opacity-40 flex items-center gap-1.5"
                  >
                    {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "เพิ่ม"}
                  </button>
                  <button
                    onClick={() => { setShowAddInput(false); setAddName(""); }}
                    className="h-9 w-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Sign out */}
      <div className="ios-card overflow-hidden">
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full flex items-center gap-3 px-4 py-4 text-destructive hover:bg-destructive/5 transition-colors text-left"
        >
          <LogOut className="h-5 w-5 shrink-0" />
          <span className="text-[15px] font-medium">ออกจากระบบ</span>
        </button>
      </div>

      {/* Change password */}
      <Dialog open={showPasswordDialog} onOpenChange={(open) => { if (!open) closePasswordDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>เปลี่ยนรหัสผ่าน</DialogTitle>
            <DialogDescription>กรอกรหัสผ่านปัจจุบันและรหัสผ่านใหม่ของคุณ</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <Input
              type="password"
              placeholder="รหัสผ่านปัจจุบัน"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="bg-input border-0 rounded-xl"
              autoComplete="current-password"
            />
            <Input
              type="password"
              placeholder="รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="bg-input border-0 rounded-xl"
              autoComplete="new-password"
            />
            <Input
              type="password"
              placeholder="ยืนยันรหัสผ่านใหม่"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              className="bg-input border-0 rounded-xl"
              autoComplete="new-password"
              onKeyDown={(e) => { if (e.key === "Enter") handleChangePassword(); }}
            />
            {passwordError && <p className="text-[13px] text-destructive">{passwordError}</p>}
            {passwordSuccess && <p className="text-[13px] text-[#34C759]">เปลี่ยนรหัสผ่านสำเร็จ</p>}
          </div>
          <DialogFooter className="mt-4 gap-2">
            <Button variant="secondary" onClick={closePasswordDialog} disabled={changingPassword}>ยกเลิก</Button>
            <Button onClick={handleChangePassword} disabled={changingPassword || !currentPassword || !newPassword || !confirmNewPassword}>
              {changingPassword ? "กำลังเปลี่ยน..." : "เปลี่ยนรหัสผ่าน"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete member tag confirm */}
      <Dialog open={!!deletingMember} onOpenChange={(open) => { if (!open) setDeletingMember(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ลบแท็กสมาชิก</DialogTitle>
            <DialogDescription>
              ยืนยันการลบแท็ก &quot;{deletingMember?.name}&quot;?
              {(deletingMember?._count.transactions ?? 0) > 0 && (
                <span className="block mt-1 text-[#FF9500]">
                  รายการ {deletingMember?._count.transactions} รายการที่ใช้แท็กนี้จะถูกยกเลิกแท็ก
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2">
            <Button variant="secondary" onClick={() => setDeletingMember(null)} disabled={deleteLoading}>ยกเลิก</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading ? "กำลังลบ..." : "ลบแท็ก"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
