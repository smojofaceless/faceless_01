// =====================================================
// DASHBOARD - Cost Overview
// =====================================================

let dbCostDays = 7; // default range

async function dbLoadCosts(days) {
    if (days !== undefined) dbCostDays = days;
    const container = document.getElementById('cost-overview');
    if (!container) return;

    try {
        const params = { p_date_to: new Date().toISOString() };
        if (dbCostDays > 0) {
            const from = new Date();
            from.setDate(from.getDate() - dbCostDays);
            params.p_date_from = from.toISOString();
        } else {
            // "All" — go back 5 years
            params.p_date_from = '2020-01-01T00:00:00.000Z';
        }
        if (dbActiveBrandId) params.p_brand_id = dbActiveBrandId;

        const { data: raw, error } = await dbSupabase.rpc('get_usage_summary', params);
        if (error) throw error;

        // RPC returns rows per (service, date) — aggregate by date
        const byDate = {};
        (raw || []).forEach(r => {
            const d = r.usage_date;
            if (!byDate[d]) byDate[d] = { usage_date: d, total_cost_cents: 0, total_tokens: 0, call_count: 0 };
            byDate[d].total_cost_cents += Number(r.total_cost_cents || 0);
            byDate[d].total_tokens += Number(r.total_tokens || 0);
            byDate[d].call_count += Number(r.call_count || 0);
        });
        const usage = Object.values(byDate).sort((a, b) => b.usage_date.localeCompare(a.usage_date));

        if (usage.length === 0) {
            container.innerHTML = '<div class="db-empty"><span>No cost data yet</span><span class="db-empty__sub">Costs appear after jobs run</span></div>';
            return;
        }

        const rangeLabel = dbCostDays > 0 ? `${dbCostDays}-Day` : 'All Time';
        const todayStr = new Date().toISOString().slice(0, 10);
        const todayRow = usage.find(u => u.usage_date === todayStr);
        const todayCost = (todayRow ? todayRow.total_cost_cents : 0) / 100;
        const totalCents = usage.reduce((s, u) => s + (u.total_cost_cents || 0), 0);
        const total = totalCents / 100;
        const totalCalls = usage.reduce((s, u) => s + (u.call_count || 0), 0);
        const avgPerCall = totalCalls > 0 ? (total / totalCalls) : 0;

        // span info
        const oldest = usage[usage.length - 1].usage_date;
        const newest = usage[0].usage_date;
        const spanDays = Math.round((new Date(newest) - new Date(oldest)) / 86400000) + 1;

        // For the chart, show at most 14 bars — bucket older data
        const maxBars = 14;
        let chartData = usage.slice().reverse(); // oldest first
        if (chartData.length > maxBars) {
            const bucketSize = Math.ceil(chartData.length / maxBars);
            const buckets = [];
            for (let i = 0; i < chartData.length; i += bucketSize) {
                const slice = chartData.slice(i, i + bucketSize);
                const cents = slice.reduce((s, u) => s + (u.total_cost_cents || 0), 0);
                const label = slice.length === 1
                    ? new Date(slice[0].usage_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    : new Date(slice[0].usage_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      + '–' + new Date(slice[slice.length - 1].usage_date + 'T12:00:00').toLocaleDateString('en-US', { day: 'numeric' });
                buckets.push({ total_cost_cents: cents, label });
            }
            chartData = buckets;
        } else {
            chartData = chartData.map(u => ({
                total_cost_cents: u.total_cost_cents || 0,
                label: new Date(u.usage_date + 'T12:00:00').toLocaleDateString('en-US',
                    dbCostDays <= 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' })
            }));
        }

        const maxCents = Math.max(...chartData.map(c => c.total_cost_cents || 1));

        container.innerHTML = `
            <div class="db-cost-stats">
                <div class="db-cost-stat">
                    <span class="db-cost-stat__val">$${todayCost.toFixed(2)}</span>
                    <span class="db-cost-stat__label">Today</span>
                </div>
                <div class="db-cost-stat">
                    <span class="db-cost-stat__val">$${total.toFixed(2)}</span>
                    <span class="db-cost-stat__label">${rangeLabel}</span>
                </div>
                <div class="db-cost-stat">
                    <span class="db-cost-stat__val">$${avgPerCall.toFixed(3)}</span>
                    <span class="db-cost-stat__label">Avg/Call</span>
                </div>
                <div class="db-cost-stat">
                    <span class="db-cost-stat__val">${dbFmt(totalCalls)}</span>
                    <span class="db-cost-stat__label">Calls</span>
                </div>
            </div>
            <div class="db-cost-span">Data spans ${spanDays} day${spanDays !== 1 ? 's' : ''} (${oldest} – ${newest})</div>
            <div class="db-cost-chart">
                ${chartData.map(c => {
                    const pct = maxCents > 0 ? Math.round((c.total_cost_cents / maxCents) * 100) : 0;
                    return `
                    <div class="db-cost-bar" title="$${(c.total_cost_cents / 100).toFixed(2)}">
                        <div class="db-cost-bar__fill" style="height:${Math.max(pct, 4)}%"></div>
                        <span class="db-cost-bar__label">${c.label}</span>
                    </div>`;
                }).join('')}
            </div>
        `;
    } catch (e) {
        console.error('dbLoadCosts:', e);
        container.innerHTML = '<div class="db-empty"><span>Failed to load</span></div>';
    }
}

// Range pill click handler
document.addEventListener('DOMContentLoaded', () => {
    const wrap = document.getElementById('cost-range');
    if (!wrap) return;
    wrap.addEventListener('click', e => {
        const pill = e.target.closest('.db-range-pill');
        if (!pill) return;
        wrap.querySelectorAll('.db-range-pill').forEach(p => p.classList.remove('db-range-pill--active'));
        pill.classList.add('db-range-pill--active');
        dbLoadCosts(parseInt(pill.dataset.days, 10));
    });
});
