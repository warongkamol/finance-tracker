"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Pencil, Check, X, Loader2, Plus, Copy, Link2, Link2Off } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface FamilyGroupMember {
  id: string;
  name: string;
  email: string;
  myAlias?: string | null;
  displayName: string;
  isMe: boolean;
}

interface FamilyGroupItem {
  id: string;
  inviteCode: string;
  name: string;
  displayName: string;
  members: FamilyGroupMember[];
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-2xl bg-border/50", className)} />;
}

export default function FamilySettingsPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<FamilyGroupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const [showCreateInput, setShowCreateInput] = useState(false);
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const [showJoinInput, setShowJoinInput] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");

  const [copied, setCopied] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Private alias (others only) — what YOU privately call another member;
  // visible only to you, never to the target or anyone else
  const [editingAliasFor, setEditingAliasFor] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");
  const [savingAlias, setSavingAlias] = useState(false);

  // Private group nickname — what YOU privately call this group
  const [editingGroupNickname, setEditingGroupNickname] = useState(false);
  const [groupNicknameDraft, setGroupNicknameDraft] = useState("");
  const [savingGroupNickname, setSavingGroupNickname] = useState(false);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/family");
      const data = await res.json();
      if (data.success) {
        const list: FamilyGroupItem[] = data.data.groups;
        setGroups(list);
        setSelectedGroupId((prev) => (prev && list.some((g) => g.id === prev) ? prev : list[0]?.id ?? null));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  // Reset inline-editor state whenever the selected group changes — otherwise
  // an open editor (with a stale draft) would keep operating on the new group.
  useEffect(() => {
    setEditingGroupNickname(false);
    setGroupNicknameDraft("");
    setEditingAliasFor(null);
    setAliasDraft("");
  }, [selectedGroupId]);

  const selectedGroup = groups.find((g) => g.id === selectedGroupId) ?? null;

  // ── Create / Join — always visible, user can always add more groups ──────

  async function handleCreateGroup() {
    if (!createName.trim() || creating) return;
    setCreating(true);
    setCreateError("");
    try {
      const res = await fetch("/api/v1/family/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: createName.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setShowCreateInput(false);
        setCreateName("");
        await fetchGroups();
        setSelectedGroupId(data.data.group.id);
      } else {
        setCreateError(data.error?.message ?? "เกิดข้อผิดพลาด");
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleJoinGroup() {
    if (!joinCode.trim() || joining) return;
    setJoining(true);
    setJoinError("");
    try {
      const res = await fetch("/api/v1/family/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: joinCode.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setShowJoinInput(false);
        setJoinCode("");
        await fetchGroups();
        setSelectedGroupId(data.data.group.id);
      } else {
        setJoinError(data.error?.message ?? "ไม่พบกลุ่ม");
      }
    } finally {
      setJoining(false);
    }
  }

  // ── Selected-group actions ────────────────────────────────────────────────

  function handleCopyCode() {
    if (!selectedGroup) return;
    navigator.clipboard.writeText(selectedGroup.inviteCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleLeaveGroup() {
    if (!selectedGroup || leaving) return;
    setLeaving(true);
    try {
      const res = await fetch("/api/v1/family/leave", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: selectedGroup.id }),
      });
      const data = await res.json();
      if (data.success) {
        setShowLeaveConfirm(false);
        const leftId = selectedGroup.id;
        setGroups((prev) => prev.filter((g) => g.id !== leftId));
        setSelectedGroupId((prev) => (prev === leftId ? null : prev));
      }
    } finally {
      setLeaving(false);
    }
  }

  // ── Member alias (private — what only YOU call them) ─────────────────────

  function startEditingAlias(member: FamilyGroupMember) {
    setEditingAliasFor(member.id);
    setAliasDraft(member.myAlias ?? "");
  }
  function cancelEditingAlias() {
    setEditingAliasFor(null);
    setAliasDraft("");
  }
  async function handleSaveAlias(memberId: string) {
    if (!selectedGroup) return;
    setSavingAlias(true);
    try {
      const trimmed = aliasDraft.trim();
      const res = await fetch("/api/v1/family/alias", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: memberId, nickname: trimmed || null }),
      });
      const data = await res.json();
      if (data.success) {
        const groupId = selectedGroup.id;
        setGroups((prev) =>
          prev.map((g) =>
            g.id !== groupId
              ? g
              : {
                  ...g,
                  members: g.members.map((m) =>
                    m.id === memberId
                      ? { ...m, myAlias: data.data.nickname, displayName: data.data.nickname ?? m.name }
                      : m
                  ),
                }
          )
        );
        setEditingAliasFor(null);
      }
    } finally {
      setSavingAlias(false);
    }
  }

  // ── Group nickname (private — what only YOU call this group) ─────────────

  function startEditingGroupNickname() {
    if (!selectedGroup) return;
    setGroupNicknameDraft(selectedGroup.displayName !== selectedGroup.name ? selectedGroup.displayName : "");
    setEditingGroupNickname(true);
  }
  function cancelEditingGroupNickname() {
    setEditingGroupNickname(false);
    setGroupNicknameDraft("");
  }
  async function handleSaveGroupNickname() {
    if (!selectedGroup) return;
    setSavingGroupNickname(true);
    try {
      const trimmed = groupNicknameDraft.trim();
      const res = await fetch("/api/v1/family/group-nickname", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: selectedGroup.id, nickname: trimmed || null }),
      });
      const data = await res.json();
      if (data.success) {
        const groupId = selectedGroup.id;
        setGroups((prev) =>
          prev.map((g) => (g.id !== groupId ? g : { ...g, displayName: data.data.nickname ?? g.name }))
        );
        setEditingGroupNickname(false);
      }
    } finally {
      setSavingGroupNickname(false);
    }
  }

  return (
    <div className="py-5 space-y-5">
      <div className="flex items-center gap-2">
        <button onClick={() => router.back()} className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-[18px] font-bold leading-tight">ครอบครัว</h1>
      </div>

      {/* Create / Join — always visible, user can always create or join more groups */}
      <div className="ios-card overflow-hidden">
        {(createError || joinError) && (
          <p className="text-[13px] text-destructive text-center px-4 pt-3">{createError || joinError}</p>
        )}
        {showCreateInput ? (
          <div className="px-4 py-3 space-y-2">
            <p className="text-[12px] text-muted-foreground font-medium uppercase tracking-wide">ตั้งชื่อกลุ่ม</p>
            <div className="flex gap-2">
              <Input
                placeholder="เช่น ครอบครัวกับแฟน"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                maxLength={50}
                className="flex-1 h-11 bg-input border-0 rounded-xl text-[14px]"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateGroup();
                  if (e.key === "Escape") { setShowCreateInput(false); setCreateName(""); setCreateError(""); }
                }}
              />
              <button
                onClick={handleCreateGroup}
                disabled={!createName.trim() || creating}
                className="h-11 px-4 rounded-xl bg-primary text-white text-[14px] font-semibold disabled:opacity-40 flex items-center gap-1.5"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "สร้าง"}
              </button>
              <button
                onClick={() => { setShowCreateInput(false); setCreateName(""); setCreateError(""); }}
                className="h-11 w-11 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : showJoinInput ? (
          <div className="px-4 py-3 space-y-2">
            <p className="text-[12px] text-muted-foreground font-medium uppercase tracking-wide">รหัสเชิญ (6 ตัวอักษร)</p>
            <div className="flex gap-2">
              <Input
                placeholder="เช่น ABC123"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                className="flex-1 h-11 bg-input border-0 rounded-xl text-[16px] font-bold tracking-widest uppercase"
                maxLength={6}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleJoinGroup();
                  if (e.key === "Escape") { setShowJoinInput(false); setJoinCode(""); setJoinError(""); }
                }}
              />
              <button
                onClick={handleJoinGroup}
                disabled={!joinCode.trim() || joining}
                className="h-11 px-4 rounded-xl bg-[#AF52DE] text-white text-[14px] font-semibold disabled:opacity-40 flex items-center gap-1.5"
              >
                {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : "เข้าร่วม"}
              </button>
              <button
                onClick={() => { setShowJoinInput(false); setJoinCode(""); setJoinError(""); }}
                className="h-11 w-11 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="px-4 py-3 flex gap-2">
            <button
              onClick={() => { setCreateError(""); setShowCreateInput(true); }}
              className="flex-1 h-11 rounded-xl bg-primary text-white text-[14px] font-semibold flex items-center justify-center gap-2"
            >
              <Plus className="h-4 w-4" />
              สร้างกลุ่ม
            </button>
            <button
              onClick={() => { setJoinError(""); setShowJoinInput(true); }}
              className="flex-1 h-11 rounded-xl bg-[#AF52DE]/10 text-[#AF52DE] text-[14px] font-semibold flex items-center justify-center gap-2"
            >
              <Link2 className="h-4 w-4" />
              เข้าร่วมด้วยรหัส
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">👨‍👩‍👧‍👦</p>
          <p className="text-[16px] font-medium">ยังไม่ได้เข้าร่วมกลุ่มครอบครัว</p>
          <p className="text-[14px] text-muted-foreground mt-1">สร้างกลุ่มใหม่ หรือเข้าร่วมด้วยรหัสจากสมาชิก</p>
        </div>
      ) : (
        <>
          {/* Group picker — chooses which group's SETTINGS to view/manage.
              Independent of the dashboard/transactions filter and the
              entry-form picker (spec: three independent pickers, no sync). */}
          <Select value={selectedGroupId ?? undefined} onValueChange={setSelectedGroupId}>
            <SelectTrigger className="h-11 bg-input border-0 rounded-xl text-[14px]">
              <SelectValue placeholder="เลือกกลุ่ม" />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.displayName}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedGroup && (
            <div className="ios-card overflow-hidden">
              {/* Invite code */}
              <div className="px-4 py-3.5 flex items-center justify-between border-b border-border/50">
                <div>
                  <p className="text-[12px] text-muted-foreground font-medium uppercase tracking-wide">รหัสเชิญ</p>
                  <p className="text-[22px] font-bold tracking-[0.2em] text-primary mt-0.5">{selectedGroup.inviteCode}</p>
                </div>
                <button
                  onClick={handleCopyCode}
                  className="flex items-center gap-1.5 h-9 px-3 rounded-xl bg-primary/10 text-primary text-[13px] font-semibold active:scale-95 transition-all"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "คัดลอกแล้ว" : "คัดลอก"}
                </button>
              </div>

              {/* Private group nickname — what only YOU call this group;
                  resolution order: my nickname ?? group's default name */}
              <div className="px-4 py-3 border-b border-border/50">
                {editingGroupNickname ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder={`ตั้งชื่อที่อยากเรียก เช่น ${selectedGroup.name}`}
                        value={groupNicknameDraft}
                        onChange={(e) => setGroupNicknameDraft(e.target.value)}
                        maxLength={50}
                        className="h-8 text-[13px] bg-input border-0 rounded-lg flex-1"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveGroupNickname();
                          if (e.key === "Escape") cancelEditingGroupNickname();
                        }}
                      />
                      <button
                        onClick={handleSaveGroupNickname}
                        disabled={savingGroupNickname}
                        className="h-7 w-7 rounded-full bg-[#AF52DE]/10 text-[#AF52DE] flex items-center justify-center"
                      >
                        {savingGroupNickname ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      </button>
                      <button
                        onClick={cancelEditingGroupNickname}
                        className="h-7 w-7 rounded-full hover:bg-muted text-muted-foreground flex items-center justify-center"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">เห็นเฉพาะคุณคนเดียว</p>
                  </div>
                ) : (
                  <button
                    onClick={startEditingGroupNickname}
                    className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-[#AF52DE] transition-colors"
                  >
                    <Pencil className="h-3 w-3" />
                    {selectedGroup.displayName !== selectedGroup.name
                      ? `ชื่อที่คุณเรียก: ${selectedGroup.displayName} 🔒`
                      : "ตั้งชื่อกลุ่มที่อยากเรียก (ส่วนตัว)"}
                  </button>
                )}
              </div>

              {/* Members — existing inline private-member-alias editor, unchanged */}
              <div className="divide-y divide-border">
                {selectedGroup.members.map((m) => (
                  <div key={m.id} className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-[#AF52DE]/10 flex items-center justify-center shrink-0">
                        <span className="text-[14px]">{m.isMe ? "👤" : "👥"}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium truncate">
                          {m.displayName}
                          {m.isMe && <span className="ml-1.5 text-[11px] text-muted-foreground font-normal">(คุณ)</span>}
                        </p>
                        <p className="text-[12px] text-muted-foreground truncate">{m.email}</p>
                      </div>
                    </div>

                    {!m.isMe && (
                      <div className="mt-2 ml-12">
                        {editingAliasFor === m.id ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <Input
                                placeholder={`ชื่อที่อยากเรียก ${m.name} เช่น น้องบี`}
                                value={aliasDraft}
                                onChange={(e) => setAliasDraft(e.target.value)}
                                maxLength={50}
                                className="h-8 text-[13px] bg-input border-0 rounded-lg flex-1"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleSaveAlias(m.id);
                                  if (e.key === "Escape") cancelEditingAlias();
                                }}
                              />
                              <button
                                onClick={() => handleSaveAlias(m.id)}
                                disabled={savingAlias}
                                className="h-7 w-7 rounded-full bg-[#AF52DE]/10 text-[#AF52DE] flex items-center justify-center"
                              >
                                {savingAlias ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                              </button>
                              <button
                                onClick={cancelEditingAlias}
                                className="h-7 w-7 rounded-full hover:bg-muted text-muted-foreground flex items-center justify-center"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              🔒 เห็นเฉพาะคุณคนเดียว — {m.name} และคนอื่นในกลุ่มจะไม่เห็นชื่อนี้
                            </p>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEditingAlias(m)}
                            className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-[#AF52DE] transition-colors"
                          >
                            <Pencil className="h-3 w-3" />
                            {m.myAlias ? `ชื่อที่คุณเรียก: ${m.myAlias} 🔒` : "ตั้งชื่อที่อยากเรียก (ส่วนตัว 🔒)"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Leave */}
              <div className="px-4 py-3 border-t border-border/50">
                <button
                  onClick={() => setShowLeaveConfirm(true)}
                  className="flex items-center gap-2 text-[13px] text-destructive font-medium hover:opacity-70 transition-opacity"
                >
                  <Link2Off className="h-4 w-4" />
                  ออกจากกลุ่ม
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Leave group confirm — passes the selected groupId */}
      <Dialog open={showLeaveConfirm} onOpenChange={setShowLeaveConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ออกจากกลุ่ม</DialogTitle>
            <DialogDescription>
              เมื่อออกจากกลุ่ม คุณจะไม่เห็นรายการของสมาชิกคนอื่นในกลุ่มนี้อีกต่อไป
              {selectedGroup && selectedGroup.members.length === 1 && (
                <span className="block mt-1 text-[#FF9500]">คุณเป็นสมาชิกคนสุดท้าย กลุ่มจะถูกลบทิ้ง</span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2">
            <Button variant="secondary" onClick={() => setShowLeaveConfirm(false)} disabled={leaving}>ยกเลิก</Button>
            <Button variant="destructive" onClick={handleLeaveGroup} disabled={leaving}>
              {leaving ? "กำลังออก..." : "ออกจากกลุ่ม"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
