/**
 * Story Debug Panel v1.0
 * 
 * Renders a comprehensive debug view for story generation pipeline.
 * Shows profile resolution, contract compliance, canonicalization,
 * truncation, repair status, and visual readiness analysis.
 * 
 * Usage:
 *   const panel = new StoryDebugPanel(generationDetails, options);
 *   container.appendChild(panel.render());
 * 
 * Toggle: DEBUG_STORY=true in localStorage or ?debug=true in URL
 */

class StoryDebugPanel {
    constructor(generationDetails, options = {}) {
        this.data = generationDetails || {};
        this.storyDebug = this.data.story_debug || null;
        this.visualReadiness = this.data.visual_readiness || null;
        this.storyContract = this.data.story_contract || null;
        this.storyProfile = this.data.story_profile || null;
        this.pipelineMetadata = this.data.pipeline_metadata || null;
        
        this.options = {
            autoExpand: options.autoExpand || false,
            showCopyButtons: options.showCopyButtons !== false,
            ...options
        };
        
        // Check for failure conditions that should auto-expand
        this.hasFailure = this._checkForFailures();
    }
    
    /**
     * Check if debug is enabled via URL param or localStorage
     */
    static isDebugEnabled() {
        // Check URL param
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('debug') === 'true') return true;
        
        // Check localStorage
        try {
            return localStorage.getItem('DEBUG_STORY') === 'true';
        } catch (e) {
            return false;
        }
    }
    
    /**
     * Check for conditions that warrant auto-expansion
     */
    _checkForFailures() {
        if (!this.storyDebug) return false;
        
        const { compliance, method } = this.storyDebug;
        
        // Auto-expand if compliance failed
        if (compliance && !compliance.passed) return true;
        
        // Auto-expand if used legacy fallback
        if (method?.generation_method === 'legacy_fallback') return true;
        
        // Auto-expand if there are hard failures
        if (compliance?.hard_failures?.length > 0) return true;
        
        return false;
    }
    
    /**
     * Get overall status badge
     */
    _getStatusBadge() {
        if (!this.storyDebug?.enabled) {
            return { text: 'NO DATA', class: 'debug-badge--muted', icon: '❓' };
        }
        
        const { compliance, method } = this.storyDebug;
        
        if (method?.generation_method === 'legacy_fallback') {
            return { text: 'LEGACY', class: 'debug-badge--warning', icon: '⚠️' };
        }
        
        if (compliance?.hard_failures?.length > 0) {
            return { text: 'HARD FAIL', class: 'debug-badge--error', icon: '❌' };
        }
        
        if (!compliance?.passed) {
            return { text: 'FAIL', class: 'debug-badge--error', icon: '❌' };
        }
        
        if (method?.generation_method === 'contract_repaired') {
            return { text: 'REPAIRED', class: 'debug-badge--warning', icon: '🔧' };
        }
        
        return { text: 'PASS', class: 'debug-badge--success', icon: '✅' };
    }
    
    /**
     * Render the main panel
     */
    render() {
        const container = document.createElement('div');
        container.className = 'story-debug-panel';
        
        // Check if we have any debug data
        const hasDebugData = this.storyDebug?.enabled || this.storyContract || this.visualReadiness;
        
        if (!hasDebugData) {
            // Show minimal panel when no backend data available
            container.innerHTML = `
                <div class="debug-panel__header" id="debug-panel-header">
                    <div class="debug-panel__title">
                        <span class="debug-panel__icon">🧪</span>
                        <span>Story Debug</span>
                        <span class="debug-badge debug-badge--muted">❓ NO DATA</span>
                    </div>
                    <span class="debug-panel__arrow" id="debug-panel-arrow">▼</span>
                </div>
                <div class="debug-panel__content" id="debug-panel-content" style="display: none;">
                    <div class="debug-section debug-section--muted">
                        <div class="debug-section__header">
                            <span class="debug-section__icon">⚠️</span>
                            <span class="debug-section__title">Backend Debug Data Not Available</span>
                        </div>
                        <div class="debug-section__content">
                            <p class="debug-muted">The story_debug payload wasn't returned from the backend. This could mean:</p>
                            <ul class="debug-list">
                                <li><strong>Legacy generation</strong> - Using vibe_preset other than "urban_legend" (current: ${this._escapeHtml(this.data.vibe_preset || 'unknown')})</li>
                                <li><strong>Backend not deployed</strong> - The updated phases.ts needs to be deployed to Supabase</li>
                                <li><strong>DNA mode disabled</strong> - Set use_dna: true in job meta to enable contract-based generation</li>
                            </ul>
                            <div class="debug-subheader">Available Data</div>
                            <div class="debug-grid">
                                <div class="debug-item">
                                    <span class="debug-label">Generation Method</span>
                                    <span class="debug-value">${this.data.generation_method || 'legacy'}</span>
                                </div>
                                <div class="debug-item">
                                    <span class="debug-label">Vibe Preset</span>
                                    <span class="debug-value">${this.data.vibe_preset || 'unknown'}</span>
                                </div>
                                <div class="debug-item">
                                    <span class="debug-label">Story Contract</span>
                                    <span class="debug-value">${this.storyContract ? '✅ Present' : '❌ Missing'}</span>
                                </div>
                                <div class="debug-item">
                                    <span class="debug-label">Story Profile</span>
                                    <span class="debug-value">${this.storyProfile ? '✅ Present' : '❌ Missing'}</span>
                                </div>
                            </div>
                            <div class="debug-subheader">To Enable Full Debug</div>
                            <ol class="debug-list">
                                <li>Deploy updated backend: <code>supabase functions deploy run-job</code></li>
                                <li>Use DNA generation: Set vibe_preset to "urban_legend" OR enable use_dna in settings</li>
                                <li>Regenerate the story</li>
                            </ol>
                        </div>
                    </div>
                </div>
            `;
            
            // Setup toggle listener
            setTimeout(() => {
                const header = container.querySelector('#debug-panel-header');
                const content = container.querySelector('#debug-panel-content');
                const arrow = container.querySelector('#debug-panel-arrow');
                
                header?.addEventListener('click', () => {
                    const isHidden = content.style.display === 'none';
                    content.style.display = isHidden ? 'block' : 'none';
                    arrow.textContent = isHidden ? '▲' : '▼';
                });
            }, 0);
            
            return container;
        }
        
        const status = this._getStatusBadge();
        const isExpanded = this.hasFailure || this.options.autoExpand;
        
        container.innerHTML = `
            <div class="debug-panel__header" id="debug-panel-header">
                <div class="debug-panel__title">
                    <span class="debug-panel__icon">🧪</span>
                    <span>Story Debug</span>
                    <span class="debug-badge ${status.class}">${status.icon} ${status.text}</span>
                </div>
                <span class="debug-panel__arrow" id="debug-panel-arrow">${isExpanded ? '▲' : '▼'}</span>
            </div>
            <div class="debug-panel__content" id="debug-panel-content" style="display: ${isExpanded ? 'block' : 'none'};">
                ${this._renderProfileSection()}
                ${this._renderContractSection()}
                ${this._renderComplianceSection()}
                ${this._renderMethodSection()}
                ${this._renderFallbackAutopsySection()}
                ${this._renderOutputsSection()}
                ${this._renderVisualReadinessSection()}
                ${this._renderRawJsonSection()}
            </div>
        `;
        
        // Setup toggle listener
        setTimeout(() => {
            const header = container.querySelector('#debug-panel-header');
            const content = container.querySelector('#debug-panel-content');
            const arrow = container.querySelector('#debug-panel-arrow');
            
            header?.addEventListener('click', () => {
                const isHidden = content.style.display === 'none';
                content.style.display = isHidden ? 'block' : 'none';
                arrow.textContent = isHidden ? '▲' : '▼';
            });
        }, 0);
        
        return container;
    }
    
    /**
     * Profile Resolution Section
     */
    _renderProfileSection() {
        const profile = this.storyDebug?.profile;
        if (!profile) {
            return this._renderSection('A. Profile Resolution', '❓', 'No profile data available', 'muted');
        }
        
        const sources = profile.merge_sources || {};
        const sourceFlags = [
            sources.system ? '✅ System' : '',
            sources.template ? '✅ Template' : '',
            sources.preset ? '✅ Preset' : '',
            sources.brand ? '✅ Brand' : '',
            sources.user ? '✅ User' : '',
        ].filter(Boolean).join(' → ');
        
        const kf = profile.key_fields || {};
        
        return this._renderSection('A. Profile Resolution', '📋', `
            <div class="debug-grid">
                <div class="debug-item">
                    <span class="debug-label">Story Mode</span>
                    <span class="debug-value">${profile.story_mode || 'auto'}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Profile Summary</span>
                    <span class="debug-value debug-value--mono">${this._escapeHtml(profile.resolved_profile_summary || 'N/A')}</span>
                </div>
                <div class="debug-item debug-item--full">
                    <span class="debug-label">Merge Sources</span>
                    <span class="debug-value">${sourceFlags || 'Unknown'}</span>
                </div>
            </div>
            <div class="debug-subheader">Key Fields</div>
            <div class="debug-grid debug-grid--dense">
                <div class="debug-item">
                    <span class="debug-label">Output Mode</span>
                    <span class="debug-value debug-chip">${kf.output_mode || 'narrative'}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Beat Count</span>
                    <span class="debug-value">${kf.beat_count || '?'}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Motif Min</span>
                    <span class="debug-value">${kf.motif_min_mentions || '?'}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Motif Escalates</span>
                    <span class="debug-value">${kf.motif_should_escalate ? '✅' : '❌'}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Final Image</span>
                    <span class="debug-value">${kf.enforce_final_image ? '✅ Required' : '❌ Optional'}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Anti-Closure</span>
                    <span class="debug-value">${(kf.anti_closure * 100).toFixed(0)}%</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Era Level</span>
                    <span class="debug-value">${kf.era_level || 'name_only'}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Word Target</span>
                    <span class="debug-value">${kf.word_target || '?'}±${kf.word_variance || '?'}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Allow Fallback</span>
                    <span class="debug-value">${kf.allow_legacy_fallback ? '✅' : '❌'}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Repair Temp</span>
                    <span class="debug-value">${kf.repair_temperature || 0.15}</span>
                </div>
            </div>
            ${kf.beat_labels?.length ? `
            <div class="debug-subheader">Beat Labels</div>
            <div class="debug-tags">
                ${kf.beat_labels.map((label, i) => `<span class="debug-tag">[BEAT_${i + 1}:${label}]</span>`).join('')}
            </div>
            ` : ''}
        `, 'info');
    }
    
    /**
     * Contract + Canonicalization Section
     */
    _renderContractSection() {
        const contract = this.storyDebug?.contract;
        const canon = this.storyDebug?.canonicalization;
        const trunc = this.storyDebug?.truncation;
        
        if (!contract && !canon) {
            return this._renderSection('B. Contract + Canonicalization', '📜', 'No contract data available', 'muted');
        }
        
        const beatsMatch = contract?.beats_expected === contract?.beats_found;
        
        return this._renderSection('B. Contract + Canonicalization', '📜', `
            <div class="debug-grid">
                <div class="debug-item debug-item--full">
                    <span class="debug-label">Contract Summary</span>
                    <span class="debug-value debug-value--mono">${this._escapeHtml(contract?.contract_summary || 'N/A')}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Beats Expected</span>
                    <span class="debug-value">${contract?.beats_expected || '?'}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Beats Found</span>
                    <span class="debug-value ${beatsMatch ? '' : 'debug-value--error'}">${contract?.beats_found || '?'} ${beatsMatch ? '✅' : '❌'}</span>
                </div>
            </div>
            
            ${canon ? `
            <div class="debug-subheader">Canonicalization</div>
            <div class="debug-grid">
                <div class="debug-item">
                    <span class="debug-label">Changed</span>
                    <span class="debug-value">${canon.changed ? '✅ Yes' : '❌ No'}</span>
                </div>
                ${canon.notes?.length ? `
                <div class="debug-item debug-item--full">
                    <span class="debug-label">Notes</span>
                    <ul class="debug-list">
                        ${canon.notes.map(n => `<li>${this._escapeHtml(n)}</li>`).join('')}
                    </ul>
                </div>
                ` : ''}
            </div>
            ` : ''}
            
            ${trunc ? `
            <div class="debug-subheader">Truncation</div>
            <div class="debug-grid">
                <div class="debug-item">
                    <span class="debug-label">Truncated</span>
                    <span class="debug-value ${trunc.truncated ? 'debug-value--warning' : ''}">${trunc.truncated ? '✅ Yes' : '❌ No'}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Original Words</span>
                    <span class="debug-value">${trunc.original_word_count || '?'}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Final Words</span>
                    <span class="debug-value">${trunc.final_word_count || '?'}</span>
                </div>
            </div>
            ` : ''}
        `, contract?.beats_expected === contract?.beats_found ? 'success' : 'warning');
    }
    
    /**
     * Compliance / Repair / Method Section
     */
    _renderComplianceSection() {
        const compliance = this.storyDebug?.compliance;
        
        if (!compliance) {
            return this._renderSection('C. Compliance', '📊', 'No compliance data (legacy generation)', 'muted');
        }
        
        const scoreClass = compliance.score >= 80 ? 'success' : compliance.score >= 50 ? 'warning' : 'error';
        
        return this._renderSection('C. Compliance', '📊', `
            <div class="debug-grid">
                <div class="debug-item">
                    <span class="debug-label">Score</span>
                    <span class="debug-value debug-value--large debug-value--${scoreClass}">${compliance.score}/100</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Passed</span>
                    <span class="debug-value">${compliance.passed ? '✅ Yes' : '❌ No'}</span>
                </div>
            </div>
            
            ${compliance.hard_failures?.length ? `
            <div class="debug-subheader debug-subheader--error">⚠️ Hard Failures</div>
            <div class="debug-tags debug-tags--error">
                ${compliance.hard_failures.map(f => `<span class="debug-tag debug-tag--error">${this._escapeHtml(f)}</span>`).join('')}
            </div>
            ` : ''}
            
            ${compliance.issues?.length ? `
            <div class="debug-subheader">Issues/Warnings</div>
            <table class="debug-table">
                <thead>
                    <tr><th>Type</th><th>Severity</th><th>Message</th></tr>
                </thead>
                <tbody>
                    ${compliance.issues.map(issue => `
                    <tr class="debug-table__row--${issue.severity}">
                        <td>${issue.type}</td>
                        <td><span class="debug-chip debug-chip--${issue.severity}">${issue.severity}</span></td>
                        <td>${this._escapeHtml(issue.message)}</td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
            ` : '<p class="debug-muted">No issues found</p>'}
            
            <div class="debug-subheader">Metrics</div>
            <div class="debug-grid debug-grid--dense">
                <div class="debug-item">
                    <span class="debug-label">Word Count</span>
                    <span class="debug-value">${compliance.metrics?.word_count || '?'}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Beat Count</span>
                    <span class="debug-value">${compliance.metrics?.beat_count || '?'}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Motif Mentions</span>
                    <span class="debug-value">${compliance.metrics?.motif_mentions || '?'}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Has Final Image</span>
                    <span class="debug-value">${compliance.metrics?.has_final_image ? '✅' : '❌'}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Grounding Details</span>
                    <span class="debug-value">${compliance.metrics?.grounding_details || '?'}</span>
                </div>
            </div>
        `, scoreClass);
    }
    
    /**
     * Method Section
     */
    _renderMethodSection() {
        const method = this.storyDebug?.method;
        
        if (!method) {
            return '';
        }
        
        const methodLabels = {
            'contract': { text: 'Contract', class: 'success', desc: 'First attempt passed' },
            'contract_repaired': { text: 'Contract (Repaired)', class: 'warning', desc: 'Fixed via repair pass' },
            'legacy_fallback': { text: 'Legacy Fallback', class: 'error', desc: 'Used fallback generation' }
        };
        
        const info = methodLabels[method.generation_method] || { text: method.generation_method, class: 'muted', desc: '' };
        
        return this._renderSection('D. Generation Method', '⚙️', `
            <div class="debug-grid">
                <div class="debug-item">
                    <span class="debug-label">Method</span>
                    <span class="debug-value debug-chip debug-chip--${info.class}">${info.text}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Description</span>
                    <span class="debug-value">${info.desc}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Repair Attempted</span>
                    <span class="debug-value">${method.repair_attempted ? '✅' : '❌'}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Repair Succeeded</span>
                    <span class="debug-value">${method.repair_succeeded ? '✅' : '❌'}</span>
                </div>
            </div>
        `, info.class);
    }
    
    /**
     * Fallback Autopsy Section v2.1
     * Shows detailed diagnostics when legacy fallback was triggered
     */
    _renderFallbackAutopsySection() {
        const autopsy = this.storyDebug?.fallback_autopsy;
        const method = this.storyDebug?.method;
        
        // Only show if fallback was triggered or we have autopsy data
        if (!autopsy?.triggered && method?.generation_method !== 'legacy_fallback') {
            return '';
        }
        
        const reason = autopsy?.reason || 'unknown';
        const error = autopsy?.error;
        const attempts = autopsy?.contract_attempts || [];
        const bestAttempt = autopsy?.best_contract_attempt;
        
        // Reason descriptions
        const reasonDescriptions = {
            'contract_exception': 'Exception during contract generation',
            'missing_beats': 'Story missing required beat tags',
            'beat_tag_mismatch': 'Wrong number of beats generated',
            'word_count_out_of_range': 'Word count exceeded limits',
            'unique_element_below_min': 'Unique element not mentioned enough',
            'grounding_missing_beats': 'Missing grounding details in beats',
            'motif_below_min': 'Motif not mentioned enough times',
            'repair_failed': 'All repair attempts failed',
            'unknown': 'Unknown failure reason'
        };
        
        return this._renderSection('⚠️ Fallback Autopsy', '🔍', `
            <div class="debug-alert debug-alert--error">
                <strong>Legacy Fallback Triggered</strong><br>
                The contract-based generation failed and fell back to legacy prompt.
            </div>
            
            <div class="debug-grid">
                <div class="debug-item">
                    <span class="debug-label">Fallback Reason</span>
                    <span class="debug-value debug-chip debug-chip--error">${reason}</span>
                </div>
                <div class="debug-item debug-item--full">
                    <span class="debug-label">Description</span>
                    <span class="debug-value">${reasonDescriptions[reason] || reason}</span>
                </div>
            </div>
            
            ${error ? `
            <div class="debug-subheader debug-subheader--error">Error Details</div>
            <div class="debug-grid">
                <div class="debug-item">
                    <span class="debug-label">Stage</span>
                    <span class="debug-value debug-chip">${error.stage}</span>
                </div>
                <div class="debug-item debug-item--full">
                    <span class="debug-label">Message</span>
                    <span class="debug-value debug-value--mono">${this._escapeHtml(error.message)}</span>
                </div>
                ${error.stack ? `
                <div class="debug-item debug-item--full">
                    <span class="debug-label">Stack</span>
                    <pre class="debug-code debug-code--sm">${this._escapeHtml(error.stack.slice(0, 500))}</pre>
                </div>
                ` : ''}
            </div>
            ` : ''}
            
            ${attempts.length > 0 ? `
            <div class="debug-subheader">Contract Attempts (${attempts.length})</div>
            <table class="debug-table debug-table--compact">
                <thead>
                    <tr>
                        <th>Stage</th>
                        <th>Words</th>
                        <th>Score</th>
                        <th>Beat Tags</th>
                        <th>Hard Failures</th>
                    </tr>
                </thead>
                <tbody>
                    ${attempts.map(a => `
                    <tr>
                        <td><span class="debug-chip debug-chip--${a.compliance_score >= 70 ? 'success' : 'warning'}">${a.stage}</span></td>
                        <td>${a.word_count}</td>
                        <td>${a.compliance_score ?? '?'}</td>
                        <td>${a.had_tags ? '✅' : '❌'}</td>
                        <td>${a.hard_failures?.length || 0}</td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
            ` : '<p class="debug-muted">No attempt data available</p>'}
            
            ${bestAttempt ? `
            <div class="debug-subheader">Best Contract Attempt Preserved</div>
            <div class="debug-grid">
                <div class="debug-item">
                    <span class="debug-label">Had Beat Tags</span>
                    <span class="debug-value">${bestAttempt.had_beat_tags ? '✅ Yes' : '❌ No'}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Beat Count</span>
                    <span class="debug-value">${bestAttempt.beat_count || 0}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Word Count</span>
                    <span class="debug-value">${bestAttempt.word_count || '?'}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Compliance Score</span>
                    <span class="debug-value">${bestAttempt.compliance_score ?? '?'}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Compliance Passed</span>
                    <span class="debug-value">${bestAttempt.compliance_passed ? '✅' : '❌'}</span>
                </div>
            </div>
            ${bestAttempt.raw_with_tags ? `
            <div class="debug-subheader">Best Attempt Raw Text (with tags)</div>
            <pre class="debug-code debug-code--sm">${this._escapeHtml(bestAttempt.raw_with_tags.slice(0, 1000))}${bestAttempt.raw_with_tags.length > 1000 ? '...' : ''}</pre>
            ` : ''}
            ` : '<p class="debug-muted">No best attempt preserved</p>'}
        `, 'error');
    }
    
    /**
     * Story Outputs Section
     */
    _renderOutputsSection() {
        const output = this.storyDebug?.output;
        
        if (!output) {
            return '';
        }
        
        return this._renderSection('E. Story Outputs', '📝', `
            <div class="debug-tabs" id="output-tabs">
                <button class="debug-tab debug-tab--active" data-tab="raw">Raw (with tags)</button>
                <button class="debug-tab" data-tab="canonical">Canonical (with tags)</button>
                <button class="debug-tab" data-tab="stripped">Stripped (TTS)</button>
            </div>
            <div class="debug-tab-content" id="output-content">
                <div class="debug-tab-pane debug-tab-pane--active" data-pane="raw">
                    <pre class="debug-code">${this._escapeHtml(output.raw_with_tags || 'N/A')}</pre>
                    <button class="btn btn--sm btn--outline debug-copy-btn" data-copy="raw_with_tags">📋 Copy</button>
                </div>
                <div class="debug-tab-pane" data-pane="canonical">
                    <pre class="debug-code">${this._escapeHtml(output.canonical_with_tags || 'N/A')}</pre>
                    <button class="btn btn--sm btn--outline debug-copy-btn" data-copy="canonical_with_tags">📋 Copy</button>
                </div>
                <div class="debug-tab-pane" data-pane="stripped">
                    <pre class="debug-code">${this._escapeHtml(output.stripped_for_tts || 'N/A')}</pre>
                    <button class="btn btn--sm btn--outline debug-copy-btn" data-copy="stripped_for_tts">📋 Copy</button>
                </div>
            </div>
        `, 'info', true);
    }
    
    /**
     * Visual Readiness Section v2.0
     * Shows per-beat analysis with flags and grounding counts
     * v2.1: Shows grounding source (compliance vs local), blocking vs non-blocking
     */
    _renderVisualReadinessSection() {
        const vr = this.visualReadiness;
        
        if (!vr) {
            return this._renderSection('F. Visual Readiness', '🎬', 'No visual readiness data available', 'muted');
        }
        
        // v2.1 uses: ok/warning/fail, per_beat, overall_should_block, severity_config
        // v2.0 uses: ok/warning/fail and per_beat
        // Legacy uses: ready/warning/error and scenes
        const isV21 = vr.version === '2.1';
        const isV2 = vr.version === '2.0' || vr.version === '2.1' || vr.per_beat;
        
        // Map severity/flag to icons and classes
        const severityIcons = { ok: '✅', warning: '⚠️', fail: '❌', ready: '✅', error: '❌' };
        const severityClasses = { ok: 'success', warning: 'warning', fail: 'error', ready: 'success', error: 'error' };
        
        // Get overall status
        const overall = isV2 ? (vr.overall || 'ok') : (vr.overall_flag || 'ready');
        const overallClass = severityClasses[overall] || 'muted';
        const overallIcon = severityIcons[overall] || '❓';
        
        // v2.1: Check if issues are blocking
        const overallShouldBlock = vr.overall_should_block ?? (overall === 'fail');
        const blockingLabel = overallShouldBlock ? '🚫 BLOCKING' : '✅ Non-blocking';
        const blockingClass = overallShouldBlock ? 'error' : 'success';
        
        // Get counts - handle both v2.0 and legacy formats
        const okCount = vr.ok_count ?? vr.ready_count ?? 0;
        const warnCount = vr.warn_count ?? vr.warning_count ?? 0;
        const failCount = vr.fail_count ?? vr.error_count ?? 0;
        const totalBeats = vr.total_beats ?? vr.total_scenes ?? 0;
        
        // Get beat data - v2.0 uses per_beat, legacy uses scenes
        const beats = vr.per_beat || vr.scenes || [];
        
        // Check for beat count mismatch with contract
        const contractBeatsExpected = this.storyDebug?.contract?.beats_expected || 0;
        const hasBeatMismatch = contractBeatsExpected > 0 && totalBeats !== contractBeatsExpected;
        const inputSource = vr.input_source || 'unknown';
        const hasBeatTags = vr.has_beat_tags ?? null;
        
        // v2.1: Grounding source tracking
        const usedComplianceGrounding = vr.used_compliance_grounding ?? false;
        const groundingSourceLabel = usedComplianceGrounding ? '📊 Compliance' : '🔍 Local detection';
        
        // v2.1: Severity config display
        const severityConfig = vr.severity_config || null;
        const severityConfigDisplay = severityConfig ? `
            <div class="debug-item debug-item--full">
                <span class="debug-label">Severity Rules</span>
                <span class="debug-value debug-value--sm">
                    Grounding: ${severityConfig.failOnMissingGrounding ? '❌ Fail' : severityConfig.warnOnMissingGrounding ? '⚠️ Warn' : '✅ OK'} | 
                    Environment: ${severityConfig.failOnMissingEnvironment ? '❌ Fail' : severityConfig.warnOnMissingEnvironment ? '⚠️ Warn' : '✅ OK'} | 
                    Abstract: ${severityConfig.failOnAbstract ? '❌ Fail' : '✅ OK'} | 
                    Min Score: ${severityConfig.minScoreForReady}
                </span>
            </div>
        ` : '';
        
        // Build mismatch warning if needed
        const mismatchWarning = hasBeatMismatch 
            ? `<div class="debug-alert debug-alert--error">
                ⚠️ <strong>Beat count mismatch:</strong> Visual readiness analyzed ${totalBeats} beat(s) but contract expects ${contractBeatsExpected}. 
                ${inputSource === 'stripped' ? 'Input appears to be stripped text without beat tags!' : ''}
                ${hasBeatTags === false ? 'No beat tags detected in input.' : ''}
               </div>`
            : '';
        
        return this._renderSection('F. Visual Readiness', '🎬', `
            ${mismatchWarning}
            <div class="debug-grid">
                <div class="debug-item">
                    <span class="debug-label">Overall</span>
                    <span class="debug-value debug-chip debug-chip--${overallClass}">${overallIcon} ${overall.toUpperCase()}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Blocking</span>
                    <span class="debug-value debug-chip debug-chip--${blockingClass}">${blockingLabel}</span>
                </div>
                <div class="debug-item debug-item--full">
                    <span class="debug-label">Summary</span>
                    <span class="debug-value">${this._escapeHtml(vr.summary || '')}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Beats Analyzed</span>
                    <span class="debug-value ${hasBeatMismatch ? 'debug-value--error' : ''}">${okCount}✅ ${warnCount}⚠️ ${failCount}❌ / ${totalBeats} ${hasBeatMismatch ? `(expected ${contractBeatsExpected})` : ''}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Input Source</span>
                    <span class="debug-value debug-chip ${inputSource === 'stripped' || inputSource === 'unknown' ? 'debug-chip--warning' : 'debug-chip--success'}">${inputSource}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Grounding Source</span>
                    <span class="debug-value debug-chip ${usedComplianceGrounding ? 'debug-chip--success' : 'debug-chip--muted'}">${groundingSourceLabel}</span>
                </div>
                <div class="debug-item">
                    <span class="debug-label">Has Beat Tags</span>
                    <span class="debug-value">${hasBeatTags === true ? '✅ Yes' : hasBeatTags === false ? '❌ No' : '❓ Unknown'}</span>
                </div>
                ${severityConfigDisplay}
            </div>
            
            <div class="debug-subheader">Per-Beat Breakdown</div>
            <table class="debug-table debug-table--compact">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Beat Label</th>
                        <th>Status</th>
                        <th>Block</th>
                        <th>Score</th>
                        <th>Grounding</th>
                        <th>Environment</th>
                        <th>Visual Nouns</th>
                        <th>Flags/Reasons</th>
                    </tr>
                </thead>
                <tbody>
                    ${beats.map(beat => {
                        // Handle both v2.0 and legacy field names
                        const beatNum = beat.beat_number ?? (beat.index + 1) ?? '?';
                        const beatLabel = beat.beat_label || '-';
                        const severity = beat.severity || beat.renderability || 'ok';
                        const severityIcon = severityIcons[severity] || '❓';
                        const severityClass = severityClasses[severity] || 'muted';
                        const score = beat.score !== undefined ? beat.score : '-';
                        const grounding = beat.grounding_count !== undefined ? beat.grounding_count : '-';
                        
                        // v2.1: Grounding source per beat
                        const groundingSrc = beat.grounding_source || 'local';
                        const groundingIcon = groundingSrc === 'compliance' ? '📊' : '🔍';
                        
                        // v2.1: Should block flag
                        const shouldBlock = beat.should_block ?? (severity === 'fail');
                        const blockIcon = shouldBlock ? '🚫' : '✅';
                        
                        // Environment tokens (v2.0) or environment_keywords (legacy)
                        const envTokens = beat.environment_tokens || beat.environment_keywords || [];
                        
                        // Visual nouns
                        const visualNouns = beat.visual_nouns || [];
                        
                        // Flags (v2.0) or reasons (legacy)
                        const flags = beat.flags || [];
                        const reasons = beat.reasons || [];
                        const flagsDisplay = flags.length > 0 
                            ? flags.map(f => `<span class="debug-tag debug-tag--${severityClass}">${f}</span>`).join(' ')
                            : reasons.slice(0, 2).join('; ') || '-';
                        
                        // Grounding status - highlight if 0
                        const groundingClass = grounding === 0 ? 'debug-value--error' : '';
                        
                        return `
                        <tr class="debug-table__row--${severityClass}">
                            <td>${beatNum}</td>
                            <td><strong>${this._escapeHtml(beatLabel)}</strong></td>
                            <td>${severityIcon}</td>
                            <td>${blockIcon}</td>
                            <td>${score}</td>
                            <td class="${groundingClass}">${groundingIcon}${grounding}</td>
                            <td class="debug-td--wrap">${envTokens.slice(0, 3).join(', ') || '<span class="debug-muted">none</span>'}</td>
                            <td class="debug-td--wrap">${visualNouns.slice(0, 4).join(', ') || '<span class="debug-muted">none</span>'}</td>
                            <td class="debug-td--wrap">${flagsDisplay}</td>
                        </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
            
            ${beats.some(b => b.action_verbs?.length > 0) ? `
            <div class="debug-subheader">Action Verbs Detected</div>
            <div class="debug-grid debug-grid--dense">
                ${beats.map(beat => {
                    const beatNum = beat.beat_number ?? (beat.index + 1) ?? '?';
                    const actions = beat.action_verbs || [];
                    if (actions.length === 0) return '';
                    return `
                    <div class="debug-item">
                        <span class="debug-label">Beat ${beatNum}</span>
                        <span class="debug-value">${actions.slice(0, 5).join(', ')}</span>
                    </div>
                    `;
                }).join('')}
            </div>
            ` : ''}
        `, overallClass);
    }
    
    /**
     * Raw JSON Section (collapsed)
     */
    _renderRawJsonSection() {
        if (!this.options.showCopyButtons) return '';
        
        return `
            <div class="debug-section debug-section--collapsible">
                <div class="debug-section__header" id="json-section-header">
                    <span class="debug-section__icon">🔧</span>
                    <span class="debug-section__title">Raw JSON</span>
                    <span class="debug-section__arrow" id="json-section-arrow">▼</span>
                </div>
                <div class="debug-section__content" id="json-section-content" style="display: none;">
                    <pre class="debug-code debug-code--small">${this._escapeHtml(JSON.stringify(this.storyDebug, null, 2))}</pre>
                    <button class="btn btn--sm btn--outline debug-copy-btn" id="copy-full-json">📋 Copy Full JSON</button>
                </div>
            </div>
        `;
    }
    
    /**
     * Render a section with consistent styling
     */
    _renderSection(title, icon, content, statusClass = 'info', hasTabs = false) {
        return `
            <div class="debug-section debug-section--${statusClass}">
                <div class="debug-section__header">
                    <span class="debug-section__icon">${icon}</span>
                    <span class="debug-section__title">${title}</span>
                </div>
                <div class="debug-section__content ${hasTabs ? 'debug-section__content--tabs' : ''}">
                    ${content}
                </div>
            </div>
        `;
    }
    
    /**
     * Escape HTML for safe rendering
     */
    _escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
    
    /**
     * Setup interactive elements (tabs, copy buttons)
     * Call after appending to DOM
     */
    setupInteractivity() {
        // Tab switching
        document.querySelectorAll('.debug-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const tabId = e.target.dataset.tab;
                const tabGroup = e.target.closest('.debug-tabs');
                const contentArea = tabGroup?.nextElementSibling;
                
                // Update active tab
                tabGroup?.querySelectorAll('.debug-tab').forEach(t => t.classList.remove('debug-tab--active'));
                e.target.classList.add('debug-tab--active');
                
                // Update visible pane
                contentArea?.querySelectorAll('.debug-tab-pane').forEach(pane => {
                    pane.classList.toggle('debug-tab-pane--active', pane.dataset.pane === tabId);
                });
            });
        });
        
        // Copy buttons
        document.querySelectorAll('.debug-copy-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const key = e.target.dataset.copy;
                let text = '';
                
                if (key === 'full_json') {
                    text = JSON.stringify(this.storyDebug, null, 2);
                } else if (this.storyDebug?.output?.[key]) {
                    text = this.storyDebug.output[key];
                }
                
                if (text) {
                    navigator.clipboard.writeText(text).then(() => {
                        const originalText = e.target.textContent;
                        e.target.textContent = '✅ Copied!';
                        setTimeout(() => { e.target.textContent = originalText; }, 1500);
                    }).catch(err => {
                        console.error('Copy failed:', err);
                    });
                }
            });
        });
        
        // JSON section toggle
        const jsonHeader = document.getElementById('json-section-header');
        const jsonContent = document.getElementById('json-section-content');
        const jsonArrow = document.getElementById('json-section-arrow');
        
        jsonHeader?.addEventListener('click', () => {
            const isHidden = jsonContent.style.display === 'none';
            jsonContent.style.display = isHidden ? 'block' : 'none';
            jsonArrow.textContent = isHidden ? '▲' : '▼';
        });
        
        // Full JSON copy
        document.getElementById('copy-full-json')?.addEventListener('click', () => {
            const text = JSON.stringify(this.storyDebug, null, 2);
            navigator.clipboard.writeText(text).then(() => {
                const btn = document.getElementById('copy-full-json');
                if (btn) {
                    const originalText = btn.textContent;
                    btn.textContent = '✅ Copied!';
                    setTimeout(() => { btn.textContent = originalText; }, 1500);
                }
            });
        });
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StoryDebugPanel;
}

// Also attach to window for browser use
if (typeof window !== 'undefined') {
    window.StoryDebugPanel = StoryDebugPanel;
}
