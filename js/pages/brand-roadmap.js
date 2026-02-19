// =====================================================
// BRAND ROADMAP PAGE CONTROLLER v2.0
//
// Fully wired to Supabase — learning loop, cost,
// platforms, presets, strategies, exit criteria
// =====================================================

(function () {
  'use strict';

  // ─── Static Brand Catalog ───────────────────────────
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
      exitCriteria: [
        { label: 'Image pipeline stable (≥50 images, ≤2% failure)', check: 'phase2_images' },
        { label: 'Per-brand cost within budgets 14+ days', check: 'phase2_cost' },
        { label: 'Strategy divergence between brand types', check: 'phase2_strategy' },
        { label: 'No cross-brand data leakage', check: 'phase2_isolation' },
        { label: 'Concurrent scheduling for 6 brands', check: 'phase2_scheduling' }
      ],
      dependencies: [
        { label: 'Cost tracking ≤5% variance (14 days)', check: 'dep_cost_tracking' },
        { label: 'Budget headroom ≥40%', check: 'dep_budget_headroom' },
        { label: 'Image pipeline ≤2% failure rate', check: 'dep_image_pipeline' },
        { label: 'Phase 1 exit criteria all met', check: 'dep_phase1_complete' }
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
      exitCriteria: [
        { label: 'All 9 brands posting autonomously', check: 'phase3_all_live' },
        { label: 'Restoration ≥70% image continuity', check: 'phase3_restoration' },
        { label: 'Total daily cost under global ceiling', check: 'phase3_cost' },
        { label: 'Learning loop shows improvement (A/B data)', check: 'phase3_learning' },
        { label: 'Strategy system ≥100 data points per platform', check: 'phase3_strategy' }
      ],
      dependencies: [
        { label: 'Phase 2 exit criteria all met', check: 'dep_phase2_complete' },
        { label: 'Lego image consistency proven in Phase 2', check: 'dep_lego_images' },
        { label: 'Multi-image prompt engineering documented', check: 'dep_multi_image_docs' }
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
    youtube_shorts: 'YT Shorts',
    instagram_reels: 'IG Reels',
    tiktok: 'TikTok',
    facebook_reels: 'FB Reels',
    threads: 'Threads',
    x: 'X'
  };

  const PLATFORM_SHORT = {
    youtube_shorts: 'YT', instagram_reels: 'IG', tiktok: 'TK',
    facebook_reels: 'FB', threads: 'TH', x: 'X'
  };

  const ENGAGEMENT_LABELS = {
    replies: { icon: '💬', label: 'Replies' },
    retention: { icon: '⏱', label: 'Retention' },
    saves: { icon: '💾', label: 'Saves' },
    shares: { icon: '🔄', label: 'Shares' }
  };

  // ─── State ──────────────────────────────────────────
  let live = {
    brands: [],
    postsByBrand: {},
    presetsByBrand: {},
    winningPatterns: {},
    timeSlots: {},
    costByBrand: {},
    platformTokens: {},
    strategies: {},
    metadataStats: {},
    metadataVersions: {},
    postLifecycle: {},
    metricsStats: {},
    abVariants: {},
    costLimits: {},
    systemCostLimit: null,
    loaded: false
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
    const sb = typeof getSupabaseClient === 'function' ? getSupabaseClient() : null;
    if (!sb) {
      console.warn('[Roadmap] No Supabase client — static data only');
      return;
    }

    try {
      const [
        brandsRes, postsRes, presetsRes, patternsRes, timeslotsRes,
        costRes, tokensRes, strategiesRes, metadataRes, versionsRes,
        lifecycleRes, metricsRes, variantsRes, costLimitsRes
      ] = await Promise.all([
        sb.from('brands').select('id, name, slug, is_active'),
        sb.from('posts').select('id, brand_id, platform, status, scheduled_at, posted_at'),
        sb.from('brand_templates').select('brand_id, name, template_type, weight, is_default'),
        sb.from('winning_metadata_patterns')
          .select('brand_id, platform, vibe_preset, sample_count, avg_performance, computed_at, top_hooks, top_hashtags, top_ctas, length_stats'),
        sb.from('time_slot_scores').select('brand_id, platform, sample_size, score'),
        sb.from('api_usage').select('brand_id, service, estimated_cost_cents, recorded_at, success'),
        sb.from('platform_tokens').select('brand_id, platform, is_valid, last_used_at, platform_channel_name'),
        sb.from('post_strategies').select('post_id, platform, strategy_type'),
        sb.from('post_metadata').select('id, post_id, platform, status'),
        sb.from('post_metadata_versions').select('id, post_id, version_type, created_by'),
        sb.from('post_lifecycle_events').select('brand_id, event, created_at, worker_id')
          .order('created_at', { ascending: false }).limit(200),
        sb.from('post_metrics').select('post_id, platform, collected_at, source')
          .order('collected_at', { ascending: false }).limit(500),
        sb.from('post_metadata_variant_assignments').select('id, job_id, platform, is_active'),
        sb.from('cost_limits').select('scope, brand_id, service, daily_budget_cents, monthly_budget_cents, enabled')
      ]);

      // — Brands
      if (brandsRes.data) live.brands = brandsRes.data;

      // Build post→brand lookup (reused by multiple aggregations)
      const postBrandMap = {};
      if (postsRes.data) postsRes.data.forEach(p => { if (p.brand_id) postBrandMap[p.id] = p.brand_id; });

      // — Posts
      if (postsRes.data) {
        const map = {};
        postsRes.data.forEach(p => {
          if (!p.brand_id) return;
          if (!map[p.brand_id]) map[p.brand_id] = { total: 0, posted: 0, scheduled: 0, failed: 0, byPlatform: {}, recentDates: [] };
          const b = map[p.brand_id];
          b.total++;
          if (p.status === 'posted') b.posted++;
          else if (p.status === 'scheduled') b.scheduled++;
          else if (p.status === 'failed') b.failed++;
          if (p.platform) b.byPlatform[p.platform] = (b.byPlatform[p.platform] || 0) + 1;
          if (p.posted_at) b.recentDates.push(new Date(p.posted_at));
        });
        live.postsByBrand = map;
      }

      // — Presets
      if (presetsRes.data) {
        const map = {};
        presetsRes.data.forEach(t => {
          if (!t.brand_id) return;
          if (!map[t.brand_id]) map[t.brand_id] = [];
          map[t.brand_id].push(t);
        });
        live.presetsByBrand = map;
      }

      // — Winning patterns
      if (patternsRes.data) {
        const map = {};
        patternsRes.data.forEach(p => {
          if (!p.brand_id) return;
          if (!map[p.brand_id]) map[p.brand_id] = [];
          map[p.brand_id].push(p);
        });
        live.winningPatterns = map;
      }

      // — Time slots
      if (timeslotsRes.data) {
        const map = {};
        timeslotsRes.data.forEach(s => {
          if (!s.brand_id) return;
          if (!map[s.brand_id]) map[s.brand_id] = { count: 0, totalSamples: 0, platforms: new Set() };
          const b = map[s.brand_id];
          b.count++;
          b.totalSamples += (s.sample_size || 0);
          b.platforms.add(s.platform);
        });
        live.timeSlots = map;
      }

      // — Cost
      if (costRes.data) {
        const map = {};
        costRes.data.forEach(u => {
          if (!u.brand_id) return;
          if (!map[u.brand_id]) map[u.brand_id] = { totalCents: 0, callCount: 0, dailyCents: {}, services: {} };
          const b = map[u.brand_id];
          const cents = u.estimated_cost_cents || 0;
          b.totalCents += cents;
          b.callCount++;
          const day = (u.recorded_at || '').slice(0, 10);
          if (day) b.dailyCents[day] = (b.dailyCents[day] || 0) + cents;
          if (u.service) b.services[u.service] = (b.services[u.service] || 0) + cents;
        });
        live.costByBrand = map;
      }

      // — Platform tokens
      if (tokensRes.data) {
        const map = {};
        tokensRes.data.forEach(t => {
          if (!t.brand_id) return;
          if (!map[t.brand_id]) map[t.brand_id] = [];
          map[t.brand_id].push(t);
        });
        live.platformTokens = map;
      }

      // — Strategies (cross-ref with posts for brand_id)
      if (strategiesRes.data) {
        const map = {};
        strategiesRes.data.forEach(s => {
          const brandId = postBrandMap[s.post_id];
          if (!brandId) return;
          if (!map[brandId]) map[brandId] = [];
          map[brandId].push({ strategy_type: s.strategy_type, platform: s.platform });
        });
        live.strategies = map;
      }

      // — Metadata stats
      if (metadataRes.data) {
        const map = {};
        metadataRes.data.forEach(m => {
          const brandId = postBrandMap[m.post_id];
          if (!brandId) return;
          if (!map[brandId]) map[brandId] = { ready: 0, generating: 0, failed: 0, total: 0 };
          const b = map[brandId];
          b.total++;
          if (m.status === 'ready') b.ready++;
          else if (m.status === 'generating' || m.status === 'not_started') b.generating++;
          else if (m.status === 'failed') b.failed++;
        });
        live.metadataStats = map;
      }

      // — Metadata versions
      if (versionsRes.data) {
        const map = {};
        versionsRes.data.forEach(v => {
          const brandId = postBrandMap[v.post_id];
          if (!brandId) return;
          map[brandId] = (map[brandId] || 0) + 1;
        });
        live.metadataVersions = map;
      }

      // — Lifecycle events
      if (lifecycleRes.data) {
        const map = {};
        lifecycleRes.data.forEach(e => {
          if (!e.brand_id) return;
          if (!map[e.brand_id]) map[e.brand_id] = { lastManualEvent: null, lastAnyEvent: null };
          const b = map[e.brand_id];
          if (!b.lastAnyEvent) b.lastAnyEvent = e.created_at;
          if (e.worker_id && (e.worker_id.includes('manual') || e.event === 'manual_retry')) {
            if (!b.lastManualEvent) b.lastManualEvent = e.created_at;
          }
        });
        live.postLifecycle = map;
      }

      // — Metrics collection
      if (metricsRes.data) {
        const map = {};
        metricsRes.data.forEach(m => {
          const brandId = postBrandMap[m.post_id];
          if (!brandId) return;
          if (!map[brandId]) map[brandId] = { postsWithMetrics: new Set(), totalCollections: 0 };
          map[brandId].postsWithMetrics.add(m.post_id);
          map[brandId].totalCollections++;
        });
        Object.keys(map).forEach(k => { map[k].postsWithMetrics = map[k].postsWithMetrics.size; });
        live.metricsStats = map;
      }

      // — A/B variants
      if (variantsRes.data) {
        live.abVariants = { total: variantsRes.data.length, active: variantsRes.data.filter(v => v.is_active).length };
      }

      // — Cost limits
      if (costLimitsRes.data) {
        const brandMap = {};
        let systemLimit = null;
        costLimitsRes.data.forEach(l => {
          if (l.scope === 'system') systemLimit = l;
          if (l.scope === 'brand' && l.brand_id) {
            if (!brandMap[l.brand_id]) brandMap[l.brand_id] = {};
            brandMap[l.brand_id][l.service || 'all'] = l;
          }
        });
        live.costLimits = brandMap;
        live.systemCostLimit = systemLimit;
      }

      live.loaded = true;
      console.log('[Roadmap] Live data loaded:', {
        brands: live.brands.length,
        posts: Object.keys(live.postsByBrand).length,
        presets: Object.keys(live.presetsByBrand).length,
        patterns: Object.keys(live.winningPatterns).length,
        cost: Object.keys(live.costByBrand).length,
        tokens: Object.keys(live.platformTokens).length
      });
    } catch (err) {
      console.error('[Roadmap] Failed to load live data:', err);
    }
  }

  // ─── Match catalog brand → DB brand ─────────────────
  function matchBrandToDb(catalogBrand) {
    if (!live.brands.length) return null;
    const nameLower = catalogBrand.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return live.brands.find(b => {
      const dbName = (b.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const dbSlug = (b.slug || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return dbName.includes(nameLower) || nameLower.includes(dbName) ||
             dbSlug.includes(nameLower) || nameLower.includes(dbSlug);
    });
  }

  function getBrandId(brand) {
    const db = matchBrandToDb(brand);
    return db ? db.id : null;
  }

  // ─── Learning Loop Signals ──────────────────────────
  function getLearningSignals(brand) {
    const id = getBrandId(brand);
    const empty = { winningPatterns: 0, winningEntries: 0, timeSlotSamples: 0, timeSlotPlatforms: 0, metadataReady: 0, metadataTotal: 0, metadataVersions: 0, strategies: 0, metricsCollected: 0, postsWithMetrics: 0, abVariants: 0, posts: 0, postsPosted: 0 };
    if (!id) return empty;

    const patterns = live.winningPatterns[id] || [];
    const ts = live.timeSlots[id] || { count: 0, totalSamples: 0, platforms: new Set() };
    const meta = live.metadataStats[id] || { ready: 0, total: 0 };
    const versions = live.metadataVersions[id] || 0;
    const strats = live.strategies[id] || [];
    const metrics = live.metricsStats[id] || { postsWithMetrics: 0, totalCollections: 0 };
    const pb = live.postsByBrand[id] || { total: 0, posted: 0 };

    return {
      winningPatterns: patterns.reduce((sum, p) => sum + (p.sample_count || 0), 0),
      winningEntries: patterns.length,
      timeSlotSamples: ts.totalSamples,
      timeSlotPlatforms: ts.platforms ? ts.platforms.size : 0,
      metadataReady: meta.ready,
      metadataTotal: meta.total,
      metadataVersions: versions,
      strategies: strats.length,
      metricsCollected: metrics.totalCollections,
      postsWithMetrics: metrics.postsWithMetrics,
      abVariants: live.abVariants ? live.abVariants.active : 0,
      posts: pb.total,
      postsPosted: pb.posted
    };
  }

  // ─── Health Score ───────────────────────────────────
  function computeHealth(brand) {
    const id = getBrandId(brand);
    if (!id || brand.status === 'planned') return { score: 0, breakdown: {} };

    const pb = live.postsByBrand[id] || { total: 0, posted: 0 };
    const presets = live.presetsByBrand[id] || [];
    const patterns = live.winningPatterns[id] || [];
    const ts = live.timeSlots[id] || { totalSamples: 0 };
    const meta = live.metadataStats[id] || { ready: 0 };
    const metrics = live.metricsStats[id] || { totalCollections: 0 };

    const postScore = Math.min(20, Math.round((pb.posted / 50) * 20));
    const presetScore = presets.length >= 3 ? 15 : Math.round((presets.length / 3) * 15);
    const patternScore = patterns.length > 0 ? 20 : 0;
    const timeSlotScore = Math.min(15, Math.round((ts.totalSamples / 100) * 15));
    const metadataScore = meta.ready >= 10 ? 15 : Math.round((meta.ready / 10) * 15);
    const metricsScore = metrics.totalCollections >= 50 ? 15 : Math.round((metrics.totalCollections / 50) * 15);

    const score = Math.min(100, postScore + presetScore + patternScore + timeSlotScore + metadataScore + metricsScore);

    return {
      score,
      breakdown: {
        posts: { score: postScore, max: 20, value: pb.posted },
        presets: { score: presetScore, max: 15, value: presets.length },
        patterns: { score: patternScore, max: 20, value: patterns.length },
        timeSlots: { score: timeSlotScore, max: 15, value: ts.totalSamples },
        metadata: { score: metadataScore, max: 15, value: meta.ready },
        metrics: { score: metricsScore, max: 15, value: metrics.totalCollections }
      }
    };
  }

  // ─── Cost Data ──────────────────────────────────────
  function getCostData(brand) {
    const id = getBrandId(brand);
    if (!id) return { totalCents: 0, avgPerPost: 0, dailyAvg: 0, services: {}, daysTracked: 0, callCount: 0 };

    const c = live.costByBrand[id] || { totalCents: 0, callCount: 0, dailyCents: {}, services: {} };
    const days = Object.keys(c.dailyCents);
    const pb = live.postsByBrand[id] || { posted: 0 };

    return {
      totalCents: c.totalCents,
      avgPerPost: pb.posted > 0 ? Math.round(c.totalCents / pb.posted) : 0,
      dailyAvg: days.length > 0 ? Math.round(c.totalCents / days.length) : 0,
      services: c.services,
      daysTracked: days.length,
      callCount: c.callCount
    };
  }

  // ─── Connected Platforms ────────────────────────────
  function getConnectedPlatforms(brand) {
    const id = getBrandId(brand);
    if (!id) return [];
    return (live.platformTokens[id] || []).map(t => ({
      platform: t.platform,
      valid: t.is_valid,
      lastUsed: t.last_used_at,
      channelName: t.platform_channel_name
    }));
  }

  // ─── Exit Criteria ──────────────────────────────────
  function checkExitCriteria(check) {
    const phase1Brands = BRAND_CATALOG.filter(b => b.phase === 1);
    const phase1Active = phase1Brands.filter(b => b.status === 'active');

    switch (check) {
      case 'phase1_posting': {
        return phase1Active.length > 0 && phase1Active.every(b => {
          const id = getBrandId(b);
          return id && (live.postsByBrand[id]?.posted || 0) >= 7;
        });
      }
      case 'phase1_metrics': {
        return phase1Active.some(b => {
          const id = getBrandId(b);
          return id && (live.metricsStats[id]?.totalCollections || 0) > 0;
        });
      }
      case 'phase1_patterns': {
        let count = 0;
        phase1Active.forEach(b => {
          const id = getBrandId(b);
          if (id && (live.winningPatterns[id]?.length || 0) > 0) count++;
        });
        return count >= Math.min(2, phase1Active.length);
      }
      case 'phase1_timeslots': {
        return phase1Active.some(b => {
          const id = getBrandId(b);
          return id && (live.timeSlots[id]?.totalSamples || 0) >= 20;
        });
      }
      case 'phase1_autonomous': {
        const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        return phase1Active.every(b => {
          const id = getBrandId(b);
          if (!id) return false;
          const lc = live.postLifecycle[id];
          if (!lc) return false;
          if (!lc.lastManualEvent) return true;
          return lc.lastManualEvent < cutoff;
        });
      }
      case 'phase2_images': {
        let imageCount = 0;
        Object.values(live.costByBrand).forEach(c => {
          if (c.services['openai_image']) imageCount += c.callCount;
        });
        return imageCount >= 50;
      }
      case 'phase2_cost': {
        const activeBrands = BRAND_CATALOG.filter(b => b.status === 'active' || b.status === 'scaling');
        return activeBrands.length > 0 && activeBrands.every(b => {
          const cost = getCostData(b);
          return cost.daysTracked >= 14;
        });
      }
      case 'phase2_strategy': {
        const brandStrats = new Set();
        Object.values(live.strategies).forEach(strats => {
          if (strats.length > 0) {
            const typeCounts = {};
            strats.forEach(s => { typeCounts[s.strategy_type] = (typeCounts[s.strategy_type] || 0) + 1; });
            const top = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];
            if (top) brandStrats.add(top[0]);
          }
        });
        return brandStrats.size >= 2;
      }
      case 'phase2_isolation': {
        return Object.keys(live.presetsByBrand).length >= 2;
      }
      case 'phase2_scheduling': {
        return Object.values(live.postsByBrand).filter(b => b.total > 0).length >= 6;
      }
      case 'phase3_all_live': {
        return BRAND_CATALOG.every(b => b.status === 'active' || b.status === 'scaling');
      }
      case 'phase3_restoration': return false;
      case 'phase3_cost': {
        if (!live.systemCostLimit) return false;
        const totalDailyCents = Object.values(live.costByBrand).reduce((sum, c) => {
          const days = Object.keys(c.dailyCents);
          return sum + (days.length > 0 ? c.totalCents / days.length : 0);
        }, 0);
        return totalDailyCents < (live.systemCostLimit.daily_budget_cents || Infinity);
      }
      case 'phase3_learning': {
        return (live.abVariants?.active || 0) >= 2;
      }
      case 'phase3_strategy': {
        const total = Object.values(live.strategies).reduce((sum, s) => sum + s.length, 0);
        return total >= 100;
      }
      case 'dep_cost_tracking': {
        return Object.values(live.costByBrand).some(c => Object.keys(c.dailyCents).length >= 14);
      }
      case 'dep_budget_headroom': {
        if (!live.systemCostLimit || !live.systemCostLimit.daily_budget_cents) return false;
        const totalDailyCents = Object.values(live.costByBrand).reduce((sum, c) => {
          const days = Object.keys(c.dailyCents);
          return sum + (days.length > 0 ? c.totalCents / days.length : 0);
        }, 0);
        return totalDailyCents < live.systemCostLimit.daily_budget_cents * 0.6;
      }
      case 'dep_image_pipeline': return checkExitCriteria('phase2_images');
      case 'dep_phase1_complete': return PHASES[1].exitCriteria.every(c => checkExitCriteria(c.check));
      case 'dep_phase2_complete': return PHASES[2].exitCriteria.every(c => checkExitCriteria(c.check));
      case 'dep_lego_images': return false;
      case 'dep_multi_image_docs': return false;
      default: return false;
    }
  }

  // ─── Phase Progress ─────────────────────────────────
  function computePhaseProgress(phase) {
    const criteria = PHASES[phase].exitCriteria;
    if (!criteria.length) return 0;
    const met = criteria.filter(c => checkExitCriteria(c.check)).length;
    return Math.round((met / criteria.length) * 100);
  }

  // ─── Dynamic Learning Items ─────────────────────────
  function computePhaseLearning(phase) {
    const phaseBrands = BRAND_CATALOG.filter(b => b.phase === phase);

    switch (phase) {
      case 1: {
        const hasScheduling = phaseBrands.some(b => {
          const id = getBrandId(b);
          return id && (live.postsByBrand[id]?.scheduled || 0) > 0;
        });
        const hasPatterns = phaseBrands.some(b => {
          const id = getBrandId(b);
          return id && (live.winningPatterns[id]?.length || 0) > 0;
        });
        const hasCost = phaseBrands.some(b => {
          const id = getBrandId(b);
          return id && (live.costByBrand[id]?.totalCents || 0) > 0;
        });
        const hasStrategies = phaseBrands.some(b => {
          const id = getBrandId(b);
          return id && (live.strategies[id]?.length || 0) > 0;
        });
        return [
          { label: 'Multi-brand scheduling', status: hasScheduling ? 'good' : 'pending' },
          { label: 'Reply vs retention signals', status: hasPatterns ? 'good' : 'pending' },
          { label: 'Cross-brand cost tracking', status: hasCost ? 'good' : 'pending' },
          { label: 'Strategy baseline data', status: hasStrategies ? 'good' : 'pending' }
        ];
      }
      case 2: {
        const hasImageCost = Object.values(live.costByBrand).some(c => (c.services['openai_image'] || 0) > 0);
        const p2PresetCount = phaseBrands.reduce((sum, b) => {
          const id = getBrandId(b);
          return sum + (id ? (live.presetsByBrand[id]?.length || 0) : 0);
        }, 0);
        const p2BrandsScheduled = phaseBrands.filter(b => {
          const id = getBrandId(b);
          return id && (live.postsByBrand[id]?.total || 0) > 0;
        }).length;
        return [
          { label: 'Image cost tracking', status: hasImageCost ? 'good' : 'empty' },
          { label: 'Cross-genre presets', status: p2PresetCount > 0 ? 'good' : 'empty' },
          { label: 'Humor calibration', status: 'empty' },
          { label: '6-brand scheduling', status: p2BrandsScheduled >= 4 ? 'pending' : 'empty' }
        ];
      }
      case 3:
        return [
          { label: 'Multi-image cost optimization', status: 'empty' },
          { label: 'Image consistency techniques', status: 'empty' },
          { label: 'Portfolio scheduling (9 brands)', status: 'empty' },
          { label: 'Cross-brand audience overlap', status: 'empty' }
        ];
      default:
        return [];
    }
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
    const totalCents = Object.values(live.costByBrand).reduce((sum, c) => sum + c.totalCents, 0);
    const allDays = new Set();
    Object.values(live.costByBrand).forEach(c => Object.keys(c.dailyCents).forEach(d => allDays.add(d)));
    const dailyAvg = allDays.size > 0 ? Math.round(totalCents / allDays.size) : 0;

    return `
      <div class="cost-tier-legend">
        <div class="cost-tier-legend__tiers">
          ${COST_TIERS.map(t => `
            <div class="cost-tier">
              <span class="cost-tier__dot cost-tier__dot--${t.cssClass}"></span>
              <span>Tier ${t.tier}: ${t.label}</span>
              <span class="cost-tier__range">${t.range}</span>
            </div>
          `).join('')}
        </div>
        ${totalCents > 0 ? `
          <div class="cost-tier-legend__total">
            <span class="cost-total__label">Total Spend</span>
            <span class="cost-total__value">$${(totalCents / 100).toFixed(2)}</span>
            <span class="cost-total__daily">~$${(dailyAvg / 100).toFixed(2)}/day</span>
          </div>
        ` : ''}
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
                              activeCount > 0 ? `🔄 ${activeCount}/${brands.length} live` : '⏳ Pending';
          const phaseClass = activeCount === brands.length ? 'complete' :
                             activeCount > 0 ? 'active' : 'pending';

          return `
            <div class="phase-card phase-card--${phaseClass}" data-phase="${p}">
              <div class="phase-card__header">
                <span class="phase-card__label">Phase ${p}</span>
                <span class="phase-card__progress-label">${progress}%</span>
              </div>
              <h3 class="phase-card__title">${phase.name}</h3>
              <div class="phase-card__dates">${phase.weeks}</div>
              <div class="phase-progress">
                <div class="phase-progress__fill" style="width: ${progress}%"></div>
              </div>
              <div class="phase-card__stats">
                <span class="phase-card__stat"><strong>${brands.length}</strong> brands</span>
                <span class="phase-card__stat">${statusLabel}</span>
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
                      return `<li class="${met ? 'criteria-met' : 'criteria-unmet'}">${met ? '✅' : '❌'} ${c.label}</li>`;
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
    const id = getBrandId(brand);
    const pb = id ? (live.postsByBrand[id] || { total: 0, posted: 0, scheduled: 0, failed: 0 }) : { total: 0, posted: 0, scheduled: 0, failed: 0 };
    const health = computeHealth(brand);
    const healthClass = health.score >= 70 ? 'good' : health.score >= 40 ? 'fair' : 'poor';
    const cost = getCostData(brand);
    const connected = getConnectedPlatforms(brand);
    const signals = getLearningSignals(brand);

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
            <span class="brand-card__info-label">Posts</span>
            <span class="brand-card__info-value">
              ${pb.posted > 0 ? `<span class="val-good">${pb.posted} posted</span>` : '<span class="val-empty">0</span>'}
              ${pb.scheduled > 0 ? ` · <span class="val-pending">${pb.scheduled} sched</span>` : ''}
              ${pb.failed > 0 ? ` · <span class="val-bad">${pb.failed} fail</span>` : ''}
            </span>
          </div>

          <div class="brand-card__info-row">
            <span class="brand-card__info-label">Presets</span>
            <span class="brand-card__info-value">
              ${brand.presets.active.length > 0 ? `<span class="val-good">${brand.presets.active.length} active</span>` : ''}
              ${brand.presets.planned.length > 0 ? `${brand.presets.active.length > 0 ? ' · ' : ''}<span class="val-muted">${brand.presets.planned.length} planned</span>` : ''}
              ${brand.presets.active.length === 0 && brand.presets.planned.length === 0 ? '<span class="val-empty">—</span>' : ''}
            </span>
          </div>

          <div class="brand-card__info-row">
            <span class="brand-card__info-label">Platforms</span>
            <div class="brand-card__platforms">
              ${brand.platforms.active.map(p => {
                const token = connected.find(t => t.platform === p || t.platform === p.replace('_shorts', '').replace('_reels', ''));
                const connClass = token ? (token.valid ? 'platform-connected' : 'platform-expired') : '';
                return `<span class="platform-icon ${p === brand.platforms.primary ? 'platform-icon--primary' : ''} ${connClass}" title="${PLATFORM_LABELS[p] || p}${token ? (token.valid ? ' ✓' : ' ⚠') : ''}">${PLATFORM_SHORT[p] || p}</span>`;
              }).join('')}
            </div>
          </div>

          <div class="brand-card__info-row">
            <span class="brand-card__info-label">Cost</span>
            <span class="brand-card__info-value">
              <span class="cost-tier-badge cost-tier-badge--${brand.costTier}">T${brand.costTier}</span>
              ${cost.totalCents > 0
                ? `$${(cost.totalCents / 100).toFixed(2)} · ~$${(cost.avgPerPost / 100).toFixed(2)}/post`
                : `<span class="val-muted">${COST_TIERS[brand.costTier - 1].range}</span>`
              }
            </span>
          </div>

          <div class="brand-card__info-row">
            <span class="brand-card__info-label">Learning</span>
            <span class="brand-card__info-value brand-card__learning-pills">
              ${signals.winningEntries > 0 ? `<span class="signal-pill signal-pill--good" title="${signals.winningPatterns} pattern samples">🧠 ${signals.winningEntries}</span>` : '<span class="signal-pill signal-pill--empty" title="No winning patterns">🧠 0</span>'}
              ${signals.metricsCollected > 0 ? `<span class="signal-pill signal-pill--good" title="${signals.metricsCollected} metric collections">📊 ${signals.postsWithMetrics}</span>` : '<span class="signal-pill signal-pill--empty" title="No metrics">📊 0</span>'}
              ${signals.strategies > 0 ? `<span class="signal-pill signal-pill--good" title="${signals.strategies} strategy assignments">🎯 ${signals.strategies}</span>` : '<span class="signal-pill signal-pill--empty" title="No strategies">🎯 0</span>'}
              ${signals.timeSlotSamples > 0 ? `<span class="signal-pill signal-pill--good" title="${signals.timeSlotSamples} time slot samples">⏰ ${signals.timeSlotSamples}</span>` : '<span class="signal-pill signal-pill--empty" title="No time slots">⏰ 0</span>'}
            </span>
          </div>
        </div>

        <div class="brand-card__health">
          <div class="health-bar">
            <div class="health-bar__track">
              <div class="health-bar__fill health-bar__fill--${healthClass}" style="width: ${health.score}%"></div>
            </div>
            <span class="health-bar__label">${health.score}%</span>
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
        <div class="learning-focus__header">
          <h3 class="learning-focus__main-title">Learning Loop Status</h3>
          ${live.loaded ? '<span class="learning-focus__live-badge">LIVE</span>' : '<span class="learning-focus__static-badge">STATIC</span>'}
        </div>
        <div class="learning-focus__grid">
          ${[1, 2, 3].map(p => {
            const items = computePhaseLearning(p);
            return `
              <div class="learning-focus__phase" data-phase="${p}">
                <div class="learning-focus__title">Phase ${p} — ${PHASES[p].name}</div>
                ${items.map(l => {
                  const icon = l.status === 'good' ? '✅' : l.status === 'pending' ? '🔄' : '⏳';
                  const cls = l.status === 'good' ? 'learning--good' : l.status === 'pending' ? 'learning--pending' : 'learning--empty';
                  return `
                    <div class="learning-focus__item ${cls}">
                      <span class="learning-focus__icon">${icon}</span>
                      <span>${l.label}</span>
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
            if (!phase.dependencies || !phase.dependencies.length) return '';
            return `
              <div class="dep-phase">
                <div class="dep-phase__title">Phase ${p} — ${phase.name}</div>
                ${phase.dependencies.map(d => {
                  const met = checkExitCriteria(d.check);
                  return `
                    <div class="dep-item ${met ? 'dep-item--met' : 'dep-item--unmet'}">
                      <span class="dep-item__icon">${met ? '✅' : '❌'}</span>
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

  // ─── Detail Panel ───────────────────────────────────
  function renderDetailPanel(brand) {
    const overlay = document.getElementById('detail-overlay');
    const panel = document.getElementById('detail-panel');
    if (!overlay || !panel) return;

    const id = getBrandId(brand);
    const signals = getLearningSignals(brand);
    const health = computeHealth(brand);
    const cost = getCostData(brand);
    const connected = getConnectedPlatforms(brand);
    const dbPresets = id ? (live.presetsByBrand[id] || []) : [];
    const patterns = id ? (live.winningPatterns[id] || []) : [];
    const pb = id ? (live.postsByBrand[id] || { total: 0, posted: 0, scheduled: 0, failed: 0, byPlatform: {} }) : { total: 0, posted: 0, scheduled: 0, failed: 0, byPlatform: {} };
    const strats = id ? (live.strategies[id] || []) : [];

    const stratCounts = {};
    strats.forEach(s => { stratCounts[s.strategy_type] = (stratCounts[s.strategy_type] || 0) + 1; });
    const stratEntries = Object.entries(stratCounts).sort((a, b) => b[1] - a[1]);

    const serviceEntries = Object.entries(cost.services).sort((a, b) => b[1] - a[1]);

    panel.innerHTML = `
      <div class="detail-panel__header">
        <div class="detail-panel__title">
          <span style="font-size: 28px;">${brand.icon}</span>
          <div>
            <h3>${brand.name}</h3>
            <span class="detail-panel__subtitle">${brand.concept}</span>
          </div>
        </div>
        <button class="detail-panel__close" onclick="window._roadmapCloseDetail()">&times;</button>
      </div>

      <!-- Health Breakdown -->
      <div class="detail-section">
        <div class="detail-section__title">Health Score — ${health.score}%</div>
        <div class="health-breakdown">
          ${Object.entries(health.breakdown).map(([key, data]) => `
            <div class="health-breakdown__row">
              <span class="health-breakdown__label">${key}</span>
              <div class="health-breakdown__bar">
                <div class="health-breakdown__fill" style="width: ${(data.score / data.max) * 100}%"></div>
              </div>
              <span class="health-breakdown__value">${data.score}/${data.max}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Posts -->
      <div class="detail-section">
        <div class="detail-section__title">Posts — ${pb.total} total</div>
        <div class="detail-stats-grid">
          <div class="detail-stat">
            <span class="detail-stat__value val-good">${pb.posted}</span>
            <span class="detail-stat__label">Posted</span>
          </div>
          <div class="detail-stat">
            <span class="detail-stat__value val-pending">${pb.scheduled}</span>
            <span class="detail-stat__label">Scheduled</span>
          </div>
          <div class="detail-stat">
            <span class="detail-stat__value val-bad">${pb.failed}</span>
            <span class="detail-stat__label">Failed</span>
          </div>
        </div>
        ${Object.keys(pb.byPlatform).length > 0 ? `
          <div class="detail-platform-breakdown">
            ${Object.entries(pb.byPlatform).sort((a, b) => b[1] - a[1]).map(([plat, count]) => `
              <div class="detail-platform-row">
                <span class="platform-icon platform-icon--sm">${PLATFORM_SHORT[plat] || plat}</span>
                <span class="detail-platform-row__name">${PLATFORM_LABELS[plat] || plat}</span>
                <span class="detail-platform-row__count">${count}</span>
              </div>
            `).join('')}
          </div>
        ` : '<div class="detail-empty">No posts yet</div>'}
      </div>

      <!-- Presets -->
      <div class="detail-section">
        <div class="detail-section__title">Presets</div>
        <div class="detail-presets">
          ${[...brand.presets.active, ...brand.presets.planned].map(p => {
            const dbPreset = dbPresets.find(dp => dp.template_type === p || dp.name === p);
            const weight = dbPreset ? (dbPreset.weight || 0) : 0;
            const isActive = brand.presets.active.includes(p);
            const inDb = !!dbPreset;
            return `
              <div class="preset-row ${isActive ? 'preset-row--active' : 'preset-row--planned'}">
                <span class="preset-row__status">${inDb ? '✅' : isActive ? '🔄' : '⏳'}</span>
                <span class="preset-row__name">${p.replace(/_/g, ' ')}</span>
                ${inDb ? `
                  <div class="preset-row__bar"><div class="preset-row__bar-fill" style="width: ${Math.min(100, weight)}%"></div></div>
                  <span class="preset-row__weight">w:${weight}</span>
                ` : `<span class="preset-row__planned-label">${isActive ? 'active (no DB row)' : 'planned'}</span>`}
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Connected Platforms -->
      <div class="detail-section">
        <div class="detail-section__title">Platforms & Connections</div>
        <div class="detail-platforms-list">
          ${brand.platforms.active.map(p => {
            const token = connected.find(t => t.platform === p || t.platform === p.replace('_shorts', '').replace('_reels', ''));
            const isPrimary = p === brand.platforms.primary;
            return `
              <div class="detail-platform-item ${token ? (token.valid ? 'detail-platform-item--connected' : 'detail-platform-item--expired') : 'detail-platform-item--disconnected'}">
                <span class="platform-icon ${isPrimary ? 'platform-icon--primary' : ''}">${PLATFORM_SHORT[p] || p}</span>
                <span class="detail-platform-item__name">${PLATFORM_LABELS[p] || p}${isPrimary ? ' ★' : ''}</span>
                <span class="detail-platform-item__status">
                  ${token
                    ? (token.valid
                      ? `<span class="val-good">✓ Connected</span>${token.channelName ? ` · ${token.channelName}` : ''}`
                      : '<span class="val-bad">⚠ Expired</span>')
                    : '<span class="val-muted">Not Connected</span>'
                  }
                </span>
                ${pb.byPlatform[p] ? `<span class="detail-platform-item__posts">${pb.byPlatform[p]} posts</span>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Learning Loop -->
      <div class="detail-section">
        <div class="detail-section__title">Learning Loop</div>
        <div class="learning-detail-grid">
          <div class="learning-detail-item">
            <div class="learning-detail-item__icon">${signals.winningEntries > 0 ? '✅' : '⏳'}</div>
            <div class="learning-detail-item__label">Winning Patterns</div>
            <div class="learning-detail-item__value">${signals.winningEntries > 0 ? `${signals.winningEntries} entries · ${signals.winningPatterns} samples` : 'No data yet'}</div>
          </div>
          <div class="learning-detail-item">
            <div class="learning-detail-item__icon">${signals.timeSlotSamples > 0 ? (signals.timeSlotSamples >= 20 ? '✅' : '🔄') : '⏳'}</div>
            <div class="learning-detail-item__label">Time Slot Scores</div>
            <div class="learning-detail-item__value">${signals.timeSlotSamples > 0 ? `${signals.timeSlotSamples} samples · ${signals.timeSlotPlatforms} platforms` : 'No data yet'}</div>
          </div>
          <div class="learning-detail-item">
            <div class="learning-detail-item__icon">${signals.metadataReady > 0 ? '✅' : '⏳'}</div>
            <div class="learning-detail-item__label">AI Metadata</div>
            <div class="learning-detail-item__value">${signals.metadataReady > 0 ? `${signals.metadataReady} ready · ${signals.metadataVersions} versions` : 'No metadata generated'}</div>
          </div>
          <div class="learning-detail-item">
            <div class="learning-detail-item__icon">${signals.metricsCollected > 0 ? '✅' : '⏳'}</div>
            <div class="learning-detail-item__label">Metrics Collection</div>
            <div class="learning-detail-item__value">${signals.metricsCollected > 0 ? `${signals.postsWithMetrics} posts · ${signals.metricsCollected} collections` : 'No metrics yet'}</div>
          </div>
          <div class="learning-detail-item">
            <div class="learning-detail-item__icon">${signals.strategies > 0 ? '✅' : '⏳'}</div>
            <div class="learning-detail-item__label">Strategy Assignments</div>
            <div class="learning-detail-item__value">${signals.strategies > 0 ? `${signals.strategies} assignments` : 'No strategies yet'}</div>
          </div>
          <div class="learning-detail-item">
            <div class="learning-detail-item__icon">${signals.abVariants > 0 ? '✅' : '⏳'}</div>
            <div class="learning-detail-item__label">A/B Testing</div>
            <div class="learning-detail-item__value">${signals.abVariants > 0 ? `${signals.abVariants} active variants` : 'Not started'}</div>
          </div>
        </div>
      </div>

      <!-- Winning Patterns -->
      ${patterns.length > 0 ? `
        <div class="detail-section">
          <div class="detail-section__title">Winning Patterns (${patterns.length} entries)</div>
          ${patterns.slice(0, 5).map(p => `
            <div class="pattern-row">
              <div class="pattern-row__header">
                <span class="platform-icon platform-icon--sm">${PLATFORM_SHORT[p.platform] || p.platform}</span>
                <span>${p.vibe_preset || 'all presets'}</span>
                <span class="pattern-row__meta">${p.sample_count || 0} samples · avg: ${(p.avg_performance || 0).toFixed(1)}</span>
              </div>
              ${p.top_hooks && p.top_hooks.length > 0 ? `
                <div class="pattern-row__hooks">
                  <span class="pattern-row__label">Top hooks:</span>
                  ${p.top_hooks.slice(0, 3).map(h => `<span class="pattern-tag">"${typeof h === 'object' ? h.hook : h}"</span>`).join('')}
                </div>
              ` : ''}
              ${p.top_hashtags && p.top_hashtags.length > 0 ? `
                <div class="pattern-row__hooks">
                  <span class="pattern-row__label">Top tags:</span>
                  ${p.top_hashtags.slice(0, 5).map(t => `<span class="pattern-tag">#${typeof t === 'object' ? t.tag : t}</span>`).join('')}
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      ` : ''}

      <!-- Strategies -->
      ${stratEntries.length > 0 ? `
        <div class="detail-section">
          <div class="detail-section__title">Strategy Distribution (${strats.length} assignments)</div>
          <div class="strategy-bars">
            ${stratEntries.slice(0, 6).map(([type, count]) => {
              const pct = Math.round((count / strats.length) * 100);
              return `
                <div class="strategy-bar-row">
                  <span class="strategy-bar-row__label">${type.replace(/_/g, ' ')}</span>
                  <div class="strategy-bar-row__track">
                    <div class="strategy-bar-row__fill" style="width: ${pct}%"></div>
                  </div>
                  <span class="strategy-bar-row__value">${count} (${pct}%)</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Cost -->
      <div class="detail-section">
        <div class="detail-section__title">Cost</div>
        <div class="cost-detail">
          <div class="cost-detail__tier">
            <span class="cost-tier-badge cost-tier-badge--${brand.costTier}">Tier ${brand.costTier}</span>
            <span>${COST_TIERS[brand.costTier - 1].label} — ${COST_TIERS[brand.costTier - 1].range}</span>
          </div>
          ${cost.totalCents > 0 ? `
            <div class="detail-stats-grid" style="margin-top: 12px;">
              <div class="detail-stat">
                <span class="detail-stat__value">$${(cost.totalCents / 100).toFixed(2)}</span>
                <span class="detail-stat__label">Total</span>
              </div>
              <div class="detail-stat">
                <span class="detail-stat__value">$${(cost.avgPerPost / 100).toFixed(2)}</span>
                <span class="detail-stat__label">Per Post</span>
              </div>
              <div class="detail-stat">
                <span class="detail-stat__value">$${(cost.dailyAvg / 100).toFixed(2)}</span>
                <span class="detail-stat__label">Daily Avg</span>
              </div>
              <div class="detail-stat">
                <span class="detail-stat__value">${cost.daysTracked}</span>
                <span class="detail-stat__label">Days</span>
              </div>
            </div>
            ${serviceEntries.length > 0 ? `
              <div class="cost-service-breakdown">
                ${serviceEntries.map(([svc, cents]) => `
                  <div class="cost-service-row">
                    <span class="cost-service-row__name">${svc.replace(/_/g, ' ')}</span>
                    <span class="cost-service-row__value">$${(cents / 100).toFixed(2)}</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          ` : `<div class="detail-empty">No cost data yet</div>`}
        </div>
      </div>

      <!-- Engagement -->
      <div class="detail-section">
        <div class="detail-section__title">Engagement Mechanics</div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          ${brand.engagement.map(e => {
            const eng = ENGAGEMENT_LABELS[e];
            return `<span class="engagement-tag engagement-tag--${e}" style="font-size: 13px; padding: 4px 12px;">${eng.icon} ${eng.label}</span>`;
          }).join('')}
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

  // ─── Event Binding ──────────────────────────────────
  function bindEvents() {
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

    const overlay = document.getElementById('detail-overlay');
    if (overlay) overlay.addEventListener('click', (e) => {
      if (e.target === overlay) window._roadmapCloseDetail();
    });

    if (platformFilter) platformFilter.value = filters.platform;
    if (engagementFilter) engagementFilter.value = filters.engagement;
    if (statusFilter) statusFilter.value = filters.status;
  }

  // ─── Public API ─────────────────────────────────────
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
