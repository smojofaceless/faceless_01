// =====================================================
// CAMPAIGN TEMPLATES — Save, load, delete templates
// =====================================================

const CampaignTemplates = {

    /** Bind template DOM elements */
    bindElements() {
        const s = CampaignState;
        s.els.templateBar       = document.getElementById('template-bar');
        s.els.templateGrid      = document.getElementById('template-grid');
        s.els.saveTemplateBtn   = document.getElementById('btn-save-template');
    },

    /** Bind template events */
    bindEvents() {
        const s = CampaignState;
        s.els.saveTemplateBtn?.addEventListener('click', () => CampaignTemplates.saveAsTemplate());
        s.els.templateGrid?.addEventListener('click', (e) => {
            const useBtn = e.target.closest('[data-template-use]');
            const delBtn = e.target.closest('[data-template-delete]');
            const editBtn = e.target.closest('[data-template-edit]');
            if (useBtn) CampaignTemplates.applyTemplate(useBtn.dataset.templateUse);
            if (delBtn) CampaignTemplates.deleteTemplate(delBtn.dataset.templateDelete);
            if (editBtn) CampaignTemplates.editTemplate(editBtn.dataset.templateEdit);
        });
    },

    /** Load templates from DB */
    async loadTemplates() {
        if (typeof campaignTemplateService === 'undefined') return;
        try {
            const brandId = CampaignState.currentBrand?.id || null;
            CampaignState._templates = await campaignTemplateService.getTemplates(brandId);
            CampaignTemplates.renderTemplateBar();
        } catch (e) {
            console.error('Failed to load templates:', e);
        }
    },

    /** Render the template bar */
    renderTemplateBar() {
        const grid = CampaignState.els.templateGrid;
        const bar = CampaignState.els.templateBar;
        if (!grid || !bar) return;

        const tpls = CampaignState._templates || [];
        if (tpls.length === 0) {
            bar.classList.add('hidden');
            return;
        }
        bar.classList.remove('hidden');

        const svc = typeof campaignTemplateService !== 'undefined' ? campaignTemplateService : null;

        grid.innerHTML = tpls.map(t => {
            const summary = svc ? svc.configSummary(t.config) : '';
            const isSystem = !t.brand_id;
            const tags = (t.tags || []).slice(0, 3).map(tag =>
                '<span class="cp-tpl-tag">' + tag + '</span>'
            ).join('');

            return '<div class="cp-tpl-card">' +
                '<div class="cp-tpl-card__head">' +
                    '<span class="cp-tpl-card__name">' + t.name + '</span>' +
                    (isSystem ? '<span class="cp-tpl-card__sys">System</span>' : '') +
                '</div>' +
                '<p class="cp-tpl-card__desc">' + (t.description || '') + '</p>' +
                '<div class="cp-tpl-card__summary">' + summary + '</div>' +
                (tags ? '<div class="cp-tpl-card__tags">' + tags + '</div>' : '') +
                '<div class="cp-tpl-card__foot">' +
                    '<button class="btn btn--primary btn--sm" data-template-use="' + t.id + '">Use</button>' +
                    (!isSystem ? '<button class="btn btn--ghost btn--sm" data-template-edit="' + t.id + '" title="Edit">\u270E</button>' : '') +
                    (!isSystem ? '<button class="btn btn--ghost btn--sm btn--danger" data-template-delete="' + t.id + '" title="Delete">\u2715</button>' : '') +
                    '<span class="cp-tpl-card__uses">' + (t.usage_count || 0) + ' uses</span>' +
                '</div>' +
            '</div>';
        }).join('');
    },

    /** Apply template to form */
    async applyTemplate(templateId) {
        const tpl = (CampaignState._templates || []).find(t => t.id === templateId);
        if (!tpl) return;

        CampaignForm.applyConfigToForm(tpl.config);

        if (typeof campaignTemplateService !== 'undefined') {
            await campaignTemplateService.incrementUsage(templateId);
            tpl.usage_count = (tpl.usage_count || 0) + 1;
            CampaignTemplates.renderTemplateBar();
        }
        CampaignForm.showToast('Template "' + tpl.name + '" applied', 'success');
    },

    /** Save current form as template */
    async saveAsTemplate() {
        const config = CampaignForm.getFormConfig();
        const name = prompt('Template name:', '');
        if (!name) return;
        const desc = prompt('Short description (optional):', '') || '';

        try {
            if (typeof campaignTemplateService === 'undefined') throw new Error('Template service not loaded');
            await campaignTemplateService.saveTemplate({
                brandId: CampaignState.currentBrand?.id || null,
                name: name,
                description: desc,
                config: config,
                tags: []
            });
            CampaignForm.showToast('Template saved!', 'success');
            await CampaignTemplates.loadTemplates();
        } catch (e) {
            console.error('saveAsTemplate:', e);
            CampaignForm.showToast('Failed to save template: ' + e.message, 'error');
        }
    },

    /** Edit a custom template */
    async editTemplate(templateId) {
        const tpl = (CampaignState._templates || []).find(t => t.id === templateId);
        if (!tpl) return;

        const newName = prompt('Template name:', tpl.name);
        if (newName === null) return;
        const newDesc = prompt('Description:', tpl.description || '');
        if (newDesc === null) return;

        const updateCfg = confirm('Also update the saved config to match current form settings?');

        try {
            if (typeof campaignTemplateService === 'undefined') throw new Error('Template service not loaded');
            const updates = { name: newName, description: newDesc };
            if (updateCfg) updates.config = CampaignForm.getFormConfig();
            await campaignTemplateService.updateTemplate(templateId, updates);
            CampaignForm.showToast('Template updated', 'success');
            await CampaignTemplates.loadTemplates();
        } catch (e) {
            console.error('editTemplate:', e);
            CampaignForm.showToast('Failed to update template', 'error');
        }
    },

    /** Delete a custom template */
    async deleteTemplate(templateId) {
        if (!confirm('Delete this template?')) return;
        try {
            if (typeof campaignTemplateService === 'undefined') throw new Error('Template service not loaded');
            await campaignTemplateService.deleteTemplate(templateId);
            CampaignForm.showToast('Template deleted', 'info');
            await CampaignTemplates.loadTemplates();
        } catch (e) {
            console.error('deleteTemplate:', e);
            CampaignForm.showToast('Failed to delete template', 'error');
        }
    }
};
