# Budget Page Redesign — Design Spec

**Date:** 2026-06-18
**Status:** Approved by user (visual-companion mockups reviewed), ready for implementation planning

## 1. Why

The current `/budget` page crams a 3-tab dashboard (ภาพรวม/แผนเทียบจริง/สัดส่วน) and a
12-month grid into one screen. As the app heads toward a public/demo launch, the
user wants this restructured into three purpose-built pages with clearer jobs:
see the whole year at a glance, plan each month's numbers, and check whether
actual spending tracked the plan. This redesign was scoped ahead of opening a
closed demo (see [[project_roadmap_sequencing]]) so testers see the intended
experience, not the page slated for replacement.

Along the way, two real bugs were found and one is already fixed (see
Section 7) and a long-standing Budget→Debt sync behavior is being redesigned
(Section 5) to support "planned but not yet real" liabilities.

## 2. Routes & Navigation

Three separate routes (not tabs-in-one-page like today), so each loads only
its own data and gets a shareable URL:

- `/budget` — ภาพรวม (yearly overview)
- `/budget/plan` — วางแผนงบรายเดือน (monthly planning grid)
- `/budget/track` — ติดตามสถานะใช้จ่าย (actual-vs-plan tracking)
- `/budget/[year]/[month]` — item edit page (existing route, kept, contents
  adjusted per Section 6)

All three top-level pages share a segmented control at the top (same visual
pattern as today's tabs) that navigates between real routes instead of
switching local state.

## 3. Page 1 — `/budget` (ภาพรวม)

- Year navigator (kept from today).
- Summary card: รายรับ / รายจ่าย / หนี้สิน / เงินออม / คงเหลือสุทธิ (วางแผนทั้งปี) —
  same totals as today's "overview" tab content.
- **12-month grid removed from this page** (moved to `/budget/plan`).
- "แผนเทียบจริงรายเดือน" chart, **changed from grouped side-by-side bars to a
  single stacked column per month**: dark segment = actual, light segment =
  remaining headroom to plan (`max(0, planned - actual)`), so one bar visually
  reads as "this much of the plan got used." When actual exceeds planned, the
  light segment is 0 (no headroom) and the bar is shown in a warning color
  (e.g. brighter red) instead of stacking past the plan line. Same chart
  component is reused verbatim on `/budget/plan`.
- Donut chart: yearly allocation across EXPENSE/LIABILITY/SAVING (kept from
  today's "allocation" tab, unchanged).
- **New:** a second stacked-bar chart, one bar per month, segmented by
  **category** (not plan-vs-actual) — shows which categories dominate each
  month's spend. Tapping a month's bar opens a breakdown (Sheet/Dialog) listing
  that month's categories and amounts.

## 4. Page 2 — `/budget/plan` (วางแผนงบรายเดือน)

- Top: the same plan-vs-actual stacked-bar dashboard from Page 1 (shared
  component).
- **New: expandable percentage rows** below the chart — รายจ่าย / หนี้สิน /
  เงินออม each shown as a % of planned yearly income. Tapping a row expands it
  in place to show the total planned amount for that type plus its line items
  (e.g. tapping "หนี้สิน 10%" reveals "ไอแพดโปร 2026 — 2,000"). Collapses on
  second tap. Only one row needs to be expanded at a time is NOT a constraint —
  any number can be open simultaneously (simple per-row toggle state).
- Below: the 12-month grid, moved here verbatim from today's `/budget` page
  (same card design: month name, ✓ if has data, รายรับ/รายจ่าย/คงเหลือ lines).
  Tapping a month still navigates to `/budget/[year]/[month]`.

## 5. Page 3 — `/budget/track` (ติดตามสถานะใช้จ่าย)

- Horizontal month-chip picker at the top (replaces the old "เทียบจริง" Sheet
  trigger button — this page IS that feature now, always visible, no need to
  open it from the month-edit page anymore).
- **Two side-by-side cards** (separate boxes, not one split card): "แผน" and
  "ยอดใช้จริง" — each shows รายรับ / รายจ่าย / คงเหลือ stacked vertically for the
  selected month. (Earlier draft tried one card split down the middle; user
  preferred two distinct boxes.)
- "งบประมาณ" card — per-item plan-vs-actual list with progress bars (carried
  over from today's comparison Sheet, renamed from "เปรียบเทียบงบ vs จริง").
- **New "รายรับรายจ่ายนอกแผน" card**, same visual style as the งบประมาณ card
  (solid card, not a dashed warning box): lists actual transactions whose
  category has no matching budget item that month. Income items listed first
  (รายรับนอกแผน), then expense items (รายจ่ายนอกแผน) below, in the same card.
  "Match" is by `categoryId` only (root category roll-up, same logic the
  comparison API already uses for child categories) — amount/over-budget
  status is irrelevant to "matched or not"; an item with a budget line is
  "matched" even if it ran over (that's handled by the งบประมาณ card's "เกิน!"
  flag, not this section).

### 5a. Comparison API must be rewritten (not just relabeled)

The existing `/api/v1/budgets/comparison` endpoint (written in Phase 4, before
the wallet/credit-card/conversion systems existed) has two problems to fix as
part of this rebuild, not patched separately:

1. **`actualNet` bug:** currently `actualIncome - actualExpense` only — never
   subtracts real LIABILITY/SAVING outflows. `plannedNet` *does* subtract
   `plannedLiability + plannedSaving`, so the two numbers are inconsistent.
   Debt installment payments recorded as a plain EXPENSE transaction are
   already covered (they land in `actualExpense`), but a debt paid via a
   credit-card `Transfer` (`isTransfer:true`) is invisible to this calc
   entirely — real cash left the wallet but `actualNet` doesn't reflect it.
   Fix: `actualNet` must account for both EXPENSE-type and Transfer-type
   liability/saving outflows so it's apples-to-apples with `plannedNet`.
2. **Unmatched-category detection (new):** the endpoint needs to return, for
   the requested month, the list of actual transactions (income and expense)
   whose category has no corresponding budget item — this is new, the
   existing endpoint only ever computes `actual` for categories that already
   have a budget item.

## 6. Month detail page — `/budget/[year]/[month]`

Mostly unchanged. Two changes:

1. **Remove the "เทียบจริง" action button + Sheet** — that feature now lives
   permanently on `/budget/track`, no reason to duplicate it here.
2. **"เพิ่มรายการงบ" form changes**, by type:
   - **เงินออม (SAVING):** no category picker. Instead, a "กระเป๋าออม" account
     picker (cash/savings-type accounts). If the user has none, an inline
     "+ สร้างกระเป๋าออมใหม่" affordance creates one without leaving the sheet.
     This is forecast metadata only — picking a wallet here does **not** move
     money or create a Transfer; it's a planning reference, same spirit as
     the LIABILITY change below.
   - **หนี้สิน (LIABILITY):** instead of the old inline
     name/monthlyAmount/totalMonths/startMonth fields, this opens the **same
     `DebtForm` used on `/debts`** (name, total amount, months, optional
     interest rate with ต่อเดือน/ต่อปี toggle, optional billing account). See
     Section 8 for what creating this produces (a `PLANNED` debt, not an
     active one).
   - รายรับ/รายจ่าย (INCOME/EXPENSE): unchanged.
   - Items remain grouped into separate per-type cards in the list (already
     the existing behavior — confirmed during design review, no change
     needed here).

## 7. Already shipped this session — Decimal serialization bug fix

Independent of the redesign, found while reviewing this page: `GET`/`PUT
/api/v1/budgets/[year]/[month]` and the `copy-from` route returned
`BudgetItem.amount` as a raw Prisma `Decimal`. `JSON.stringify` serializes
`Decimal` via its `toJSON()` → `toString()`, which **drops the decimal point
entirely for whole numbers** (e.g. `1000`, not `"1000.00"`). The client sums
items with plain `+` (`budget/[year]/[month]/page.tsx`'s per-type totals,
summary bar, and `netPlanned`), so JS did **string concatenation** instead of
addition — `0 + "1000"` → `"01000"`. With several whole-number items this
glues into one long digit string with no decimal point at all (e.g.
`"01000800030006000"`), which `formatCurrency`'s `parseFloat` then reads as
one gigantic number — matching the user's report of expense totals "off by
millions."

**Fixed** (commits pending in this session, 2 files): both routes now map
`amount: Number(item.amount)` before responding, matching the pattern
`/api/v1/budgets/route.ts` (yearly overview) already used correctly. `tsc
--noEmit` clean. This fix is **not** blocked on the redesign and should ship
independently/ahead of it.

## 8. Schema change — "Planned" liabilities

**Problem:** today, adding a LIABILITY item on the budget page immediately
creates a real `Debt` (status `ACTIVE`) via the existing Budget→Debt sync
(commit `817a07b`). The user wants budget-page liabilities to represent
**forecasts** (e.g. "might buy an iPad next year") that don't commit to a real
debt until confirmed closer to the date — at which point amount/months may
need adjusting since the original entry was an estimate.

**Decision:**
- Add `PLANNED` to the `DebtStatus` enum (`ACTIVE | COMPLETED | CANCELLED` →
  `+ PLANNED`).
- Creating a LIABILITY item via the new `DebtForm`-based flow (Section 6)
  creates a `Debt` with status `PLANNED`. **No `DebtPayment` rows are
  generated yet** — a planned debt is just `name/totalAmount/totalMonths/
  startDate/interestRate`, no schedule. This was the user's explicit call
  after the first round of "should it forecast" turned out to mean "show me
  a number to decide with, not a real schedule."
- `PLANNED` debts are **excluded from all real-debt totals** (debt list page's
  ACTIVE sums, dashboard `DebtBanner`, account `creditOutstanding`, etc. — the
  same `status: ACTIVE` filters already used everywhere just need confirming
  they don't accidentally also catch `PLANNED`).
- The `/debts` page gets a new "หนี้สินวางแผน" section listing `PLANNED` debts
  separately from the ACTIVE list.
- A "ยืนยันเป็นหนี้จริง" action on each planned debt lets the user **edit**
  `totalAmount` and `totalMonths` (the original entry was an estimate) before
  confirming, then flips status `PLANNED → ACTIVE` and generates the
  `DebtPayment` schedule via the existing extracted helper
  (`createDebtPaymentsAndBudgetItems`, from sub-project C-3 Plan 1 Task 2) —
  no new schedule-generation logic needed, just reuse.
- The reverse direction (creating a real debt directly on `/debts` →
  auto-creates a LIABILITY budget item) is **unchanged** — that already
  matches the "create debt first, plan around it later" case the user
  described, no redesign needed there.
- Because the BudgetItem's `amount` already carries the planned monthly
  figure independent of the linked Debt's status, Page 2's "% of planned
  income" math (Section 4) and the 12-month grid totals work correctly for
  planned liabilities with **no special-casing** — they're just a normal
  LIABILITY line until/unless converted.

## 9. Explicitly deferred / out of scope

- **Emoji → icon swap**: user wants to evaluate this separately before
  deciding (which emojis, replaced with what icon set, where) — not part of
  this spec, raised here only as a flagged follow-up. See
  [[project_state|standing one-session-per-subproject pattern]] — should get
  its own short session once researched, not bundled into this redesign.
- Exact Recharts implementation technique for the stacked plan-vs-actual bar
  (Section 3) — the **visual outcome** is specified (dark=actual, light=
  remaining-to-plan, over-budget = no light segment + warning color); the
  concrete chart-library mechanics (e.g. two `<Bar>`s sharing a `stackId` with
  a computed `remainder = max(0, planned-actual)` series) are an
  implementation detail for the plan/build step, not a design decision.
- Whether selecting a "กระเป๋าออม" for a SAVING budget item should later be
  cross-checked against real Transfers into that account (i.e., did the
  planned saving actually happen) — out of scope for this spec; today it's
  metadata only, no actual-vs-planned tracking for savings specifically beyond
  what the LIABILITY/EXPENSE "งบประมาณ" card already does by category.
