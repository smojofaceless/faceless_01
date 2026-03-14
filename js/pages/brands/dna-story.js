// DNA/story system, test story generation, uniqueness dashboard
// Extracted from brands.html inline script

const DNA_DIMENSIONS = {
    era: { label: '⏰ Era', options: [
        { key: '1940s_postwar', label: 'Late 1940s' }, { key: '1950s_atomic', label: 'Mid-1950s' },
        { key: '1950s_late', label: 'Late 1950s' }, { key: '1960s_early', label: 'Early 1960s' },
        { key: '1960s_late', label: 'Late 1960s' }, { key: '1970s_early', label: 'Early 1970s' },
        { key: '1970s_late', label: 'Late 1970s' }, { key: '1980s_early', label: 'Early 1980s' },
        { key: '1980s_late', label: 'Late 1980s' }, { key: '1990s_early', label: 'Early 1990s' },
        { key: '1990s_late', label: 'Late 1990s' }, { key: '2000s_early', label: 'Early 2000s' },
    ]},
    location: { label: '📍 Location', options: [
        { key: 'rural_highway', label: 'Rural highways' }, { key: 'forest_trail', label: 'Forest trails' },
        { key: 'coastal_town', label: 'Coastal towns' }, { key: 'desert_highway', label: 'Desert stretches' },
        { key: 'mountain_roads', label: 'Mountain roads' }, { key: 'midwest_farmland', label: 'Midwest farmland' },
        { key: 'swamp_bayou', label: 'Southern swamps' }, { key: 'industrial_ruins', label: 'Industrial ruins' },
        { key: 'small_towns', label: 'Small towns' }, { key: 'suburban_sprawl', label: 'Suburban developments' },
        { key: 'college_campus', label: 'College campuses' }, { key: 'national_parks', label: 'National parks' },
        { key: 'border_towns', label: 'Border towns' }, { key: 'mining_towns', label: 'Mining towns' },
        { key: 'lakeside_cabins', label: 'Lakeside areas' },
    ]},
    subgenre: { label: '📰 Format', options: [
        { key: 'urban_legend', label: 'Urban legend' }, { key: 'true_crime', label: 'Faux true-crime' },
        { key: 'witness_account', label: 'Witness compilation' }, { key: 'found_document', label: 'Found document' },
        { key: 'broadcast_interruption', label: 'Broadcast incident' }, { key: 'missing_persons', label: 'Missing persons case' },
        { key: 'government_coverup', label: 'Government coverup' }, { key: 'recurring_phenomenon', label: 'Recurring phenomenon' },
        { key: 'local_folklore', label: 'Local folklore' }, { key: 'investigation_closed', label: 'Closed investigation' },
    ]},
    narrative_artifact: { label: '📜 Narrative Voice', options: [
        { key: 'police_memo', label: 'Archived police memo' }, { key: 'newspaper_recap', label: 'Local newspaper recap' },
        { key: 'research_footnote', label: 'Research paper footnote' }, { key: 'witness_interview', label: 'Witness interview summary' },
        { key: 'agency_report', label: 'Internal agency report' }, { key: 'radio_transcript', label: 'Radio broadcast transcript' },
        { key: 'forum_post', label: 'Archived forum post' }, { key: 'documentary_narration', label: 'Documentary narration' },
        { key: 'oral_history', label: 'Oral history compilation' }, { key: 'deathbed_confession', label: 'Deathbed testimony' },
    ]},
    threat_behavior: { label: '👁️ Threat Behavior', options: [
        { key: 'watching', label: 'Watching' }, { key: 'following', label: 'Following' },
        { key: 'appearing', label: 'Appearing' }, { key: 'calling', label: 'Calling' },
        { key: 'signaling', label: 'Signaling' }, { key: 'waiting', label: 'Waiting' },
        { key: 'mimicking', label: 'Mimicking' }, { key: 'gathering', label: 'Gathering' },
        { key: 'retreating', label: 'Retreating' }, { key: 'broadcasting', label: 'Broadcasting' },
    ]},
    threat_manifestation: { label: '👤 Threat Form', options: [
        { key: 'humanoid_tall', label: 'Tall humanoid' }, { key: 'humanoid_faceless', label: 'Faceless figure' },
        { key: 'humanoid_dated', label: 'Anachronistic figure' }, { key: 'vehicle_black', label: 'Black vehicle' },
        { key: 'light_geometric', label: 'Geometric lights' }, { key: 'sound_pattern', label: 'Repeating sound' },
        { key: 'reflection', label: 'Wrong reflection' }, { key: 'shadow_independent', label: 'Independent shadow' },
        { key: 'distortion_visual', label: 'Visual distortion' }, { key: 'animal_wrong', label: 'Wrong animals' },
        { key: 'object_appearing', label: 'Appearing objects' }, { key: 'environmental', label: 'Environmental anomaly' },
    ]},
    repeating_detail: { label: '🔄 Repeating Detail', options: [
        { key: 'face_covered', label: 'Face obscured by pale cloth' }, { key: 'face_blank', label: 'Featureless smooth face' },
        { key: 'face_too_wide', label: 'Smile stretched too wide' }, { key: 'eyes_wrong', label: 'Eyes reflecting nonexistent light' },
        { key: 'eyes_black', label: 'Entirely black eyes' },
        { key: 'posture_still', label: 'Standing perfectly still' }, { key: 'posture_tilted', label: 'Head always tilted unnaturally' },
        { key: 'movement_wrong', label: 'Joints bending backwards' }, { key: 'movement_stop', label: 'Freezing when observed' },
        { key: 'clothing_dated', label: 'Clothes from wrong decade' }, { key: 'clothing_wet', label: 'Always dripping wet' },
        { key: 'appearance_faded', label: 'Colors washed out like old photo' },
        { key: 'env_cold', label: 'Temperature drops sharply' }, { key: 'env_smell', label: 'Smell of ozone and copper' },
        { key: 'env_static', label: 'All radios fill with static' }, { key: 'env_animals', label: 'Dogs refuse to go near' },
    ]},
    weird_axis: { label: '❓ Weird Axis', options: [
        { key: 'distance_constant', label: 'Maintains exact same distance always' }, { key: 'photos_closer', label: 'Closer in photos than in person' },
        { key: 'memories_fade', label: 'Witnesses forget details, only fear remains' }, { key: 'maps_wrong', label: 'Location can\'t be found on any map' },
        { key: 'time_wrong', label: 'Clocks show different times for nearby people' }, { key: 'direction_wrong', label: 'Every compass points to same coordinates' },
        { key: 'counting_wrong', label: 'Always one more person than there should be' }, { key: 'sound_delayed', label: 'Sounds arrive seconds late' },
        { key: 'shadow_independent', label: 'Shadow moves independently' }, { key: 'reflection_delayed', label: 'Reflection appears moments late' },
        { key: 'names_forgotten', label: 'No one remembers names of the missing' }, { key: 'roads_change', label: 'Road doesn\'t exist the next day' },
        { key: 'photos_show_more', label: 'Photos show things not seen in person' }, { key: 'radio_predicts', label: 'Radio describes events before they happen' },
        { key: 'children_remember', label: 'Only children can see it clearly' }, { key: 'writing_appears', label: 'Same message in window condensation' },
        { key: 'electronics_fail', label: 'Electronics die in specific radius' }, { key: 'dreams_shared', label: 'Everyone reports the same dream' },
        { key: 'photos_change', label: 'Face appears in old photos where none was' }, { key: 'voices_recorded', label: 'Recordings contain unheard voices' },
    ]},
    escalation: { label: '📈 Escalation', options: [
        { key: 'sightings_to_missing', label: 'Sightings → disappearances' }, { key: 'one_to_many', label: 'One witness → many' },
        { key: 'distant_to_close', label: 'Distant → close' }, { key: 'night_to_day', label: 'Night only → daylight' },
        { key: 'rural_to_urban', label: 'Rural → urban' }, { key: 'passive_to_active', label: 'Passive → active' },
        { key: 'individual_to_group', label: 'Individuals → groups' }, { key: 'physical_to_psychological', label: 'Physical → psychological' },
    ]},
    authority: { label: '🏛️ Authority Response', options: [
        { key: 'files_lost', label: 'Files lost' }, { key: 'dismissed', label: 'Dismissed reports' },
        { key: 'active_coverup', label: 'Active coverup' }, { key: 'investigation_closed', label: 'Investigation quietly closed' },
        { key: 'witnesses_silenced', label: 'Witnesses relocated' }, { key: 'official_denial', label: 'Official denial' },
        { key: 'media_blackout', label: 'Media blackout' }, { key: 'alternative_explanation', label: 'Alternative explanation given' },
    ]},
    ending_knowledge: { label: '🔚 Ending', options: [
        { key: 'unresolved', label: 'Unresolved' }, { key: 'suppressed', label: 'Suppressed' },
        { key: 'forgotten', label: 'Forgotten' }, { key: 'ongoing', label: 'Ongoing' },
        { key: 'inherited', label: 'Inherited' }, { key: 'cyclical', label: 'Cyclical' },
        { key: 'partial', label: 'Partially explained' }, { key: 'denied', label: 'Officially denied' },
    ]},
    ending_imagery: { label: '🖼️ Final Image', options: [
        { key: 'watching_treeline', label: 'Figure at treeline' }, { key: 'empty_road', label: 'Empty road' },
        { key: 'silent_recording', label: 'Silent recording' }, { key: 'coordinates_appearing', label: 'Coordinates appearing' },
        { key: 'sealed_files', label: 'Sealed files' }, { key: 'children_dreaming', label: 'Children dreaming' },
        { key: 'photograph_changing', label: 'Photograph changing' }, { key: 'fog_rolling', label: 'Fog rolling in' },
        { key: 'lights_distant', label: 'Distant lights' }, { key: 'message_reappearing', label: 'Message reappearing' },
    ]},
    emotion: { label: '💭 Emotional Aftertaste', options: [
        { key: 'unease', label: 'Lingering unease' }, { key: 'dread', label: 'Slow-building dread' },
        { key: 'paranoia', label: 'Paranoia' }, { key: 'isolation', label: 'Profound isolation' },
        { key: 'insignificance', label: 'Cosmic insignificance' }, { key: 'wrongness', label: 'Fundamental wrongness' },
        { key: 'recognition', label: 'Uncomfortable recognition' }, { key: 'curiosity_fear', label: 'Morbid curiosity mixed with fear' },
    ]},
};

// US state pools by location (abbreviated)
const LOCATION_STATES = {
    rural_highway: ['Texas', 'Oklahoma', 'Kansas', 'Nebraska', 'Iowa'],
    forest_trail: ['Oregon', 'Washington', 'Vermont', 'Maine', 'West Virginia'],
    coastal_town: ['Maine', 'Massachusetts', 'North Carolina', 'Florida', 'California'],
    desert_highway: ['Nevada', 'Arizona', 'New Mexico', 'Utah', 'West Texas'],
    mountain_roads: ['Colorado', 'Montana', 'Wyoming', 'West Virginia', 'Alaska'],
    midwest_farmland: ['Iowa', 'Indiana', 'Illinois', 'Ohio', 'Wisconsin'],
    swamp_bayou: ['Louisiana', 'Mississippi', 'Alabama', 'Georgia', 'South Carolina'],
    industrial_ruins: ['Pennsylvania', 'Michigan', 'Ohio', 'Indiana', 'New Jersey'],
    small_towns: ['Arkansas', 'Tennessee', 'Kentucky', 'Missouri', 'North Dakota'],
    suburban_sprawl: ['New Jersey', 'Connecticut', 'Maryland', 'Virginia', 'Illinois'],
    college_campus: ['Massachusetts', 'California', 'Pennsylvania', 'New York', 'Ohio'],
    national_parks: ['Wyoming', 'Montana', 'California', 'Utah', 'Arizona'],
    border_towns: ['Texas', 'Arizona', 'New Mexico', 'California'],
    mining_towns: ['West Virginia', 'Pennsylvania', 'Colorado', 'Montana', 'Nevada'],
    lakeside_cabins: ['Minnesota', 'Wisconsin', 'Michigan', 'New Hampshire', 'Maine'],
};

// ---- ONE_TOO_MANY trope packs (mirrors run-job/story_dna.ts) ----
const ONE_TOO_MANY_TROPE_PACKS = [
    { group: 'friends on a road trip', size: 5, extra: 6, container: 'van', evidence: 'group photo', glitch: 'the GPS kept rerouting to the same dead end' },
    { group: 'coworkers at an office retreat', size: 8, extra: 9, container: 'conference room', evidence: 'sign-in sheet', glitch: 'the elevator kept stopping on a floor that didn\'t exist' },
    { group: 'students on a field trip', size: 12, extra: 13, container: 'school bus', evidence: 'attendance sheet', glitch: 'the bus driver counted 13 but the roster said 12' },
    { group: 'neighbors evacuating together', size: 7, extra: 8, container: 'hotel', evidence: 'hotel key card log', glitch: 'the GPS rerouted to the same dead end' },
    { group: 'wedding guests at a rehearsal dinner', size: 10, extra: 11, container: 'restaurant', evidence: 'seating chart', glitch: 'the table settings kept resetting to 11' },
    { group: 'hikers on a trail', size: 6, extra: 7, container: 'campsite', evidence: 'trail register', glitch: 'the marked trail led somewhere not on the map' },
    { group: 'subway passengers stuck in a stopped train', size: 9, extra: 10, container: 'subway car', evidence: 'security camera footage', glitch: 'the train kept arriving at the same station' },
    { group: 'ferry passengers on a night crossing', size: 8, extra: 9, container: 'ferry', evidence: 'ticket manifest', glitch: 'the lighthouse signal came from the wrong direction' },
    { group: 'classmates at a school reunion', size: 15, extra: 16, container: 'gymnasium', evidence: 'yearbook', glitch: 'one face in every photo didn\'t match anyone\'s memory' },
    { group: 'family members at a holiday gathering', size: 11, extra: 12, container: 'house', evidence: 'family photo from that night', glitch: 'Grandma\'s china cabinet had exactly one extra place setting' },
];

// Dims locked by one_too_many (these get overridden, user can't change them)
const ONE_TOO_MANY_LOCKED_DIMS = ['threat_behavior', 'threat_manifestation', 'repeating_detail', 'weird_axis', 'escalation', 'ending_imagery'];

function getRandomTropePack() {
    return ONE_TOO_MANY_TROPE_PACKS[Math.floor(Math.random() * ONE_TOO_MANY_TROPE_PACKS.length)];
}

let lastGeneratedStory = null;
let lastGeneratedScenes = [];
let lastGeneratedVisualCues = [];
let lastUsedDNA = null;

// Build the DNA dropdown grid
function buildDNAGrid() {
    const grid = document.getElementById('ip-dna-grid');
    if (!grid) return;
    grid.innerHTML = '';
    for (const [dimKey, dim] of Object.entries(DNA_DIMENSIONS)) {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;flex-direction:column;gap:2px';
        wrapper.innerHTML = `
            <label style="font-size:10px;color:var(--text-secondary);font-weight:600">${dim.label}</label>
            <select class="form-control form-control--sm" id="ip-dna-${dimKey}" style="font-size:11px">
                <option value="_random">🎲 Random</option>
                ${dim.options.map(o => `<option value="${o.key}">${o.label}</option>`).join('')}
            </select>
        `;
        grid.appendChild(wrapper);
    }
}

function rollAllDNA() {
    const vibePreset = document.getElementById('ip-vibe-preset').value;
    for (const [dimKey, dim] of Object.entries(DNA_DIMENSIONS)) {
        const sel = document.getElementById(`ip-dna-${dimKey}`);
        if (!sel) continue;
        // Don't roll locked dims for one_too_many
        if (vibePreset === 'one_too_many' && ONE_TOO_MANY_LOCKED_DIMS.includes(dimKey)) continue;
        const randomIdx = Math.floor(Math.random() * dim.options.length);
        sel.value = dim.options[randomIdx].key;
    }
    // Open the details panel so user can see the roll
    const details = document.getElementById('ip-dna-details');
    if (details) details.open = true;
}

// Apply/remove lane lock when vibe preset changes
function applyPresetLaneLock() {
    const vibePreset = document.getElementById('ip-vibe-preset').value;
    const isOTM = vibePreset === 'one_too_many';
    
    for (const dimKey of Object.keys(DNA_DIMENSIONS)) {
        const sel = document.getElementById(`ip-dna-${dimKey}`);
        const wrapper = sel?.closest('div');
        if (!sel || !wrapper) continue;
        const isLocked = isOTM && ONE_TOO_MANY_LOCKED_DIMS.includes(dimKey);
        sel.disabled = isLocked;
        wrapper.style.opacity = isLocked ? '0.5' : '1';
        
        // Show lock indicator
        let lockBadge = wrapper.querySelector('.lane-lock-badge');
        if (isLocked) {
            if (!lockBadge) {
                lockBadge = document.createElement('span');
                lockBadge.className = 'lane-lock-badge';
                lockBadge.style.cssText = 'font-size:9px;color:#F59E0B;font-weight:600;margin-left:4px';
                lockBadge.textContent = '🔒 Lane Locked';
                wrapper.querySelector('label')?.appendChild(lockBadge);
            }
            // Set visual indicator value
            sel.value = '_locked';
            // Add _locked option if not present
            if (!sel.querySelector('option[value="_locked"]')) {
                const opt = document.createElement('option');
                opt.value = '_locked';
                opt.textContent = '🔒 Set by One Too Many trope';
                sel.insertBefore(opt, sel.firstChild);
            }
        } else {
            if (lockBadge) lockBadge.remove();
            // Remove _locked option if present & reset to random
            const lockedOpt = sel.querySelector('option[value="_locked"]');
            if (lockedOpt) {
                if (sel.value === '_locked') sel.value = '_random';
                lockedOpt.remove();
            }
        }
    }
}

function getSelectedDNA() {
    const vibePreset = document.getElementById('ip-vibe-preset').value;
    const dna = {};
    
    for (const [dimKey, dim] of Object.entries(DNA_DIMENSIONS)) {
        const sel = document.getElementById(`ip-dna-${dimKey}`);
        const val = sel ? sel.value : '_random';
        if (val === '_random' || val === '_locked') {
            const randomIdx = Math.floor(Math.random() * dim.options.length);
            dna[dimKey] = dim.options[randomIdx];
        } else {
            dna[dimKey] = dim.options.find(o => o.key === val) || dim.options[0];
        }
    }
    
    // Apply ONE_TOO_MANY lane lock — override 6 dims with trope pack
    if (vibePreset === 'one_too_many') {
        const trope = getRandomTropePack();
        dna._trope = trope;
        dna.threat_behavior = { key: 'count_appears', label: `Appears in counts (group of ${trope.size} keeps counting ${trope.extra})` };
        dna.threat_manifestation = { key: 'extra_person', label: `Extra person among ${trope.group}` };
        dna.repeating_detail = { key: 'numbers_wrong', label: `The count kept coming up wrong — ${trope.size} should be there but they count ${trope.extra}` };
        dna.weird_axis = { key: 'counting_wrong', label: 'There was always one more person in the group than there should have been' };
        dna.escalation = { key: 'counting_escalation', label: `Confusion → panic as ${trope.evidence} confirms ${trope.extra} people (should be ${trope.size})` };
        dna.ending_imagery = { key: 'proof_n_plus_one', label: `The ${trope.evidence} showed exactly ${trope.extra} people — with an extra face, unfazed, as if they belonged` };
    }
    
    // Add random US states based on location
    const statePool = LOCATION_STATES[dna.location.key] || ['Unknown State'];
    const state = statePool[Math.floor(Math.random() * statePool.length)];
    dna._state = state;
    dna._vibePreset = vibePreset;
    return dna;
}

function buildDNAPrompt(dna, wordRange) {
    // ONE_TOO_MANY gets a special counting-horror prompt structure
    if (dna._vibePreset === 'one_too_many' && dna._trope) {
        const t = dna._trope;
        return `You are writing a "one too many" counting horror story. A group realizes there is ONE EXTRA PERSON that no one can identify. The DNA has been PRE-DETERMINED. Follow ALL specifications.

═══════════════════════════════════════
📋 STORY DNA (NON-NEGOTIABLE):
═══════════════════════════════════════

⏰ ERA: "In the ${dna.era.label.toLowerCase()}..."
📍 LOCATION: ${dna._state} — ${dna.location.label.toLowerCase()}
📰 FORMAT: ${dna.subgenre.label}
📜 NARRATIVE VOICE: ${dna.narrative_artifact.label}

👥 THE GROUP: ${t.group} — there should be ${t.size} people
🔢 THE COUNT: They keep counting ${t.extra} — one extra that shouldn't exist
📦 CONTAINER: The group is in/at a ${t.container}
📋 EVIDENCE: The ${t.evidence} confirms ${t.extra} people (should be ${t.size})
⚡ GLITCH: ${t.glitch}

🏛️ AUTHORITY RESPONSE: ${dna.authority.label}
🔚 ENDING: ${dna.ending_knowledge.label}
   Final Image: The ${t.evidence} shows exactly ${t.extra} people — with an extra face looking at the camera, unfazed, unblinking, as if they belonged
💭 EMOTIONAL AFTERTASTE: ${dna.emotion.label}

═══════════════════════════════════════
📐 STRUCTURE:
═══════════════════════════════════════
1. OPENING: "In the ${dna.era.label.toLowerCase()}..." — introduce the ${t.group} gathering at the ${t.container} in ${dna._state}
2. THE COUNT: Someone counts heads. ${t.size} people should be there. They count ${t.extra}. "Wait... count again."
3. GROWING UNEASE: Every recount = ${t.extra}. Who is the extra? Everyone looks familiar. No one is a stranger. The number is just WRONG.
4. THE GLITCH: ${t.glitch}
5. EVIDENCE: The ${t.evidence} shows ${t.extra} people. Proof.
6. ENDING: ${dna.ending_knowledge.label}. Final image: the ${t.evidence} with that extra face.

📏 WORD COUNT: MINIMUM ${wordRange.min} / MAXIMUM ${wordRange.max} words
🚫 DO NOT: Reveal who the extra person is. Do NOT make it a ghost/demon/monster. The horror is that the count is simply WRONG and there's no explanation.
🚫 DO NOT: Use first-person ("I"). Use third-person limited or the specified narrative voice.

The setting should feel REAL and SPECIFIC to ${dna._state}. Use local details.

Respond in JSON:
{
  "title": "Short catchy title (3-6 words)",
  "story": "The full story text..."
}`;
    }

    // Default: generic DNA-driven horror prompt
    return `You are writing a faux–true crime horror story. The DNA of this story has been PRE-DETERMINED. You MUST follow ALL specifications exactly.

═══════════════════════════════════════
📋 STORY DNA (NON-NEGOTIABLE):
═══════════════════════════════════════

⏰ ERA: "In the ${dna.era.label.toLowerCase()}..." 
📍 LOCATION: ${dna._state} — specifically ${dna.location.label.toLowerCase()}
📰 FORMAT: ${dna.subgenre.label}
📜 NARRATIVE VOICE: ${dna.narrative_artifact.label} — write in the style and tone of a ${dna.narrative_artifact.label.toLowerCase()}
👁️ THE THREAT:
   What it IS: ${dna.threat_manifestation.label}
   What it DOES: ${dna.threat_behavior.label}
🔄 REPEATING DETAIL (must appear 2-3 times): ${dna.repeating_detail.label}
❓ THE WEIRD AXIS (what makes this story unique): ${dna.weird_axis.label}
📈 ESCALATION PATTERN: ${dna.escalation.label}
🏛️ AUTHORITY RESPONSE: ${dna.authority.label}
🔚 ENDING:
   Resolution: ${dna.ending_knowledge.label}
   Final Image: ${dna.ending_imagery.label}
💭 EMOTIONAL AFTERTASTE: ${dna.emotion.label}

═══════════════════════════════════════
📐 STRUCTURE (FOLLOW EXACTLY):
═══════════════════════════════════════
1. OPENING: Start with "In the ${dna.era.label.toLowerCase()}..." using the ${dna.narrative_artifact.label.toLowerCase()} voice
2. EARLY REPORTS: Describe initial encounters with the ${dna.threat_manifestation.label.toLowerCase()} that is ${dna.threat_behavior.label.toLowerCase()}. Include the repeating detail.
3. PATTERN: The same repeating detail (${dna.repeating_detail.label.toLowerCase()}) appears in reports from different sources.
4. THE WEIRD PART: Introduce the weird axis — ${dna.weird_axis.label.toLowerCase()}
5. ESCALATION: ${dna.escalation.label}
6. AUTHORITY: ${dna.authority.label}
7. ENDING: ${dna.ending_knowledge.label}. Final image: ${dna.ending_imagery.label.toLowerCase()}

📏 WORD COUNT: MINIMUM ${wordRange.min} words / MAXIMUM ${wordRange.max} words
🌲 VISUAL ENVIRONMENT: Stories set in ${dna.location.label.toLowerCase()} of ${dna._state}
🚫 DO NOT: Add elements not in the DNA. Do not change the threat, weird axis, or ending.

Respond in JSON:
{
  "title": "Short catchy title (3-6 words)",
  "story": "The full story text..."
}`;
}

function displayUsedDNA(dna) {
    const el = document.getElementById('ip-dna-used');
    const list = document.getElementById('ip-dna-used-list');
    if (!el || !list) return;
    el.style.display = 'block';
    
    const items = [
        `⏰ <strong>Era:</strong> ${dna.era.label}`,
        `📍 <strong>Location:</strong> ${dna.location.label} (${dna._state})`,
        `📰 <strong>Format:</strong> ${dna.subgenre.label}`,
        `📜 <strong>Voice:</strong> ${dna.narrative_artifact.label}`,
    ];

    if (dna._vibePreset === 'one_too_many' && dna._trope) {
        const t = dna._trope;
        items.push(
            `<span style="color:#F59E0B">🔒 <strong>ONE TOO MANY LANE LOCK:</strong></span>`,
            `&nbsp;&nbsp;👥 <strong>Group:</strong> ${t.group} (${t.size} should be there, counting ${t.extra})`,
            `&nbsp;&nbsp;📦 <strong>Container:</strong> ${t.container}`,
            `&nbsp;&nbsp;📋 <strong>Evidence:</strong> ${t.evidence}`,
            `&nbsp;&nbsp;⚡ <strong>Glitch:</strong> ${t.glitch}`,
        );
    } else {
        items.push(
            `👁️ <strong>Threat:</strong> ${dna.threat_manifestation.label} — ${dna.threat_behavior.label}`,
            `🔄 <strong>Repeat:</strong> ${dna.repeating_detail.label}`,
            `❓ <strong>Weird:</strong> ${dna.weird_axis.label}`,
            `📈 <strong>Escalation:</strong> ${dna.escalation.label}`,
        );
    }
    
    items.push(
        `🏛️ <strong>Authority:</strong> ${dna.authority.label}`,
        `🔚 <strong>Ending:</strong> ${dna.ending_knowledge.label} — ${dna.ending_imagery.label}`,
        `💭 <strong>Emotion:</strong> ${dna.emotion.label}`,
    );
    list.innerHTML = items.join('<br>');
}

// ---- Scene count helpers ----
function updateSceneCountFromDuration() {
    const dur = parseInt(document.getElementById('ip-story-duration').value) || 60;
    const balanced = Math.round(dur / 2.5); // 2.5s per scene = balanced pace
    document.getElementById('ip-scene-count').value = balanced;
    updateScenePace();
}
function updateScenePace() {
    const dur = parseInt(document.getElementById('ip-story-duration').value) || 60;
    const sc = parseInt(document.getElementById('ip-scene-count').value) || 24;
    const pace = (dur / sc).toFixed(1);
    document.getElementById('ip-scene-pace').textContent = `${pace}s/scene`;
}

document.addEventListener('DOMContentLoaded', () => {
    buildDNAGrid();
    document.getElementById('ip-story-generate-btn').addEventListener('click', generateTestStory);
    document.getElementById('ip-dna-roll-btn').addEventListener('click', rollAllDNA);
    document.getElementById('ip-scene-count').addEventListener('input', updateScenePace);
    document.getElementById('ip-uniqueness-refresh').addEventListener('click', loadUniquenessStats);
    document.getElementById('ip-use-scene-btn').addEventListener('click', () => {
        if (lastGeneratedVisualCues.length > 0) {
            useVisualCueForImage(0);
        } else if (lastGeneratedScenes.length > 0) {
            document.getElementById('ip-test-scene').value = lastGeneratedScenes[0];
            generateTestImage();
        }
    });
    // Apply lane lock when vibe preset changes
    const vibeSelect = document.getElementById('ip-vibe-preset');
    if (vibeSelect) {
        vibeSelect.addEventListener('change', applyPresetLaneLock);
        // Apply on initial load in case already set to one_too_many
        setTimeout(applyPresetLaneLock, 100);
    }
});

async function generateTestStory() {
    const btn = document.getElementById('ip-story-generate-btn');
    const statusEl = document.getElementById('ip-story-status');
    const container = document.getElementById('ip-story-container');

    const openaiKey = window.apiKeys?.get('openai');
    if (!openaiKey) {
        toast.error('OpenAI API key not configured. Add it in Settings first.');
        return;
    }

    const duration = parseInt(document.getElementById('ip-story-duration').value);
    const targetWords = Math.round(duration * 2.5);
    const wordRange = { min: Math.round(targetWords * 0.85), max: Math.round(targetWords * 1.15) };

    // Resolve DNA (random dims get rolled here)
    const dna = getSelectedDNA();
    lastUsedDNA = dna;
    displayUsedDNA(dna);

    const storyPrompt = buildDNAPrompt(dna, wordRange);

    btn.disabled = true;
    statusEl.textContent = '\u23f3 Generating story...';
    statusEl.style.color = 'var(--text-secondary)';

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'You are a master horror story writer. You follow story DNA specifications EXACTLY — every dimension must appear in the story. You write atmospheric, gripping stories in the specified narrative voice. NEVER deviate from the DNA.' },
                    { role: 'user', content: storyPrompt }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.75,
                max_tokens: 2000,
            })
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: { message: response.statusText } }));
            throw new Error(err.error?.message || `API error: ${response.status}`);
        }

        const data = await response.json();
        const content = JSON.parse(data.choices[0].message.content);
        const title = content.title || 'Untitled';
        const storyText = content.story || content.text || '';
        const wordCount = storyText.split(/\s+/).length;

        lastGeneratedStory = { title, story: storyText, wordCount };

        // Show story
        container.style.display = 'block';
        document.getElementById('ip-story-title').textContent = title;
        document.getElementById('ip-story-wordcount').textContent = `${wordCount} words (~${Math.round(wordCount / 2.5)}s)`;
        document.getElementById('ip-story-text').textContent = storyText;

        // Split into scenes using the configured scene count
        const targetSceneCount = parseInt(document.getElementById('ip-scene-count').value) || 24;
        lastGeneratedScenes = splitIntoScenes(storyText, targetSceneCount);
        lastGeneratedVisualCues = [];
        
        if (lastGeneratedScenes.length > 0) {
            // Show scenes immediately with placeholder cues
            renderSceneList(lastGeneratedScenes, []);
            
            // Extract visual cues using GPT (background step)
            statusEl.textContent = `⏳ Extracting visual cues from ${lastGeneratedScenes.length} scenes...`;
            const cues = await extractVisualCues(lastGeneratedScenes, openaiKey);
            lastGeneratedVisualCues = cues;
            
            // Re-render with visual cues
            renderSceneList(lastGeneratedScenes, cues);
            
            // Auto-fill Scene 1's visual cue into the image test field
            if (cues[0]) {
                document.getElementById('ip-test-scene').value = cues[0].description;
                document.getElementById('ip-test-scene').dataset.cueType = cues[0].type || 'character';
                document.getElementById('ip-test-scene').dataset.cueCamera = cues[0].camera || 'medium';
            } else {
                document.getElementById('ip-test-scene').value = lastGeneratedScenes[0];
            }
        }

        statusEl.textContent = `✅ Generated "${title}" (${wordCount} words, ${lastGeneratedVisualCues.length} visual cues) — click 🖼️ to generate`;
        statusEl.style.color = '#10B981';

    } catch (e) {
        statusEl.textContent = '\u274c ' + e.message;
        statusEl.style.color = '#EF4444';
        console.error('[TestStory]', e);
    } finally {
        btn.disabled = false;
    }
}

function splitIntoScenes(text, targetScenes = 24) {
    const MIN_WORDS_PER_SCENE = 10;
    const wordCount = text.split(/\s+/).length;
    
    // Cap target scenes so each scene has at least MIN_WORDS_PER_SCENE words
    const maxViableScenes = Math.max(3, Math.floor(wordCount / MIN_WORDS_PER_SCENE));
    const effectiveTarget = Math.min(targetScenes, maxViableScenes);
    
    // Split into sentences first
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    
    // When we need more scenes than sentences, split at clause boundaries
    let chunks = [...sentences];
    if (chunks.length < effectiveTarget) {
        const expanded = [];
        for (const s of chunks) {
            if (expanded.length >= effectiveTarget) { expanded.push(s); continue; }
            const clauses = s.split(/(?<=,)\s+|(?<=;)\s+|(?<=—)\s*|\s+(?:and|but|when|as|while|then)\s+/i)
                .filter(c => c.trim().length > 3);
            if (clauses.length > 1) expanded.push(...clauses);
            else expanded.push(s);
        }
        chunks = expanded;
    }
    
    // Final cap: never more scenes than chunks
    const finalTarget = Math.min(effectiveTarget, chunks.length);
    
    // Distribute chunks evenly across scenes
    const chunksPerScene = chunks.length / finalTarget;
    const scenes = [];
    for (let i = 0; i < finalTarget; i++) {
        const startIdx = Math.floor(i * chunksPerScene);
        const endIdx = i === finalTarget - 1 ? chunks.length : Math.floor((i + 1) * chunksPerScene);
        const actualEnd = Math.max(endIdx, startIdx + 1);
        const sceneText = chunks.slice(startIdx, actualEnd).join(' ').trim();
        if (sceneText) scenes.push(sceneText);
    }
    
    console.log(`[splitIntoScenes] ${wordCount} words, target=${targetScenes}, effective=${finalTarget}, chunks=${chunks.length}, produced=${scenes.length}`);
    return scenes.length > 0 ? scenes : [text];
}

// =========================================================
// VISUAL CUE EXTRACTION — Scene → Image Description
// =========================================================
async function extractVisualCues(scenes, openaiKey) {
    const sceneList = scenes.map((s, i) => `Scene ${i+1}: ${s}`).join('\n\n');
    
    const prompt = `You are a visual director for a horror comic book. For each scene of a story, describe what a SINGLE ILLUSTRATION should depict.

RULES:
- Each scene gets ONE image description
- Focus on the KEY VISUAL ELEMENT of the scene — what would a camera capture?
- NOT every scene needs people. Some scenes should be:
  • Establishing shots (landscape, roads, buildings, signs)
  • Object close-ups (documents, registers, phones, evidence)  
  • Atmosphere shots (fog, empty corridors, dark forests)
  • Character moments (group gathered, single person reacting)
- Describe WHAT IS VISIBLE in the image, not emotions or sounds
- Include: subjects, setting, time of day, key objects, camera angle
- Be specific: "A worn leather trail register book lying open on a wooden post, showing 7 handwritten names, surrounded by dark pine trees" NOT "a trail register"
- Keep each description to 1-3 sentences max
- Think about what would make the most VISUALLY INTERESTING and STORY-RELEVANT illustration

SCENES:
${sceneList}

Respond in JSON:
{
  "visual_cues": [
    { "scene": 1, "type": "establishing|object|atmosphere|character|group", "description": "What the image shows...", "camera": "wide|medium|close-up|extreme-close-up|overhead|low-angle" },
    ...
  ]
}`;

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'You are a visual director who translates story scenes into precise image descriptions for an AI image generator. You think cinematically — not every scene is a person shot.' },
                    { role: 'user', content: prompt }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.5,
                max_tokens: 4000,
            })
        });

        if (!response.ok) {
            const errBody = await response.text().catch(() => response.statusText);
            throw new Error(`Visual cue API ${response.status}: ${errBody.substring(0, 200)}`);
        }
        
        const data = await response.json();
        const raw = data.choices?.[0]?.message?.content;
        if (!raw) throw new Error('No content in visual cue response');
        const content = JSON.parse(raw);
        return content.visual_cues || [];
    } catch (e) {
        console.warn('[VisualCues] Extraction failed, falling back to raw scenes:', e.message);
        // Fallback: use raw scene text
        return scenes.map((s, i) => ({ scene: i+1, type: 'character', description: s.substring(0, 250), camera: 'medium' }));
    }
}

function renderSceneList(scenes, visualCues) {
    const scenesEl = document.getElementById('ip-story-scenes');
    const listEl = document.getElementById('ip-scenes-list');
    if (!scenesEl || !listEl) return;
    
    scenesEl.style.display = 'block';
    
    const typeColors = {
        establishing: '#3B82F6', object: '#F59E0B', atmosphere: '#8B5CF6',
        character: '#10B981', group: '#EF4444'
    };
    const typeIcons = {
        establishing: '🏞️', object: '🔍', atmosphere: '🌫️',
        character: '👤', group: '👥'
    };
    
    listEl.innerHTML = scenes.map((s, i) => {
        const cue = visualCues[i] || { type: 'character', description: s.substring(0, 250), camera: 'medium' };
        const color = typeColors[cue.type] || '#6B7280';
        const icon = typeIcons[cue.type] || '📷';
        
        return `<div style="padding:6px 8px;margin-bottom:6px;background:rgba(0,0,0,0.1);border-radius:6px;border-left:3px solid ${color}">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                <button class="btn btn--secondary btn--sm" style="flex-shrink:0;font-size:10px;padding:2px 6px" onclick="useVisualCueForImage(${i})" title="Generate image from visual cue">🖼️</button>
                <strong style="font-size:12px;color:var(--text-primary)">Scene ${i+1}</strong>
                <span style="font-size:9px;padding:1px 5px;border-radius:3px;background:${color};color:#fff;font-weight:700;text-transform:uppercase">${icon} ${cue.type}</span>
                <span style="font-size:9px;color:var(--text-secondary)">📷 ${cue.camera || 'medium'}</span>
            </div>
            <div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px;cursor:pointer" onclick="document.getElementById('ip-test-scene').value=this.parentElement.dataset.rawScene" title="Click to copy raw scene text">
                📖 ${s.substring(0, 100)}${s.length > 100 ? '...' : ''}
            </div>
            <div style="font-size:11px;color:${color};font-weight:500;padding:3px 6px;background:rgba(0,0,0,0.08);border-radius:4px">
                🎬 <strong>Visual:</strong> ${cue.description}
            </div>
        </div>`;
    }).join('');
    
    // Attach data
    listEl.querySelectorAll('div[style*="border-left"]').forEach((el, i) => {
        el.dataset.rawScene = scenes[i];
        el.dataset.visualCue = JSON.stringify(visualCues[i] || {});
    });
}

function useVisualCueForImage(sceneIdx) {
    const cue = lastGeneratedVisualCues[sceneIdx];
    if (!cue) return;
    // Set the textarea to the visual cue description (not the raw narrative)
    document.getElementById('ip-test-scene').value = cue.description;
    // Store metadata for the image generator to use
    document.getElementById('ip-test-scene').dataset.cueType = cue.type || 'character';
    document.getElementById('ip-test-scene').dataset.cueCamera = cue.camera || 'medium';
    generateTestImage();
}

// =========================================================
// UNIQUENESS DASHBOARD
// =========================================================
async function loadUniquenessStats() {
    const statusEl = document.getElementById('ip-uniqueness-status');
    const container = document.getElementById('ip-uniqueness-container');

    statusEl.textContent = '\u23f3 Loading...';
    statusEl.style.color = 'var(--text-secondary)';

    try {
        // Call get_dna_statistics() RPC
        const { data: stats, error } = await getSupabaseClient().rpc('get_dna_statistics');
        if (error) throw error;

        const s = Array.isArray(stats) ? stats[0] : stats;
        if (!s) throw new Error('No stats returned');

        container.style.display = 'block';
        document.getElementById('ip-stat-total').textContent = s.total_generated || '0';
        document.getElementById('ip-stat-unique').textContent = s.unique_concepts || '0';
        document.getElementById('ip-stat-7d').textContent = s.stories_last_7_days || '0';
        document.getElementById('ip-stat-30d').textContent = s.stories_last_30_days || '0';
        document.getElementById('ip-stat-attempts').textContent = s.avg_uniqueness_attempts || '1.00';
        
        const total = parseInt(s.total_generated) || 0;
        const unique = parseInt(s.unique_concepts) || 0;
        const ratio = total > 0 ? Math.round((unique / total) * 100) : 100;
        document.getElementById('ip-stat-ratio').textContent = ratio + '%';
        document.getElementById('ip-stat-ratio').style.color = ratio >= 90 ? '#10B981' : ratio >= 70 ? '#F59E0B' : '#EF4444';

        document.getElementById('ip-stat-most-weird').textContent = s.most_used_weird_axis || 'n/a';
        document.getElementById('ip-stat-least-weird').textContent = s.least_used_weird_axis || 'n/a';

        // Load recent story_dna entries
        await loadRecentDNA();

        statusEl.textContent = '\u2705 Stats loaded';
        statusEl.style.color = '#10B981';
    } catch (e) {
        statusEl.textContent = '\u274c ' + e.message;
        statusEl.style.color = '#EF4444';
        console.error('[Uniqueness]', e);
    }
}

async function loadRecentDNA() {
    try {
        const { data, error } = await getSupabaseClient()
            .from('story_dna')
            .select('id, created_at, genre, concept_hash, weird_axis_id, threat_behavior_id, threat_manifestation_id, era_id, location_id, generation_attempt')
            .order('created_at', { ascending: false })
            .limit(10);

        if (error) throw error;
        if (!data || data.length === 0) return;

        const recentEl = document.getElementById('ip-recent-stories');
        const listEl = document.getElementById('ip-recent-stories-list');
        recentEl.style.display = 'block';

        listEl.innerHTML = data.map(d => {
            const date = new Date(d.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            const genre = d.genre || 'unknown';
            const genreColor = genre === 'one_too_many' ? '#F59E0B' : genre === 'urban_legend' ? '#8B5CF6' : '#6B7280';
            const attempt = d.generation_attempt > 1 ? ` <span style="color:#EF4444">(${d.generation_attempt} attempts)</span>` : '';
            const era = d.era_id ? d.era_id.replace(/_/g, ' ') : '';
            const loc = d.location_id ? d.location_id.replace(/_/g, ' ') : '';
            return `<div style="padding:4px 6px;margin-bottom:2px;background:rgba(0,0,0,0.1);border-radius:4px;font-size:11px;line-height:1.4">
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <span><span style="background:${genreColor};color:#fff;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700;text-transform:uppercase">${genre.replace(/_/g, ' ')}</span> ${attempt}</span>
                    <span style="opacity:0.6;font-size:10px">${date}</span>
                </div>
                <div style="margin-top:2px;color:var(--text-secondary)">
                    ❓ ${d.weird_axis_id || 'n/a'} · 👁️ ${d.threat_behavior_id || 'n/a'} / ${d.threat_manifestation_id || 'n/a'} · 📍 ${loc || 'n/a'} · ⏰ ${era || 'n/a'}
                </div>
            </div>`;
        }).join('');
    } catch (e) {
        console.warn('[RecentDNA]', e.message);
    }
}

// =====================================================
// =====================================================
// SETTINGS HUB MODAL
// =====================================================

