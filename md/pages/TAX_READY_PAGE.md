# Tax-Ready Page (Schedule C Export)

> **Status:** 📋 PLANNED  
> **Roadmap Item:** #31  
> **Route:** `pages/tax-ready.html`  
> **CSS:** `css/tax-ready.css`  
> **JS:** `js/pages/tax-ready.js`

---

## Purpose

Aggregate all revenue and expenses into IRS Schedule C (Form 1040) line items for a **single-member LLC**. Generate tax-ready reports, estimate quarterly payments, and maintain audit-ready documentation. This is NOT tax software — it's a data aggregation tool that prepares numbers for your accountant or tax filing.

---

## Tax Context

| Item | Detail |
|------|--------|
| **Entity Type** | Single-member LLC (disregarded entity) |
| **Tax Form** | Schedule C (Profit or Loss From Business) |
| **Attached To** | Personal Form 1040 |
| **NOT Needed** | Form 1065 (partnerships), Schedule K-1 |
| **Also Required** | Schedule SE (self-employment tax) if net profit > $400 |
| **Quarterly Estimates** | Form 1040-ES if expected tax > $1,000/year |
| **Business Code** | 711510 (Independent artists, writers, performers) or 512110 (Motion picture/video production) |
| **Record Retention** | IRS recommends 3 years minimum, 7 years preferred |

---

## Page Layout

```
┌─────────────────────────────────────────────────────┐
│  SIDEBAR (existing)                                  │
├─────────────────────────────────────────────────────┤
│  Tax Preparation          Tax Year: [2026 ▼]        │
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │ 📊 SCHEDULE C SUMMARY                           ││
│  │                                                   ││
│  │ PART I — INCOME                                   ││
│  │ Line 1: Gross receipts.............. $XX,XXX.XX  ││
│  │ Line 2: Returns/allowances......... $0.00        ││
│  │ Line 7: Gross income............... $XX,XXX.XX   ││
│  │                                                   ││
│  │ PART II — EXPENSES                                ││
│  │ Line 8:  Advertising............... $XXX.XX      ││
│  │ Line 9:  Car/truck................. $0.00        ││
│  │ Line 11: Commissions/fees.......... $XXX.XX      ││
│  │ Line 13: Depreciation.............. $XXX.XX      ││
│  │ Line 15: Insurance................. $0.00        ││
│  │ Line 17: Legal/professional........ $XXX.XX      ││
│  │ Line 18: Office expense............ $XX.XX       ││
│  │ Line 22: Supplies.................. $XX.XX       ││
│  │ Line 25: Utilities................. $XXX.XX      ││
│  │ Line 27a: Other expenses........... $X,XXX.XX    ││
│  │   → API costs (OpenAI, ElevenLabs). $XXX.XX     ││
│  │   → Hosting (Supabase, Vercel)..... $XXX.XX     ││
│  │   → Software subscriptions......... $XX.XX      ││
│  │   → Music licensing................ $XX.XX      ││
│  │ Line 28: Total expenses............ $X,XXX.XX    ││
│  │                                                   ││
│  │ BOTTOM LINE                                       ││
│  │ Line 29: Tentative profit.......... $XX,XXX.XX   ││
│  │ Line 30: Home office deduction..... $X,XXX.XX    ││
│  │ ─────────────────────────────────────────        ││
│  │ Line 31: NET PROFIT................ $XX,XXX.XX   ││
│  │                                                   ││
│  │        [Export CSV]  [Export PDF]  [Print]        ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │ 💵 SELF-EMPLOYMENT TAX ESTIMATE (Schedule SE)    ││
│  │                                                   ││
│  │ Net profit (Line 31):           $XX,XXX.XX       ││
│  │ × 92.35%:                       $XX,XXX.XX       ││
│  │ × 15.3% SE tax rate:           $X,XXX.XX        ││
│  │ Deductible half (1040 Sch 1):  $X,XXX.XX        ││
│  │                                                   ││
│  │ Medicare surtax (>$200K):       $0.00            ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │ 📅 QUARTERLY ESTIMATES (Form 1040-ES)            ││
│  │                                                   ││
│  │ Quarter   Due Date    Amount    Status            ││
│  │ ───────────────────────────────────────           ││
│  │ Q1        Apr 15      $XXX      ☐ Paid           ││
│  │ Q2        Jun 15      $XXX      ☐ Paid           ││
│  │ Q3        Sep 15      $XXX      ☐ Paid           ││
│  │ Q4        Jan 15 '27  $XXX      ☐ Paid           ││
│  │                                                   ││
│  │ Projected annual tax:  $X,XXX                    ││
│  │ Safe harbor (100% PY): $X,XXX                    ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │ 📈 QUARTERLY P&L BREAKDOWN                       ││
│  │                                                   ││
│  │         Q1        Q2        Q3        Q4    YTD  ││
│  │ Rev    $X,XXX    $X,XXX    —         —     $XX   ││
│  │ Exp    $X,XXX    $X,XXX    —         —     $XX   ││
│  │ Net    $X,XXX    $X,XXX    —         —     $XX   ││
│  │ Margin  XX%       XX%      —         —      XX% ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │ 🏠 HOME OFFICE DEDUCTION                         ││
│  │                                                   ││
│  │ Method: [Simplified ▼]                           ││
│  │ Square footage: [___] sq ft (max 300)            ││
│  │ Rate: $5/sq ft                                   ││
│  │ Deduction: $____                                 ││
│  │                                                   ││
│  │ OR Actual Method:                                ││
│  │ Total home sq ft: [____]                         ││
│  │ Office sq ft: [____]                             ││
│  │ Business %: XX%                                  ││
│  │ Mortgage/rent: $____ × XX% = $____               ││
│  │ Utilities: $____ × XX% = $____                   ││
│  │ Insurance: $____ × XX% = $____                   ││
│  │ Deduction: $____                                 ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │ ⚠️ DATA COMPLETENESS CHECK                       ││
│  │                                                   ││
│  │ ✅ Revenue entries found for all 12 months       ││
│  │ ✅ API costs tracked (automated)                 ││
│  │ ⚠️ Q2 has no manual expenses — intentional?     ││
│  │ ⚠️ 3 expenses missing receipts                  ││
│  │ ❌ No home office deduction configured           ││
│  │                                                   ││
│  │        [View Missing Items]                      ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │ 📎 RECEIPT INDEX                                  ││
│  │                                                   ││
│  │ Total receipts: 47                                ││
│  │ By category: Software(23) Hosting(12) Equip(8)   ││
│  │              Legal(2) Other(2)                    ││
│  │                                                   ││
│  │        [View All]  [Download ZIP]                ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │ 🗂️ YEAR-END ARCHIVE                              ││
│  │                                                   ││
│  │ Archive 2026 tax data for permanent record?      ││
│  │ Includes: Schedule C summary, all transactions,  ││
│  │ receipts, quarterly reports, P&L statements.     ││
│  │                                                   ││
│  │ Archived years: 2025 (if any)                    ││
│  │                                                   ││
│  │        [Archive 2026]  [Download 2025 Archive]   ││
│  └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

---

## Schedule C Line Mapping Logic

### Part I — Income (from Revenue page data)

| Line | Description | Data Source |
|------|-------------|-------------|
| Line 1 | Gross receipts | `SUM(amount) FROM v_revenue_all WHERE year = tax_year` |
| Line 2 | Returns & allowances | Manual entry (refunds, chargebacks) — usually $0 |
| Line 4 | Cost of goods sold | $0 (digital content, no COGS) |
| Line 7 | Gross income | Line 1 - Line 2 - Line 4 |

### Part II — Expenses (from Expenses page data)

| Line | Description | Data Source |
|------|-------------|-------------|
| Line 8 | Advertising | `category = 'advertising'` |
| Line 9 | Car/truck | `category = 'car_truck'` |
| Line 10 | Commissions/fees | `category = 'commissions_fees'` |
| Line 11 | Contract labor | `category = 'contract_labor'` |
| Line 13 | Depreciation | `category = 'equipment'` (items > $2,500 threshold) |
| Line 15 | Insurance | `category = 'insurance'` |
| Line 17 | Legal/professional | `category = 'legal_professional'` |
| Line 18 | Office expense | `category = 'office_supplies'` |
| Line 22 | Supplies | `category = 'office_supplies'` (consumables) |
| Line 25 | Utilities | `category = 'internet_phone'` |
| Line 27a | Other expenses | `category IN ('software_subscriptions', 'hosting', 'music_licensing', 'education_training', 'other')` |
| Line 28 | Total expenses | Sum of Lines 8-27a |
| Line 30 | Home office | Calculated from home office config |
| Line 31 | Net profit/loss | Line 7 - Line 28 - Line 30 |

---

## Database Schema

### `tax_config` (per-year settings)
```sql
CREATE TABLE tax_config (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tax_year INT NOT NULL,
    business_name TEXT DEFAULT 'Content Creation LLC',
    business_code TEXT DEFAULT '711510',
    ein TEXT,  -- Employer ID Number (encrypted or omitted)
    
    -- Home office (simplified method)
    home_office_method TEXT DEFAULT 'simplified',  -- 'simplified' or 'actual'
    home_office_sqft INT DEFAULT 0,  -- for simplified (max 300)
    home_total_sqft INT,  -- for actual method
    home_office_actual_sqft INT,  -- for actual method
    
    -- Quarterly estimates
    q1_paid BOOLEAN DEFAULT false,
    q1_amount NUMERIC(10,2) DEFAULT 0,
    q2_paid BOOLEAN DEFAULT false,
    q2_amount NUMERIC(10,2) DEFAULT 0,
    q3_paid BOOLEAN DEFAULT false,
    q3_amount NUMERIC(10,2) DEFAULT 0,
    q4_paid BOOLEAN DEFAULT false,
    q4_amount NUMERIC(10,2) DEFAULT 0,
    
    -- Prior year data (for safe harbor calculation)
    prior_year_tax NUMERIC(10,2) DEFAULT 0,
    
    -- Archive
    archived_at TIMESTAMPTZ,
    archive_url TEXT,  -- Supabase storage path to ZIP
    
    meta JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tax_year)
);
```

### `tax_year_snapshots` (archived data)
```sql
CREATE TABLE tax_year_snapshots (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    tax_year INT NOT NULL,
    snapshot_type TEXT NOT NULL,  -- 'schedule_c', 'transactions', 'quarterly_pl'
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(tax_year, snapshot_type)
);
```

---

## RPCs

| RPC | Purpose | Params |
|-----|---------|--------|
| `get_schedule_c_data` | Compute all Schedule C line items | tax_year |
| `get_quarterly_pl` | P&L by quarter | tax_year |
| `get_se_tax_estimate` | Self-employment tax calculation | tax_year |
| `get_quarterly_estimate` | 1040-ES quarterly payment amounts | tax_year |
| `get_tax_completeness_check` | Missing data warnings | tax_year |
| `get_receipt_index` | All receipts organized by category/month | tax_year |
| `save_tax_config` | Update tax year settings | tax_year, config fields |
| `archive_tax_year` | Snapshot all data for permanent record | tax_year |

### `get_schedule_c_data` (core RPC)
```sql
CREATE OR REPLACE FUNCTION get_schedule_c_data(p_tax_year INT)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    total_revenue NUMERIC;
    expenses_by_line JSONB;
    home_office_deduction NUMERIC;
BEGIN
    -- Part I: Income
    SELECT COALESCE(SUM(amount), 0) INTO total_revenue
    FROM v_revenue_all
    WHERE EXTRACT(YEAR FROM revenue_date) = p_tax_year;
    
    -- Part II: Expenses by Schedule C line
    SELECT jsonb_object_agg(schedule_c_line, line_total)
    INTO expenses_by_line
    FROM (
        SELECT schedule_c_line, SUM(amount) AS line_total
        FROM v_expenses_combined
        WHERE EXTRACT(YEAR FROM expense_date) = p_tax_year
        GROUP BY schedule_c_line
    ) sub;
    
    -- Home office
    SELECT CASE 
        WHEN tc.home_office_method = 'simplified' 
        THEN LEAST(tc.home_office_sqft, 300) * 5
        WHEN tc.home_office_method = 'actual' AND tc.home_total_sqft > 0
        THEN 0  -- would need actual expenses, computed separately
        ELSE 0
    END INTO home_office_deduction
    FROM tax_config tc WHERE tc.tax_year = p_tax_year;
    
    result = jsonb_build_object(
        'tax_year', p_tax_year,
        'part_i', jsonb_build_object(
            'line_1_gross_receipts', total_revenue,
            'line_2_returns', 0,
            'line_7_gross_income', total_revenue
        ),
        'part_ii', expenses_by_line,
        'line_28_total_expenses', (SELECT SUM(value::numeric) FROM jsonb_each_text(expenses_by_line)),
        'line_30_home_office', COALESCE(home_office_deduction, 0),
        'line_31_net_profit', total_revenue - COALESCE((SELECT SUM(value::numeric) FROM jsonb_each_text(expenses_by_line)), 0) - COALESCE(home_office_deduction, 0)
    );
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Self-Employment Tax Calculation

```
Net profit (Schedule C Line 31)
× 0.9235 (92.35%) = SE tax base
× 0.153 (15.3%) = Total SE tax
  ├── 12.4% Social Security (on first $168,600 for 2026)
  └── 2.9% Medicare (no cap)
÷ 2 = Deductible half (Form 1040 Schedule 1 Line 15)

Additional Medicare Tax: 0.9% on SE income > $200K (single)
```

---

## Export Formats

### CSV Export
- `schedule_c_summary_{year}.csv` — Line items with amounts
- `revenue_detail_{year}.csv` — All revenue entries
- `expense_detail_{year}.csv` — All expense entries
- `quarterly_pl_{year}.csv` — Q1-Q4 breakdown

### PDF Export
- Schedule C preview formatted like the actual IRS form
- Generated client-side using a JS PDF library (jsPDF or similar)
- Includes: business info header, all line items, totals, SE tax estimate

### Year-End Archive (ZIP)
- All CSVs above
- PDF summary
- All receipts (downloaded from Supabase storage)
- `README.txt` with archive metadata

---

## Data Completeness Checks

| Check | Severity | Description |
|-------|----------|-------------|
| No revenue for a month | ⚠️ Warning | "January has no revenue entries — intentional?" |
| No expenses for a quarter | ⚠️ Warning | "Q2 has no manual expenses entered" |
| Expenses without receipts | ⚠️ Warning | "3 expenses over $75 have no receipt attached" |
| No home office configured | ℹ️ Info | "Home office deduction not configured" |
| API costs not categorized | ⚠️ Warning | "API expenses need Schedule C line assignment" |
| Missing quarterly payment | ⚠️ Warning | "Q1 estimated payment not marked as paid" |
| Revenue > $400 & no SE tax | ❌ Error | "Net profit > $400 — Schedule SE required" |
| Year not archived | ℹ️ Info | "2025 tax year hasn't been archived yet" |

---

## Quarterly Due Dates (Fixed)

| Quarter | Income Period | Due Date |
|---------|--------------|----------|
| Q1 | Jan 1 – Mar 31 | April 15 |
| Q2 | Apr 1 – May 31 | June 15 |
| Q3 | Jun 1 – Aug 31 | September 15 |
| Q4 | Sep 1 – Dec 31 | January 15 (next year) |

**Safe Harbor Rule:** To avoid underpayment penalties, pay either:
- 100% of prior year's tax liability (110% if AGI > $150K), OR
- 90% of current year's tax liability

---

## Implementation Order

1. Database migration (`tax_config` + `tax_year_snapshots`)
2. `get_schedule_c_data` RPC (core computation)
3. SE tax + quarterly estimate RPCs
4. Tax-ready page HTML + CSS
5. Schedule C display component
6. Quarterly estimates section with paid checkboxes
7. Home office deduction calculator
8. Data completeness checker
9. CSV/PDF export
10. Year-end archive (ZIP download)
11. Receipt index viewer
12. Wire to sidebar navigation

---

## Important Disclaimers

This page generates **informational summaries only** — it is NOT tax advice and does NOT file taxes. Always consult a qualified tax professional. The system:

- Does NOT transmit data to the IRS
- Does NOT generate official tax forms
- Does NOT guarantee accuracy of tax calculations
- IS a data aggregation tool to organize your numbers
- SHOULD be reviewed by an accountant before filing
