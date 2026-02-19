// =====================================================
// BRAND ROADMAP PAGE CONTROLLER v1.0
//
// Renders phase timeline, brand cards, detail panel,
// learning focus, and dependencies from static config
// + live Supabase data (brands, posts, metrics, etc.)
// =====================================================

(function () {
  'use strict';

  // ─── Static Brand Catalog ───────────────────────────
  // Phase assignments, presets, platforms per the BRAND_ROADMAP.md spec.
  // This is the single source of truth for the roadmap page until
  // brand_roadmap_config table is created.

  const BRAND_CATALOG = [
    {
      key: 'stories_that_stalk',
      name: 'Stories That Stalk',
      icon: '📜',
      concept: 'AI-generated horror short stories with narration, images, music, and effects.',
      phase: 1,
      status: 'active',
      costTier: 3,
      engagement: ['retention', 'saves'],
      platforms: { primary: 'youtube_shorts', active: ['youtube_shorts', 'instagram_reels', 'facebook_reels', 'threads'] },
      presets: {
        active: ['urban_legend', 'one_too_many', 'reddit_trending_horror', 'dark_origins'],
        planned: ['security_cam', 'creepypasta_classic']
      }
    },
    {
      key: 'confessions_choices',
      name: 'Confessions & Choices',
      icon: '🎮',
      concept: 'Gameplay-background confessions and moral dilemma narration.',
      phase: 1,
      status: 'planned',
      costTier: 1,
      engagement: ['replies', 'retention'],
      platforms: { primary: 'tiktok', active: ['tiktok', 'youtube_shorts', 'instagram_reels'] },
      presets: {
        active: [],
        planned: ['confession_storytime', 'moral_dilemma', 'relationship_confession', 'workplace_chaos']
      }
    },
    {
      key: 'would_you_rather',
      name: 'Would You Rather',
      icon: '⚡',
      concept: 'Rapid-fire dilemmas designed for maximum reply engagement.',
      phase: 1,
      status: 'planned',
      costTier: 1,
      engagement: ['replies'],
      platforms: { primary: 'tiktok', active: ['tiktok', 'instagram_reels', 'threads'] },
      presets: {
        active: [],
        planned: ['wyr_horror', 'wyr_impossible', 'wyr_escalating', 'wyr_viral_debate']
      }
    },
    {
      key: 'lego_history',
      name: 'Lego History',
      icon: '🧱',
      concept: 'Historical events narrated over AI-generated Lego-style scene images.',
      phase: 2,
      status: 'planned',
      costTier: 2,
      engagement: ['retention', 'shares'],
      platforms: { primary: 'youtube_shorts', active: ['youtube_shorts', 'tiktok', 'instagram_reels'] },
      presets: {
        active: [],
        planned: ['lego_war', 'lego_disaster', 'lego_ancient', 'lego_modern']
      }
    },
    {
      key: 'lego_bible_verses',
      name: 'Lego Bible Verses',
      icon: '✝️',
      concept: 'Bible verses visualized as Lego dioramas. Short, contemplative, shareable.',
      phase: 2,
      status: 'planned',
      costTier: 2,
      engagement: ['saves', 'shares'],
      platforms: { primary: 'instagram_reels', active: ['instagram_reels', 'facebook_reels', 'youtube_shorts'] },
      presets: {
        active: [],
        planned: ['lego_verse_daily', 'lego_verse_thematic', 'lego_verse_storytelling']
      }
    },
    {
      key: 'space_facts',
      name: 'Space Facts',
      icon: '🚀',
      concept: 'Real space facts delivered with absurdist, deadpan humor.',
      phase: 2,
      status: 'planned',
      costTier: 2,
      engagement: ['shares', 'replies'],
      platforms: { primary: 'tiktok', active: ['tiktok', 'youtube_shorts', 'threads'] },
      presets: {
        active: [],
        planned: ['space_unhinged', 'space_comparison', 'space_what_if', 'space_tier_list']
      }
    },
    {
      key: 'forgotten_lost',
      name: 'Forgotten / Lost Things',
      icon: '🗝️',
      concept: 'Forgotten history, lost cities, dead technology. Nostalgia + mystery.',
      phase: 2,
      status: 'planned',
      costTier: 2,
      engagement: ['saves', 'replies'],
      platforms: { primary: 'youtube_shorts', active: ['youtube_shorts', 'instagram_reels', 'facebook_reels'] },
      presets: {
        active: [],
        planned: ['forgotten_places', 'lost_technology', 'discontinued_products', 'erased_history']
      }
    },
    {
      key: 'lego_bible_stories',
      name: 'Lego Bible Stories',
      icon: '📖',
      concept: 'Full Bible stories retold with Lego visuals and narration.',
      phase: 3,
      status: 'planned',
      costTier: 3,
      engagement: ['retention', 'saves'],
      platforms: { primary: 'youtube_shorts', active: ['youtube_shorts', 'facebook_reels', 'instagram_reels'] },
      presets: {
        active: [],
        planned: ['lego_bible_epic', 'lego_bible_parable', 'lego_bible_hero']
      }
    },
    {
      key: 'restoration_timelapse',
      name: 'Restoration Time Lapse',
      icon: '🔧',
      concept: 'AI-generated restoration sequences. Rusty to restored. Satisfying visual content.',
      phase: 3,
      status: 'planned',
      costTier: 4,
      engagement: ['retention', 'saves'],
      platforms: { primary: 'instagram_reels', active: ['instagram_reels', 'tiktok', 'youtube_shorts'] },
      presets: {
        active: [],
        planned: ['tool_restoration', 'furniture_restoration', 'vehicle_restoration', 'oddly_satisfying']
      }
    }
  ];

  // ─── Phase Metadata ─────────────────────────────────
  const PHASES = {
    1: {
      name: 'Foundation',
      weeks: 'Weeks 1–4',
      goals: [
        'Validate full pipeline end-to-end across multiple brands',
        'Prove scheduling, posting, metrics collection work at scale',
        'Collect diverse engagement signals (retention + replies + shares)'
      ],
      learning: [
        { label: 'Multi-brand scheduling', status: 'good' },
        { label: 'Reply vs retention signals', status: 'pending' },
        { label: 'Cross-brand cost tracking', status: 'good' },
        { label: 'Strategy baseline data', status: 'pending' }
      ],
      exitCriteria: [
        { label: 'All brands posting 7+ consecutive days', check: 'phase1_posting' },
        { label: 'Metrics collection running for all brands', check: 'phase1_metrics' },
        { label: 'Winning patterns populated for ≥2 brands', check: 'phase1_patterns' },
        { label: 'Time slot scores ≥20 samples per brand/platform', check: 'phase1_timeslots' },
        { label: 'No manual intervention for 48+ hours', check: 'phase1_autonomous' }
      ],
      dependencies: []
    },
    2: {
      name: 'Expansion',
      weeks: 'Weeks 5–10',
      goals: [
        'Introduce image-generation brands',
        'Validate AI image pipelines for non-horror genres',
        'Scale to 6+ brands without scheduling conflicts'
      ],
      learning: [
        { label: 'Image cost tracking', status: 'pending' },
        { label: 'Cross-genre presets', status: 'empty' },
        { label: 'Humor calibration', status: 'empty' },
        { label: '6-brand scheduling', status: 'empty' }
      ],
      exitCriteria: [
        { label: 'Image pipeline stable (≥50 images, ≤2% failure)', check: 'phase2_images' },
        { label: 'Per-brand cost within budgets 14+ days', check: 'phase2_cost' },
        { label: 'Strategy divergence between brand types', check: 'phase2_strategy' },
        { label: 'No cross-brand data leakage', check: 'phase2_isolation' },
        { label: 'Concurrent scheduling for 6 brands', check: 'phase2_scheduling' }
      ],
      dependencies: [
        { label: 'Cost tracking ≤5% variance (14 days)', status: 'pending' },
        { label: 'Budget headroom ≥40%', status: 'pending' },
        { label: 'Image pipeline ≤2% failure rate', status: 'empty' },
        { label: 'Phase 1 exit criteria all met', status: 'empty' }
      ]
    },
    3: {
      name: 'Scale',
      weeks: 'Weeks 11–16',
      goals: [
        'Launch remaining high-cost and experimental brands',
        'Prove 9-brand autonomous operation',
        'Begin cross-brand portfolio optimization'
      ],
      learning: [
        { label: 'Multi-image cost optimization', status: 'empty' },
        { label: 'Image consistency techniques', status: 'empty' },
        { label: 'Portfolio scheduling (9 brands)', status: 'empty' },
        { label: 'Cross-brand audience overlap', status: 'empty' }
      ],
      exitCriteria: [
        { label: 'All 9 brands posting autonomously', check: 'phase3_all_live' },
        { label: 'Restoration ≥70% image continuity', check: 'phase3_restoration' },
        { label: 'Total daily cost under global ceiling', check: 'phase3_cost' },
        { label: 'Learning loop shows improvement (A/B data)', check: 'phase3_learning' },
        { label: 'Strategy system ≥100 data points per platform', check: 'phase3_strategy' }
      ],
      dependencies: [
        { label: 'Phase 2 exit criteria all met', status: 'empty' },
        { label: 'Lego image consistency proven in Phase 2', status: 'empty' },
        { label: 'Multi-image prompt engineering documented', status: 'empty' }
      ]
    }
  };

  const COST_TIERS = [
    { tier: 1, label: 'Text-only', range: '$0.01–0.03/post', cssClass: 't1' },
    { tier: 2, label: 'Text + Images', range: '$0.10–0.30/post', cssClass: 't2' },
    { tier: 3, label: 'Full Pipeline', range: '$0.30–0.80/post', cssClass: 't3' },
    { tier: 4, label: 'Multi-Image Seq', range: '$0.50–1.50/post', cssClass: 't4' }
  ];

  const PLATFORM_LABELS = {
    youtube_shorts: 'YT',
    instagram_reels: 'IG',
    tiktok: 'TK',
    facebook_reels: 'FB',
    threads: 'TH',
    x: 'X'
  };

  const ENGAGEMENT_LABELS = {
    replies: { icon: '💬', label: 'Replies' },
    retention: { icon: '⏱', label: 'Retention' },
    saves: { icon: '💾', label: 'Saves' },
    shares: { icon: '🔄', label: 'Shares' }
  };

  // ─── State ──────────────────────────────────────────
  let liveData = {
    brands: [],
    postCounts: {},
    presetCounts: {},
    winningPatterns: {},
    timeSlotCounts: {},
    strategies: []
  };

  let selectedBrand = null;
  let filters = { platform: 'all', engagement: 'all', status: 'all' };

  // ─── Init ───────────────────────────────────────────
  async function init() {
    renderPage();
    await loadLiveData();
    renderPage();
    bindEvents();
  }

  // ─── Data Loading ───────────────────────────────────
  async function loadLiveData() {
    const sb = window.supabaseClient;
    if (!sb) {
      console.warn('[Roadmap] No Supabase client — using static data only');
      return;
    }

    try {
      // Parallel queries
      const [brandsRes, postsRes, presetsRes, patternsRes, timeslotsRes, strategiesRes] = await Promise.all([
        sb.from('brands').select('id, name, slug, is_active'),
        sb.from('posts').select('brand_id, id', { count: 'exact', head: false }),
        sb.from('brand_templates').select('brand_id, template_type, is_default, weight'),
        sb.from('winning_metadata_patterns').select('brand_id, platform, updated_at'),
        sb.from('time_slot_scores').select('brand_id, platform'),
        sb.rpc('get_top_strategies', { p_brand_id: '00000000-0000-0000-0000-000000000000', p_platform: 'youtube_shorts', p_limit: 1 }).then(() => null).catch(() => null)
      ]);

      if (brandsRes.data) liveData.brands = brandsRes.data;

      // Count posts per brand
      if (postsRes.data) {
        const counts = {};
        postsRes.data.forEach(p => {
          counts[p.brand_id] = (counts[p.brand_id] || 0) + 1;
        });
        liveData.postCounts = counts;
      }

      // Count presets per brand
      if (presetsRes.data) {
        const pc = {};
        presetsRes.data.forEach(t => {
          if (!pc[t.brand_id]) pc[t.brand_id] = [];
          pc[t.brand_id].push(t);
        });
        liveData.presetCounts = pc;
      }

      // Winning patterns per brand
      if (patternsRes.data) {
        const wp = {};
        patternsRes.data.forEach(p => {
          if (!wp[p.brand_id]) wp[p.brand_id] = [];
          wp[p.brand_id].push(p);
        });
        liveData.winningPatterns = wp;
      }

      // Time slot counts per brand
      if (timeslotsRes.data) {
        const ts = {};
        timeslotsRes.data.forEach(s => {
          ts[s.brand_id] = (ts[s.brand_id] || 0) + 1;
        });
        liveData.timeSlotCounts = ts;
      }

      console.log('[Roadmap] Live data loaded:', {
        brands: liveData.brands.length,
        postCounts: Object.keys(liveData.postCounts).length,
        presetCounts: Object.keys(liveData.presetCounts).length
      });
    } catch (err) {
      console.error('[Roadmap] Failed to load live data:', err);
    }
  }

  // ─── Match catalog brands to DB brands ──────────────
  function matchBrandToDb(catalogBrand) {
    if (!liveData.brands.length) return null;
    // Match by name similarity (case-insensitive, partial)
    const nameLower = catalogBrand.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return liveData.brands.find(b => {
      const dbName = (b.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const dbSlug = (b.slug || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return dbName.includes(nameLower) || nameLower.includes(dbName) ||
             dbSlug.includes(nameLower) || nameLower.includes(dbSlug);
    });
  }

  // ─── Compute Health Score ────────────────────────────
  function computeHealth(brand) {
    const dbBrand = matchBrandToDb(brand);
    if (!dbBrand || brand.status === 'planned') return 0;

    let score = 0;
    const brandId = dbBrand.id;

    // Post count (max 25 pts)
    const posts = liveData.postCounts[brandId] || 0;
    score += Math.min(25, Math.round((posts / 50) * 25));

    // Presets configured (max 25 pts)
    const presets = liveData.presetCounts[brandId] || [];
    score += presets.length > 0 ? 25 : 0;

    // Winning patterns (max 25 pts)
    const patterns = liveData.winningPatterns[brandId] || [];
    score += patterns.length > 0 ? 25 : 0;

    // Time slot scores (max 25 pts)
    const slots = liveData.timeSlotCounts[brandId] || 0;
    score += Math.min(25, Math.round((slots / 50) * 25));

    return Math.min(100, score);
  }

  // ─── Rendering ──────────────────────────────────────
  function renderPage() {
    const content = document.getElementById('roadmap-content');
    if (!content) return;

    const filtered = applyFilters(BRAND_CATALOG);

    content.innerHTML = `
      ${renderCostTierLegend()}
      ${renderPhaseTimeline()}
      ${renderBrandSections(filtered)}
      ${renderLearningFocus()}
      ${renderDependencies()}
    `;
  }

  function renderCostTierLegend() {
    return `
      <div class="cost-tier-legend">
        ${COST_TIERS.map(t => `
          <div class="cost-tier">
            <span class="cost-tier__dot cost-tier__dot--${t.cssClass}"></span>
            <span>Tier ${t.tier}: ${t.label}</span>
            <span class="cost-tier__range">${t.range}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderPhaseTimeline() {
    return `
      <div class="phase-timeline">
        ${[1, 2, 3].map(p => {
          const phase = PHASES[p];
          const brands = BRAND_CATALOG.filter(b => b.phase === p);
          const activeCount = brands.filter(b => b.status === 'active' || b.status === 'scaling').length;
          const progress = computePhaseProgress(p);
          const statusLabel = activeCount === brands.length ? '✅ All live' :
                              activeCount > 0 ? `🔄 ${activeCount} live` : '⏳ Pending';
          const statusColor = activeCount === brands.length ? 'var(--status-active-muted)' :
                              activeCount > 0 ? 'var(--phase-' + p + '-muted)' : 'var(--status-planned-muted)';

          return `
            <div class="phase-card" data-phase="${p}">
              <div class="phase-card__header">
                <span class="phase-card__label">Phase ${p}</span>
              </div>
              <h3 class="phase-card__title">${phase.name}</h3>
              <div class="phase-card__dates">${phase.weeks}</div>
              <div class="phase-progress">
                <div class="phase-progress__fill" style="width: ${progress}%"></div>
              </div>
              <div class="phase-card__stats">
                <span class="phase-card__stat"><strong>${brands.length}</strong> brands</span>
                <span class="phase-card__status-summary" style="background: ${statusColor}; color: var(--color-text-secondary);">
                  ${statusLabel}
                </span>
              </div>
              <div class="phase-tooltip">
                <div class="phase-tooltip__section">
                  <div class="phase-tooltip__title">Goals</div>
                  <ul class="phase-tooltip__list">
                    ${phase.goals.map(g => `<li>• ${g}</li>`).join('')}
                  </ul>
                </div>
                <div class="phase-tooltip__section">
                  <div class="phase-tooltip__title">Exit Criteria</div>
                  <ul class="phase-tooltip__list">
                    ${phase.exitCriteria.map(c => {
                      const met = checkExitCriteria(c.check);
                      return `<li>${met ? '✅' : '❌'} ${c.label}</li>`;
                    }).join('')}
                  </ul>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderBrandSections(brands) {
    const grouped = {};
    brands.forEach(b => {
      if (!grouped[b.phase]) grouped[b.phase] = [];
      grouped[b.phase].push(b);
    });

    if (brands.length === 0) {
      return `
        <div class="roadmap-empty">
          <div class="roadmap-empty__icon">🔍</div>
          <div class="roadmap-empty__text">No brands match the current filters</div>
          <div class="roadmap-empty__sub">Try changing the platform, engagement, or status filter</div>
        </div>
      `;
    }

    return Object.entries(grouped).sort((a, b) => a[0] - b[0]).map(([phase, phaseBrands]) => `
      <div class="brand-cards-section">
        <div class="brand-cards-section__title">Phase ${phase} — ${PHASES[phase].name}</div>
        <div class="brand-cards-grid">
          ${phaseBrands.map(b => renderBrandCard(b)).join('')}
        </div>
      </div>
    `).join('');
  }

  function renderBrandCard(brand) {
    const dbBrand = matchBrandToDb(brand);
    const brandId = dbBrand ? dbBrand.id : null;
    const posts = brandId ? (liveData.postCounts[brandId] || 0) : 0;
    const health = computeHealth(brand);
    const healthClass = health >= 70 ? 'good' : health >= 40 ? 'fair' : 'poor';
    const activePresets = brand.presets.active.length;
    const plannedPresets = brand.presets.planned.length;

    return `
      <div class="brand-card" data-status="${brand.status}" data-brand-key="${brand.key}" onclick="window._roadmapSelectBrand('${brand.key}')">
        <div class="brand-card__header">
          <div class="brand-card__name">
            <span class="brand-card__icon">${brand.icon}</span>
            <span>${brand.name}</span>
          </div>
          <span class="brand-card__status brand-card__status--${brand.status}">${brand.status}</span>
        </div>
        <div class="brand-card__concept">${brand.concept}</div>
        <div class="brand-card__info">
          <div class="brand-card__info-row">
            <span class="brand-card__info-label">Presets</span>
            <span class="brand-card__info-value">${activePresets > 0 ? activePresets + ' active' : ''}${activePresets > 0 && plannedPresets > 0 ? ', ' : ''}${plannedPresets > 0 ? plannedPresets + ' planned' : ''}</span>
          </div>
          <div class="brand-card__info-row">
            <span class="brand-card__info-label">Platforms</span>
            <div class="brand-card__platforms">
              ${brand.platforms.active.map(p => `
                <span class="platform-icon ${p === brand.platforms.primary ? 'platform-icon--primary' : ''}" title="${p}">${PLATFORM_LABELS[p] || p}</span>
              `).join('')}
            </div>
          </div>
          <div class="brand-card__info-row">
            <span class="brand-card__info-label">Posts</span>
            <span class="brand-card__info-value">${posts}</span>
          </div>
          <div class="brand-card__info-row">
            <span class="brand-card__info-label">Cost Tier</span>
            <span class="brand-card__info-value">Tier ${brand.costTier} — ${COST_TIERS[brand.costTier - 1].range}</span>
          </div>
        </div>
        <div class="brand-card__health">
          <div class="health-bar">
            <div class="health-bar__track">
              <div class="health-bar__fill health-bar__fill--${healthClass}" style="width: ${health}%"></div>
            </div>
            <span class="health-bar__label">${health}%</span>
          </div>
        </div>
        <div class="brand-card__engagement">
          ${brand.engagement.map(e => {
            const eng = ENGAGEMENT_LABELS[e];
            return `<span class="engagement-tag engagement-tag--${e}">${eng.icon} ${eng.label}</span>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  function renderLearningFocus() {
    return `
      <div class="learning-focus">
        ${[1, 2, 3].map(p => {
          const phase = PHASES[p];
          return `
            <div class="learning-focus__phase" data-phase="${p}">
              <div class="learning-focus__title">Phase ${p} Learning</div>
              ${phase.learning.map(l => {
                const icon = l.status === 'good' ? '✅' : l.status === 'pending' ? '🔄' : '⏳';
                return `
                  <div class="learning-focus__item">
                    <span class="learning-focus__icon">${icon}</span>
                    <span>${l.label}</span>
                  </div>
                `;
              }).join('')}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderDependencies() {
    return `
      <div class="dependencies-section">
        <button class="dependencies-toggle" onclick="window._roadmapToggleDeps()">
          <span class="dependencies-toggle__arrow">▶</span>
          <span>Phase Dependencies & Unlock Criteria</span>
        </button>
        <div class="dependencies-content" id="deps-content">
          ${[2, 3].map(p => {
            const phase = PHASES[p];
            if (!phase.dependencies.length) return '';
            return `
              <div class="dep-phase">
                <div class="dep-phase__title">Phase ${p} — ${phase.name}</div>
                ${phase.dependencies.map(d => {
                  const icon = d.status === 'good' ? '✅' : d.status === 'pending' ? '🔄' : '❌';
                  return `
                    <div class="dep-item">
                      <span class="dep-item__icon">${icon}</span>
                      <span>${d.label}</span>
                    </div>
                  `;
                }).join('')}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  function renderDetailPanel(brand) {
    const overlay = document.getElementById('detail-overlay');
    const panel = document.getElementById('detail-panel');
    if (!overlay || !panel) return;

    const dbBrand = matchBrandToDb(brand);
    const brandId = dbBrand ? dbBrand.id : null;
    const dbPresets = brandId ? (liveData.presetCounts[brandId] || []) : [];
    const patterns = brandId ? (liveData.winningPatterns[brandId] || []) : [];
    const timeSlots = brandId ? (liveData.timeSlotCounts[brandId] || 0) : 0;
    const posts = brandId ? (liveData.postCounts[brandId] || 0) : 0;

    const allPresets = [...brand.presets.active, ...brand.presets.planned];

    panel.innerHTML = `
      <div class="detail-panel__header">
        <div class="detail-panel__title">
          <span style="font-size: 28px;">${brand.icon}</span>
          <h3>${brand.name}</h3>
        </div>
        <button class="detail-panel__close" onclick="window._roadmapCloseDetail()">&times;</button>
      </div>

      <div class="detail-section">
        <div class="detail-section__title">Presets (${brand.presets.active.length} active, ${brand.presets.planned.length} planned)</div>
        ${allPresets.map(p => {
          const dbPreset = dbPresets.find(dp => dp.template_type === p);
          const weight = dbPreset ? Math.round((dbPreset.weight || 0) * 100) : 0;
          const isActive = brand.presets.active.includes(p);
          return `
            <div class="preset-row" title="Click to view in AI Intelligence">
              <span class="preset-row__name">${p} ${isActive ? '' : '(planned)'}</span>
              <div class="preset-row__bar">
                <div class="preset-row__bar-fill" style="width: ${weight}%"></div>
              </div>
              <span class="preset-row__posts">${weight}%</span>
              <span class="preset-row__trend ${isActive ? 'trend--up' : 'trend--flat'}">${isActive ? '↑' : '—'}</span>
            </div>
          `;
        }).join('')}
      </div>

      <div class="detail-section">
        <div class="detail-section__title">Platforms</div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          ${brand.platforms.active.map(p => `
            <span class="platform-icon ${p === brand.platforms.primary ? 'platform-icon--primary' : ''}" style="width: auto; padding: 4px 10px; font-size: 12px;" title="${p}">
              ${PLATFORM_LABELS[p] || p} ${p === brand.platforms.primary ? '★' : ''}
            </span>
          `).join('')}
        </div>
      </div>

      <div class="detail-section">
        <div class="detail-section__title">Learning Loop Status</div>
        <div class="learning-row">
          <span class="learning-row__label">Winning Patterns</span>
          <span class="learning-row__value ${patterns.length > 0 ? 'learning-row__value--good' : 'learning-row__value--empty'}">
            ${patterns.length > 0 ? `✅ ${patterns.length} entries` : '⏳ No data yet'}
          </span>
        </div>
        <div class="learning-row">
          <span class="learning-row__label">Time Slot Scores</span>
          <span class="learning-row__value ${timeSlots > 20 ? 'learning-row__value--good' : timeSlots > 0 ? 'learning-row__value--pending' : 'learning-row__value--empty'}">
            ${timeSlots > 0 ? `${timeSlots > 20 ? '✅' : '🔄'} ${timeSlots} samples` : '⏳ No data yet'}
          </span>
        </div>
        <div class="learning-row">
          <span class="learning-row__label">Total Posts</span>
          <span class="learning-row__value ${posts > 30 ? 'learning-row__value--good' : posts > 0 ? 'learning-row__value--pending' : 'learning-row__value--empty'}">
            ${posts > 0 ? `${posts > 30 ? '✅' : '🔄'} ${posts} posts` : '⏳ No posts yet'}
          </span>
        </div>
        <div class="learning-row">
          <span class="learning-row__label">DB Presets Configured</span>
          <span class="learning-row__value ${dbPresets.length > 0 ? 'learning-row__value--good' : 'learning-row__value--empty'}">
            ${dbPresets.length > 0 ? `✅ ${dbPresets.length} presets` : '⏳ Using fallback'}
          </span>
        </div>
      </div>

      <div class="detail-section">
        <div class="detail-section__title">Engagement Mechanics</div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          ${brand.engagement.map(e => {
            const eng = ENGAGEMENT_LABELS[e];
            return `<span class="engagement-tag engagement-tag--${e}" style="font-size: 13px; padding: 4px 12px;">${eng.icon} ${eng.label}</span>`;
          }).join('')}
        </div>
      </div>

      <div class="detail-section">
        <div class="detail-section__title">Cost</div>
        <div style="font-size: 14px; color: var(--color-text-secondary);">
          Tier ${brand.costTier} — ${COST_TIERS[brand.costTier - 1].label}
          <span style="font-family: var(--font-mono); color: var(--color-text-tertiary); margin-left: 8px;">${COST_TIERS[brand.costTier - 1].range}</span>
        </div>
      </div>
    `;

    overlay.classList.add('active');
  }

  // ─── Filters ────────────────────────────────────────
  function applyFilters(brands) {
    return brands.filter(b => {
      if (filters.platform !== 'all' && !b.platforms.active.includes(filters.platform)) return false;
      if (filters.engagement !== 'all' && !b.engagement.includes(filters.engagement)) return false;
      if (filters.status !== 'all' && b.status !== filters.status) return false;
      return true;
    });
  }

  // ─── Phase Progress (rough heuristic) ───────────────
  function computePhaseProgress(phase) {
    const criteria = PHASES[phase].exitCriteria;
    if (!criteria.length) return 0;
    const met = criteria.filter(c => checkExitCriteria(c.check)).length;
    return Math.round((met / criteria.length) * 100);
  }

  function checkExitCriteria(check) {
    // For now, derive from live data where possible
    switch (check) {
      case 'phase1_posting': {
        // At least one brand has posts
        const activeBrands = BRAND_CATALOG.filter(b => b.phase === 1 && b.status === 'active');
        return activeBrands.some(b => {
          const db = matchBrandToDb(b);
          return db && (liveData.postCounts[db.id] || 0) > 7;
        });
      }
      case 'phase1_metrics': {
        return Object.keys(liveData.postCounts).length > 0;
      }
      case 'phase1_patterns': {
        return Object.keys(liveData.winningPatterns).length >= 1;
      }
      case 'phase1_timeslots': {
        return Object.values(liveData.timeSlotCounts).some(c => c >= 20);
      }
      default:
        return false;
    }
  }

  // ─── Event Binding ──────────────────────────────────
  function bindEvents() {
    // Filter selects
    const platformFilter = document.getElementById('filter-platform');
    const engagementFilter = document.getElementById('filter-engagement');
    const statusFilter = document.getElementById('filter-status');

    if (platformFilter) platformFilter.addEventListener('change', (e) => {
      filters.platform = e.target.value;
      renderPage();
      bindEvents();
    });

    if (engagementFilter) engagementFilter.addEventListener('change', (e) => {
      filters.engagement = e.target.value;
      renderPage();
      bindEvents();
    });

    if (statusFilter) statusFilter.addEventListener('change', (e) => {
      filters.status = e.target.value;
      renderPage();
      bindEvents();
    });

    // Close detail on overlay click
    const overlay = document.getElementById('detail-overlay');
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) window._roadmapCloseDetail();
      });
    }

    // Restore filter values
    if (platformFilter) platformFilter.value = filters.platform;
    if (engagementFilter) engagementFilter.value = filters.engagement;
    if (statusFilter) statusFilter.value = filters.status;
  }

  // ─── Public API (for onclick handlers) ──────────────
  window._roadmapSelectBrand = function (key) {
    const brand = BRAND_CATALOG.find(b => b.key === key);
    if (brand) {
      selectedBrand = brand;
      renderDetailPanel(brand);
    }
  };

  window._roadmapCloseDetail = function () {
    const overlay = document.getElementById('detail-overlay');
    if (overlay) overlay.classList.remove('active');
    selectedBrand = null;
  };

  window._roadmapToggleDeps = function () {
    const btn = document.querySelector('.dependencies-toggle');
    const content = document.getElementById('deps-content');
    if (btn && content) {
      btn.classList.toggle('open');
      content.classList.toggle('open');
    }
  };

  // ─── Boot ───────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);
})();
