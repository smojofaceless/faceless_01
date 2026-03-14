# Expenses Page

> **Status:** 📋 PLANNED  
> **Roadmap Item:** #30  
> **Route:** `pages/expenses.html`  
> **CSS:** `css/expenses.css`  
> **JS:** `js/pages/expenses.js`

---

## Purpose

Track all business expenses — both automated (API usage costs already in `api_usage` table) and manual (hosting, subscriptions, equipment, etc.). Categories align with IRS Schedule C expense lines for seamless tax filing.

---

## Page Layout

```
┌─────────────────────────────────────────────────────┐
│  SIDEBAR (existing)                                  │
├─────────────────────────────────────────────────────┤
│  Expense Overview                                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐│
│  │ Total    │ │ This     │ │ API Costs│ │ YTD     ││
│  │ Expenses │ │ Month    │ │ (Auto)   │ │ Total   ││
│  │ $X,XXX   │ │ $XXX     │ │ $XXX     │ │ $XX,XXX ││
│  └──────────┘ └──────────┘ └──────────┘ └─────────┘│
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │  Monthly Expenses (bar chart)                    ││
│  │  [By Category] [By Type (Auto/Manual)]           ││
│  │  ▁▂▃▅▇█▇▅▃▂▁▂                                   ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
│  ┌──────────────────────┐ ┌────────────────────────┐│
│  │ By Category (Pie)     │ │ API Cost Breakdown     ││
│  │ 🖥️ Software: 45%     │ │ OpenAI Text:  $XX.XX   ││
│  │ 🎙️ Voice API: 20%    │ │ OpenAI Image: $XX.XX   ││
│  │ 🖼️ Image API: 15%    │ │ ElevenLabs:   $XX.XX   ││
│  │ 🌐 Hosting: 10%      │ │ FFmpeg:       $XX.XX   ││
│  │ 📦 Other: 10%        │ │ Creatomate:   $XX.XX   ││
│  └──────────────────────┘ └────────────────────────┘│
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │ Recurring Expenses                                ││
│  │ ⟳ Supabase Pro     $25/mo   Next: Apr 1         ││
│  │ ⟳ OpenAI API       ~$50/mo  Metered             ││
│  │ ⟳ ElevenLabs       $22/mo   Next: Apr 5         ││
│  │ ⟳ Domain (annual)  $12/yr   Next: Jan 2027      ││
│  │ ⟳ Vercel Hosting   $20/mo   Next: Apr 1         ││
│  │                                    [+ Add]       ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │ + Add Expense                          [Button]  ││
│  ├─────────────────────────────────────────────────┤│
│  │ All Expenses                                      ││
│  │ [Auto] [Manual] [All]   Category ▼  Month ▼     ││
│  │                                                   ││
│  │ Date       Category        Vendor     Amount Src ││
│  │ ─────────────────────────────────────────────────││
│  │ Mar 13     Software/API    OpenAI     $3.20  Auto││
│  │ Mar 13     Software/API    OpenAI     $1.80  Auto││
│  │ Mar 12     Software/API    ElevenLabs $0.45  Auto││
│  │ Mar 1      Hosting         Supabase   $25.00 Man ││
│  │ Mar 1      Software        Vercel     $20.00 Man ││
│  │ Feb 15     Equipment       Microphone $89.99 Man ││
│  │ ...                                               ││
│  │                              [Load More]         ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │ 📎 Receipts                                      ││
│  │ 3 receipts this month | 12 YTD                   ││
│  │ [View All Receipts]                              ││
│  └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

---

## Expense Categories (Schedule C Aligned)

| Category | Schedule C Line | Examples |
|----------|----------------|----------|
| `advertising` | Line 8 | Social media ads, paid promotion |
| `commissions_fees` | Line 11 | Platform fees, payment processing fees |
| `contract_labor` | Line 11 | Freelancer payments (voice actors, editors) |
| `insurance` | Line 15 | Business insurance (if any) |
| `internet_phone` | Line 25 (Utilities) | Internet bill (% business use), phone plan |
| `office_supplies` | Line 22 | Desk supplies, printer ink |
| `equipment` | Line 13 (Depreciation) or Line 22 | Computer, microphone, camera, lighting |
| `software_subscriptions` | Line 27a (Other) | API services, SaaS tools, hosting |
| `hosting` | Line 27a (Other) | Supabase, Vercel, domain names, CDN |
| `music_licensing` | Line 27a (Other) | Licensed music tracks, sound effects |
| `education_training` | Line 27a (Other) | Courses, books, conferences |
| `legal_professional` | Line 17 | LLC filing, accountant, legal counsel |
| `rent_home_office` | Line 30 | Home office deduction (simplified or actual) |
| `car_truck` | Line 9 | Mileage (if applicable) |
| `other` | Line 27a | Anything else |

---

## Data Sources

### Automated: `api_usage` Table (Already Exists)
The system already tracks API costs in the `api_usage` table with these services:
- `openai_text` — GPT-4o story/scene generation
- `openai_image` — gpt-image-1 image generation
- `elevenlabs` — Voice synthesis
- `ffmpeg_renderer` — Self-hosted video rendering (nominal cost)
- `creatomate` — Cloud video rendering

**Transform to expenses:** Create a view that converts `api_usage` rows into expense line items using known per-unit pricing.

### Manual Entry
Everything else: hosting bills, subscriptions, equipment purchases, etc.

---

## Database Schema

### `manual_expenses` (manual entries)
```sql
CREATE TABLE manual_expenses (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    brand_id UUID REFERENCES brands(id),  -- null = general business expense
    category TEXT NOT NULL,  -- maps to Schedule C line
    subcategory TEXT,  -- freeform subdivision
    vendor TEXT,  -- who was paid
    amount NUMERIC(10,2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    expense_date DATE NOT NULL,
    description TEXT,
    receipt_url TEXT,  -- Supabase storage path
    is_recurring BOOLEAN DEFAULT false,
    recurring_period TEXT,  -- 'monthly', 'quarterly', 'annually'
    recurring_next_date DATE,  -- next expected charge
    tax_deductible BOOLEAN DEFAULT true,
    schedule_c_line TEXT,  -- e.g. 'line_8', 'line_27a'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_manual_expenses_brand ON manual_expenses(brand_id);
CREATE INDEX idx_manual_expenses_date ON manual_expenses(expense_date);
CREATE INDEX idx_manual_expenses_category ON manual_expenses(category);
```

### `expense_categories` (reference table)
```sql
CREATE TABLE expense_categories (
    id TEXT PRIMARY KEY,  -- e.g. 'software_subscriptions'
    name TEXT NOT NULL,  -- Display name
    schedule_c_line TEXT NOT NULL,  -- e.g. 'line_27a'
    description TEXT,
    icon TEXT,  -- emoji or icon class
    is_system BOOLEAN DEFAULT true,  -- can't be deleted
    sort_order INT DEFAULT 0
);

-- Seed data
INSERT INTO expense_categories VALUES
    ('advertising', 'Advertising', 'line_8', 'Social media ads, paid promotions', '📣', true, 1),
    ('commissions_fees', 'Commissions & Fees', 'line_11', 'Platform fees, payment processing', '💳', true, 2),
    ('contract_labor', 'Contract Labor', 'line_11', 'Freelancer payments', '👤', true, 3),
    ('insurance', 'Insurance', 'line_15', 'Business insurance', '🛡️', true, 4),
    ('internet_phone', 'Internet & Phone', 'line_25', 'Internet and phone service (business %)', '🌐', true, 5),
    ('office_supplies', 'Office Supplies', 'line_22', 'Desk supplies, stationery', '📎', true, 6),
    ('equipment', 'Equipment', 'line_13', 'Computer, microphone, camera, lighting', '🖥️', true, 7),
    ('software_subscriptions', 'Software & Subscriptions', 'line_27a', 'API services, SaaS tools', '💻', true, 8),
    ('hosting', 'Hosting & Infrastructure', 'line_27a', 'Supabase, Vercel, domains, CDN', '☁️', true, 9),
    ('music_licensing', 'Music & Audio Licensing', 'line_27a', 'Licensed music, sound effects', '🎵', true, 10),
    ('education_training', 'Education & Training', 'line_27a', 'Courses, books, conferences', '📚', true, 11),
    ('legal_professional', 'Legal & Professional', 'line_17', 'LLC filing, accountant, legal', '⚖️', true, 12),
    ('rent_home_office', 'Home Office', 'line_30', 'Home office deduction', '🏠', true, 13),
    ('car_truck', 'Car & Truck', 'line_9', 'Business mileage', '🚗', true, 14),
    ('other', 'Other Expenses', 'line_27a', 'Miscellaneous', '📦', true, 15);
```

### Views
```sql
-- Transform api_usage into expense format
CREATE VIEW v_expense_from_api_usage AS
SELECT
    au.id,
    au.brand_id,
    'software_subscriptions' AS category,
    CASE au.service
        WHEN 'openai_text' THEN 'OpenAI (Text)'
        WHEN 'openai_image' THEN 'OpenAI (Image)'
        WHEN 'elevenlabs' THEN 'ElevenLabs'
        WHEN 'ffmpeg_renderer' THEN 'FFmpeg Renderer'
        WHEN 'creatomate' THEN 'Creatomate'
        ELSE au.service
    END AS vendor,
    au.estimated_cost AS amount,
    'USD' AS currency,
    au.created_at::date AS expense_date,
    CONCAT(au.service, ': ', au.operation, ' (', au.model, ')') AS description,
    'api' AS source,
    'line_27a' AS schedule_c_line
FROM api_usage au
WHERE au.estimated_cost > 0;

-- Combined view: automated API + manual
CREATE VIEW v_expenses_combined AS
SELECT id, brand_id, category, vendor, amount, currency, expense_date,
       description, 'api' AS source, 'line_27a' AS schedule_c_line,
       null AS receipt_url
FROM v_expense_from_api_usage
UNION ALL
SELECT id, brand_id, category, vendor, amount, currency, expense_date,
       description, 'manual' AS source, schedule_c_line, receipt_url
FROM manual_expenses;

-- Aggregated by Schedule C category
CREATE VIEW v_expenses_by_category AS
SELECT 
    category,
    schedule_c_line,
    SUM(amount) AS total_amount,
    COUNT(*) AS entry_count,
    MIN(expense_date) AS first_expense,
    MAX(expense_date) AS last_expense
FROM v_expenses_combined
GROUP BY category, schedule_c_line;
```

---

## RPCs

| RPC | Purpose | Params |
|-----|---------|--------|
| `add_manual_expense` | Insert new expense | category, vendor, amount, date, description, receipt_url, recurring, etc. |
| `update_manual_expense` | Edit existing expense | id, fields to update |
| `delete_manual_expense` | Remove expense | id |
| `get_expenses` | Paginated list with filters | brand_id, category, date_from, date_to, source, pagination |
| `get_expense_summary` | Aggregated stats | brand_id, date_from, date_to, group_by (category/month/vendor) |
| `get_recurring_expenses` | Active recurring items | brand_id |
| `get_api_cost_breakdown` | API costs by service | brand_id, date_from, date_to |

---

## Components

### Expense Entry Modal
```
┌─────────────────────────────────────────┐
│  Add Expense                        ✕   │
├─────────────────────────────────────────┤
│  Category:    [Software & Subs     ▼]   │
│  Vendor:      [Supabase            ]    │
│  Amount:      [$] [25.00           ]    │
│  Date:        [2026-03-01          ]    │
│  Description: [Monthly Pro plan    ]    │
│                                          │
│  Brand:       [All / General       ▼]   │
│                                          │
│  📎 Receipt:  [Drop file or browse]     │
│                                          │
│  ☐ Recurring  Period: [Monthly ▼]       │
│  ☐ Tax Deductible (default: yes)        │
│                                          │
│           [Cancel]  [Save Expense]       │
└─────────────────────────────────────────┘
```

### API Cost Detail Panel
- Pulls from existing `mv_daily_usage` materialized view
- Shows cost per service per day (7-day and 30-day views)
- Cost per job average
- Trend arrows (up/down vs previous period)

### Receipt Manager
- Grid view of uploaded receipts
- Filter by month/category
- Click to preview (image lightbox or PDF viewer)
- Drag & drop upload

### Recurring Expense Tracker
- List of all recurring expenses
- Next charge date
- Monthly/annual totals
- Toggle active/inactive
- "Generate from template" — auto-create this month's entries from recurring items

---

## Storage

### Receipt Uploads
```
expenses/{year}/{month}/{expense_id}_{filename}
```
Example: `expenses/2026/03/abc123_supabase_invoice.pdf`

- Upload via Supabase Storage JS client
- Max file size: 10MB
- Accepted types: .pdf, .png, .jpg, .jpeg, .webp

---

## API Cost Calculation

### Known Pricing (approximate, for estimation)
| Service | Unit | Cost |
|---------|------|------|
| `openai_text` (gpt-4o) | 1K input tokens | $0.0025 |
| `openai_text` (gpt-4o) | 1K output tokens | $0.01 |
| `openai_image` (gpt-image-1) | per image (1024x1536) | ~$0.04-0.08 |
| `elevenlabs` (turbo v2.5) | per character | ~$0.00003 |
| `ffmpeg_renderer` | per job | ~$0 (self-hosted) |
| `creatomate` | per render | ~$0.50-1.00 |

The `api_usage` table already has an `estimated_cost` column — the view can use it directly.

---

## Implementation Order

1. Database migration (tables + seed categories + views + RPCs)
2. API cost view from existing `api_usage` / `mv_daily_usage`
3. Manual expense entry modal + service
4. Recurring expense logic
5. Expenses page HTML + CSS
6. Expenses dashboard JS (charts, cards, table, receipt manager)
7. Wire to sidebar navigation
