# Budget Page Redesign — Plan

**Goal:** Make `/budget` easier to use per user feedback: too much scrolling/data density,
hard-to-find actions (เทียบจริง/คัดลอก/นำเข้าหนี้), confusing month/year switching, and
fiddly add/edit-item flow. The 12-month grid itself is fine and stays as-is.

**User's explicit direction (verbatim from clarifying Q&A):**
- Tapping a month should navigate to a **new dedicated page** showing that month's items,
  with a back button to return to the yearly overview — not inline expansion.
- "คงเหลือสุทธิ (วางแผน)" must stay a **flat per-period sum**, not a carried-over balance.
  (Traced the existing calc at `budget/page.tsx:762-765` and `:204-206` — it's already a
  clean `Σ(income) − Σ(non-income)` per month/year with zero carry-over logic anywhere in
  the codebase. Preserve this exactly; do not introduce accumulation across months.)
- Stacked dashboard cards should be grouped into tabs (mirrors `/debts` `tab` state and
  dashboard's `familyFilter` segmented-control pattern).

**No backend changes needed** — `/api/v1/budgets/[year]/[month]`, `.../copy-from/...`,
`/api/v1/budgets/comparison`, `/api/v1/budgets/yearly-comparison`, `/api/v1/debts` already
support everything the detail view needs.

---

### Task 1: Extract shared types/constants/helpers

**Create:** `src/app/(app)/budget/_shared.tsx`

Move out of `budget/page.tsx` (used by both the overview and the new detail route):
- Types: `ItemType`, `Category`, `DebtPayment`, `Debt`, `BudgetItem`, `Comparison`/`ComparisonItem`
- Constants: `TYPE_CONFIG`, `SHORT_MONTHS`, `CHART_TOOLTIP_STYLE`, `AXIS_TICK`, `Y_TICK_FORMATTER`
- Helpers: `Skeleton`, `debtMonthsForYear`
- `ItemForm` + its `DebtCreationInput`/`ItemFormProps` (used only by the detail route after
  this refactor, but lives here so it's colocated with the types it depends on)

Leave page-specific types (`MonthOverview`, `YearlyComparisonMonth`, `MonthDetail`) in
their respective pages.

- [ ] Create `_shared.tsx`, move the above, export everything needed
- [ ] Update `budget/page.tsx` imports accordingly; `npx tsc --noEmit` clean

---

### Task 2: Build `/budget/[year]/[month]` — dedicated month page

**Create:** `src/app/(app)/budget/[year]/[month]/page.tsx`

Client component using `useParams<{ year: string; month: string }>()` + `useRouter()`
(same pattern as `debts/[id]/page.tsx`). Parse `year`/`month` to numbers from params.

Move from `budget/page.tsx` wholesale, adapted to load from URL params instead of
`selectedMonth` state:
- `detail`/`loadingDetail` state + fetch-on-mount (replaces `fetchDetail`)
- `saveItemsForMonth`, `handleAddItem`, `handleEditItem`, `handleDeleteItem`
- Copy-from dialog + `handleCopyFrom` + `copySrcMonth`/`showCopyDialog`/`copyLoading`
- Debt-import dialog + `openDebtImport`/`toggleDebt`/`handleDebtImport`/`handleCreateDebt`
  + `debts`/`loadingDebts`/`selectedDebtIds`/`debtImporting`
- Comparison sheet + `fetchComparison`/`comparison`/`loadingComparison`/`showComparison`
- `itemsByType`, `netPlanned` derived values (keep the flat-sum formula byte-for-byte)
- `categories` fetch

**New header layout** (replaces the inline `selectedMonth &&` block's header at
`budget/page.tsx:835-846`):
- Back button (`<Link href="/budget">` + `ArrowLeft`/`ChevronLeft`, same idiom as
  `debts/[id]/page.tsx`) on the left
- Month + year title in the center
- **Prev/next month chevrons** — navigate via `<Link href="/budget/{y}/{m}">` to the
  adjacent month, wrapping across year boundaries (Dec → next year Jan, Jan → prev year
  Dec). This directly addresses "สลับเดือน/ปีงงๆ" by letting users move between months
  without returning to the grid.
- Action buttons (คัดลอก, 📊 เทียบจริง, นำเข้าหนี้สิน) as a clearly-labeled row/toolbar
  instead of being buried at the bottom of the item list — addresses "หาฟีเจอร์ยาก"

Body: items-by-type list, empty state, summary bar (unchanged calc), all 3
dialogs/sheets — same content as today, just living on their own page instead of
inline-expanding below the grid.

- [ ] Create the route, wire up data loading from params
- [ ] New header: back button + prev/next month nav + title
- [ ] Move action buttons into a visible toolbar near the top
- [ ] Move all dialogs/sheets (copy, debt-import, comparison) here
- [ ] Verify `npx tsc --noEmit` clean

---

### Task 3: Convert add/edit-item forms from inline to Sheet

Currently `ItemForm` renders **inline** — both the "add new item" block
(`budget/page.tsx:927-938`) and the "edit this item" block
(`budget/page.tsx:866-876`, replacing the row in place) push the surrounding list down,
which is the likely source of "เพิ่ม/แก้ไขรายการงบยุ่งยาก".

Replace both with a `Sheet`/`SheetContent` overlay, mirroring how `DebtForm` and
`RecurringForm` are already used elsewhere (`debts/page.tsx:207-216`,
`recurring/page.tsx:129-150`):
- One sheet, driven by `editingIdx !== null || addingItem` state
- Title: "เพิ่มรายการงบ" / "แก้ไขรายการงบ"
- Same `ItemForm` component, same `onSave`/`onSaveDebt`/`onCancel` wiring — only the
  presentation container changes (overlay vs. inline block)

- [ ] Wrap `ItemForm` (add + edit) in a `Sheet`
- [ ] Confirm list no longer reflows when adding/editing; cancel/save closes the sheet

---

### Task 4: Simplify `/budget/page.tsx` (overview)

Remove everything now living in the detail route:
- `selectedMonth`, `detail`, `loadingDetail`, `saving`, `editingIdx`, `addingItem`
- Copy dialog, debt-import dialog, comparison sheet + all their state/handlers
- `fetchDetail`, `saveItemsForMonth`, `handleAddItem`, `handleEditItem`, `handleDeleteItem`,
  `handleCopyFrom`, `openDebtImport`, `toggleDebt`, `handleDebtImport`, `handleCreateDebt`,
  `fetchComparison`, `itemsByType`, `netPlanned`, `debts`/`debtMonthsForYear` usage
- `categories` fetch (only needed by `ItemForm`, which moved out)

Month grid cards (`budget/page.tsx:801-827`): replace
`<button onClick={() => fetchDetail(m.month)}>` with
`<Link href={`/budget/${year}/${m.month}`}>` styled identically (drop the now-meaningless
`isSelected` ring — selection state doesn't exist on the overview anymore).

Resulting page: year nav + tabbed yearly dashboard (Task 5) + 12-month grid. Nothing else.

- [ ] Strip detail-related state/handlers/dialogs/imports
- [ ] Month cards become `Link`s to `/budget/[year]/[month]`
- [ ] `npx tsc --noEmit` clean — confirms nothing dangling

---

### Task 5: Tab the yearly dashboard (`BudgetDashboardSection`)

Currently three stacked `ios-card`s (yearly totals, plan-vs-actual bar charts, allocation
pie) — addresses "เลื่อนเยอะ/ข้อมูลแน่นไป" and "บางหน้า group รวมเป็น tab ได้".

Replace the stack with a segmented 3-tab control using the same
`ios-card p-1 grid grid-cols-3 gap-1` idiom as `/debts` (`debts/page.tsx:126-139`):

| Tab | Content |
|---|---|
| ภาพรวม | Yearly planned totals + "คงเหลือสุทธิ (วางแผนทั้งปี)" — current `budget/page.tsx:225-244` |
| แผนเทียบจริง | The two `PlanVsActualChart`s (income, expense) — `:247-251` |
| สัดส่วน | Allocation pie + breakdown list — `:254-282` |

Keep the `hasAnyBudget` early-return and loading skeleton as-is; only the body changes
from "all stacked" to "one visible at a time, switched by tab".

- [ ] Add local `dashboardTab` state (`"overview" | "comparison" | "allocation"`)
- [ ] Render the 3-button segmented control + the active section only
- [ ] Verify all three tabs render correctly with real data

---

### Verification

- `npx tsc --noEmit -p tsconfig.json` clean
- `docker compose up -d --build app` (picks up source changes — no bind mount)
- Live smoke test (run-finance-tracker skill, fixture account):
  - `/budget` → tap a month → lands on `/budget/{year}/{month}`
  - Back button returns to `/budget` at the same year
  - Prev/next month chevrons work, including wrap across Dec↔Jan year boundary
  - Add item, edit item, delete item — sheet opens/closes correctly, list doesn't reflow
  - คัดลอก (copy from month), นำเข้าหนี้สิน (debt import), 📊 เทียบจริง (comparison) all work
    from the new page
  - Yearly dashboard tabs switch correctly; "คงเหลือสุทธิ" figures match the old
    (pre-redesign) flat-sum values — no carry-over introduced
- Clean up any test fixture data created during the smoke pass
