# Revenue / Profits Page

> **Status:** 📋 PLANNED  
> **Roadmap Item:** #29  
> **Route:** `pages/profits.html`  
> **CSS:** `css/profits.css`  
> **JS:** `js/pages/profits.js`

---

## Purpose

Track all revenue streams across platforms. YouTube ad revenue is automated via API; TikTok Creator Fund, affiliate commissions, sponsorships, and brand deals are manual entry. Single source of truth for LLC income reporting.

---

## Page Layout

```
┌─────────────────────────────────────────────────────┐
│  SIDEBAR (existing)                                  │
├─────────────────────────────────────────────────────┤
│  Revenue Overview                                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐│
│  │ Total    │ │ This     │ │ This     │ │ YTD     ││
│  │ Revenue  │ │ Month    │ │ Week     │ │ Revenue ││
│  │ $X,XXX   │ │ $X,XXX   │ │ $XXX     │ │ $XX,XXX ││
│  └──────────┘ └──────────┘ └──────────┘ └─────────┘│
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │  Revenue Over Time (line/bar chart)              ││
│  │  [Daily] [Weekly] [Monthly]  Date range picker   ││
│  │  ▁▂▃▅▇█▇▅▃▂▁▂▃▅▇                               ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
│  ┌──────────────────────┐ ┌────────────────────────┐│
│  │ By Platform           │ │ By Revenue Type        ││
│  │ 🎬 YouTube: $X,XXX   │ │ 💰 Ad Revenue: $X,XXX ││
│  │ 🎵 TikTok:  $XXX     │ │ 🤝 Affiliates: $XXX   ││
│  │ 📸 Instagram: $0     │ │ 📦 Sponsorships: $XXX  ││
│  │ 📘 Facebook: $0      │ │ 🎁 Other: $XXX         ││
│  └──────────────────────┘ └────────────────────────┘│
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │ By Brand                                         ││
│  │ Stories That Stalk     $X,XXX  ████████░░  62%   ││
│  │ Decide This Daily      $XXX    ███░░░░░░░  22%   ││
│  │ [other brands...]                                ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │ Revenue Per Video (RPV) / RPM                    ││
│  │ YouTube:  RPM $X.XX  |  Avg RPV $X.XX           ││
│  │ TikTok:   RPM $X.XX  |  Avg RPV $X.XX           ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │ + Add Revenue Entry                    [Button]  ││
│  ├─────────────────────────────────────────────────┤│
│  │ Revenue Entries                                   ││
│  │ [Auto] [Manual] [All]    Filter: platform, type  ││
│  │                                                   ││
│  │ Date       Platform  Type         Amount  Source  ││
│  │ ─────────────────────────────────────────────────││
│  │ Mar 13     YouTube   Ad Revenue   $12.50  Auto   ││
│  │ Mar 10     TikTok    Creator Fund $8.00   Manual ││
│  │ Mar 5      -         Affiliate    $25.00  Manual ││
│  │ Feb 28     YouTube   Ad Revenue   $45.30  Auto   ││
│  │ ...                                               ││
│  └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

---

## Data Sources

### Automated (API)
| Platform | API | Data Available | Scope Needed |
|----------|-----|----------------|-------------|
| YouTube | YouTube Analytics API v2 | `estimatedRevenue`, `estimatedAdRevenue`, `estimatedRedPartnerRevenue`, `grossRevenue` | `yt-analytics-monetary.readonly` |
| TikTok | N/A | None — no public revenue API | N/A |
| Instagram | N/A | No direct revenue for Reels | N/A |
| Facebook | N/A | No direct revenue for Reels | N/A |

### Manual Entry
| Revenue Type | Description | Typical Source |
|-------------|-------------|----------------|
| `creator_fund` | TikTok Creator Fund / Creativity Program | TikTok app dashboard |
| `affiliate` | Affiliate link commissions | Affiliate network dashboards |
| `sponsorship` | Paid brand deals / sponsored content | Invoice / contract |
| `merchandise` | Merch sales (if any) | Store dashboard |
| `other` | Miscellaneous income | Varies |

---

## Database Schema

### `post_revenue` (automated, per-post)
```sql
CREATE TABLE post_revenue (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    post_id UUID REFERENCES posts(id),
    brand_id UUID NOT NULL REFERENCES brands(id),
    platform TEXT NOT NULL,
    revenue_type TEXT NOT NULL DEFAULT 'ad_revenue',
    amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    period_start DATE,
    period_end DATE,
    source TEXT NOT NULL DEFAULT 'api',  -- 'api' or 'manual'
    meta JSONB DEFAULT '{}',
    collected_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prevent duplicate API entries for same post + period
CREATE UNIQUE INDEX idx_post_revenue_unique 
    ON post_revenue(post_id, platform, revenue_type, period_start, period_end) 
    WHERE source = 'api';
```

### `manual_revenue_entries` (manual, brand-level)
```sql
CREATE TABLE manual_revenue_entries (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    brand_id UUID REFERENCES brands(id),
    platform TEXT,  -- nullable for non-platform revenue
    revenue_type TEXT NOT NULL,
    amount NUMERIC(10,2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    revenue_date DATE NOT NULL,
    description TEXT,
    receipt_url TEXT,
    post_id UUID REFERENCES posts(id),  -- optional link to specific post
    is_recurring BOOLEAN DEFAULT false,
    recurring_period TEXT,  -- 'monthly', 'weekly'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Views
```sql
-- Combined revenue view (automated + manual)
CREATE VIEW v_revenue_all AS
SELECT 
    id, brand_id, platform, revenue_type, amount, currency,
    COALESCE(period_start, collected_at::date) AS revenue_date,
    source, post_id, null AS description, null AS receipt_url
FROM post_revenue
UNION ALL
SELECT 
    id, brand_id, platform, revenue_type, amount, currency,
    revenue_date, 'manual' AS source, post_id, description, receipt_url
FROM manual_revenue_entries;

-- Summary by platform
CREATE VIEW v_revenue_by_platform AS
SELECT brand_id, platform, 
    SUM(amount) AS total_revenue,
    COUNT(*) AS entry_count,
    MIN(revenue_date) AS first_revenue,
    MAX(revenue_date) AS last_revenue
FROM v_revenue_all
GROUP BY brand_id, platform;
```

---

## RPCs

| RPC | Purpose | Params |
|-----|---------|--------|
| `record_post_revenue` | Upsert automated revenue (idempotent) | post_id, platform, revenue_type, amount, period_start, period_end |
| `add_manual_revenue` | Insert manual revenue entry | brand_id, platform, revenue_type, amount, date, description, receipt_url |
| `update_manual_revenue` | Edit manual entry | id, fields to update |
| `delete_manual_revenue` | Remove manual entry | id |
| `get_revenue_summary` | Aggregated stats | brand_id, date_from, date_to, group_by |
| `get_revenue_entries` | Paginated list | brand_id, filters, pagination |
| `get_brand_revenue` | Per-brand totals | brand_id, period |

---

## Components

### Revenue Entry Modal
- Platform dropdown (YouTube, TikTok, Instagram, Other)
- Revenue type dropdown (Ad Revenue, Creator Fund, Affiliate, Sponsorship, Merchandise, Other)
- Amount input (currency formatted)
- Date picker
- Description text area
- Receipt upload (drag & drop → Supabase storage)
- Link to post/job (optional search)
- Recurring toggle + period selector

### Revenue Charts
- Line chart: revenue over time (Chart.js or built-in canvas)
- Donut chart: by revenue type
- Horizontal bars: by platform
- Stacked bars: by brand

---

## YouTube Monetary Integration

### OAuth Scope Addition
```javascript
// js/services/youtube.js — add to SCOPES
'https://www.googleapis.com/auth/yt-analytics-monetary.readonly'
```

### Analytics API Query
```
GET https://youtubeanalytics.googleapis.com/v2/reports
?ids=channel==MINE
&startDate=2026-01-01
&endDate=2026-03-13
&metrics=estimatedRevenue,estimatedAdRevenue,views
&dimensions=video
&filters=video==VIDEO_ID
```

### metrics-collector Extension
- After fetching standard metrics, also fetch monetary data
- Only for YouTube posts with `platform_post_id` set
- Store in `post_revenue` table
- Non-fatal: if monetary scope not authorized, skip silently

---

## Implementation Order

1. Database migration (tables + views + RPCs)
2. YouTube monetary scope + metrics-collector extension
3. Manual revenue entry modal + service
4. Revenue page HTML + CSS
5. Revenue dashboard JS (charts, cards, table)
6. Wire to sidebar navigation
