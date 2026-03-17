// =====================================================
// WORKER V1 STEP IMPLEMENTATIONS
// Real work for each pipeline step
// v3.0 - 2026-03-01 (Story Anchor + Enhanced Visual Cues: preset-aware extraction, group count enforcement, character consistency)
// v2.0 - 2026-02-15 (Visual cue extraction for images, balanced scene count defaults, scene splitting fix)
// v1.5 - 2026-02-12 (DB-driven image prompt config per vibe preset)
// v1.4 - 2026-02-10 (Background Music V1: DB-driven track selection, ducking config)
// v1.3 - 2026-02-10 (Cost controls integration)
// v1.2 - 2026-02-22 (Standardized asset paths)
// v1.1 - 2026-02-22 (Added step logging)
// v1.0 - 2026-02-20
// =====================================================

import { SupabaseClient } from "npm:@supabase/supabase-js@2.39.3";
import {
  Job,
  StepResult,
  getAssetByKey,
  getAssetsByPrefix,
  upsertAsset,
  updateJobFields,
  updateJobMeta,
  loadJob,
  requireLeaseOwner,
  requireLeaseGrace,
  heartbeatJob,
  uploadToStorage,
  uploadRemoteToStorage,
  computeHash,
  computePipelineHash,
  fetchWithError,
  getEffectsConfigForJob,
  getImagePromptConfigForJob,
  getSubtitleConfigForJob,
  ImagePromptConfig,
  SubtitleConfig,
  ELEVENLABS_VOICE_ID,
  OPENAI_TTS_MODEL,
  OPENAI_TTS_VOICE,
  OPENAI_TTS_INSTRUCTIONS,
  getPresetVoiceConfig,
  TtsProvider,
  STORAGE_BUCKET,
  updateStepStatus,
  WALL_CLOCK_BUDGET_MS,
  IMAGE_RESERVE_MS,
  // Path builders for canonical storage paths
  pathForImage,
  pathForAudio,
  pathForSubtitles,
  pathForAssembledVideo,
  pathForFinalVideo,
  pathForBrandMusic,
  pathForJobMusic,
  pathForBrandGameplay,
} from "./helpers.ts";

import { StepLogger } from "./stepLogger.ts";
import { 
  CostControlHelper, 
  ServiceType, 
  isCostLimitError,
  assertCanSpend 
} from "./costControl.ts";

// =====================================================
// REDDIT-INSPIRED HORROR SCENARIO SYSTEM
// Curated rotating horror themes drawn from the types of
// stories that trend on horror subreddits (nosleep, 
// creepypasta, letsnotmeet, paranormal, etc.)
// =====================================================

interface HorrorScenario {
  category: string;       // e.g. "stalker", "paranormal", "glitch"
  subreddit_style: string;  // which subreddit genre this resembles
  premise: string;        // 2-3 sentence scenario seed
  setting_hint: string;   // suggested setting type
  fear_type: string;      // core fear being exploited
}

/**
 * Curated pool of horror scenarios inspired by trending Reddit horror content.
 * Each scenario captures the "DNA" of the kind of stories that go viral on 
 * horror subreddits — without needing live API access.
 */
const HORROR_SCENARIOS: HorrorScenario[] = [
  // --- r/nosleep style (first-person escalating horror) ---
  { category: 'home_invasion', subreddit_style: 'nosleep', premise: 'Someone realizes the person who has been entering their home while they are away has been living in their attic for months. They find food wrappers, a makeshift bed, and a notebook with detailed logs of the homeowner\'s daily schedule.',  setting_hint: 'suburban house', fear_type: 'violation of safe space' },
  { category: 'digital_horror', subreddit_style: 'nosleep', premise: 'A person discovers their smart home cameras have been recording someone standing in their bedroom doorway every night at 3:17 AM for the past two weeks. The figure is wearing the homeowner\'s own clothes.', setting_hint: 'smart home', fear_type: 'surveillance & identity' },
  { category: 'childhood_memory', subreddit_style: 'nosleep', premise: 'An adult returns to their childhood home and finds a door in the basement that they have absolutely no memory of. Behind it is a room with children\'s drawings on the walls — drawings that depict events from their own life that haven\'t happened yet.', setting_hint: 'childhood home', fear_type: 'repressed memory' },
  { category: 'doppelganger', subreddit_style: 'nosleep', premise: 'A night shift worker at a convenience store watches security footage from the previous night and sees themselves already working the shift — stocking shelves, serving customers, doing everything exactly as they would. But they weren\'t there that night.', setting_hint: 'convenience store', fear_type: 'identity duplication' },
  { category: 'isolation', subreddit_style: 'nosleep', premise: 'During a severe winter storm, a family realizes their nearest neighbor\'s house — visible from their kitchen window for 15 years — has never actually existed. The lot is empty. But someone has been waving at them from that window every evening.', setting_hint: 'rural winter home', fear_type: 'false familiarity' },
  { category: 'medical_horror', subreddit_style: 'nosleep', premise: 'A patient wakes up from routine surgery to find the hospital completely empty. Not abandoned — the lights are on, machines are running, coffee is still warm — but every single person is gone. Then they hear their own voice being paged over the intercom.', setting_hint: 'hospital', fear_type: 'abandonment & identity' },
  { category: 'technology', subreddit_style: 'nosleep', premise: 'A person\'s GPS keeps rerouting them to the same abandoned gas station no matter where they try to drive. When they finally stop and go inside, they find photographs of themselves at every age, pinned to the wall in chronological order — including ages they haven\'t reached yet.', setting_hint: 'abandoned gas station', fear_type: 'predestination' },
  { category: 'sleep_horror', subreddit_style: 'nosleep', premise: 'Someone sets up a sleep recording app and discovers they\'ve been having full, coherent conversations in their sleep — with a voice that responds. The voice knows things about them that nobody else knows.', setting_hint: 'bedroom', fear_type: 'unconscious vulnerability' },

  // --- r/letsnotmeet style (real encounter horror) ---
  { category: 'stalker', subreddit_style: 'letsnotmeet', premise: 'A rideshare driver picks up a passenger who knows their name, their address, and the names of their children — but has never met them before. The passenger smiles and says "I\'ve been your neighbor for six months."', setting_hint: 'car at night', fear_type: 'being watched' },
  { category: 'wrong_person', subreddit_style: 'letsnotmeet', premise: 'A jogger running their usual trail at dusk notices someone running behind them, matching their exact pace. When they speed up, the person speeds up. When they slow down, the person slows down. When they stop and turn around, the trail is empty — but they can still hear footsteps.', setting_hint: 'wooded trail', fear_type: 'pursuit' },
  { category: 'social_horror', subreddit_style: 'letsnotmeet', premise: 'After moving to a new town, a person is warmly welcomed by every neighbor. But they start noticing every neighbor has the same mannerism — the same head tilt, the same way of ending sentences. And nobody in town has any photos from before five years ago.', setting_hint: 'small town', fear_type: 'collective deception' },
  { category: 'workplace', subreddit_style: 'letsnotmeet', premise: 'A night security guard at a storage facility starts finding handwritten notes in lockers that haven\'t been opened in years. The notes are addressed to them by name and describe what they did earlier that same day.', setting_hint: 'storage facility', fear_type: 'omniscient observer' },

  // --- r/creepypasta style (folk horror / internet legend) ---
  { category: 'ritual', subreddit_style: 'creepypasta', premise: 'A hiker discovers a circle of trees in the forest where every trunk has been carved with the same symbol. Their compass stops working inside the circle. Their phone shows a photo in the gallery they didn\'t take — it\'s a photo of themselves, taken from behind, from inside the tree circle. The timestamp is tomorrow.', setting_hint: 'deep forest', fear_type: 'ancient ritual' },
  { category: 'cursed_object', subreddit_style: 'creepypasta', premise: 'A thrift store employee finds a music box that plays a melody nobody recognizes. Everyone who listens to it starts humming the same tune involuntarily. One by one, they stop coming to work. The employee finds them all standing in a field outside town, humming in unison, staring at something in the sky that nobody else can see.', setting_hint: 'small town thrift store', fear_type: 'memetic contagion' },
  { category: 'urban_decay', subreddit_style: 'creepypasta', premise: 'An urban explorer finds a subway station that doesn\'t appear on any map. The platform is pristine, as if it was built yesterday. A train arrives on schedule. The passengers are all wearing clothes from different decades. One of them waves and mouths: "You\'re next."', setting_hint: 'underground subway', fear_type: 'temporal displacement' },
  { category: 'folklore', subreddit_style: 'creepypasta', premise: 'In a coastal village, fishermen follow a centuries-old rule: never go to sea on the seventh day of the seventh month. A newcomer breaks the rule. When they return, they look twenty years older and refuse to speak about what they saw. Their boat is covered in handprints from the inside.', setting_hint: 'coastal village', fear_type: 'forbidden knowledge' },

  // --- r/paranormal style (unexplained phenomena) ---
  { category: 'haunting', subreddit_style: 'paranormal', premise: 'After their grandmother\'s funeral, a family discovers her voice still comes through the baby monitor every night, singing the same lullaby. The baby stops crying when it plays. But one night the voice says something new: "I\'m not the only one who comes."', setting_hint: 'family home', fear_type: 'afterlife communication' },
  { category: 'time_slip', subreddit_style: 'paranormal', premise: 'A photographer develops film from a vintage camera bought at an estate sale. The photos show their own apartment — but decades old, with different furniture. In every photo, someone is sitting in the exact spot where the photographer sleeps. The last photo shows the person looking directly at the camera, holding a sign that reads today\'s date.', setting_hint: 'apartment', fear_type: 'temporal bleed' },
  { category: 'entity', subreddit_style: 'paranormal', premise: 'A family\'s dog starts barking at the same empty corner of the living room every evening at sunset. One day, the youngest child casually mentions "the tall man" who stands there. They say he\'s always been there. He just recently started moving.', setting_hint: 'family home', fear_type: 'invisible presence' },
  { category: 'location_horror', subreddit_style: 'paranormal', premise: 'A hotel guest requests a room change because they hear whispering from the walls. They\'re moved three times. The whispering follows. The front desk clerk finally admits: "Every guest in that wing hears whispering. We don\'t know what they say because it\'s always in a language we can\'t identify."', setting_hint: 'old hotel', fear_type: 'inescapable presence' },

  // --- r/shortscarystories style (tight, twist-heavy) ---
  { category: 'twist', subreddit_style: 'shortscarystories', premise: 'A 911 operator receives a call from a child reporting an intruder in their home. As protocol demands, they keep the child talking and calm. Twenty minutes later, responding officers arrive to find the child safe — but the 911 operator\'s own home has been broken into. The intruder left a recording of the entire 911 call playing on repeat.', setting_hint: 'call center / home', fear_type: 'misdirection' },
  { category: 'mirror', subreddit_style: 'shortscarystories', premise: 'A person notices their reflection blinks a half-second late. They test it for days, recording themselves in front of mirrors. The delay grows longer each day. On the seventh day, the reflection doesn\'t move at all. It just stands there, watching, while they back away.', setting_hint: 'bathroom', fear_type: 'self-alienation' },
  { category: 'routine', subreddit_style: 'shortscarystories', premise: 'Every morning, a commuter passes the same man standing at the same bus stop. The man never gets on a bus. One day the commuter waves. The man walks over, sits next to them on the bus, and whispers: "I\'ve been waiting for you to notice me for four hundred and twelve days."', setting_hint: 'city bus', fear_type: 'patient predator' },
  { category: 'family', subreddit_style: 'shortscarystories', premise: 'A parent checking the baby monitor at 2 AM sees a second figure standing over the crib. They sprint to the nursery — empty, just the baby sleeping peacefully. When they return to the monitor screen, there are now two figures standing over the crib. And one of them looks exactly like the parent.', setting_hint: 'nursery', fear_type: 'parental dread' },
];

/**
 * Pick a random horror scenario, avoiding recently used categories.
 * Returns the scenario plus metadata for storage.
 */
function pickHorrorScenario(recentSettings?: string[]): HorrorScenario & { scenario_index: number } {
  let pool = HORROR_SCENARIOS.map((s, i) => ({ ...s, scenario_index: i }));
  
  // If we have recent settings, deprioritize matching categories
  if (recentSettings && recentSettings.length > 0) {
    const recentLower = recentSettings.map(s => s.toLowerCase());
    const unused = pool.filter(s => 
      !recentLower.some(r => 
        r.includes(s.setting_hint.toLowerCase()) || 
        r.includes(s.category.toLowerCase())
      )
    );
    if (unused.length >= 3) pool = unused;
  }
  
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Build the prompt for generating a Reddit-inspired horror story.
 */
function buildRedditInspiredPrompt(
  scenario: HorrorScenario,
  wordRange: { min: number; max: number },
  recentStories?: Array<{ title: string; hook: string | null; setting?: string }>
): string {
  let avoidanceSection = '';
  if (recentStories && recentStories.length > 0) {
    const avoidList = recentStories.map(s => {
      const parts = [`"${s.title}"`];
      if (s.setting) parts.push(`(setting: ${s.setting})`);
      return parts.join(' ');
    }).join('\n- ');
    avoidanceSection = `\n\nDO NOT REPEAT — these stories were already created recently:\n- ${avoidList}\n\nYour story must feel completely fresh and explore a DIFFERENT scenario than any of the above.`;
  }

  return `Write an original horror story inspired by this scenario seed. The scenario is a STARTING POINT — expand, twist, and make it your own.

SCENARIO SEED (${scenario.subreddit_style} style):
"""
${scenario.premise}
"""

SUBREDDIT STYLE: ${scenario.subreddit_style === 'nosleep' ? 'r/nosleep — First-person, escalating dread. The narrator is living through this RIGHT NOW. "This is happening to me." Confessional, urgent, real.' :
  scenario.subreddit_style === 'letsnotmeet' ? 'r/letsnotmeet — True encounter retold. "This actually happened." Grounded, realistic, no supernatural elements needed — the horror is human.' :
  scenario.subreddit_style === 'creepypasta' ? 'r/creepypasta — Internet legend / folk horror. Mysterious, atmospheric, mythic. The kind of story people screenshot and share.' :
  scenario.subreddit_style === 'paranormal' ? 'r/paranormal — Unexplained phenomena reported matter-of-factly. The narrator doesn\'t understand what happened. Neither will the audience.' :
  scenario.subreddit_style === 'shortscarystories' ? 'r/shortscarystories — Tight, punchy, twist-heavy. Every sentence matters. Build to a gut-punch ending.' :
  'Reddit horror — viral, shareable, scroll-stopping.'}

CORE FEAR: ${scenario.fear_type}
SETTING: ${scenario.setting_hint}

REQUIREMENTS:
- Word count: ${wordRange.min}-${wordRange.max} words (STRICT — controls video timing!)
- Use the scenario as INSPIRATION only — add your own details, names, locations, specifics
- FIRST-PERSON narrator — conversational, authentic, like someone telling you a story they can't forget
- The narrator is telling you something that happened to THEM
- Include enough specific mundane detail to feel real (job, routine, apartment number, time of day)

STRUCTURE (MANDATORY):
[HOOK] — First 1-2 sentences. SCROLL-STOPPING opener. USE ONE OF THESE PATTERNS:
  • "I need to tell someone what happened before [ticking clock]."
  • "I found something in my [ordinary place] that I can't explain."
  • "My [person/device] has been [doing something wrong] for [specific time period]."
  • "I think someone has been [violation] and I have proof."
  The hook MUST create immediate tension. Specific detail > vague dread. Hit hard in the FIRST sentence.
[SETUP] — Establish normalcy. Specific, grounded, relatable. Job, routine, the small details that make it feel like a real person's life.
[ESCALATION] — Things get wrong. Not all at once — drip feed the wrongness. Each new detail is worse than the last. At least 3 escalation beats.
[CONFRONTATION] — The moment the narrator faces the horror directly. Maximum tension.
[AFTERMATH] — What happened after. Did they escape? Are they still living with it? The unresolved dread.

STYLE RULES:
- Write like a real person recounting something terrifying, not a professional writer
- Short paragraphs. Some one-sentence paragraphs for impact.
- Use line breaks for pacing — let the reader breathe between scares
- No purple prose. Plain language hits harder: "I looked under the bed. It looked back."
- Include at least ONE moment where the narrator questions their own sanity
- The horror should be IMPLIED more than shown — what we imagine is worse than what we see
- No gore — psychological horror and wrongness only
- Every sentence must be visually filmable as a dark, realistic illustrated scene

ENDING (MANDATORY):
- End with a haunting final line that lingers. The ending is SPOKEN NARRATION in a video — NOT a Reddit text post.
- NEVER end with "Has anyone else experienced something like this?" or "I'm posting this from my car" or any line that implies the narrator is typing/posting online. This is a NARRATED VIDEO, not a forum post.
- Great endings leave the horror UNRESOLVED or reveal one final twist. Examples of TONE (do NOT copy these verbatim — write your own):
  • A chilling final detail the narrator just noticed
  • An ominous realization that changes everything they told you
  • A quiet, dread-filled statement about what happens next
  • The horror continuing or getting worse, stated matter-of-factly
- The last line should make the viewer's stomach drop, not ask them to comment.

AUTHENTICITY RULES:
- Use modern, relatable settings: apartments, offices, rideshares, smart devices, night shifts
- Name specific apps, brands, everyday objects — grounds the story in reality
- The narrator should react the way a REAL person would (denial, rationalization, then panic)
- Include at least one moment where they consider a rational explanation before rejecting it${avoidanceSection}

Respond in JSON format:
{
  "title": "Short catchy title (3-6 words)",
  "story": "The full story text...",
  "setting": "One or two words describing the primary setting/location",
  "concept": "One sentence summarizing the core concept/premise"
}`;
}

// =====================================================
// DARK ORIGINS SCENARIO SYSTEM
// Documentary-style dark biographies and horror icon
// origin stories told as third-person investigations.
// =====================================================

interface DarkOriginsScenario {
  category: string;
  doc_style: string;
  premise: string;
  setting_hint: string;
  fear_type: string;
}

const DARK_ORIGINS_SCENARIOS: DarkOriginsScenario[] = [
  // --- Horror icon archetypes (original characters) ---
  { category: 'masked_stalker', doc_style: 'true_crime_doc', premise: 'A six-year-old boy stopped speaking after his sister\'s death. He spent 15 years in a state institution, never blinking — until the night he walked out. What he did next made him the most studied case in criminal psychology. He moved through suburban streets wearing a white expressionless mask, standing in yards, watching.', setting_hint: 'suburban street, 1978', fear_type: 'the shape that watches' },
  { category: 'drowned_revenant', doc_style: 'cold_case', premise: 'Camp Crystal Pine closed in 1958 after a drowning the counselors could have prevented. The boy\'s mother disappeared a year later. But every summer since, someone returns to the lake. The body count now stands at 47. The lake has never been drained.', setting_hint: 'summer camp, 1957', fear_type: 'the dead that return' },
  { category: 'dream_researcher', doc_style: 'investigation_files', premise: 'Dr. Frederick Krueger ran a sleep research lab in a small Ohio town. Parents trusted him with their children. When the truth came out, the town handled it themselves. But Krueger had been documenting something about the boundary between waking and dreaming that he claimed to have crossed.', setting_hint: 'boiler room, 1984', fear_type: 'a killer you cannot escape in sleep' },
  { category: 'possessed_doll', doc_style: 'dark_history', premise: 'Charles Leclair was a toymaker who believed objects could hold consciousness. His final creation — a red-haired doll — was found at three separate crime scenes. The doll was destroyed each time. Each time, an identical one appeared somewhere else. Leclair himself had been dead for six months.', setting_hint: 'toy factory, 1988', fear_type: 'something alive inside a toy' },
  { category: 'sewer_entity', doc_style: 'dark_history', premise: 'Every 27 years, the children of Derryfield, Maine go missing at six times the national average. Witnesses across three generations describe the same figure: a performer in white face paint near storm drains, offering something each child wants most. No adult has ever seen it directly.', setting_hint: 'small town storm drain, 1958', fear_type: 'the thing wearing a friendly face' },
  { category: 'phone_killer', doc_style: 'true_crime_doc', premise: 'In 1996, someone began calling teenagers in Woodsboro, California. The voice asked one question: "What\'s your favorite scary movie?" Those who answered wrong were found dead within the hour. The killer wore a costume anyone could buy. That was the point.', setting_hint: 'suburban house, 1996', fear_type: 'the voice that knows your secrets' },
  { category: 'puzzle_craftsman', doc_style: 'investigation_files', premise: 'Philip LeMarchand built puzzle boxes in the 18th century. Of the 270 boxes he created, only six have been recovered. Everyone who solved one reported the same thing before they disappeared: the walls began to rearrange. His journals describe "the configuration" — an arrangement that opens something never meant to be opened.', setting_hint: 'warehouse of puzzle boxes, 1987', fear_type: 'suffering designed as art' },
  { category: 'backwoods_family', doc_style: 'true_crime_doc', premise: 'The Sawyer family ran a slaughterhouse in rural Texas. When the plant closed, the family didn\'t stop working. Between 1969 and 1974, thirty-one travelers disappeared along Route 304. The largest family member wore the faces of others. Literally.', setting_hint: 'Texas farmhouse, 1973', fear_type: 'a family with its own rules about meat' },

  // --- Real-feeling dark biographies ---
  { category: 'cursed_musician', doc_style: 'biography_channel', premise: 'Lucian Deville recorded one album in 1962. It sold four copies. He disappeared for three years. When he returned, his voice had changed — deeper, impossible. His second album went platinum. Session musicians refused to play with him. The recording engineer noted Deville cast no shadow in the studio lights. He died on stage in 1971.', setting_hint: 'recording studio, 1962', fear_type: 'what someone traded for fame' },
  { category: 'vanishing_preacher', doc_style: 'cold_case', premise: 'Reverend Elias Harmon arrived in Crow Hollow with no past and a voice that could fill a cathedral. His congregation grew from 12 to 400 in three years. Then members started disappearing — always the ones who lived alone, always after a private counseling session. When police came, all 400 were gone.', setting_hint: 'white church, 1954', fear_type: 'a shepherd who devours his flock' },
  { category: 'taxidermist', doc_style: 'true_crime_doc', premise: 'Edgar Holloway was the best taxidermist in Dane County — so lifelike that customers said the animals\' eyes followed them. After his death, authorities found his private collection. The "animals" in that room were not animals. His preservation technique cannot be replicated. The bodies looked alive. Some had been dead for twenty years.', setting_hint: 'farmhouse workshop, 1957', fear_type: 'preserving what should decay' },
  { category: 'childrens_host', doc_style: 'investigation_files', premise: 'Mr. Whiskers\' Playhouse ran on local TV from 1968 to 1975. When the show was cancelled, the station claimed budget cuts. But the host had been embedding messages in every episode. Decoded in 2004, they contained the home address of every child who had written a fan letter.', setting_hint: 'TV studio, 1972', fear_type: 'the person children trusted most' },
  { category: 'night_nurse', doc_style: 'cold_case', premise: 'Nurse Margaret Hollister worked nights at St. Catherine\'s for eleven years. Patients requested her by name. Her ward had the highest recovery rate — and the highest unexpected deaths. Every patient she "took a special interest in" had a 50/50 chance. She wasn\'t saving them. She was choosing.', setting_hint: 'hospital ward, 1983', fear_type: 'the caretaker who decides who lives' },
  { category: 'photographer', doc_style: 'dark_history', premise: 'Emmett Voss was a Victorian portrait photographer. His subjects praised his work — impossibly lifelike. But they changed after sitting for him. Quieter, duller, as if something had been removed. His journals: "I do not capture the likeness. I capture the life." His darkroom contained 2,000 portraits. Each one still blinks.', setting_hint: 'portrait studio, 1891', fear_type: 'a camera that takes something from you' },
  { category: 'radio_dj', doc_style: 'investigation_files', premise: 'WKRD 104.7 broadcast midnight to 4 AM from 1975 to 1977. The DJ never appeared at the station. The equipment ran itself. Twenty-three regular listeners were committed to psychiatric facilities. All could recite the same phrase in a language linguists cannot identify.', setting_hint: 'radio station, 1977', fear_type: 'a broadcast that changes the listener' },
  { category: 'ice_cream_man', doc_style: 'true_crime_doc', premise: 'The ice cream truck on Maple Drive played the same melody every afternoon from 1974 to 1978. Every child knew "Mr. Freeze." He gave free popsicles on birthdays. After his arrest, authorities discovered the truck wasn\'t registered. The company didn\'t exist. No one could explain where the ice cream came from. Or what was in it.', setting_hint: 'suburban street, 1978', fear_type: 'the everyday figure no one questions' },

  // --- Real serial killers (true crime documentary) ---
  { category: 'dahmer', doc_style: 'true_crime_doc', premise: 'Jeffrey Dahmer worked at a chocolate factory in Milwaukee. His neighbors complained about the smell. Police visited his apartment twice — once they found a bleeding, naked fourteen-year-old boy outside and returned him to Dahmer after he convinced them it was a lovers\' quarrel. Between 1978 and 1991, seventeen young men entered apartment 213. Their remains were found in acid vats, in the freezer, and arranged on a makeshift altar. Dahmer kept polaroids to remember how they looked before.', setting_hint: 'Milwaukee apartment, 1991', fear_type: 'the monster next door who got away with it' },
  { category: 'bundy', doc_style: 'biography_channel', premise: 'Ted Bundy was handsome, charming, and studied law. Women trusted him. He used a fake arm cast to ask for help carrying things to his car. Between 1974 and 1978, he murdered at least thirty women across seven states. He escaped custody twice. He represented himself at trial and cross-examined the witnesses who survived him. The judge who sentenced him to death called him a bright young man and said he\'d have liked to have him practice law in his courtroom.', setting_hint: 'Pacific Northwest, 1974', fear_type: 'charm as a weapon' },
  { category: 'gein', doc_style: 'cold_case', premise: 'Ed Gein lived alone on a 160-acre farm in Plainfield, Wisconsin after his mother died. He was quiet, helpful, the kind of neighbor who babysat children. When the sheriff entered his farmhouse in November 1957, he found furniture upholstered in human skin, bowls made from skulls, lampshades made from faces, and a suit — a complete female body suit — that Gein wore to become his mother.', setting_hint: 'Plainfield Wisconsin, 1957', fear_type: 'what someone builds from the dead' },
  { category: 'btk', doc_style: 'investigation_files', premise: 'Dennis Rader called himself BTK — Bind, Torture, Kill. He murdered ten people in Wichita, Kansas between 1974 and 1991, then stopped. For thirty years, the case went cold. Rader was a compliance officer, a church council president, a Cub Scout leader. He was caught in 2005 because he asked police if they could trace a floppy disk. They said no. They lied. The metadata on the disk read "Christ Lutheran Church."', setting_hint: 'Wichita Kansas, 1974-2005', fear_type: 'the pillar of the community' },
  { category: 'zodiac', doc_style: 'cold_case', premise: 'The Zodiac Killer attacked couples in the San Francisco Bay Area between 1968 and 1969. He shot them, stabbed them, then wrote letters to newspapers about it. He included ciphers. He called police during the attacks. He wore a homemade executioner\'s hood with a crosshair symbol. He claimed thirty-seven victims. Police confirmed five deaths. He was never identified. His first cipher wasn\'t fully solved until 2020.', setting_hint: 'San Francisco, 1968', fear_type: 'the killer who wanted to be famous' },
  { category: 'ramirez', doc_style: 'true_crime_doc', premise: 'Richard Ramirez — the Night Stalker — entered homes through unlocked windows in Los Angeles during the summer of 1985. He had no victim type. He killed men, women, and children in thirteen different neighborhoods over fourteen weeks. He left pentagrams drawn in lipstick. He forced survivors to swear to Satan. When his face hit the front page, an entire neighborhood chased him down the street until civilians tackled him.', setting_hint: 'Los Angeles, 1985', fear_type: 'someone in your house while you sleep' },
  { category: 'kemper', doc_style: 'biography_channel', premise: 'Edmund Kemper stood six feet nine inches tall and had an IQ of 145. He murdered his grandparents at fifteen "to see what it felt like." Released at twenty-one, he killed six college hitchhikers, then his mother and her friend. He drank beers with off-duty cops — they considered him a friend. He called police to confess. They didn\'t believe him. He had to call three times.', setting_hint: 'Santa Cruz California, 1973', fear_type: 'intelligence weaponized' },
  { category: 'gacy', doc_style: 'true_crime_doc', premise: 'John Wayne Gacy was a building contractor, a Democratic Party volunteer, and a children\'s party clown named "Pogo." He was photographed with the First Lady. Between 1972 and 1978, he murdered at least thirty-three young men and buried twenty-six of them in the crawl space beneath his house. His neighbors complained about the smell for years. Gacy told them it was a broken sewer pipe.', setting_hint: 'Des Plaines Illinois, 1978', fear_type: 'the clown who buried them under the house' },
  { category: 'wuornos', doc_style: 'cold_case', premise: 'Aileen Wuornos was a highway prostitute in Florida who shot and killed seven men between 1989 and 1990. She claimed every killing was self-defense. The jury didn\'t believe her. Her childhood had been documented by social services in fourteen separate reports spanning ten years. Nobody had intervened.', setting_hint: 'Florida highways, 1989', fear_type: 'what the system creates by looking away' },
  { category: 'hh_holmes', doc_style: 'dark_history', premise: 'H.H. Holmes built a three-story hotel in Chicago during the 1893 World\'s Fair. He designed it himself. The blueprints made no sense: hallways to nowhere, rooms with no windows, chutes to the basement. He hired and fired crews constantly so no one saw the full layout. The building contained gas lines to sealed rooms, a soundproofed vault, and a kiln large enough for a body. He confessed to twenty-seven murders. The real number may exceed two hundred.', setting_hint: 'Chicago, 1893', fear_type: 'a building designed to kill' },
  { category: 'fish', doc_style: 'investigation_files', premise: 'Albert Fish was sixty-five and looked like a kindly grandfather. He wrote an anonymous letter to the mother of ten-year-old Grace Budd — a child he\'d murdered six years earlier — describing what he\'d done in detail. The letter was traced because the envelope bore a flophouse logo. Fish had inserted twenty-nine needles into his own pelvis over the years. They appeared on the prison X-ray like a constellation.', setting_hint: 'New York City, 1934', fear_type: 'evil wearing the face of a grandfather' },
  { category: 'berkowitz', doc_style: 'true_crime_doc', premise: 'David Berkowitz — Son of Sam — shot thirteen people and killed six in New York City between 1976 and 1977 using a .44 caliber revolver. He attacked couples in parked cars. He wrote letters to police and newspapers claiming his neighbor\'s dog commanded him to kill. The entire city lived in terror. Women cut their hair because he seemed to prefer brunettes. He was caught because of a parking ticket. When arrested, he was smiling.', setting_hint: 'New York City, 1977', fear_type: 'a city held hostage by one man' },
];

/**
 * Pick a random dark origins scenario, avoiding recently used settings.
 */
function pickDarkOriginsScenario(recentSettings?: string[]): DarkOriginsScenario & { scenario_index: number } {
  let pool = DARK_ORIGINS_SCENARIOS.map((s, i) => ({ ...s, scenario_index: i }));
  
  if (recentSettings && recentSettings.length > 0) {
    const recentLower = recentSettings.map(s => s.toLowerCase());
    const unused = pool.filter(s => 
      !recentLower.some(r => 
        r.includes(s.setting_hint.toLowerCase()) || 
        r.includes(s.category.toLowerCase())
      )
    );
    if (unused.length >= 3) pool = unused;
  }
  
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Build the prompt for generating a dark origins documentary-style horror story.
 */
function buildDarkOriginsPrompt(
  scenario: DarkOriginsScenario,
  wordRange: { min: number; max: number },
  recentStories?: Array<{ title: string; hook: string | null; setting?: string }>
): string {
  let avoidanceSection = '';
  if (recentStories && recentStories.length > 0) {
    const avoidList = recentStories.map(s => {
      const parts = [`"${s.title}"`];
      if (s.setting) parts.push(`(setting: ${s.setting})`);
      return parts.join(' ');
    }).join('\n- ');
    avoidanceSection = `\n\nDO NOT REPEAT — these stories were already created recently:\n- ${avoidList}\n\nYour story must feel completely fresh and explore a DIFFERENT character/era than any of the above.`;
  }

  return `Write an original dark biography / horror origin story inspired by this scenario seed. The scenario is a STARTING POINT — expand, twist, and make it your own.

SCENARIO SEED (${scenario.doc_style} style):
"""
${scenario.premise}
"""

DOCUMENTARY STYLE: ${scenario.doc_style === 'true_crime_doc' ? 'True Crime Documentary — Dateline, 48 Hours style. Calm narrator presenting disturbing evidence.' :
  scenario.doc_style === 'biography_channel' ? 'Biography Channel — dark profile of a fascinating figure. Rise, secret, fall.' :
  scenario.doc_style === 'cold_case' ? 'Cold Case Files — reopened investigation, suppressed evidence, answers that raise more questions.' :
  scenario.doc_style === 'investigation_files' ? 'Investigation Files — sealed documents, classified reports, a pattern hidden in plain sight.' :
  'Dark History — historical horror buried and forgotten, brought to light.'}

CORE FEAR: ${scenario.fear_type}

REQUIREMENTS:
- Word count: ${wordRange.min}-${wordRange.max} words (STRICT — controls video timing!)
- Use the scenario as INSPIRATION only — add your own details, dates, locations, specifics
- THIRD-PERSON documentary narrator — calm, factual, investigative
- "This was a real person. This really happened." energy throughout
- Single main character study — who they were, what they did, what they became
- End on an UNRESOLVED note — case never closed, body never found, recordings never explained

SETTING RULES (CRITICAL — this is what makes this preset DIFFERENT):
- Set stories in HISTORICAL periods: 1950s, 1960s, 1970s, 1980s, early 1990s
- Use SMALL TOWNS, rural areas, institutions (hospitals, churches, factories, studios)
- Ground in specific DATES, PLACES, and NUMBERS — "March 14, 1967", "Dane County, Wisconsin", "thirty-one travelers"
- Characters should be SPECIFIC PEOPLE with occupations: toymakers, nurses, preachers, photographers, musicians
- Do NOT use modern technology, social media, smartphones, apps
- Do NOT use generic "someone" — name the character, give them a profession, a town, a year

STRUCTURE (MANDATORY):
[HOOK] — First 1-2 sentences. SCROLL-STOPPING opener that makes someone stop scrolling. USE ONE OF THESE PATTERNS:
  • "Did you know [specific shocking fact]?" — e.g. "Did you know he kept polaroids of all seventeen victims?"
  • "This man killed [X] people and nobody noticed for [Y] years." — specific numbers are MANDATORY
  • "In [year], [shocking event with a number]." — e.g. "In 1957, a sheriff opened a farmhouse door and found furniture made of human skin."
  • "What [name] kept in his [location] would change [field] forever." — e.g. "What Gacy kept under his house would change forensic science forever."
  The hook MUST contain a SPECIFIC NUMBER or a SHOCKING CONCRETE FACT. No vague "something terrible happened." No slow buildups. Hit hard in the FIRST sentence.
[ORIGIN] — Who was this person? Establish them as normal, trusted, even admired. Plant the seed of wrongness.
[DESCENT] — The turning point. What they did, what was discovered, the moment the mask slipped. Include specific evidence: dates, numbers, documents, testimony.
[AFTERMATH] — What happened after. The investigation, the disappearance, the sealed files. The question that was never answered.
  OPTIONAL: If the case is rich enough, end with a SERIES HOOK — "But the basement was only the beginning." / "That was the first house. There were two more." This implies a Part 2 and encourages viewers to follow.

STYLE RULES:
- No gore — psychological horror and implication only
- Every sentence must be visually filmable as a dark, realistic illustrated scene
- Include specific factual-sounding details: dates, population numbers, case file numbers, distances
- Use documentary phrasing: "Authorities later discovered...", "The official report stated...", "What they found in the basement..."
- The narrator knows more than they're telling — let implication do the work
- Include at least ONE piece of "evidence" described in detail (a photograph, a journal entry, a recording, a police report)
- Mix long investigative sentences with short chilling statements: "The report was sealed. The town moved on. The basement was never opened again."

DUAL-TIMELINE TECHNIQUE (MANDATORY):
- Cut between THEN and NOW at least once in the story. Examples:
  • "Today, the house at 213 Oxford Apartments still stands. The unit has been vacant since 1991."
  • "The church in Crow Hollow is still there. No one has held a service in seventy years."
  • "As of 2024, the case remains open. The crawl space has been sealed with concrete."
- This grounds the story in reality and makes viewers feel the horror is CURRENT, not distant history.
- Place the present-day detail either in the AFTERMATH or weave it between the DESCENT and AFTERMATH.

"BASED ON REAL EVENTS" ENERGY (MANDATORY):
- Begin the story with one of these documentary framing devices (naturally integrated, not a disclaimer):
  • "The following events are documented in [county] court records."
  • "This case was reopened in [year] after new evidence surfaced."
  • "What happened in [town] between [year] and [year] was verified by [number] witnesses."
- This single line makes every viewer lean in. It turns fiction into "fact."

ENDING (MANDATORY):
- End with a chilling final statement that lingers. This is SPOKEN NARRATION in a video, not a text post.
- Great documentary endings leave the horror UNRESOLVED — the case is still open, the evidence was never explained, the body was never found.
- Use matter-of-fact documentary voice for maximum impact: "The basement was sealed with concrete. No one has entered since."
- OPTIONAL: If the case is rich enough, end with a SERIES HOOK — "But the basement was only the beginning." / "That was the first house. There were two more." This implies a Part 2 and encourages viewers to follow.
- Do NOT end with a direct question asking the audience to comment. Rhetorical statements are fine: "Some say the recordings are still playing." — but NOT "Would you listen?" or "What do you think?"${avoidanceSection}

Respond in JSON format:
{
  "title": "Short catchy title (3-6 words)",
  "story": "The full story text...",
  "setting": "One or two words describing the primary setting/location",
  "concept": "One sentence summarizing the core concept/premise"
}`;
}

// =====================================================
// STEP 1: STORY GENERATION
// =====================================================

export async function executeStoryStep(
  supabase: SupabaseClient,
  job: Job,
  workerId: string,
  env: Record<string, string>,
  logger: StepLogger
): Promise<StepResult> {
  const idempotencyKey = `${job.id}:story_generate`;

  // Check if story already exists
  if (job.story_text && job.title) {
    console.log(`[STORY] Story already exists: "${job.title}"`);
    
    // Ensure asset record exists for idempotency
    const existingAsset = await getAssetByKey(supabase, job.id, idempotencyKey);
    if (!existingAsset) {
      const contentHash = await computeHash(job.story_text);
      await upsertAsset(supabase, job.id, idempotencyKey, 'story', '', null, {
        title: job.title,
        content_hash: contentHash,
        word_count: job.story_text.split(/\s+/).length,
        source: 'existing'
      });
    }
    
    return { success: true, skipped: true, data: { title: job.title } };
  }

  // Check if asset exists (previous partial run)
  const existingAsset = await getAssetByKey(supabase, job.id, idempotencyKey);
  if (existingAsset?.meta?.title && existingAsset?.meta?.story_text) {
    console.log(`[STORY] Restoring from asset: "${existingAsset.meta.title}"`);
    await updateJobFields(supabase, job.id, {
      title: existingAsset.meta.title,
      story_text: existingAsset.meta.story_text,
    });
    return { success: true, skipped: true, data: { title: existingAsset.meta.title } };
  }

  // Generate story directly via OpenAI
  const openaiKey = env.OPENAI_API_KEY;
  if (!openaiKey) {
    return { success: false, error: 'OPENAI_API_KEY not configured' };
  }
  
  const vibePreset = job.vibe_preset || (job.meta?.vibe_preset as string) || 'urban_legend';
  const duration = (job.meta?.duration as { min?: number; max?: number; minSeconds?: number; maxSeconds?: number } | number) || 60;
  // Dark origins performs better at 90s+ (documentary pacing, algorithm retention)
  const defaultDuration = vibePreset === 'dark_origins' ? 90 : 60;
  // v11.0: Also check minSeconds/maxSeconds (used by campaign scheduler)
  const targetDuration = typeof duration === 'object'
    ? (duration.min || duration.minSeconds || defaultDuration)
    : (duration || defaultDuration);

  // Calculate target word count (roughly 2.5 words per second for narration)
  const targetWords = Math.round(targetDuration * 2.5);
  const wordRange = { min: Math.round(targetWords * 0.85), max: Math.round(targetWords * 1.15) };

  // Preset-specific word range overrides (v2: shorter, tighter scripts)
  if (vibePreset === 'no_good_choice') {
    wordRange.min = 80;
    wordRange.max = 110;
  }
  if (vibePreset === 'two_doors') {
    wordRange.min = 70;
    wordRange.max = 95;
  }
  if (vibePreset === 'one_rule_one_power') {
    wordRange.min = 80;
    wordRange.max = 110;
  }

  console.log(`[STORY] Generating story for vibe=${vibePreset}, duration=${targetDuration}s (~${targetWords} words)`);

  try {
    // Query recent stories for this brand+preset to avoid thematic repetition
    let recentStories: Array<{ title: string; hook: string | null; setting?: string }> = [];
    try {
      const { data: recent } = await supabase
        .from('stories')
        .select('title, hook')
        .eq('vibe_preset', vibePreset)
        .order('created_at', { ascending: false })
        .limit(20);
      if (recent && recent.length > 0) {
        recentStories = recent;
        console.log(`[STORY] Found ${recent.length} recent ${vibePreset} stories to avoid`);
      }
    } catch (e) {
      console.warn(`[STORY] Could not fetch recent stories (non-fatal): ${e}`);
    }

    // Also check story_dna for concept/setting data from recent jobs
    try {
      const { data: recentDna } = await supabase
        .from('story_dna')
        .select('meta')
        .eq('genre', vibePreset)
        .eq('brand_id', job.brand_id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (recentDna) {
        for (const dna of recentDna) {
          const setting = (dna.meta as Record<string, unknown>)?.setting as string;
          if (setting) {
            // Merge setting info into recentStories for avoidance
            const existing = recentStories.find(s => s.title === (dna.meta as Record<string, unknown>)?.title);
            if (existing) existing.setting = setting;
          }
        }
      }
    } catch (e) {
      // Non-fatal
    }

    // ── Fetch audience retention data for pacing guidance ──────────
    let retentionContext = '';
    try {
      const { data: retentionData } = await supabase
        .from('v_visual_performance')
        .select('vibe_preset, avg_view_duration_seconds, perf_score')
        .eq('brand_id', job.brand_id)
        .not('avg_view_duration_seconds', 'is', null)
        .gt('avg_view_duration_seconds', 0);

      if (retentionData && retentionData.length > 0) {
        // Prefer preset-specific data, fall back to brand-wide average
        const presetRows = retentionData.filter(r => r.vibe_preset === vibePreset);
        const rows = presetRows.length >= 3 ? presetRows : retentionData;
        const totalPosts = rows.length;
        const avgRetention = rows.reduce((sum: number, r: Record<string, number>) => sum + (r.avg_view_duration_seconds || 0), 0) / totalPosts;
        const bestRetention = Math.max(...rows.map((r: Record<string, number>) => r.avg_view_duration_seconds || 0));
        const avgPerf = rows.reduce((sum: number, r: Record<string, number>) => sum + (r.perf_score || 0), 0) / totalPosts;

        if (avgRetention > 0) {
          const midPoint = Math.floor(avgRetention * 0.4);
          const climaxPoint = Math.floor(avgRetention * 0.75);
          const tailSeconds = Math.floor(avgRetention * 0.25);

          retentionContext = `

AUDIENCE RETENTION DATA (from ${totalPosts} previous posts):
- Average watch time: ${avgRetention.toFixed(1)} seconds
- Best watch time: ${bestRetention.toFixed(1)} seconds
- Avg performance score: ${avgPerf.toFixed(0)}
PACING GUIDANCE based on real audience data:
  • HOOK must hit in the first 3 seconds — this is when most viewers decide to stay or scroll
  • Place a TENSION ESCALATION or MINI-REVEAL at ~${midPoint} seconds to retain mid-point viewers
  • The CLIMAX or major TWIST should land at ~${climaxPoint} seconds (75% mark) — engaged viewers get their payoff here
  • Reserve the final ~${tailSeconds} seconds for a cliffhanger, unanswered question, or comment-bait that drives engagement
  • Stories that FRONT-LOAD intrigue and maintain escalating tension past the ${midPoint}-second mark consistently outperform`;
          console.log(`[STORY] Retention context: avg=${avgRetention.toFixed(1)}s, best=${bestRetention.toFixed(1)}s from ${totalPosts} posts (${presetRows.length >= 3 ? 'preset-specific' : 'brand-wide'})`);
        }
      }
    } catch (e) {
      console.warn(`[STORY] Could not fetch retention data (non-fatal): ${e}`);
    }

    // Build story prompt based on vibe preset
    // For reddit_trending_horror, pick a curated horror scenario and build a Reddit-inspired prompt
    // For dark_origins, pick a documentary dark biography scenario
    let horrorScenario: (HorrorScenario & { scenario_index: number }) | null = null;
    let darkOriginsScenario: (DarkOriginsScenario & { scenario_index: number }) | null = null;
    let storyPrompt: string;

    if (vibePreset === 'reddit_trending_horror') {
      const recentSettings = recentStories?.map(s => s.setting).filter(Boolean) as string[] || [];
      horrorScenario = pickHorrorScenario(recentSettings);
      console.log(`[STORY] Reddit-inspired scenario: "${horrorScenario.category}" (${horrorScenario.subreddit_style} style, fear: ${horrorScenario.fear_type})`);
      storyPrompt = buildRedditInspiredPrompt(horrorScenario, wordRange, recentStories);
    } else if (vibePreset === 'dark_origins') {
      const recentSettings = recentStories?.map(s => s.setting).filter(Boolean) as string[] || [];
      darkOriginsScenario = pickDarkOriginsScenario(recentSettings);
      console.log(`[STORY] Dark Origins scenario: "${darkOriginsScenario.category}" (${darkOriginsScenario.doc_style} style, fear: ${darkOriginsScenario.fear_type})`);
      storyPrompt = buildDarkOriginsPrompt(darkOriginsScenario, wordRange, recentStories);
    } else {
      storyPrompt = buildStoryPrompt(vibePreset, wordRange, recentStories);
    }

    // Append retention pacing guidance to the prompt (if available)
    if (retentionContext) {
      storyPrompt += retentionContext;
    }

    // Log prompt snapshot
    await logger.snapshot('story', 'prompt', storyPrompt, `OpenAI prompt for ${vibePreset} story`);

    // ── Story Generation with Quality Gate Retry Loop ──────────
    // If the quality gate rejects the story, we regenerate in-place (up to 3 attempts).
    // Previous implementation threw an error, but the pipeline has no step-level retry,
    // so the throw was causing a permanent failure instead of a retry.
    const MAX_GATE_ATTEMPTS = 3;
    let title = '';
    let storyText = '';
    let storySetting = '';
    let storyConcept = '';
    let gateAttempt = 0;
    let gatePassed = false;

    while (gateAttempt < MAX_GATE_ATTEMPTS && !gatePassed) {
      gateAttempt++;
      console.log(`[STORY] Generation attempt ${gateAttempt}/${MAX_GATE_ATTEMPTS}`);

      // Rebuild prompt on retry (picks different scenario/seed for variety)
      if (gateAttempt > 1) {
        if (vibePreset === 'reddit_trending_horror') {
          const recentSettings2 = recentStories?.map(s => s.setting).filter(Boolean) as string[] || [];
          horrorScenario = pickHorrorScenario(recentSettings2);
          storyPrompt = buildRedditInspiredPrompt(horrorScenario, wordRange, recentStories);
        } else if (vibePreset === 'dark_origins') {
          const recentSettings2 = recentStories?.map(s => s.setting).filter(Boolean) as string[] || [];
          darkOriginsScenario = pickDarkOriginsScenario(recentSettings2);
          storyPrompt = buildDarkOriginsPrompt(darkOriginsScenario, wordRange, recentStories);
        } else {
          storyPrompt = buildStoryPrompt(vibePreset, wordRange, recentStories);
        }
        // Re-append retention context on retry
        if (retentionContext) {
          storyPrompt += retentionContext;
        }
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: getStorySystemPrompt(vibePreset),
            },
            {
              role: 'user',
              content: storyPrompt
            }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.9 + (gateAttempt - 1) * 0.05, // Slightly increase temp on retry for variety
          max_tokens: 2000,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('No content in OpenAI response');
      }

      const parsed = JSON.parse(content);
      title = parsed.title || 'Untitled Story';
      storyText = parsed.story || parsed.content || parsed.text || '';

      // Sanitize dashes from narration text — em-dashes and standalone hyphens
      // don't render well in subtitles/captions
      if (storyText) {
        storyText = storyText
          .replace(/\s*—\s*/g, ', ')      // em-dash → comma
          .replace(/\s*–\s*/g, ', ')      // en-dash → comma
          .replace(/\s+-\s+/g, ', ')      // spaced hyphen → comma
          .replace(/,\s*,/g, ',')         // clean up double commas
          .replace(/,\s*\./g, '.')        // clean up comma before period
          .trim();
        console.log(`[STORY] Sanitized dashes from narration text`);
      }

      storySetting = parsed.setting || '';
      storyConcept = parsed.concept || '';

      if (!storyText) {
        throw new Error('Story generation returned no story text');
      }

      // ── Quality Gate: Preset-specific content validation ──────────
      const qualityGateResult = runQualityGate(vibePreset, storyText, title);
      if (qualityGateResult.passed) {
        console.log(`[STORY] ✓ Quality gate passed for ${vibePreset} (attempt ${gateAttempt})`);
        gatePassed = true;
      } else {
        const gateMsg = `Quality gate failed for ${vibePreset}: ${qualityGateResult.failures.join('; ')}`;
        console.warn(`[STORY] ⚠️ ${gateMsg} (attempt ${gateAttempt}/${MAX_GATE_ATTEMPTS})`);
        await logger.snapshot('story', 'quality_gate_fail', {
          preset: vibePreset,
          failures: qualityGateResult.failures,
          title,
          story_preview: storyText.slice(0, 200),
          attempt: gateAttempt,
        }, gateMsg);

        if (gateAttempt >= MAX_GATE_ATTEMPTS) {
          // Max retries — accept the story but log the issue
          console.warn(`[STORY] Quality gate failed ${gateAttempt} times, accepting story anyway`);
          await logger.snapshot('story', 'quality_gate_accepted', {
            preset: vibePreset,
            failures: qualityGateResult.failures,
            attempts: gateAttempt,
          }, 'Quality gate max retries — story accepted');
          gatePassed = true; // Accept anyway
        }
      }
    }

    const contentHash = await computeHash(storyText);
    const titleHash = await computeHash(title);
    // Build a concept hash from setting+concept (for thematic uniqueness, not just text)
    const conceptString = `${storySetting}|${storyConcept}`.toLowerCase().trim();
    const conceptHash = conceptString.length > 1 ? await computeHash(conceptString) : contentHash;
    const wordCount = storyText.split(/\s+/).length;
    const sentences = storyText.split(/(?<=[.!?])\s+/).filter((s: string) => s.trim().length > 0);
    const sentenceCount = sentences.length;
    const avgSentenceLength = sentenceCount > 0 ? wordCount / sentenceCount : 0;

    // Log response snapshot (truncated story)
    await logger.snapshot('story', 'response', { title, story_preview: storyText.slice(0, 300), word_count: wordCount }, 'Generated story');

    // Update job
    await updateJobFields(supabase, job.id, {
      title: title,
      story_text: storyText,
      story_word_count: wordCount,
    });

    // Write to stories table for uniqueness tracking
    // This populates the canonical story registry that story_dna references
    try {
      const { data: existingStory } = await supabase
        .from('stories')
        .select('id')
        .eq('content_hash', contentHash)
        .limit(1)
        .maybeSingle();

      if (existingStory) {
        console.log(`[STORY] Story already in stories table (hash collision, id=${existingStory.id})`);
      } else {
        const { error: storyInsertError } = await supabase
          .from('stories')
          .insert({
            title,
            story_text: storyText,
            content_hash: contentHash,
            title_hash: titleHash,
            word_count: wordCount,
            sentence_count: sentenceCount,
            avg_sentence_length: Math.round(avgSentenceLength * 100) / 100,
            hook: storyText.split(/[.!?]/)[0]?.trim() || title,
            vibe_preset: vibePreset,
            source_job_id: job.id,
          });

        if (storyInsertError) {
          console.warn(`[STORY] stories table insert warning: ${storyInsertError.message}`);
        } else {
          console.log(`[STORY] ✓ Inserted into stories table (hash: ${contentHash.substring(0, 16)})`);
        }
      }
    } catch (e) {
      console.warn(`[STORY] stories table insert failed (non-fatal): ${e}`);
    }

    // Store asset for idempotency (include concept metadata for uniqueness step)
    await upsertAsset(supabase, job.id, idempotencyKey, 'story', '', null, {
      title: title,
      story_text: storyText,
      content_hash: contentHash,
      concept_hash: conceptHash,
      setting: storySetting,
      concept: storyConcept,
      word_count: wordCount,
      vibe_preset: vibePreset,
      generated_at: new Date().toISOString(),
      // Include Reddit-inspired scenario metadata if available
      ...(horrorScenario ? {
        scenario_category: horrorScenario.category,
        scenario_subreddit_style: horrorScenario.subreddit_style,
        scenario_fear_type: horrorScenario.fear_type,
        scenario_setting_hint: horrorScenario.setting_hint,
        scenario_index: horrorScenario.scenario_index,
      } : {}),
    });

    // Store scenario metadata in job meta (for campaign detail page display)
    if (horrorScenario) {
      try {
        await updateJobMeta(supabase, job.id, {
          scenario_category: horrorScenario.category,
          scenario_subreddit_style: horrorScenario.subreddit_style,
          scenario_fear_type: horrorScenario.fear_type,
          scenario_setting_hint: horrorScenario.setting_hint,
        });
        console.log(`[STORY] ✓ Scenario metadata stored in job meta`);
      } catch (e) {
        console.warn(`[STORY] Could not store scenario in job meta (non-fatal): ${e}`);
      }
    }

    console.log(`[STORY] ✓ Generated: "${title}" (${wordCount} words)${horrorScenario ? ` [scenario: ${horrorScenario.category}/${horrorScenario.subreddit_style}]` : ''}`);
    return { success: true, data: { title, word_count: wordCount } };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[STORY] ✗ Failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * Build a rich one_too_many prompt with randomized story seed ingredients.
 * These are SUGGESTIONS, not rigid requirements — GPT picks what serves the story.
 */
function buildOneToManyPrompt(wordRange: { min: number; max: number }): string {
  // Randomize story seeds so each generation gets different raw material
  const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

  const groupSizes = [
    { start: 4, extra: 5 }, { start: 5, extra: 6 }, { start: 6, extra: 7 },
    { start: 7, extra: 8 }, { start: 8, extra: 9 },
  ];
  const groupTypes = [
    'college friends on a road trip', 'coworkers at a team retreat', 'family members on a camping trip',
    'hikers in a guided group', 'wedding party staying at a cabin', 'students on a field trip',
    'old friends reuniting for a birthday', 'neighbors evacuating together',
  ];
  const containers = [
    'rented van', 'hotel hallway', 'elevator', 'subway car', 'lakeside cabin', 'ferry deck',
    'bus', 'mountain lodge', 'rental car', 'campfire circle', 'motel room', 'train car',
    'small boat', 'ski lift gondola', 'escape room', 'tour bus', 'basement', 'dorm common room',
  ];
  const evidenceSources = [
    'group photo on someone\'s phone', 'dashcam footage', 'security camera still',
    'bathroom mirror reflection', 'group selfie', 'receipt showing wrong headcount',
    'polaroid from that night', 'CCTV playback at gas station', 'hotel key card log',
    'restaurant bill showing wrong covers', 'video doorbell footage',
  ];
  const glitches = [
    'clock keeps resetting to the same time', 'doors won\'t unlock from inside',
    'windows won\'t roll down', 'radio playing the same song on loop',
    'GPS rerouting to a dead end', 'phones showing different times',
    'camera missing frames', 'no cell service despite full bars',
    'lights flicker whenever someone mentions the count', 'engine dies when they try to leave',
  ];
  const witnesses = [
    'gas station attendant', 'security guard', 'motel clerk', 'toll booth operator',
    'restaurant host', 'park ranger', 'bus driver', 'ferry worker',
  ];
  const dialogueLines = [
    'I think we\'re one too many.', 'Wait... count again.', 'That can\'t be right.',
    'Who\'s the extra?', 'The number\'s wrong.', 'Count them again.',
  ];

  // Pick random seeds for this generation
  const size = pick(groupSizes);
  const group = pick(groupTypes);
  const container = pick(containers);
  const evidence = pick(evidenceSources);
  const glitch = pick(glitches);
  const witness = pick(witnesses);
  const dialogue = pick(dialogueLines);

  return `a counting horror story — the "one too many" subgenre. A group of people realizes there is one extra person among them who shouldn't be there.

STORY SEED (use these as inspiration — adapt freely to serve YOUR story):
- Group: ${size.start} ${group}
- Setting/Container: ${container}
- The count keeps showing ${size.extra} instead of ${size.start}
- Possible dialogue: "${dialogue}"

THE COUNTING HORROR FORMULA (the core that makes this genre work):
The horror comes from MATHEMATICS, not monsters. A group of N people counts and gets N+1. They recount. Still N+1. The extra person looks normal — that's what makes it terrifying. Nobody can agree on who doesn't belong because everyone looks like they fit.

STORYTELLING TOOLKIT (use whichever elements make your story richer):
- RECOUNTS: The group counts multiple times, different ways (headcount, by seat, by name). Always comes up wrong.
- SPATIAL GROUNDING: Establish where everyone is physically — who sits where, who's by the door, who's in the back. When the count breaks, the reader should be able to "see" the extra person in the arrangement. The geometry of bodies in a confined space makes the wrong number visceral.
- EXTERNAL CONFIRMATION: An outsider (like a ${witness}) independently notices the wrong number — it's not just the group's paranoia. Layer it: the outsider confirms, someone investigates later and finds nothing, then delayed proof surfaces anyway.
- ENVIRONMENTAL DISTURBANCE: Weave 2-3 small wrongnesses throughout — things that break BECAUSE the count is off (e.g. ${glitch}). Don't dump them all at once; scatter them so the reader feels reality fraying at the seams.
- VISUAL PROOF: Evidence surfaces later showing the wrong count (e.g. ${evidence}) — the extra person was REAL, captured on record.
- THE EXTRA — "ALMOST RIGHT": The extra person looks normal at first glance. But describe what's slightly OFF — a smile that arrives half a second late, eyes that track movement a beat behind, a voice that sounds like it learned human speech from recordings. The uncanny valley is the horror: close enough to pass, wrong enough to feel.
- NAMED CHARACTERS: Give at least the person who FIRST notices the wrong count a name. A name makes the terror personal — "Marcus counted twice" hits harder than "someone counted twice."
- AFTERMATH WITH TIME-SKIP: Don't just end when they escape. Push the epilogue forward — weeks later, months later. The photo resurfaces. The dashcam footage gets reviewed. Someone finds their name on a list they were never on. The proof lingers long after the event.

TONE & STYLE:
- Write like you're calmly recounting something deeply unsettling
- Use SPECIFIC numbers ("there were ${size.start} of us", "the count showed ${size.extra}") — vague counts kill counting horror
- Ground the reader in physical details (What does the space look like? Where is everyone sitting? What does the air feel like?)
- Short punchy sentences for tension. Longer flowing ones for unease.
- NEVER use dashes (—, –, -) as punctuation. Use commas, periods, or semicolons instead.
- The hook should grab attention in the first 3 seconds — "Did you know..." hooks, shocking statements, or immediate immersion all work
- End with something that lingers — unresolved, a final image, proof that won't go away

Word count: ${wordRange.min}-${wordRange.max} words (critical for video timing).
Each story MUST use a completely different and unique setting from all previous stories`;
}

/**
 * Get preset-specific system prompt for story generation.
 * Some presets work better with different narrative voices.
 */
function getStorySystemPrompt(vibePreset: string): string {
  if (vibePreset === 'one_too_many') {
    return `You are a master storyteller specializing in short-form horror and mystery content for TikTok/Reels narration. For counting horror stories, you can use ANY narrative voice that best serves the story, first-person ("I counted again..."), third-person documentary ("They counted again..."), or even a "Did you know..." factual hook style. Choose whichever voice makes THIS particular story most gripping. You write like a calm, factual narrator recounting something deeply unsettling, the horror comes from the math not adding up, not from gore or monsters.

CRITICAL FORMATTING RULE: NEVER use dashes, em-dashes (—), en-dashes (–), or hyphens (-) as punctuation in the narration. Use commas, periods, semicolons, or ellipses instead. This text will be displayed as on-screen subtitles and used as platform captions where dashes render poorly.`;
  }
  if (vibePreset === 'reddit_trending_horror') {
    return `You are a master storyteller who writes ORIGINAL horror scripts in the style of viral Reddit posts. You write in FIRST-PERSON, the narrator is someone recounting what happened to them, like a real person confessing a real experience. Your voice is CONFESSIONAL, not dramatic. You sound like someone sitting across from a friend saying "okay so this is going to sound crazy but...", reluctant, self-aware, grounded in mundane reality before the horror creeps in.

CRUCIAL TONE RULES:
- First-person. Always. ("I noticed..." "My stomach dropped..." "I told myself it was nothing.")
- The narrator has thoughts, doubts, rationalizations, they THINK on the page
- Include at least one moment of mundane normalcy BEFORE the horror (buying gum, checking a bank app, a fridge humming)
- Include at least one brief dialogue exchange, real people talking like real people
- Sentences vary: some punchy fragments, some longer interior thoughts
- Horror comes from MODERN, EVERYDAY environments (apartments, phones, gig work, smart homes) NOT rural folklore
- No Reddit references, no usernames, no "OP"
- Every sentence must be visually filmable as a 2D illustrated scene

CRITICAL FORMATTING RULE: NEVER use dashes, em-dashes (—), en-dashes (–), or hyphens (-) as punctuation in the narration. Use commas, periods, semicolons, or ellipses instead. This text will be displayed as on-screen subtitles and used as platform captions where dashes render poorly.`;
  }
  if (vibePreset === 'dark_origins') {
    return `You are a documentary narrator specializing in dark biographies and unsolved mysteries. You write in THIRD-PERSON, calm, factual, investigative, like the narrator of a Dateline or Investigation Discovery special. Your tone says "this was a real person" even when the story is fiction.

CRUCIAL TONE RULES:
- Third-person documentary voice. Always. ("He arrived in town..." "Authorities later discovered..." "The case was never closed.")
- Sound like a true crime documentary narrator, measured, authoritative, letting the facts do the horror
- SCROLL-STOPPING FIRST SENTENCE, the very first sentence must make someone stop scrolling. Use shocking numbers, specific facts, or "Did you know..." hooks. Examples: "This man killed 33 people and buried 26 of them in his crawl space." / "Did you know he kept polaroids of every victim?" / "In 1957, a sheriff opened a door and found furniture made of human skin."
- Include specific dates, locations, and numbers to make fiction feel like fact
- The narrator knows more than they're telling, implication over exposition
- No first-person. No "I." No confessional voice.
- Characters are HISTORICAL figures with names, professions, and specific time periods (1950s-1990s)
- Every sentence must be visually filmable as a dark, realistic scene
- End with an unresolved thread: "The case remains open." / "The recordings were never explained." / "No body was ever found."
- OPTIONAL: End with a series hook implying Part 2: "But that was only the first house." / "What they found next was worse."
- DUAL-TIMELINE: Cut between THEN and NOW at least once, "Today, the building still stands..." to make it feel current.
- "BASED ON REAL EVENTS" ENERGY: Open with a documentary framing line like "The following events are documented in county records", one line that makes fiction feel like fact.
- COMMENT-BAIT: The LAST sentence should be a question or provocative statement that drives viewer comments: "Do you think the neighbors really didn't know?" / "Was he acting alone?"
- This is NOT internet horror. This is documentary horror, the horror of real things that happened in real places to real people.

CRITICAL FORMATTING RULE: NEVER use dashes, em-dashes (—), en-dashes (–), or hyphens (-) as punctuation in the narration. Use commas, periods, semicolons, or ellipses instead. This text will be displayed as on-screen subtitles and used as platform captions where dashes render poorly.`;
  }
  // DecideThisDaily decision presets: second-person, spoken-word native, no horror
  if (['no_good_choice', 'one_rule_one_power', 'two_doors'].includes(vibePreset)) {
    return `You are a short-form content writer specializing in decision and dilemma scripts for Instagram Reels, YouTube Shorts, and TikTok. You write in SECOND-PERSON ("you", "your"), speaking directly to the viewer. Your tone is provocative but neutral, like someone calmly presenting an impossible choice. Every sentence must sound natural when read aloud. Short, punchy, conversational. No literary flourishes. No essays.

CRITICAL FORMATTING RULE: NEVER use dashes, em-dashes (—), en-dashes (–), or hyphens (-) as punctuation in the narration. Use commas, periods, semicolons, or ellipses instead. This text will be displayed as on-screen subtitles and used as platform captions where dashes render poorly.`;
  }
  return `You are a master storyteller specializing in short-form horror and mystery content. You create gripping, atmospheric stories perfect for TikTok/Reels narration. Your stories are ALWAYS first-person narration that feels personal and immediate.

CRITICAL FORMATTING RULE: NEVER use dashes, em-dashes (—), en-dashes (–), or hyphens (-) as punctuation in the narration. Use commas, periods, semicolons, or ellipses instead. This text will be displayed as on-screen subtitles and used as platform captions where dashes render poorly.`;
}

/**
 * Build story prompt based on vibe preset
 */
function buildStoryPrompt(vibePreset: string, wordRange: { min: number; max: number }, recentStories?: Array<{ title: string; hook: string | null; setting?: string }>): string {
  // Comment Multiplier: ~40% of NGC stories get social disagreement framing in the closing
  const useSocialFraming = vibePreset === 'no_good_choice' && Math.random() < 0.4;
  if (useSocialFraming) {
    console.log('[STORY] NGC social framing: ENABLED (comment multiplier)');
  }

  const vibeDescriptions: Record<string, string> = {
    urban_legend: 'an urban legend or creepy internet story, featuring unexplained phenomena, "that one weird thing that happened", or local folklore that turns out to be true',
    one_too_many: buildOneToManyPrompt(wordRange),
    backrooms: 'a liminal space or "backrooms" style horror about accidentally entering wrong places, glitches in reality, or spaces that shouldn\'t exist',
    nosleep: 'a first-person creepypasta/NoSleep style horror that starts mundane but escalates into something terrifying',
    glitch: 'a glitch in the matrix story about strange repetitions, déjà vu, NPCs acting weird, or reality not working right',
    no_good_choice: `a short-form spoken narration presenting a lose-lose decision. The viewer hears two options, both carry a genuine, specific, painful cost. There is no escape. They must pick one.

FORMAT — 7 beats, strict order:

BEAT 1 — HOOK (1 sentence):
State the dilemma immediately. First sentence. No scene-setting, no atmosphere, no "you're standing in..." openers. The viewer must understand the core conflict within 2 seconds of hearing it. Lead with a forced action, an ultimatum, a revelation, or a loss, not with a location or mood.
Examples of strong hooks:
- "Your sister just admitted she's been stealing from your parents, and she's begging you to stay quiet."
- "Your company offered to keep you, but only if you let your entire team get laid off."
Examples of weak hooks (NEVER open like these):
- "You're sitting in a crowded café..." — scene description, no stakes
- "It's late at night and your phone keeps buzzing..." — atmosphere, no conflict
- "The room feels tense as everyone waits..." — mood painting, no dilemma

BEAT 2 — SITUATION (1-2 sentences):
Add only the context needed to make the choice real. Who's involved, what's at stake, why you can't avoid it. No atmosphere. No adjectives that don't carry information. One specific grounding detail (a number, a name, a place, a deadline).

BEAT 3 — OPTION A (1-2 sentences):
State the first path in natural spoken language. Describe what you'd actually DO. No labels. Don't literally write "Option A." Use action-forward phrasing:
- Strong: "You tell your boss the truth."
- Weak: "Option A: You choose to call your partner."

BEAT 4 — COST A (1-2 sentences):
Reveal what that path actually costs you. Be concrete and specific. The viewer should physically react. Use observable consequences: things lost, relationships broken, money gone, reputations destroyed, doors permanently closed. No "might" or "could", state the cost as fact.

BEAT 5 — OPTION B (1-2 sentences):
State the second path. Different direction entirely, not a slight variation of A. Transition naturally:
- Strong: "Or you keep quiet and let it happen."
- Weak: "Option B: You focus on the presentation."

BEAT 6 — COST B (1-2 sentences):
Reveal what this path costs you. Different CATEGORY of pain than Cost A (e.g., if A costs money, B costs a relationship; if A costs trust, B costs safety). Same level of specificity. Same gut-punch energy.

BEAT 7 — QUESTION (${useSocialFraming ? '2-3 sentences' : '1 sentence'}):
${useSocialFraming ? `Before the final question, add 1-2 SHORT sentences implying that other people disagree about which choice is right. Reference the SPECIFIC options from your story, not generic statements. Do NOT use "Option A" or "Option B" labels.
Examples:
- "Most people say you stay quiet. What would you actually do?"
- "Some people say loyalty comes first. Others say honesty does. What do you pick?"
- "Half the people report them. Half stay quiet. Which one do you choose?"
The social framing + question together must be under 25 words.
Then end` : 'End'} with a direct question. Short. Confrontational. No reflection, no summary, no "it's up to you," no moral. Just the question.
${useSocialFraming ? '' : 'Strong: "So which one do you pick?"\nWeak: "The choice is yours, what matters more to you?"'}

RULES:
- Second person throughout ("you", "your"). Never break POV.
- Write approximately 120-150 words.
- Spoken-word native. Every sentence must sound natural read aloud. No semicolons. No literary flourishes. No complex subordinate clauses.
- Short sentences dominate. Max one compound sentence per beat.
- DO NOT literally write "Option A" or "Option B" in the output. Express the two paths as natural spoken actions ("You tell them..." / "Or you stay quiet..."). The binary structure must be clear from the narration, not from labels.
- Both options must be genuinely painful. If 80%+ of people would obviously pick the same one, the dilemma is broken. Rebalance.
- Both costs must be CONCRETE: dollar amounts, lost relationships by name, specific career consequences, observable social fallout. Never vague.
- Both costs must be DIFFERENT CATEGORIES of loss. Don't make it "lose money vs. lose slightly more money." Make it "lose money vs. lose trust."
- No horror, supernatural, fantasy, sci-fi, or speculative elements. Real-world only.
- No confession framing. No first-person narrator. No "I".
- No softening language: avoid "might," "perhaps," "could potentially," "in the long run."
- No reflection or philosophical commentary. The dilemma speaks for itself.
- No third option. No compromise. No way out.
- Scenarios must be widely relatable to a broad mainstream adult audience. No niche professions, specialized knowledge, or narrow demographics required to understand the stakes.
- Scenario categories: career, money, family, friendship, trust, reputation, health, loyalty, fairness, time pressure, survival.

REMINDER:
Your story MUST be at least 100 words. Aim for 120-150 words.
Stories shorter than 100 words will be rejected.
Count your words carefully before finishing.`,
    one_rule_one_power: `a power-fantasy trade-off. Present ONE supernatural or impossible power and EXACTLY ONE restriction that meaningfully limits it.

FORMAT — 5 beats, strict order:

BEAT 1 — HOOK (1 sentence, 8-15 words):
State the power in one clean sentence. Second person. No preamble, no scene-setting.
Strong: "You can freeze time whenever you want."
Strong: "You can heal any injury with a touch."
Weak: "Imagine a world where you had an incredible ability..." ← BANNED
Weak: "What if I told you that you could..." ← BANNED

BEAT 2 — QUICK IMAGINATION (2-3 short sentences, 15-25 words):
Let the viewer picture using the power. 2-3 short punchy scenarios are ENCOURAGED.
Strong: "You could walk into any room. Hear any conversation. Take anything you want."
Strong: "Everything stops — people, traffic, the world around you."
Weak: "You could fly to Paris, time travel, read minds, become invisible, stop wars, cure diseases..." ← TOO MANY, BANNED

BEAT 3 — THE RULE (1-2 sentences, 10-20 words):
The single restriction. Must be visceral, specific, gut-punch delivery.
Do NOT use transitional phrases like "here's the rule" or "but there's a catch" — just STATE the rule directly.
Strong: "But every time you freeze time, you age."
Strong: "But you can never use it on someone you love."
Weak: "But here's the rule: while time is frozen, you still age." ← TRANSITIONAL FLUFF
Weak: "But it changes who you are as a person." ← ABSTRACT, BANNED

BEAT 4 — IMPLICATION (1-2 sentences, 15-25 words):
Show what the rule actually costs. One concrete scenario — the real weight.
Strong: "Every hour you steal costs you an hour of your life."
Weak: "This would have deep consequences for your existence." ← ABSTRACT

BEAT 5 — QUESTION (1 sentence, ≤8 words):
Clean exit. No reflection. No commentary. Just the question.
Strong: "Would you take it?" / "Still worth it?" / "Deal?"
Weak: "So what do you think — is this something you would actually consider taking?" ← TOO LONG

Rules:
- Second person throughout ("You can now...")
- Calm, confident tone — like offering a deal, not threatening
- ${wordRange.min}-${wordRange.max} words total
- ONE power, ONE rule, no exceptions
- Scenarios: 2-3 short punchy ones are GOOD. Do NOT list more than 3. Keep each under 8 words.
- Do NOT make the rule trivial or the power useless
- The power must remain desirable AFTER the rule — most people should genuinely struggle with the choice
- The power and rule must be easy to visualize in under 2 seconds — no abstract concepts
- Do NOT use horror framing (no death, blood, torture, murder)
- Do NOT use filler: "imagine", "think about", "picture this", "what if I told you", "here's the thing", "let that sink in", "in other words"
- Do NOT use softening: "might", "perhaps", "could potentially", "in the long run"
- Do NOT end with reflection or philosophical commentary
- The outcome should be ambiguous — not tragic, not utopian

If your draft is under ${wordRange.min} words, expand the IMAGINATION or IMPLICATION beat with an additional concrete moment.`,
    two_doors: `a symbolic binary choice presenting two desirable but incompatible life paths through a framing device. The viewer must sacrifice one to gain the other.

FORMAT — 5 beats, strict order:

BEAT 1 — HOOK (1 sentence):
Present the framing device immediately. First sentence. The viewer sees two objects, two paths, two options within the first two seconds. No backstory. No atmosphere. No "you find yourself in..." openers. State the device plainly.
Examples of strong hooks:
- "Two doors appear in front of you."
- "Two envelopes sit on the table."
- "A coin lands in your hand. Heads or tails."
- "Two keys. One gold. One silver."
Examples of weak hooks (NEVER open like these):
- "In an old studio, two blank canvases stand before you, each vibrant and swirling..." — too atmospheric
- "You're standing at a crossroads, the wind carrying whispers of two different futures..." — scene-setting
- "Imagine a place where every choice leads to a different world..." — abstract and slow

BEAT 2 — FRAME (1 sentence, MAX 2 short sentences):
The permanence statement. The viewer understands this is irreversible. Make it SHORT and BLUNT.
Strong: "You can only follow one. The other disappears forever."
Strong: "Choose one. The other is gone."
Strong: "One opens. The other locks forever."
Weak: "Once you choose a direction, the other fades forever." — too soft, too many words
Weak: "Each one leads to a completely different life and there's no coming back." — run-on
Aim for ≤15 words. Shorter = stronger.

BEAT 3 — PATH A (2-3 sentences):
Describe the first life path as A SCENE FROM A RANDOM TUESDAY. Show what the viewer physically sees, hears, does. Give at least ONE specific daily-life moment: a morning routine, a conversation, a physical environment, a specific action.
Answer this question: "What does this life look like on a random Tuesday?"
STRONG: "You wake up in a different city every month. No alarm. No emails. Your suitcase is always half-packed."
STRONG: "Cameras flash when you step out of the car. Your name is on the building."
WEAK (NEVER write like this): "A life of freedom and adventure." — abstract label, not a scene
WEAK (NEVER write like this): "A path of quiet fulfillment." — concept, not visible
WEAK (NEVER write like this): "Luxury and glamour surround you." — tells, doesn't show
Do NOT label it "Path A" or "Option A." Transition directly from the frame.
Transition examples:
- "Behind the first door..."
- "The gold key opens a life where..."
- "One path leads to..."

BEAT 4 — PATH B (2-3 sentences):
Describe the second life path as A DIFFERENT SCENE FROM A DIFFERENT RANDOM TUESDAY. Same rules: physical, concrete, filmable. At least ONE specific daily-life moment.
It must represent a DIFFERENT VALUE CATEGORY than Path A. If Path A is freedom, Path B should be belonging — NOT a different flavor of freedom.
STRONG: "The same person sits across from you at dinner every night. Nobody checks the time."
STRONG: "Kids run to the front door when they hear your car pull in." 
WEAK (NEVER write like this): "A life of warmth and connection." — value label
WEAK (NEVER write like this): "Tranquility in every corner of your life." — abstract summary
Transition examples:
- "Behind the second door..."
- "The silver key opens a life where..."
- "The other path leads to..."

VALUE CONFLICT PAIRS (use these or invent similar ones):
- freedom vs. security
- adventure vs. stability
- power vs. love
- knowledge vs. peace
- ambition vs. belonging
- truth vs. happiness
- creativity vs. comfort
- independence vs. family
- fame vs. privacy
- passion vs. safety

BEAT 5 — QUESTION (1 sentence):
Short, direct question. Two formats work well — pick one:

FORMAT A — Device question (matches the framing device):
Strong: "Which door do you open?"
Strong: "Which key do you turn?"
Strong: "Which compass do you trust?"

FORMAT B — Binary label (names the two paths for maximum comment bait):
Strong: "East or West?"
Strong: "City or countryside?"
Strong: "Stage or workshop?"
Strong: "Passport or front porch?"

Format B typically drives MORE comments because people reply with just one word.

Weak (NEVER): "The choice is yours — what matters more?" — too soft
Weak (NEVER): "It all depends on what you value most." — not even a question
Weak (NEVER): "So, which direction do you follow?" — vague, doesn't name the stakes

RULES:
- Second person throughout ("you", "your"). Never break POV.
- ${wordRange.min}-${wordRange.max} words total. THIS IS CRITICAL.
- If your draft is under ${wordRange.min} words, you MUST expand the path descriptions with additional concrete life moments until you reach at least ${wordRange.min} words. Add one more filmable detail per path. Do NOT pad with filler or abstract language — add another specific scene moment.
- The framing device can be ANYTHING symbolic: doors, keys, envelopes, canvases, mirrors, bridges, roads, coins, buttons, switches, flames, rivers, stairs, windows, books, compasses, maps, bottles, stones, rings, clocks, lanterns, scrolls. The only rule is that there are TWO of them.
- Spoken-word native. Every sentence must sound natural read aloud. No semicolons. No literary flourishes. No poetic metaphors. No complex clauses.
- Short sentences dominate. Max one compound sentence per beat.
- Both paths must be GENUINELY DESIRABLE. Neither is "the bad one." The viewer must want both.
- Both paths must represent DIFFERENT VALUE CATEGORIES. Not two flavors of the same thing.
- Do NOT reveal consequences, downsides, or outcomes. The viewer chooses blind.
- Do NOT add moral commentary, reflection, or summarization after the paths.
- Do NOT use horror, supernatural, or fantasy framing. The symbolic device is a metaphor — the paths describe REAL life experiences.
- Do NOT literally write "Path A" or "Path B" or "Option A" or "Option B." Use natural transitions tied to the framing device.
- Scenario categories for paths: career, relationships, lifestyle, identity, geography, creativity, knowledge, community, family, legacy.
- NEVER use abstract life labels in path descriptions. These words are BANNED from PATH_A and PATH_B: luxury, fulfillment, happiness, peace, success, greatness, comfort, excitement, prosperity, contentment, serenity, tranquility, harmony, bliss, joy, glamour, elegance, prestige, satisfaction, purpose. Instead, SHOW what the life looks like — a specific scene, a physical detail, an observable moment.
- Every path MUST contain at least one of: a location (kitchen, airport, trail, office), an action (wake up, cook, walk, build, travel), or a person (partner, children, stranger, coworker). If you can't film it, rewrite it.`,
  };

  const vibeDesc = vibeDescriptions[vibePreset] || vibeDescriptions.urban_legend;

  // Build avoidance section from recent stories
  let avoidanceSection = '';
  if (recentStories && recentStories.length > 0) {
    const avoidList = recentStories.map(s => {
      const parts = [`"${s.title}"`];
      if (s.setting) parts.push(`(setting: ${s.setting})`);
      return parts.join(' ');
    }).join('\n- ');
    avoidanceSection = `\n\nDO NOT REPEAT — these stories were already created recently. You MUST use a COMPLETELY DIFFERENT setting, location, premise, and title theme:\n- ${avoidList}\n\nYour story must feel fresh and explore a setting/scenario that is NOTHING like the above. No elevators if there's an elevator story. No ferries if there's a ferry story. No trains if there's a train story. Pick something nobody has done yet.`;
  }

  // For one_too_many, the prompt already includes all requirements (word count, tone, style)
  // so we just append avoidance + JSON format. For other presets, use the standard requirements block.
  if (vibePreset === 'one_too_many') {
    return `Create ${vibeDesc}.${avoidanceSection}

Respond in JSON format:
{
  "title": "Short catchy title (3-6 words)",
  "story": "The full story text...",
  "setting": "One or two words describing the primary setting/location (e.g. 'van road trip', 'ferry deck', 'escape room')",
  "concept": "One sentence summarizing the core concept/premise (e.g. 'Extra person appears during van road trip to gas station')"
}`;
  }

  // DecideThisDaily presets: self-contained prompt (word count, tone, style all in vibeDesc)
  if (['no_good_choice', 'one_rule_one_power', 'two_doors'].includes(vibePreset)) {
    return `Create ${vibeDesc}.${avoidanceSection}

Respond in JSON format:
{
  "title": "Short catchy title (3-7 words, question-first for no_good_choice, power-first for one_rule_one_power, framing-device for two_doors)",
  "story": "The full script text...",
  "setting": "One or two words describing the scenario domain (e.g. 'career dilemma', 'time power', 'two timelines')",
  "concept": "One sentence summarizing the core choice/trade-off"
}`;
  }

  return `Create ${vibeDesc}.${avoidanceSection}

REQUIREMENTS:
- Word count: ${wordRange.min}-${wordRange.max} words (this is critical for video timing)
- First-person narration, past tense
- Start with an engaging hook that grabs attention in the first 3 seconds
- Build tension throughout
- End with a chilling revelation or unresolved mystery
- Use vivid sensory details
- Keep sentences punchy for narration pacing
- NEVER use dashes (—, –, -) as punctuation. Use commas, periods, or semicolons instead.

Respond in JSON format:
{
  "title": "Short catchy title (3-6 words)",
  "story": "The full story text...",
  "setting": "One or two words describing the primary setting/location (e.g. 'elevator', 'ferry boat', 'hiking trail', 'escape room')",
  "concept": "One sentence summarizing the core concept/premise (e.g. 'Extra person appears in stopped elevator between floors')"
}`;
}

// =====================================================
// QUALITY GATES — Preset-specific story validation
// Checks structural requirements AFTER generation.
// Returns { passed: boolean, failures: string[] }
// =====================================================

interface QualityGateResult {
  passed: boolean;
  failures: string[];
}

function runQualityGate(vibePreset: string, storyText: string, title: string): QualityGateResult {
  const failures: string[] = [];
  const lower = storyText.toLowerCase();
  const sentences = storyText.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);

  switch (vibePreset) {
    case 'one_too_many':
      return gateOneToMany(storyText, lower, title, failures);
    case 'reddit_trending_horror':
      return gateRedditTrendingHorror(storyText, lower, sentences, failures);
    case 'dark_origins':
      return gateDarkOrigins(storyText, lower, sentences, failures);
    case 'no_good_choice':
      return gateNoGoodChoice(storyText, lower, sentences, failures);
    case 'one_rule_one_power':
      return gateOneRuleOnePower(storyText, lower, sentences, failures);
    case 'two_doors':
      return gateTwoDoors(storyText, lower, sentences, failures);
    default:
      // No quality gate for other presets
      return { passed: true, failures: [] };
  }
}

/**
 * one_too_many: Story MUST have exactly ONE anomaly (the extra person/thing).
 * - Must reference counting or numbers
 * - Must have a discrepancy (N vs N+1)
 * - Title should hint at the count
 */
function gateOneToMany(text: string, lower: string, title: string, failures: string[]): QualityGateResult {
  // Check for counting/number words
  const countingPatterns = /\b(count|counted|counting|number|numbered|extra|additional|one more|one too many|wasn't supposed|shouldn't have been|too many|more than|appeared|N\+1)\b/i;
  if (!countingPatterns.test(text)) {
    failures.push('Missing counting/number anomaly language — must reference a discrepancy');
  }

  // Check for specific numbers (the "N friends" pattern)
  const numberMention = /\b(two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i;
  if (!numberMention.test(text)) {
    failures.push('No specific number mentioned — needs "N friends/people" reference');
  }

  // Check for the reveal/discovery moment
  const revealPatterns = /\b(but .*(photo|picture|video|count|head count|selfie).*show|realized|noticed|something was wrong|didn't add up|one extra|wasn't right|off by one|the math)\b/i;
  if (!revealPatterns.test(text)) {
    // Softer check: at least mention a photo or recount
    const softReveal = /\b(photo|picture|selfie|head count|recount|counted again|looked again)\b/i;
    if (!softReveal.test(text)) {
      failures.push('Missing the reveal moment — needs discovery of the extra (photo, count, etc.)');
    }
  }

  return { passed: failures.length === 0, failures };
}

/**
 * reddit_trending_horror: Must follow Reddit horror conventions.
 * - First-person narration ("I", "my", "me")
 * - At least one mundane detail before horror
 * - At least one dialogue exchange
 */
function gateRedditTrendingHorror(text: string, lower: string, sentences: string[], failures: string[]): QualityGateResult {
  // Check first-person voice
  const firstPersonCount = (text.match(/\bI\b/g) || []).length;
  if (firstPersonCount < 3) {
    failures.push(`Weak first-person voice — only ${firstPersonCount} uses of "I" (need 3+)`);
  }

  // Check for mundane/everyday detail in first third of story
  const firstThird = sentences.slice(0, Math.ceil(sentences.length / 3)).join(' ');
  const mundanePatterns = /\b(coffee|grocery|phone|apartment|work|shift|car|bus|walk|morning|evening|routine|lunch|dinner|commute|alarm|shower|keys|door|parking|fridge|microwave|laundry|rent|bill|uber|lyft|doordash|app|notification|text|message)\b/i;
  if (!mundanePatterns.test(firstThird)) {
    failures.push('Missing mundane/everyday detail in opening — needs grounding before horror');
  }

  // Check for dialogue — quoted speech OR indirect speech patterns
  // Many Reddit horror stories use indirect speech ("she told me", "he whispered")
  // so we accept both quoted text and indirect speech verbs
  const hasQuotedSpeech = /["\u201C\u201D].*?["\u201C\u201D]|".*?"/s.test(text);
  const hasIndirectSpeech = /\b(said|told|asked|whispered|yelled|screamed|muttered|replied|called out|texted|messaged|shouted|begged|pleaded|warned|insisted|stammered|croaked)\b/i.test(text);
  if (!hasQuotedSpeech && !hasIndirectSpeech) {
    failures.push('No dialogue found — needs quoted speech or indirect speech (said/told/whispered etc.)');
  }

  return { passed: failures.length === 0, failures };
}

/**
 * dark_origins: Must follow documentary voice conventions.
 * - Third-person (no "I" as narrator)
 * - Includes dates, locations, or specific numbers
 * - Ends with unresolved thread or provocative statement
 */
function gateDarkOrigins(text: string, lower: string, sentences: string[], failures: string[]): QualityGateResult {
  // Check third-person voice — "I" should NOT be used as narrator
  // Allow "I" inside quotes (dialogue), but narrator should be third-person
  const textWithoutQuotes = text.replace(/[""].*?[""]|".*?"/g, '');
  const narratorICount = (textWithoutQuotes.match(/\bI\b/g) || []).length;
  if (narratorICount > 2) {
    failures.push(`First-person narrator detected (${narratorICount} uses of "I" outside quotes) — must be third-person documentary`);
  }

  // Check for dates, years, or specific time references
  const datePatterns = /\b(19\d{2}|20[0-2]\d|january|february|march|april|may|june|july|august|september|october|november|december|spring of|summer of|winter of|fall of|that year|that night|the morning of)\b/i;
  if (!datePatterns.test(text)) {
    failures.push('Missing dates or time period references — documentary style needs specifics');
  }

  // Check for location specificity
  const locationPatterns = /\b(county|state|town|city|street|avenue|road|highway|route|district|building|house|basement|attic|hospital|prison|courthouse|police|sheriff|detective|officer|FBI|authorities)\b/i;
  if (!locationPatterns.test(text)) {
    failures.push('Missing location/authority references — needs documentary grounding');
  }

  // Check ending — last 2 sentences should be unresolved or provocative
  const lastTwo = sentences.slice(-2).join(' ').toLowerCase();
  const endingPatterns = /\b(never (found|explained|solved|closed|recovered)|remains (open|unsolved|unknown)|still (stands|missing|unknown|unexplained)|was never|no (body|one|trace)|to this day|what (happened|they found|do you think)|case (was|remains)|were they|was he|was she|did they|the truth|nobody knows|some say)\b/i;
  if (!endingPatterns.test(lastTwo)) {
    // Softer check: question mark at end
    if (!lastTwo.includes('?')) {
      failures.push('Ending lacks unresolved thread — should end with mystery, question, or "the case remains..."');
    }
  }

  return { passed: failures.length === 0, failures };
}

// =====================================================
// DecideThisDaily Quality Gates
// =====================================================
// Shared rules: second-person, ends with question, first
// sentence passes "mute test" (curiosity without audio).
// =====================================================

/**
 * Global check for all DecideThisDaily presets:
 * - Second-person voice (≥2 uses of "you/your")
 * - Ends with a question mark
 * - First Sentence Kill Test: first sentence is ≤15 words and creates curiosity
 */
function sharedDecisionGateChecks(text: string, lower: string, sentences: string[], failures: string[]): void {
  // Second-person check
  const youCount = (lower.match(/\byou\b|\byour\b|\byou're\b|\byou've\b|\byou'll\b|\byou'd\b/g) || []).length;
  if (youCount < 2) {
    failures.push(`Weak second-person voice — only ${youCount} uses of "you/your" (need 2+)`);
  }

  // Must end with question
  const lastSentence = sentences[sentences.length - 1] || '';
  if (!lastSentence.trim().endsWith('?')) {
    failures.push('Must end with a direct question — last sentence has no question mark');
  }

  // First Sentence Kill Test: first sentence should be short and curiosity-generating
  const firstSentence = sentences[0] || '';
  const firstWordCount = firstSentence.split(/\s+/).length;
  if (firstWordCount > 20) {
    failures.push(`First sentence too long (${firstWordCount} words) — should hook in ≤20 words for mute-scroll retention`);
  }
}

/**
 * no_good_choice v2: Hook-first, concrete costs, natural phrasing, no labels.
 * G1-G10 structural gates + S1-S6 soft gates.
 * See ngcStoryUpgrade_001.md Section 6 for full spec.
 */
function gateNoGoodChoice(text: string, lower: string, sentences: string[], failures: string[]): QualityGateResult {
  sharedDecisionGateChecks(text, lower, sentences, failures);

  const firstSentence = (sentences[0] || '').toLowerCase();
  const lastSentence = sentences[sentences.length - 1] || '';

  // ── G1: Hook-first (dilemma trigger) — WARN ONLY during calibration ──
  // Pass: first sentence contains a revelation, ultimatum, consequence, or forced action
  // Fail: first sentence is purely scene/mood/atmosphere
  const hookPassPatterns = [
    /\byou(r|\b).*(told|admitted|confessed|found out|discovered|just learned|offered|asked you|says if|texted|called|sent|demanded|threatened|begged)/i,
    /\b(fired|caught|cheating|stealing|dying|pregnant|leaving|gone|over|owes|hit someone|been lying|laid off|arrested|exposed|bankrupt|kicked out|kicked you|blocked|deleted|emptied|drained|sold|broke|quit|resigned)\b/i,
    /\b(or else|or i'm done|if you don't|right now or|last chance|by (tonight|tomorrow|friday|monday|morning|midnight|the end of)|deadline|expires|ultimatum)\b/i,
  ];
  const hookFailPatterns = [
    /^you'?re\s+(sitting|standing|walking|lying|waiting|looking|staring|driving)\s+(in|at|on|by|through)/i,
    /^it'?s\s+(late|early|dark|morning|night|quiet|raining)/i,
    /^the\s+(room|air|house|office|street|city|night|morning|silence)\s+(feels?|is|seems|was|smells?|looks?)/i,
    /^you'?re\s+(thinking about|looking at|staring at|watching|wondering)/i,
  ];
  const hookHasPass = hookPassPatterns.some(p => p.test(firstSentence));
  const hookHasFail = hookFailPatterns.some(p => p.test(firstSentence));
  if (!hookHasPass || hookHasFail) {
    // G1 is WARN-ONLY during calibration — do NOT push to failures
    console.warn(`[GATE] no_good_choice G1 WARN: Hook may be atmospheric — "${sentences[0]?.slice(0, 80)}..."`);
  } else {
    console.log(`[GATE] no_good_choice G1 PASS`);
  }

  // ── G2: Two distinct paths — HARD FAIL ──
  // Detect action-forking language: "you + verb" ... transition ... "you + different verb"
  const actionForkTransitions = /\b(or you|or,? you|but if you|the other option|instead,? you|alternatively,? you)\b/i;
  const twoOptionPatterns = /\b(option [ab]|choice [ab12]|on one hand|on the other|first option|second option|if you choose|path [ab12]|door [12])\b/i;
  const youVerbCount = (text.match(/\byou\s+(tell|stay|take|leave|call|keep|go|walk|say|accept|refuse|turn|ignore|answer|report|hide|confront|sign|pay|quit|lie|confess|reveal|delete|block|mute|step|hand|give|send|show|ask|run|wait|stop|move)\b/gi) || []).length;
  if (!actionForkTransitions.test(text) && !twoOptionPatterns.test(text) && youVerbCount < 2) {
    failures.push('G2: Cannot identify two distinct paths — needs clear binary action structure (two different "you + verb" paths)');
    console.warn(`[GATE] no_good_choice G2 FAIL`);
  } else {
    console.log(`[GATE] no_good_choice G2 PASS`);
  }

  // ── G3: Concrete cost A — WARN ONLY during calibration ──
  // After first path, at least one concrete consequence marker
  const concreteCostPattern = /(\$|%|\d+,?\d*\b|\b(friend|partner|parent|boss|sister|brother|spouse|mom|dad|wife|husband|job|house|apartment|career|degree|savings|retirement)\b|\b(never|forever|years|gone|permanently)\b|\b(fired|expelled|arrested|divorced|evicted|bankrupt|blocked|dead|ruined|destroyed|cut off|blacklisted|homeless|alone)\b)/i;
  // Split text roughly in half to check each cost zone
  const midpoint = Math.floor(text.length / 2);
  const firstHalf = text.slice(0, midpoint);
  const secondHalf = text.slice(midpoint);
  if (!concreteCostPattern.test(firstHalf)) {
    console.warn(`[GATE] no_good_choice G3 WARN: First path consequence may be too vague`);
  } else {
    console.log(`[GATE] no_good_choice G3 PASS`);
  }

  // ── G4: Concrete cost B — WARN ONLY during calibration ──
  if (!concreteCostPattern.test(secondHalf)) {
    console.warn(`[GATE] no_good_choice G4 WARN: Second path consequence may be too vague`);
  } else {
    console.log(`[GATE] no_good_choice G4 PASS`);
  }

  // ── G5: Costs are different categories — WARN ONLY ──
  const categoryPatterns: Record<string, RegExp> = {
    financial: /\b(\$|\d+k|\bsavings?\b|\bmoney\b|\brent\b|\bdebt\b|\bloan\b|\bsalary\b|\bincome\b|\bpay\b|\bbankrupt\b|\bpay(ment|check)\b|\bretirement\b)\b/i,
    relationship: /\b(friend|partner|parent|spouse|wife|husband|mom|dad|sister|brother|family|marriage|divorce|breakup|trust|loyal|betray|alone|block(ed)?|silence|ghoste?d?)\b/i,
    career: /\b(job|career|boss|fired|promotion|team|project|office|colleague|manager|resign|laid off|blacklist|reference|reputation|professional)\b/i,
    health: /\b(health|hospital|surgery|sick|injury|pain|dying|medical|therapy|recovery|disability)\b/i,
    legal: /\b(arrest|jail|prison|court|lawyer|police|criminal|charged|lawsuit|sue|convicted|probation)\b/i,
  };
  const costACategories = new Set<string>();
  const costBCategories = new Set<string>();
  for (const [cat, pattern] of Object.entries(categoryPatterns)) {
    if (pattern.test(firstHalf)) costACategories.add(cat);
    if (pattern.test(secondHalf)) costBCategories.add(cat);
  }
  // Check if there's at least one category in B that's not in A
  const uniqueToB = [...costBCategories].filter(c => !costACategories.has(c));
  if (costACategories.size > 0 && costBCategories.size > 0 && uniqueToB.length === 0) {
    console.warn(`[GATE] no_good_choice G5 WARN: Both costs appear to be the same category (${[...costACategories].join(', ')})`);
  } else {
    console.log(`[GATE] no_good_choice G5 PASS`);
  }

  // ── G6: Direct final question — HARD FAIL ──
  const lastWords = lastSentence.trim().split(/\s+/);
  if (lastSentence.trim().endsWith('?')) {
    if (lastWords.length > 15) {
      failures.push(`G6: Final question too long (${lastWords.length} words) — must be ≤ 15 words`);
      console.warn(`[GATE] no_good_choice G6 FAIL: question too long`);
    } else {
      const softeningPatterns = /\b(it's up to you|what matters more|only you can decide|whatever you choose|it all depends|it comes down to)\b/i;
      if (softeningPatterns.test(lastSentence)) {
        failures.push('G6: Final question contains softening language — must be short and direct');
        console.warn(`[GATE] no_good_choice G6 FAIL: softening language`);
      } else {
        console.log(`[GATE] no_good_choice G6 PASS`);
      }
    }
  }
  // Note: question mark check is already in sharedDecisionGateChecks

  // ── G7: No supernatural — HARD FAIL ──
  const supernaturalPatterns = /\b(magic|spell|ghost|demon|vampire|werewolf|zombie|supernatural|teleport|superpow|immortal|wizard|witch|dragon|curse|haunted|potion|enchant|alien|time.?travel|parallel.?universe)\b/i;
  if (supernaturalPatterns.test(lower)) {
    failures.push('G7: Supernatural/fantasy elements detected — must be realistic');
    console.warn(`[GATE] no_good_choice G7 FAIL`);
  } else {
    console.log(`[GATE] no_good_choice G7 PASS`);
  }

  // ── G8: Second person only — HARD FAIL ──
  const textWithoutQuotes = text.replace(/[""\u201C\u201D].*?[""\u201C\u201D]|".*?"/g, '');
  const narratorICount = (textWithoutQuotes.match(/\bI\b/g) || []).length;
  if (narratorICount > 1) {
    failures.push(`G8: First-person narrator detected (${narratorICount} uses of "I") — must be second-person address`);
    console.warn(`[GATE] no_good_choice G8 FAIL`);
  } else {
    console.log(`[GATE] no_good_choice G8 PASS`);
  }

  // ── G9: No reflection/moral — HARD FAIL ──
  // Check last 2 sentences before the question for moralizing
  const preQuestionSentences = sentences.slice(-3, -1).join(' ').toLowerCase();
  const moralizingPatterns = /\b(the choice is|each path|carries weight|in the end|whatever you choose|no right answer|both options|it all depends|no matter what|either way,? you lose|there is no (right|easy|good) answer|it's a reminder|life rarely)\b/i;
  if (moralizingPatterns.test(preQuestionSentences)) {
    failures.push('G9: Reflection/moralizing detected — dilemma should speak for itself');
    console.warn(`[GATE] no_good_choice G9 FAIL`);
  } else {
    console.log(`[GATE] no_good_choice G9 PASS`);
  }

  // ── G10: No literal option labels — HARD FAIL ──
  if (/option [ab]/i.test(text)) {
    failures.push('G10: Literal "Option A/B" labels detected — use natural spoken phrasing instead');
    console.warn(`[GATE] no_good_choice G10 FAIL`);
  } else {
    console.log(`[GATE] no_good_choice G10 PASS`);
  }

  // ── Soft Gates (log only, never fail) ──

  // S1: Hook length
  const hookWordCount = (sentences[0] || '').split(/\s+/).length;
  if (hookWordCount > 20) {
    console.warn(`[GATE] no_good_choice S1 WARN: Hook may be too long (${hookWordCount} words) — aim for ≤ 15`);
  }

  // S2: Setup length (sentences before first action-fork transition)
  const forkIndex = sentences.findIndex(s => actionForkTransitions.test(s) || /\byou\s+(tell|stay|take|leave|call|keep|go|walk|say|accept|refuse|turn)\b/i.test(s));
  if (forkIndex > 3) {
    console.warn(`[GATE] no_good_choice S2 WARN: Excessive setup — ${forkIndex} sentences before first path`);
  }

  // S3: Word count outside target range — HARD FAIL
  const totalWords = text.split(/\s+/).length;
  if (totalWords < 80 || totalWords > 110) {
    failures.push(`S3: Word count ${totalWords} outside required range 80-110`);
    console.warn(`[GATE] no_good_choice S3 FAIL: Word count ${totalWords} outside target range 80-110`);
  }

  // S4: Hedging language
  const hedgingCount = (lower.match(/\b(might|perhaps|maybe|could potentially|somewhat|in a way|kind of|sort of)\b/g) || []).length;
  if (hedgingCount >= 2) {
    console.warn(`[GATE] no_good_choice S4 WARN: Hedging language detected (${hedgingCount} instances) — be declarative`);
  }

  // S5: Balance sniff test (rough heuristic — are both paths using the same action verbs?)
  const pathVerbs = text.match(/\byou\s+(tell|stay|take|leave|call|keep|go|walk|say|accept|refuse|turn|ignore|answer|report|hide|confront)\b/gi) || [];
  if (pathVerbs.length >= 2) {
    const verbRoots = pathVerbs.map(v => v.replace(/^you\s+/i, '').toLowerCase());
    if (new Set(verbRoots).size === 1) {
      console.warn(`[GATE] no_good_choice S5 WARN: Both paths may use the same action ("${verbRoots[0]}") — ensure genuinely different paths`);
    }
  }

  // S6: Label usage (redundant with G10 — informational layer)
  if (/option [ab]/i.test(text)) {
    console.warn(`[GATE] no_good_choice S6 WARN: Literal option labels detected — consider natural spoken phrasing`);
  }

  return { passed: failures.length === 0, failures };
}

/**
 * one_rule_one_power v2: 5-beat structure, single power + single rule,
 * punchy delivery, no filler, short final question.
 */
function gateOneRuleOnePower(text: string, lower: string, sentences: string[], failures: string[]): QualityGateResult {
  sharedDecisionGateChecks(text, lower, sentences, failures);

  // G1 — Power in first sentence
  const firstSentence = sentences[0] || '';
  const powerRegex = /\b(you can|you are able|you have the (power|ability)|you gain|you possess|you now|you wake up)\b/i;
  if (!powerRegex.test(firstSentence)) {
    failures.push('G1: Power must appear in first sentence — open with "You can..."');
  }

  // G2 — Single rule only (detect multiple restrictions)
  const ruleMarkers = text.match(/\b(but |however |the catch |the rule |the cost |the price |except |only if |there's (one|a) (catch|rule|condition) )\b/gi) || [];
  if (ruleMarkers.length > 2) {
    failures.push(`G2: Multiple restrictions detected (${ruleMarkers.length} markers) — must have exactly ONE rule`);
  }

  // G3 — Rule clarity: restriction language must be present
  const rulePresent = /\b(but|however|the (rule|catch|cost|price|condition|restriction|limitation)|here's the (thing|catch|rule)|there's (one|a) (rule|catch|condition)|except|only if|every time you|each time you|whenever you|the moment you|you (can't|cannot|lose|sacrifice|give up|forget))\b/i;
  if (!rulePresent.test(text)) {
    failures.push('G3: No restriction/rule language found — needs clear "but here\'s the catch" moment');
  }

  // G4 — No filler language
  const fillerPatterns = /\b(imagine|think about|picture this|what if I told you|here's the thing|let that sink in|in other words)\b/i;
  if (fillerPatterns.test(lower)) {
    failures.push('G4: Filler language detected — remove "imagine", "picture this", "let that sink in", etc.');
  }

  // G5 — Short final question (≤8 words)
  const lastSentence = sentences[sentences.length - 1] || '';
  const lastWordCount = lastSentence.trim().split(/\s+/).length;
  if (lastWordCount > 8) {
    failures.push(`G5: Final question too long (${lastWordCount} words) — must be ≤8 words`);
  }

  // G6 — Word count check
  const totalWords = text.trim().split(/\s+/).length;
  if (totalWords < 80 || totalWords > 110) {
    failures.push(`G6: Word count ${totalWords} outside 80-110 range`);
  }

  // G7 — Power desirability: rule must not make the power obviously not worth taking
  const dealBreakerPatterns = /\b(you (will |would )?(instantly |immediately )?(die|be killed|cease to exist|lose (all|every) memor)|everyone (around you |you (love|know) )?(dies|is killed|disappears|ceases)|the (entire |whole )?(world|universe|planet) (ends|is destroyed|collapses))\b/i;
  if (dealBreakerPatterns.test(lower)) {
    failures.push('G7: Power desirability — rule makes the power obviously not worth taking for most people');
  }

  // Anti-excessive-list check (allow 2-3 short scenarios, block 4+)
  const scenarioLines = text.match(/you could [^.]{3,40}\./gi) || [];
  if (scenarioLines.length > 3) {
    failures.push(`Excessive scenario listing (${scenarioLines.length} found) — keep to 2-3 short punchy scenarios max`);
  }

  // No horror framing
  const horrorPatterns = /\b(terrif|horrif|blood|scream|die|death|kill|murder|corpse|nightmare|torture|agony|suffer)\b/i;
  if (horrorPatterns.test(lower)) {
    failures.push('Horror framing detected — one_rule_one_power should be contemplative, not horror');
  }

  return { passed: failures.length === 0, failures };
}

/**
 * two_doors v2: Framing device in sentence one, two paths with value conflict,
 * no consequences, no labels, no reflection.
 * G3 (value conflict) starts in warn mode — logs only, does not block.
 */
function gateTwoDoors(text: string, lower: string, sentences: string[], failures: string[]): QualityGateResult {
  sharedDecisionGateChecks(text, lower, sentences, failures);

  // G1 — Framing device in sentence one
  const firstSentence = sentences[0] || '';
  const deviceRegex = /(two|2|pair of|both)\s+(doors?|keys?|paths?|roads?|pills?|envelopes?|canvases?|mirrors?|bridges?|books?|buttons?|switches?|coins?|flames?|rivers?|stairs?|staircases?|windows?|scrolls?|clocks?|bottles?|stones?|rings?|lamps?|lanterns?|compasses?|maps?|photos?|letters?|tunnels?|hallways?|corridors?|gates?|portals?|boxes?|chests?|cups?|chalices?|orbs?|gems?|feathers?|masks?|cards?|levers?|ropes?|ladders?|ships?|trains?|tickets?|journals?|screens?|lights?|shadows?|worlds?|lives?)/i;
  const altDeviceRegex = /(heads or tails|left or right|one .* or the other|door (one|1)|the first .* the second)/i;
  if (!deviceRegex.test(firstSentence) && !altDeviceRegex.test(firstSentence)) {
    failures.push('Framing device not found in first sentence — must open with a symbolic binary device (two doors, two keys, etc.)');
  }

  // G2 — Two paths described (transition language detection)
  const pathTransitions = /(behind the (first|second|other)|the (first|gold|silver|left|right|red|blue) (door|key|path|envelope|mirror|coin|road|book|button|canvas|ticket|staircase)|one (leads?|opens?|takes? you|shows?|reveals?)|the other (leads?|opens?|takes? you|shows?|reveals?)|on one side|on the other)/gi;
  const transitionMatches = text.match(pathTransitions) || [];
  if (transitionMatches.length < 2) {
    // Fallback: check for contrast connectors between descriptive passages
    const fallbackTransition = /(or|the other|the second|alternatively|but the other)/i;
    if (!fallbackTransition.test(text)) {
      failures.push('Cannot identify two parallel paths — needs clear first path / second path structure with transitions');
    }
  }

  // G3 — Value conflict present (WARN MODE — soft gate, does not block)
  const valueBuckets: Record<string, RegExp> = {
    freedom: /\b(free|freedom|travel|wander|explore|adventure|open road|no rules|no limits|no schedule|anywhere|no alarm|no boss|no routine|no obligations|wherever you want)\b/i,
    security: /\b(safe|secure|stable|steady|certain|guaranteed|protected|routine|predictable|reliable)\b/i,
    love: /\b(love|partner|family|children|kids|heart|beside you|together|hold|connection|relationship|marriage|spouse|bedtime stories|kitchen table)\b/i,
    power: /\b(power|influence|control|lead|command|authority|throne|empire|rule|shape the world|people follow)\b/i,
    knowledge: /\b(know|learn|truth|understand|discover|wisdom|answers|curiosity|library|books|science|history|language|mind)\b/i,
    peace: /\b(peace|quiet|calm|still|silence|rest|content|simple|serene|cabin|garden|modest)\b/i,
    ambition: /\b(ambition|career|success|build|create|achieve|legacy|famous|recognition|your name is known|fill rooms|work changes)\b/i,
    belonging: /\b(belong|community|roots|hometown|neighbors|tradition|history|family table|sunday dinners?|grew up)\b/i,
  };
  // Try to split text into two path sections at the second transition marker
  const pathSplitMatch = text.match(/(?:behind the second|the second|the other (leads?|opens?|takes? you|shows?|reveals?)|the (silver|other|right|blue) (door|key|path|envelope|mirror|coin|road|book|button|canvas|ticket|staircase))/i);
  if (pathSplitMatch && pathSplitMatch.index !== undefined) {
    const pathAText = text.slice(0, pathSplitMatch.index).toLowerCase();
    const pathBText = text.slice(pathSplitMatch.index).toLowerCase();
    const bucketsA = new Set<string>();
    const bucketsB = new Set<string>();
    for (const [bucket, regex] of Object.entries(valueBuckets)) {
      if (regex.test(pathAText)) bucketsA.add(bucket);
      if (regex.test(pathBText)) bucketsB.add(bucket);
    }
    // Check for overlap — if both hit only the same bucket(s), warn
    const hasDistinctValues = [...bucketsA].some(b => !bucketsB.has(b)) || [...bucketsB].some(b => !bucketsA.has(b));
    if (!hasDistinctValues && (bucketsA.size > 0 || bucketsB.size > 0)) {
      console.log(`[GATE] two_doors G3 WARN: Value conflict missing — both paths hit same value buckets: [${[...bucketsA].join(',')}] vs [${[...bucketsB].join(',')}]`);
    } else if (bucketsA.size === 0 && bucketsB.size === 0) {
      console.log(`[GATE] two_doors G3 WARN: Could not detect value categories in either path — may lack clear value conflict`);
    }
  } else {
    console.log(`[GATE] two_doors G3 WARN: Could not split text into two path sections for value conflict analysis`);
  }

  // G4 — No consequences revealed
  const consequenceRegex = /(you lose|you'll lose|the cost|the price|the catch|downside|but you (can't|won't|never|lose)|consequence|sacrifice|risk|giving up|at the expense|trade.?off|but it means losing)/i;
  if (consequenceRegex.test(text)) {
    failures.push('Consequence or cost language detected — two_doors paths must be blind choices with no revealed downsides');
  }

  // G5 — Direct final question (≤12 words, no softening)
  const lastSentence = sentences[sentences.length - 1] || '';
  const lastWordCount = lastSentence.trim().split(/\s+/).length;
  if (lastWordCount > 12) {
    failures.push(`Final question too long (${lastWordCount} words) — must be ≤12 words`);
  }
  const softeningRegex = /(it's up to you|what matters more|only you can decide|whatever you choose|it all depends|it comes down to|what do you value|depends on who you are)/i;
  if (softeningRegex.test(lastSentence)) {
    failures.push('Final question uses softening language — must be a short, direct challenge');
  }

  // G6 — No supernatural/fantasy
  const supernaturalRegex = /(magic|spell|ghost|demon|vampire|werewolf|zombie|supernatural|teleport|superpow|immortal|wizard|witch|dragon|curse|haunted|potion|enchant|alien|time.?travel|parallel.?universe|prophecy|sorcerer|mystical|enchanted)/i;
  if (supernaturalRegex.test(text)) {
    failures.push('Supernatural/fantasy elements detected — paths must describe real-world lives');
  }

  // G7 — No literal option labels ("Path A:", "Option 1:", etc.)
  const labelRegex = /(option|path|choice|door)\s*(a|b|1|2|one|two)\s*:/i;
  if (labelRegex.test(text)) {
    failures.push('Literal option labels detected (\'Path A:\', \'Option 1:\', etc.) — use natural framing-device transitions instead');
  }

  // G8 — No reflection or moralizing (last 2 non-question sentences)
  const nonQuestionSentences = sentences.filter(s => !s.trim().endsWith('?'));
  const lastTwo = nonQuestionSentences.slice(-2);
  const reflectionRegex = /(the choice is|each path|carries weight|in the end|whatever you choose|no right answer|both options|it all depends|no matter what|either way|the decision|only you know|it reveals|it says something about|what kind of person)/i;
  for (const s of lastTwo) {
    if (reflectionRegex.test(s)) {
      failures.push('Reflection/moralizing detected — the paths should speak for themselves');
      break;
    }
  }

  // === SOFT GATES (log only) ===

  // S1 — Hook length
  const hookWordCount = firstSentence.trim().split(/\s+/).length;
  if (hookWordCount > 12) {
    console.log(`[GATE] two_doors S1 WARN: Hook is ${hookWordCount} words — aim for ≤10 words for instant framing device recognition`);
  }

  // S2 — Word count range
  const totalWords = text.trim().split(/\s+/).length;
  if (totalWords < 70 || totalWords > 95) {
    console.log(`[GATE] two_doors S2 WARN: Word count ${totalWords} outside target range (70-95)`);
  }

  // S3 — Poetic language
  const poeticWords = (text.match(/\b(swirling|whisper|shimmer|ethereal|vibrant|glow|radiant|luminous|cascade|blooming|dancing|caress|velvet|crystalline|iridescent|transcendent)\b/gi) || []);
  if (poeticWords.length >= 2) {
    console.log(`[GATE] two_doors S3 WARN: Poetic language detected (${poeticWords.join(', ')}) — use clear, concrete description instead`);
  }

  // S4 — Path balance (rough check)
  if (pathSplitMatch && pathSplitMatch.index !== undefined) {
    const pathAWords = text.slice(0, pathSplitMatch.index).trim().split(/\s+/).length;
    const pathBWords = text.slice(pathSplitMatch.index).trim().split(/\s+/).length;
    if (pathAWords > pathBWords * 2 || pathBWords > pathAWords * 2) {
      console.log(`[GATE] two_doors S4 WARN: Paths are unbalanced (${pathAWords} vs ${pathBWords} words) — both should receive roughly equal description`);
    }
  }

  // S5 — Both paths desirable (no negative language)
  const negativeRegex = /\b(lonely|alone|empty|cold|boring|monoton|dull|bleak|gray|grim|harsh|suffer|pain|miserable|unhappy|trapped)\b/i;
  if (negativeRegex.test(text)) {
    console.log(`[GATE] two_doors S5 WARN: Negative language in a path — both paths must be genuinely desirable, not one good and one bad`);
  }

  // S6 — Framing device consistency (hook device matches question device)
  const deviceNounMatch = firstSentence.match(/\b(doors?|keys?|paths?|roads?|pills?|envelopes?|canvases?|mirrors?|bridges?|books?|buttons?|switches?|coins?|flames?|rivers?|stairs?|staircases?|windows?|scrolls?|clocks?|bottles?|stones?|rings?|lamps?|lanterns?|compasses?|maps?|photos?|letters?|tunnels?|hallways?|corridors?|gates?|portals?|boxes?|tickets?|journals?|screens?|lights?)\b/i);
  if (deviceNounMatch) {
    const deviceNoun = deviceNounMatch[0].toLowerCase().replace(/s$/, ''); // singular form
    const lastSentenceLower = lastSentence.toLowerCase();
    if (!lastSentenceLower.includes(deviceNoun)) {
      console.log(`[GATE] two_doors S6 WARN: Final question doesn't reference the framing device '${deviceNoun}' from the hook — keep consistent`);
    }
  }

  // S7 — Sensory concreteness (paths should contain concrete imagery, not abstract value labels)
  const abstractLabels = /\b(luxury|fulfillment|happiness|peace|success|greatness|comfort|excitement|prosperity|contentment|serenity|tranquility|harmony|bliss|joy|glamour|elegance|prestige|satisfaction|purpose)\b/gi;
  const concreteIndicators = /\b(kitchen|office|street|airport|mountain|bedroom|car|table|garden|trail|door|window|coffee|morning|night|cook|build|walk|travel|speak|wake up|sit|drive|run|eat|write|sing|carry|hold|pick up|partner|children|kids|coworker|stranger|crowd|audience|neighbor|friend)\b/gi;
  if (pathSplitMatch && pathSplitMatch.index !== undefined) {
    const pathsText = text.slice(firstSentence.length); // everything after hook
    const abstractHits = (pathsText.match(abstractLabels) || []);
    const concreteHits = (pathsText.match(concreteIndicators) || []);
    if (abstractHits.length >= 2 && concreteHits.length === 0) {
      console.log(`[GATE] two_doors S7 WARN: Paths contain abstract labels (${abstractHits.join(', ')}) but no concrete imagery — paths should describe filmable life moments, not value summaries`);
    } else if (abstractHits.length > concreteHits.length && abstractHits.length >= 2) {
      console.log(`[GATE] two_doors S7 WARN: Abstract language (${abstractHits.length} hits) outweighs concrete imagery (${concreteHits.length} hits) — aim for more specific, observable details`);
    }
  }

  return { passed: failures.length === 0, failures };
}

// =====================================================
// STEP 2: UNIQUENESS CHECK
// =====================================================

export async function executeUniquenessStep(
  supabase: SupabaseClient,
  job: Job,
  workerId: string,
  env: Record<string, string>,
  logger: StepLogger
): Promise<StepResult> {
  const idempotencyKey = `${job.id}:uniqueness_check`;

  // Check if already done
  const existingAsset = await getAssetByKey(supabase, job.id, idempotencyKey);
  if (existingAsset?.meta?.checked) {
    console.log(`[UNIQUENESS] Already checked (hash: ${existingAsset.meta.story_hash})`);
    return { success: true, skipped: true, data: existingAsset.meta as Record<string, unknown> };
  }

  if (!job.story_text) {
    return { success: false, error: 'No story_text available for uniqueness check' };
  }

  const storyHash = await computeHash(job.story_text);
  console.log(`[UNIQUENESS] Checking story hash: ${storyHash.substring(0, 16)}...`);

  // Retrieve concept metadata from story asset (setting + concept for thematic uniqueness)
  let conceptHash = storyHash;
  let storySetting = '';
  let storyConcept = '';
  try {
    const storyAsset = await getAssetByKey(supabase, job.id, `${job.id}:story_generate`);
    if (storyAsset?.meta?.concept_hash) {
      conceptHash = storyAsset.meta.concept_hash as string;
      storySetting = (storyAsset.meta.setting as string) || '';
      storyConcept = (storyAsset.meta.concept as string) || '';
      console.log(`[UNIQUENESS] Using concept hash (setting: "${storySetting}", concept: "${storyConcept}")`);
    }
  } catch (e) {
    console.warn(`[UNIQUENESS] Could not retrieve concept metadata, using full text hash`);
  }

  try {
    // Check if story_dna entry exists for this job
    const { data: existingDna } = await supabase
      .from('story_dna')
      .select('id, concept_hash')
      .eq('job_id', job.id)
      .single();

    if (existingDna) {
      console.log(`[UNIQUENESS] story_dna already exists for job`);
      await upsertAsset(supabase, job.id, idempotencyKey, 'uniqueness_check', '', null, {
        checked: true,
        story_hash: storyHash,
        existing_dna_id: existingDna.id,
        source: 'existing_dna'
      });
      return { success: true, skipped: true, data: { story_hash: storyHash } };
    }

    // Insert into story_dna (thematic uniqueness tracking)
    // concept_hash = hash of setting+concept (thematic), full_hash = hash of full text (exact)
    const vibePreset = job.vibe_preset || (job.meta?.vibe_preset as string) || 'urban_legend';
    const { error: insertError } = await supabase
      .from('story_dna')
      .upsert({
        job_id: job.id,
        brand_id: job.brand_id,
        concept_hash: conceptHash,
        full_hash: storyHash,
        genre: vibePreset,
        generation_attempt: 1,
        created_at: new Date().toISOString(),
        meta: {
          title: job.title,
          setting: storySetting,
          concept: storyConcept,
        },
      }, { onConflict: 'job_id' });

    if (insertError) {
      console.warn(`[UNIQUENESS] story_dna insert warning: ${insertError.message}`);
      // Non-fatal - continue anyway
    }

    // Check for similar stories (concept collision check — same theme/setting)
    const { data: similarStories } = await supabase
      .from('story_dna')
      .select('id, job_id, concept_hash')
      .eq('brand_id', job.brand_id)
      .eq('concept_hash', conceptHash)
      .neq('job_id', job.id)
      .limit(5);

    const hasCollision = (similarStories?.length || 0) > 0;
    const uniquenessScore = hasCollision ? 0.5 : 0.95;

    // ─── Uniqueness threshold enforcement ───
    // If score is too low, reject this story and force regeneration
    const UNIQUENESS_THRESHOLD = 0.6; // Configurable: stories below this are too similar
    if (uniquenessScore < UNIQUENESS_THRESHOLD) {
      console.warn(`[UNIQUENESS] ⚠ Score ${uniquenessScore} < threshold ${UNIQUENESS_THRESHOLD} — story too similar to ${similarStories?.length} existing stories`);
      
      // Store the rejection for debugging
      await upsertAsset(supabase, job.id, idempotencyKey, 'uniqueness_check', '', null, {
        checked: true,
        story_hash: storyHash,
        uniqueness_score: uniquenessScore,
        has_collision: hasCollision,
        collision_count: similarStories?.length || 0,
        rejected: true,
        similar_job_ids: (similarStories || []).map((s: { job_id: string }) => s.job_id).slice(0, 3),
      });

      return {
        success: false,
        error: `Story uniqueness score ${uniquenessScore} is below threshold ${UNIQUENESS_THRESHOLD}. ${similarStories?.length || 0} similar stories exist for this brand. Regenerate with a different angle.`,
        data: { uniqueness_score: uniquenessScore, collision_count: similarStories?.length || 0, rejected: true },
      };
    }

    // Store result
    await upsertAsset(supabase, job.id, idempotencyKey, 'uniqueness_check', '', null, {
      checked: true,
      story_hash: storyHash,
      uniqueness_score: uniquenessScore,
      has_collision: hasCollision,
      collision_count: similarStories?.length || 0,
    });

    console.log(`[UNIQUENESS] ✓ Score: ${uniquenessScore}, collisions: ${similarStories?.length || 0}`);
    return { success: true, data: { story_hash: storyHash, uniqueness_score: uniquenessScore } };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[UNIQUENESS] ✗ Failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

// =====================================================
// STEP 3: SCENES + SUBTITLES GENERATION
// =====================================================

export async function executeScenesStep(
  supabase: SupabaseClient,
  job: Job,
  workerId: string,
  env: Record<string, string>,
  logger: StepLogger
): Promise<StepResult> {
  const idempotencyKey = `${job.id}:scenes_subtitles`;

  // Check if already done - ensure we have actual scenes, not just an empty array
  const existingAsset = await getAssetByKey(supabase, job.id, idempotencyKey);
  if (existingAsset?.meta?.scenes && (existingAsset.meta.scenes as unknown[]).length > 0) {
    const scenes = existingAsset.meta.scenes as unknown[];
    console.log(`[SCENES] Already generated: ${scenes.length} scenes`);
    return { success: true, skipped: true, data: { scene_count: scenes.length } };
  }

  if (!job.story_text) {
    return { success: false, error: 'No story_text available for scene generation' };
  }

  // Handle duration - can be a number or { minSeconds, maxSeconds } object
  const rawDuration = job.meta?.duration;
  let presetDuration: number;
  if (typeof rawDuration === 'number') {
    presetDuration = rawDuration;
    console.log(`[SCENES] Duration from number: ${presetDuration}s`);
  } else if (rawDuration && typeof rawDuration === 'object') {
    // Use average of min/max, or min, or max, or default to 60
    const durObj = rawDuration as { minSeconds?: number; maxSeconds?: number; min?: number; max?: number };
    const minSec = durObj.minSeconds ?? durObj.min ?? 60;
    const maxSec = durObj.maxSeconds ?? durObj.max ?? 90;
    presetDuration = Math.round((minSec + maxSec) / 2);
    console.log(`[SCENES] Duration from object: min=${minSec}, max=${maxSec}, avg=${presetDuration}s`);
  } else {
    presetDuration = 60;
    console.log(`[SCENES] Duration defaulted to: ${presetDuration}s`);
  }

  // Estimate actual audio duration from word count.
  // TTS narrates at ~2.0-2.5 words/sec; we use 2.0 (conservative) + 3s buffer.
  // This prevents scene timing spanning 75s when audio is only 38s.
  const wordCount = job.story_text.split(/\s+/).filter((w: string) => w.length > 0).length;
  const estimatedAudioDuration = Math.ceil(wordCount / 2.0) + 3;
  // Use the LOWER of preset target and estimated audio — scene timing should
  // approximate narration length; the images step will voice-align precisely later.
  const duration = Math.min(presetDuration, estimatedAudioDuration);
  console.log(`[SCENES] Duration: preset=${presetDuration}s, estimatedAudio=${estimatedAudioDuration}s (${wordCount} words), using=${duration}s`);
  
  // scene_count from UI (create page calculates via PACE_PRESETS + platform clamps)
  // Fallback: balanced pace ~3s per scene, clamped [6, 24] for social media
  const fallbackSceneCount = Math.max(6, Math.min(24, Math.round(duration / 3)));
  let sceneCount = (job.meta?.scene_count as number) || fallbackSceneCount;
  console.log(`[SCENES] sceneCount=${sceneCount} for duration=${duration}s (source: ${job.meta?.scene_count ? 'job.meta' : 'fallback'})`);

  console.log(`[SCENES] Generating ${sceneCount} scenes for ${duration}s video`);

  try {
    // Split story into sentences
    const sentences = job.story_text
      .split(/(?<=[.!?])\s+/)
      .filter(s => s.trim().length > 0);

    // When we need more scenes than sentences, split long sentences at clause boundaries
    let textChunks = [...sentences];
    if (textChunks.length < sceneCount) {
      // Split at clause boundaries (commas, semicolons, dashes, "and", "but", "when", "as")
      const clauseSplitters = /(?<=,)\s+|(?<=;)\s+|(?<=—)\s*|\s+(?:and|but|when|as|while|then)\s+/i;
      let expanded: string[] = [];
      for (const sentence of textChunks) {
        if (expanded.length >= sceneCount) {
          expanded.push(sentence);
          continue;
        }
        const clauses = sentence.split(clauseSplitters).filter(c => c.trim().length > 3);
        if (clauses.length > 1) {
          expanded.push(...clauses);
        } else {
          expanded.push(sentence);
        }
      }
      textChunks = expanded;
    }

    // CRITICAL: Cap scene count to available text chunks to prevent duplication.
    // When sceneCount > textChunks.length, fractional chunksPerScene causes
    // adjacent scenes to grab the same text chunk (e.g. "Two paths... Two paths...").
    if (textChunks.length < sceneCount) {
      console.log(`[SCENES] Capping sceneCount from ${sceneCount} to ${textChunks.length} (not enough text chunks for more scenes)`);
      sceneCount = textChunks.length;
    }

    // Distribute text chunks across scenes evenly
    const chunksPerScene = textChunks.length / sceneCount;
    // First pass: build scene texts so we can measure word counts
    const rawScenes: Array<{ text: string; wordCount: number; keywords: string[] }> = [];

    for (let i = 0; i < sceneCount; i++) {
      const startIdx = Math.floor(i * chunksPerScene);
      const endIdx = i === sceneCount - 1 ? textChunks.length : Math.floor((i + 1) * chunksPerScene);
      // Ensure at least one chunk per scene
      const actualEnd = Math.max(endIdx, startIdx + 1);
      const sceneText = textChunks.slice(startIdx, actualEnd).join(' ').trim();

      // Extract meaningful keywords (nouns/adjectives), filtering stopwords
      const STOPWORDS = new Set([
        'about', 'above', 'after', 'again', 'along', 'already', 'always', 'among',
        'around', 'based', 'because', 'been', 'before', 'being', 'below', 'between',
        'both', 'could', 'didn', 'does', 'doing', 'during', 'each', 'either',
        'enough', 'every', 'everything', 'first', 'found', 'from', 'going', 'gotten',
        'hadn', 'hasn', 'have', 'having', 'here', 'however', 'inside', 'into',
        'just', 'know', 'known', 'large', 'later', 'like', 'little', 'long',
        'make', 'many', 'might', 'more', 'most', 'much', 'must', 'never',
        'next', 'none', 'nothing', 'only', 'other', 'over', 'part', 'people',
        'place', 'point', 'really', 'right', 'said', 'same', 'seemed', 'should',
        'since', 'small', 'some', 'someone', 'something', 'sometimes', 'still',
        'such', 'take', 'than', 'that', 'their', 'them', 'then', 'there', 'these',
        'they', 'thing', 'things', 'think', 'this', 'those', 'though', 'through',
        'time', 'until', 'upon', 'very', 'want', 'wasn', 'well', 'were', 'what',
        'when', 'where', 'which', 'while', 'with', 'within', 'without', 'would',
        'your', 'began', 'called', 'came', 'come', 'even', 'ever', 'felt',
        'gave', 'give', 'given', 'goes', 'gone', 'good', 'great', 'hand',
        'hands', 'head', 'heard', 'help', 'high', 'home', 'house', 'idea',
        'kept', 'kind', 'knew', 'last', 'left', 'let', 'life', 'line',
        'look', 'looked', 'looking', 'made', 'making', 'matter', 'mind',
        'moment', 'move', 'moved', 'need', 'number', 'once', 'open', 'opened',
        'order', 'own', 'pass', 'passed', 'perhaps', 'quite', 'rather',
        'read', 'room', 'round', 'seem', 'seems', 'seen', 'several',
        'shall', 'show', 'side', 'simply', 'soon', 'sort', 'start',
        'started', 'state', 'story', 'sure', 'taken', 'talk', 'tell',
        'that', 'them', 'themselves', 'three', 'told', 'took', 'turn',
        'turned', 'under', 'used', 'using', 'voice', 'walk', 'want',
        'watch', 'water', 'will', 'word', 'words', 'work', 'world',
        'years', 'young',
      ]);
      const words = sceneText.toLowerCase().split(/\s+/).filter(w => w.length > 0);
      const keywords = words
        .map(w => w.replace(/[^a-z]/g, ''))  // strip punctuation
        .filter(w => w.length > 4 && !STOPWORDS.has(w))
        .filter((w, idx, arr) => arr.indexOf(w) === idx) // dedupe
        .slice(0, 5);

      rawScenes.push({
        text: sceneText || textChunks[Math.min(i, textChunks.length - 1)] || 'Scene',
        wordCount: Math.max(words.length, 1),
        keywords: keywords,
      });
    }

    // Second pass: assign durations proportional to word count
    // Each scene's duration scales with its narration length.
    // Minimum 1.5s per scene so very short phrases still get screen time.
    const totalWords = rawScenes.reduce((sum, s) => sum + s.wordCount, 0);
    const minSceneDuration = 1.5;
    const reservedTime = minSceneDuration * sceneCount;
    const flexibleTime = Math.max(0, duration - reservedTime);

    const scenes: Array<{
      index: number;
      text: string;
      startTime: number;
      endTime: number;
      keywords: string[];
    }> = [];

    let currentTime = 0;
    for (let i = 0; i < rawScenes.length; i++) {
      const raw = rawScenes[i];
      // Duration = minimum + proportional share of flexible time
      const proportion = raw.wordCount / totalWords;
      const sceneDur = minSceneDuration + (flexibleTime * proportion);
      const startTime = currentTime;
      const endTime = i === rawScenes.length - 1 ? duration : currentTime + sceneDur;

      scenes.push({
        index: i,
        text: raw.text,
        startTime: parseFloat(startTime.toFixed(2)),
        endTime: parseFloat(endTime.toFixed(2)),
        keywords: raw.keywords,
      });

      currentTime = endTime;
    }

    console.log(`[SCENES] Word-proportional timing (pre-merge): ${scenes.map(s => `S${s.index}=${(s.endTime - s.startTime).toFixed(1)}s`).join(', ')}`);

    // Merge micro-scenes: any scene under 3s gets merged with its neighbor
    const MIN_SCENE_DURATION = 3.0;
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < scenes.length; i++) {
        const dur = scenes[i].endTime - scenes[i].startTime;
        if (dur < MIN_SCENE_DURATION && scenes.length > 2) {
          // Merge with the shorter neighbor (prefer next, fallback to prev)
          const mergeWith = i < scenes.length - 1 ? i + 1 : i - 1;
          const kept = Math.min(i, mergeWith);
          const removed = Math.max(i, mergeWith);
          scenes[kept].text = scenes[kept].text + ' ' + scenes[removed].text;
          scenes[kept].startTime = Math.min(scenes[kept].startTime, scenes[removed].startTime);
          scenes[kept].endTime = Math.max(scenes[kept].endTime, scenes[removed].endTime);
          // Merge keywords (deduplicate, keep first 5)
          const allKw = [...new Set([...scenes[kept].keywords, ...scenes[removed].keywords])];
          scenes[kept].keywords = allKw.slice(0, 5);
          scenes.splice(removed, 1);
          // Re-index
          for (let j = 0; j < scenes.length; j++) scenes[j].index = j;
          merged = true;
          console.log(`[SCENES] Merged micro-scene (${dur.toFixed(1)}s) → now ${scenes.length} scenes`);
          break;
        }
      }
    }

    console.log(`[SCENES] Final timing: ${scenes.map(s => `S${s.index}=${(s.endTime - s.startTime).toFixed(1)}s`).join(', ')}`);

    // Generate subtitle cues (word-level timing approximation)
    // Note: These are a rough fallback — the subtitles step prefers
    // precise audio_timestamps from the voice step (Whisper alignment).
    const subWordCount = job.story_text.split(/\s+/).length;
    const wordsPerSecond = subWordCount / duration;
    const words = job.story_text.split(/\s+/);
    
    const subtitleCues: Array<{ start: number; end: number; text: string }> = [];
    let subCueTime = 0;

    for (const word of words) {
      const wordDuration = 1 / wordsPerSecond;
      subtitleCues.push({
        start: subCueTime,
        end: subCueTime + wordDuration,
        text: word,
      });
      subCueTime += wordDuration;
    }

    // Store asset
    await upsertAsset(supabase, job.id, idempotencyKey, 'scene_data', '', null, {
      scenes: scenes,
      subtitle_cues: subtitleCues,
      scene_count: scenes.length,
      duration: duration,
      word_count: subWordCount,
    });

    // Log scene breakdown snapshot
    await logger.snapshot('scenes', 'output', {
      scene_count: scenes.length,
      duration: duration,
      source: job.meta?.scene_count ? 'job.meta' : 'fallback',
      avg_scene_duration: (duration / scenes.length).toFixed(1) + 's',
      sample_scenes: scenes.slice(0, 3).map(s => ({ index: s.index, text: s.text.substring(0, 100), keywords: s.keywords })),
    }, `Generated ${scenes.length} scenes for ${duration}s video`);

    // === PIPELINE HASH: Compute once for entire job config ===
    // This makes debugging "why did this re-render?" trivial
    const storyHash = await computeHash(job.story_text);
    const artStyle = (job.meta?.art_style as string) || 'cinematic';
    const visualPreset = job.visual_preset || (job.meta?.visual_preset as string) || 'default';
    const musicTrackId = (job.meta?.music_track_id as string) || 'ambient_dark_01';
    const vibePreset = job.vibe_preset || (job.meta?.vibe_preset as string) || 'urban_legend';
    
    // Provider-aware voice info for pipeline hash
    // Load brand-level voice override from config_overrides.voice
    let brandVoiceConfig: { voice?: string; instructions?: string; speed?: number } | null = null;
    try {
      const { data: voiceTemplate } = await supabase
        .from('brand_templates')
        .select('config_overrides')
        .eq('brand_id', job.brand_id)
        .eq('is_default', true)
        .limit(1)
        .single();
      brandVoiceConfig = voiceTemplate?.config_overrides?.voice || null;
    } catch (_) { /* soft-fail: use preset defaults */ }

    const ttsProvider: TtsProvider = (env.TTS_PROVIDER || 'openai') as TtsProvider;
    const pipelineVoiceConfig = getPresetVoiceConfig(vibePreset, brandVoiceConfig);
    const voiceId = ttsProvider === 'openai' ? pipelineVoiceConfig.voice : ELEVENLABS_VOICE_ID;
    const voiceModel = ttsProvider === 'openai' ? OPENAI_TTS_MODEL : 'eleven_turbo_v2_5';

    const pipelineHash = await computePipelineHash({
      brandId: job.brand_id,
      vibePreset: vibePreset,
      duration: duration,
      storyHash: storyHash,
      artStyle: artStyle,
      visualPreset: visualPreset,
      voiceId: voiceId,
      voiceModel: voiceModel,
      musicTrackId: musicTrackId,
    });

    // Also update job meta with scene data + pipeline hash
    await updateJobMeta(supabase, job.id, {
      scenes: scenes,
      subtitle_cues: subtitleCues,
      pipeline_hash: pipelineHash,
      pipeline_hash_inputs: {
        brand_id: job.brand_id,
        vibe_preset: vibePreset,
        duration: duration,
        story_hash: storyHash.slice(0, 16),
        art_style: artStyle,
        visual_preset: visualPreset,
        voice_id: voiceId,
        voice_model: voiceModel,
        tts_provider: ttsProvider,
        music_track_id: musicTrackId,
      },
    });

    console.log(`[SCENES] ✓ Generated ${scenes.length} scenes, ${subtitleCues.length} subtitle cues, pipeline_hash=${pipelineHash.slice(0, 12)}...`);
    
    // Validate we actually generated scenes
    if (scenes.length === 0) {
      return { success: false, error: `Scene generation produced 0 scenes (duration=${duration}, sceneCount=${sceneCount}, sentences=${job.story_text?.split(/(?<=[.!?])\s+/).length || 0})` };
    }
    
    return { success: true, data: { scene_count: scenes.length, subtitle_count: subtitleCues.length, pipeline_hash: pipelineHash } };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[SCENES] ✗ Failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

// =====================================================
// STEP 4: VOICE SYNTHESIS (Multi-provider: OpenAI TTS / ElevenLabs)
// =====================================================

export async function executeVoiceStep(
  supabase: SupabaseClient,
  job: Job,
  workerId: string,
  env: Record<string, string>,
  logger: StepLogger
): Promise<StepResult> {
  const idempotencyKey = `${job.id}:voice_synthesis`;

  // Check if already done
  const existingAsset = await getAssetByKey(supabase, job.id, idempotencyKey);
  if (existingAsset?.public_url) {
    console.log(`[VOICE] Already generated: ${existingAsset.public_url}`);
    return { success: true, skipped: true, data: { audio_url: existingAsset.public_url } };
  }

  if (!job.story_text) {
    return { success: false, error: 'No story_text available for voice synthesis' };
  }

  // Determine TTS provider: env var > job meta > default 'openai'
  const ttsProvider: TtsProvider = (env.TTS_PROVIDER || job.meta?.tts_provider || 'openai') as TtsProvider;
  console.log(`[VOICE] Using TTS provider: ${ttsProvider}`);

  if (ttsProvider === 'elevenlabs') {
    return executeVoiceStepElevenLabs(supabase, job, workerId, env, logger, idempotencyKey);
  } else {
    return executeVoiceStepOpenAI(supabase, job, workerId, env, logger, idempotencyKey);
  }
}

// =====================================================
// TTS SPLIT-TEXT RETRY HELPER
// =====================================================
// When OpenAI TTS truncates the ending of long text, split the text at a
// natural sentence boundary and generate two separate audio clips, then
// concatenate the raw MP3 bytes.  MP3 is frame-based so simple byte
// concatenation is valid — each frame is self-contained.

/**
 * Find the best sentence boundary to split text roughly in half.
 * Prefers splitting at the sentence ending closest to the midpoint.
 */
function findSentenceSplitPoint(text: string): number {
  const midpoint = Math.floor(text.length / 2);
  // Find all sentence-ending positions (. ! ? followed by space or end)
  const sentenceEnds: number[] = [];
  for (let i = 0; i < text.length - 1; i++) {
    if (/[.!?]/.test(text[i]) && (text[i + 1] === ' ' || text[i + 1] === '\n')) {
      sentenceEnds.push(i + 1); // include the punctuation
    }
  }
  if (sentenceEnds.length === 0) {
    // No sentence boundaries — split at last space before midpoint
    const lastSpace = text.lastIndexOf(' ', midpoint);
    return lastSpace > 0 ? lastSpace : midpoint;
  }
  // Find sentence end closest to midpoint (but at least 20% through the text)
  const minSplit = Math.floor(text.length * 0.2);
  const maxSplit = Math.floor(text.length * 0.8);
  let bestSplit = sentenceEnds[0];
  let bestDist = Math.abs(sentenceEnds[0] - midpoint);
  for (const pos of sentenceEnds) {
    if (pos < minSplit || pos > maxSplit) continue;
    const dist = Math.abs(pos - midpoint);
    if (dist < bestDist) {
      bestDist = dist;
      bestSplit = pos;
    }
  }
  return bestSplit;
}

/**
 * Generate TTS for text split into two halves, then concatenate the MP3 bytes.
 */
async function generateSplitTTS(
  openaiKey: string,
  fullText: string,
  model: string,
  voice: string,
  instructions: string
): Promise<{ audioBytes: Uint8Array; splitPoint: number }> {
  const splitPoint = findSentenceSplitPoint(fullText);
  const part1Text = fullText.slice(0, splitPoint).trim();
  const part2Text = fullText.slice(splitPoint).trim();

  if (!part1Text || !part2Text) {
    throw new Error(`Text split produced empty part: part1=${part1Text.length} chars, part2=${part2Text.length} chars`);
  }

  console.log(`[VOICE] Split-text TTS: part1=${part1Text.length} chars, part2=${part2Text.length} chars (split at char ${splitPoint})`);

  // Generate both halves (sequentially to avoid rate limits)
  const generatePart = async (text: string, partNum: number): Promise<Uint8Array> => {
    const resp = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: text,
        voice,
        instructions,
        response_format: 'mp3',
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => 'unknown');
      throw new Error(`TTS part ${partNum} failed (${resp.status}): ${errText.slice(0, 200)}`);
    }
    const buf = await resp.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.length < 500) {
      throw new Error(`TTS part ${partNum} returned suspiciously small audio: ${bytes.length} bytes`);
    }
    console.log(`[VOICE] ✓ Part ${partNum}: ${bytes.length} bytes`);
    return bytes;
  };

  const part1Audio = await generatePart(part1Text, 1);
  const part2Audio = await generatePart(part2Text, 2);

  // Concatenate MP3 bytes (MP3 is frame-based, simple concat works)
  const combined = new Uint8Array(part1Audio.length + part2Audio.length);
  combined.set(part1Audio, 0);
  combined.set(part2Audio, part1Audio.length);

  return { audioBytes: combined, splitPoint };
}

// =====================================================
// VOICE PROVIDER: OpenAI gpt-4o-mini-tts
// =====================================================

async function executeVoiceStepOpenAI(
  supabase: SupabaseClient,
  job: Job,
  workerId: string,
  env: Record<string, string>,
  logger: StepLogger,
  idempotencyKey: string
): Promise<StepResult> {
  const openaiKey = env.OPENAI_API_KEY;
  if (!openaiKey) {
    return { success: false, error: 'OPENAI_API_KEY not configured' };
  }

  // === EXTERNAL IDEMPOTENCY: Hash includes provider+model+voice+text ===
  const ttsModel = OPENAI_TTS_MODEL;
  // Use preset-specific voice if available, then job override, then default
  // Load brand-level voice override from config_overrides.voice
  const vibePreset = job.vibe_preset || (job.meta?.vibe_preset as string) || 'urban_legend';
  let brandVoiceOverride: { voice?: string; instructions?: string; speed?: number } | null = null;
  try {
    const { data: voiceTemplate } = await supabase
      .from('brand_templates')
      .select('config_overrides')
      .eq('brand_id', job.brand_id)
      .eq('is_default', true)
      .limit(1)
      .single();
    brandVoiceOverride = voiceTemplate?.config_overrides?.voice || null;
  } catch (_) { /* soft-fail */ }
  const presetVoice = getPresetVoiceConfig(vibePreset, brandVoiceOverride);
  const ttsVoice = (job.meta?.tts_voice as string) || presetVoice.voice;
  const ttsInstructions = (job.meta?.tts_instructions as string) || presetVoice.instructions;
  const canonicalVoiceInput = `openai|${ttsModel}|${ttsVoice}|${job.story_text}`;
  const storyHash = await computeHash(canonicalVoiceInput);
  const storyHashKey = `voice_hash:${storyHash}`;

  // Quality guard: only reuse if quality_ok !== false
  const existingHashAsset = await getAssetByKey(supabase, job.id, storyHashKey, true);
  if (existingHashAsset?.public_url) {
    console.log(`[VOICE] Story hash match (billing protection): ${storyHash.slice(0, 8)}...`);
    await upsertAsset(supabase, job.id, idempotencyKey, 'voice', 
      existingHashAsset.storage_path, existingHashAsset.public_url, {
        story_hash: storyHash,
        copied_from: existingHashAsset.idempotency_key,
        timestamps: existingHashAsset.meta?.timestamps,
        duration_ms: existingHashAsset.meta?.duration_ms,
        tts_provider: 'openai',
      });
    await updateJobMeta(supabase, job.id, {
      audio_url: existingHashAsset.public_url,
      audio_duration_ms: existingHashAsset.meta?.duration_ms,
      tts_provider: 'openai',
    });
    return { success: true, skipped: true, data: { 
      audio_url: existingHashAsset.public_url, 
      billing_protected: true,
      tts_provider: 'openai',
    } };
  }

  const wordCount = job.story_text.split(/\s+/).length;
  const charCount = job.story_text.length;
  console.log(`[VOICE] Synthesizing ${wordCount} words (${charCount} chars) with OpenAI ${ttsModel} voice=${ttsVoice}`);

  try {
    await requireLeaseGrace(supabase, job.id, workerId, 'OpenAI TTS');

    // === COST CONTROL ===
    const costHelper = new CostControlHelper(supabase, job.id, workerId);
    try {
      await assertCanSpend(costHelper, 'openai_tts', 'voice_synthesis', 1);
    } catch (costError) {
      if (isCostLimitError(costError)) {
        console.error(`[VOICE] ❌ Cost limit hit: ${costError instanceof Error ? costError.message : costError}`);
        return { 
          success: false, 
          error: `cost_limit_exceeded: openai_tts - ${costError instanceof Error ? costError.message : 'budget reached'}`,
          data: { chars: charCount, cost_limit_hit: true, failure_class: 'misconfig' }
        };
      }
      throw costError;
    }

    // Snapshot request params
    await logger.snapshot('voice', 'payload', {
      provider: 'openai',
      model: ttsModel,
      voice: ttsVoice,
      instructions: ttsInstructions.slice(0, 100),
      text_length: charCount,
      word_count: wordCount,
      text_preview: job.story_text.slice(0, 200),
    }, 'OpenAI TTS request params');

    // === TTS GENERATION WITH TRUNCATION RETRY ===
    // Strategy: generate → Whisper align → detect truncation → retry if needed
    // Retry 1: re-generate with speed=0.95 (gives model more time to finish)
    // Retry 2: split text at sentence boundary, generate two clips, concatenate
    const MAX_TTS_ATTEMPTS = 3;
    const TRUNCATION_THRESHOLD = 3; // min trailing interpolated words to trigger retry
    const RETRY_SPEED = 0.95;       // slightly slower on first retry

    let audioBytes: Uint8Array = new Uint8Array(0);
    let timestamps: Array<{ word: string; start: number; end: number }> = [];
    let timestampsApproximate = true;
    let estimatedDurationMs = 0;
    let ttsAttempt = 0;
    let truncationResolved = false;
    let ttsRetryStrategy: string | null = null;

    for (ttsAttempt = 1; ttsAttempt <= MAX_TTS_ATTEMPTS; ttsAttempt++) {
      // Determine TTS parameters for this attempt
      const isSpeedRetry = ttsAttempt === 2;
      const isSplitRetry = ttsAttempt === 3;
      const currentSpeed = isSpeedRetry ? RETRY_SPEED : undefined;

      if (ttsAttempt > 1) {
        console.log(`[VOICE] TTS attempt ${ttsAttempt}/${MAX_TTS_ATTEMPTS} — strategy: ${isSpeedRetry ? `speed=${RETRY_SPEED}` : 'text-split'}`);
      }

      // ── Split-text retry: generate two halves and concatenate ──
      if (isSplitRetry) {
        try {
          const splitResult = await generateSplitTTS(
            openaiKey, job.story_text!, ttsModel, ttsVoice, ttsInstructions
          );
          audioBytes = splitResult.audioBytes;
          ttsRetryStrategy = 'text_split';
          console.log(`[VOICE] ✓ Split-text TTS: ${splitResult.splitPoint} chars in part 1, combined ${audioBytes.length} bytes`);
        } catch (splitErr) {
          console.warn(`[VOICE] Split-text retry failed: ${splitErr instanceof Error ? splitErr.message : splitErr} — using last attempt`);
          break; // Keep whatever we had from attempt 2
        }
      } else {
        // ── Normal or speed-retry TTS call ──
        const ttsBody: Record<string, unknown> = {
          model: ttsModel,
          input: job.story_text,
          voice: ttsVoice,
          instructions: ttsInstructions,
          response_format: 'mp3',
        };
        if (currentSpeed !== undefined) {
          ttsBody.speed = currentSpeed;
          ttsRetryStrategy = `speed_${currentSpeed}`;
        }

        const response = await fetchWithError(
          'https://api.openai.com/v1/audio/speech',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openaiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(ttsBody),
          },
          'OpenAI TTS'
        );

        const audioBuffer = await response.arrayBuffer();
        audioBytes = new Uint8Array(audioBuffer);
      }

      if (audioBytes.length < 1000) {
        throw new Error(`OpenAI TTS returned suspiciously small audio: ${audioBytes.length} bytes`);
      }

      // ── Whisper alignment ──
      estimatedDurationMs = Math.round((audioBytes.length / 16000) * 1000);
      timestamps = [];
      timestampsApproximate = true;

      try {
        console.log(`[VOICE] Running Whisper alignment on ${audioBytes.length} byte audio (attempt ${ttsAttempt})...`);
        
        const boundary = '----WhisperBoundary' + Date.now();
        const formParts: Uint8Array[] = [];
        const encoder = new TextEncoder();
        
        formParts.push(encoder.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`
        ));
        formParts.push(audioBytes);
        formParts.push(encoder.encode('\r\n'));
        formParts.push(encoder.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`
        ));
        formParts.push(encoder.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n`
        ));
        formParts.push(encoder.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\nword\r\n`
        ));
        formParts.push(encoder.encode(`--${boundary}--\r\n`));
        
        const totalLength = formParts.reduce((sum, p) => sum + p.length, 0);
        const formBody = new Uint8Array(totalLength);
        let offset = 0;
        for (const part of formParts) {
          formBody.set(part, offset);
          offset += part.length;
        }
        
        const whisperResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
          },
          body: formBody,
        });
        
        if (whisperResp.ok) {
          const whisperData = await whisperResp.json();
          
          if (whisperData.duration) {
            estimatedDurationMs = Math.round(whisperData.duration * 1000);
          }
          
          if (whisperData.words && Array.isArray(whisperData.words) && whisperData.words.length > 0) {
            const whisperWords = whisperData.words.map((w: { word: string; start: number; end: number }) => ({
              word: w.word.trim(),
              start: w.start,
              end: w.end,
            })).filter((w: { word: string }) => w.word.length > 0);
            
            const originalWords = job.story_text!.split(/\s+/).filter(w => w.length > 0);
            timestamps = forceAlignTimestamps(originalWords, whisperWords);
            
            if (timestamps.length > 0) {
              timestampsApproximate = false;
              console.log(`[VOICE] ✓ Forced alignment: ${timestamps.length} words aligned from ${whisperWords.length} Whisper words, duration=${estimatedDurationMs}ms`);

              // === TTS TRUNCATION DETECTION ===
              const MIN_WORD_DUR = 0.08;
              let trailingInterpolated = 0;
              for (let ti = timestamps.length - 1; ti >= 0; ti--) {
                const dur = timestamps[ti].end - timestamps[ti].start;
                if (Math.abs(dur - MIN_WORD_DUR) < 0.005) {
                  trailingInterpolated++;
                } else {
                  break;
                }
              }

              if (trailingInterpolated >= TRUNCATION_THRESHOLD) {
                const truncatedText = timestamps.slice(-trailingInterpolated).map(t => t.word).join(' ');
                console.warn(`[VOICE] ⚠️ TTS TRUNCATION DETECTED (attempt ${ttsAttempt}): ${trailingInterpolated} trailing words likely not spoken: "${truncatedText}"`);
                console.warn(`[VOICE]    Whisper matched ${whisperWords.length} words but story has ${originalWords.length} — last ${trailingInterpolated} were interpolated at ${MIN_WORD_DUR}s each`);

                if (ttsAttempt < MAX_TTS_ATTEMPTS) {
                  console.log(`[VOICE] 🔄 Retrying TTS to recover truncated words...`);
                  continue; // Retry with next strategy
                } else {
                  // Final attempt still truncated — accept it but flag
                  console.warn(`[VOICE] ⚠️ Truncation persists after ${MAX_TTS_ATTEMPTS} attempts — accepting with flag`);
                  await updateJobMeta(supabase, job.id, {
                    tts_truncation_detected: true,
                    tts_truncated_word_count: trailingInterpolated,
                    tts_truncated_text: truncatedText,
                    tts_retry_attempts: ttsAttempt,
                    tts_retry_strategy: ttsRetryStrategy,
                    tts_truncation_resolved: false,
                  });
                }
              } else {
                // No truncation (or below threshold) — success
                if (ttsAttempt > 1) {
                  console.log(`[VOICE] ✓ Truncation resolved on attempt ${ttsAttempt} (strategy: ${ttsRetryStrategy})`);
                  truncationResolved = true;
                  await updateJobMeta(supabase, job.id, {
                    tts_truncation_detected: false,
                    tts_truncation_resolved: true,
                    tts_retry_attempts: ttsAttempt,
                    tts_retry_strategy: ttsRetryStrategy,
                  });
                }
              }
            } else {
              console.warn(`[VOICE] Forced alignment returned 0 words, falling back to Whisper raw`);
              timestamps = whisperWords;
              timestampsApproximate = false;
            }
          } else {
            console.warn(`[VOICE] Whisper returned no word timestamps, falling back to approximate`);
          }
        } else {
          const errText = await whisperResp.text().catch(() => 'unknown');
          console.warn(`[VOICE] Whisper alignment failed (${whisperResp.status}): ${errText.slice(0, 200)} — falling back to approximate`);
        }
      } catch (whisperErr) {
        console.warn(`[VOICE] Whisper alignment error: ${whisperErr instanceof Error ? whisperErr.message : whisperErr} — falling back to approximate`);
      }

      // If we get here (didn't `continue`), we're done with retry loop
      break;
    }
    
    // Fallback: approximate timestamps if Whisper didn't work
    if (timestamps.length === 0) {
      const words = job.story_text!.split(/\s+/).filter(w => w.length > 0);
      const avgWordDurationSec = (estimatedDurationMs / 1000) / words.length;
      let currentTime = 0;
      for (const word of words) {
        timestamps.push({
          word: word,
          start: currentTime,
          end: currentTime + avgWordDurationSec,
        });
        currentTime += avgWordDurationSec;
      }
      timestampsApproximate = true;
    }

    // Upload final audio to storage
    const storagePath = pathForAudio(job.brand_id, job.id);
    const publicUrl = await uploadToStorage(
      supabase,
      STORAGE_BUCKET,
      storagePath,
      audioBytes,
      'audio/mpeg'
    );

    // Store asset
    await upsertAsset(supabase, job.id, idempotencyKey, 'voice_audio', storagePath, publicUrl, {
      duration_ms: estimatedDurationMs,
      word_count: timestamps.length,
      has_timestamps: true,
      timestamps_approximate: timestampsApproximate,
      story_hash: storyHash,
      timestamps: timestamps,
      tts_provider: 'openai',
      tts_model: ttsModel,
      tts_voice: ttsVoice,
    });
    
    // Also store with hash key for billing protection
    await upsertAsset(supabase, job.id, storyHashKey, 'voice_audio', storagePath, publicUrl, {
      duration_ms: estimatedDurationMs,
      word_count: timestamps.length,
      has_timestamps: true,
      timestamps_approximate: timestampsApproximate,
      story_hash: storyHash,
      timestamps: timestamps,
      tts_provider: 'openai',
      tts_model: ttsModel,
      tts_voice: ttsVoice,
    });

    // Update job meta
    await updateJobMeta(supabase, job.id, {
      audio_url: publicUrl,
      audio_timestamps: timestamps,
      audio_duration_ms: estimatedDurationMs,
      tts_provider: 'openai',
      tts_model: ttsModel,
      tts_voice: ttsVoice,
    });

    console.log(`[VOICE] ✓ OpenAI TTS: ${estimatedDurationMs}ms audio (${audioBytes.length} bytes), ${timestamps.length} word timestamps (${timestampsApproximate ? 'approx' : 'precise via Whisper'})${ttsAttempt > 1 ? ` [${ttsAttempt} attempts, strategy: ${ttsRetryStrategy}]` : ''}`);
    
    // === COST CONTROL: Record usage + release slot ===
    const costIdempotencyKey = `job:${job.id}:openai_tts:voice:${storyHash.slice(0, 16)}`;
    // OpenAI TTS pricing: ~$0.015 per 1K chars for gpt-4o-mini-tts
    // Multiply by attempt count since each retry is a separate API call
    const estimatedCostCents = Math.round(charCount * 0.0015 * ttsAttempt);
    await costHelper.recordUsage(
      'openai_tts',
      costIdempotencyKey,
      { 
        chars_processed: charCount, 
        model: ttsModel,
        voice: ttsVoice,
        estimated_cost_cents: estimatedCostCents,
        audio_bytes: audioBytes.length,
      },
      'voice',
      'voice_synthesis'
    );
    await costHelper.releaseSlot('openai_tts', 'voice_synthesis');

    // Snapshot result
    await logger.snapshot('voice', 'response', {
      provider: 'openai',
      duration_ms: estimatedDurationMs,
      word_count: timestamps.length,
      has_timestamps: true,
      timestamps_approximate: timestampsApproximate,
      audio_bytes: audioBytes.length,
      audio_url: publicUrl,
      tts_attempts: ttsAttempt,
      tts_retry_strategy: ttsRetryStrategy,
      tts_truncation_resolved: truncationResolved,
    }, 'OpenAI TTS result');

    return { success: true, data: { audio_url: publicUrl, duration_ms: estimatedDurationMs, tts_provider: 'openai' } };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[VOICE] ✗ OpenAI TTS Failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

// =====================================================
// VOICE PROVIDER: ElevenLabs
// =====================================================

async function executeVoiceStepElevenLabs(
  supabase: SupabaseClient,
  job: Job,
  workerId: string,
  env: Record<string, string>,
  logger: StepLogger,
  idempotencyKey: string
): Promise<StepResult> {

  const elevenLabsKey = env.ELEVENLABS_API_KEY;
  if (!elevenLabsKey) {
    return { success: false, error: 'ELEVENLABS_API_KEY not configured' };
  }

  // === EXTERNAL IDEMPOTENCY: Hash includes voice_id+model+text to avoid cross-config collisions ===
  const voiceModel = 'eleven_turbo_v2_5';
  const voiceStability = '0.5';
  const voiceSimilarity = '0.75';
  const canonicalVoiceInput = `${ELEVENLABS_VOICE_ID}|${voiceModel}|${voiceStability}|${voiceSimilarity}|${job.story_text}`;
  const storyHash = await computeHash(canonicalVoiceInput);
  const storyHashKey = `voice_hash:${storyHash}`;
  // Quality guard: only reuse if quality_ok !== false
  const existingHashAsset = await getAssetByKey(supabase, job.id, storyHashKey, true);
  if (existingHashAsset?.public_url) {
    console.log(`[VOICE] Story hash match (billing protection): ${storyHash.slice(0, 8)}...`);
    // Copy existing asset to job's voice key
    await upsertAsset(supabase, job.id, idempotencyKey, 'voice', 
      existingHashAsset.storage_path, existingHashAsset.public_url, {
        story_hash: storyHash,
        copied_from: existingHashAsset.idempotency_key,
        timestamps: existingHashAsset.meta?.timestamps,
        duration_ms: existingHashAsset.meta?.duration_ms,
      });
    // Update job meta
    await updateJobMeta(supabase, job.id, {
      audio_url: existingHashAsset.public_url,
      audio_duration_ms: existingHashAsset.meta?.duration_ms,
    });
    return { success: true, skipped: true, data: { 
      audio_url: existingHashAsset.public_url, 
      billing_protected: true 
    } };
  }

  console.log(`[VOICE] Synthesizing ${job.story_text.split(/\s+/).length} words with ElevenLabs`);

  // Character count for cost tracking
  const charCount = job.story_text.length;

  try {
    // === LEASE GRACE CHECK: Verify enough time before expensive API call ===
    await requireLeaseGrace(supabase, job.id, workerId, 'ElevenLabs TTS');

    // === COST CONTROL: Check budget + acquire slot before ElevenLabs call ===
    const costHelper = new CostControlHelper(supabase, job.id, workerId);
    try {
      await assertCanSpend(costHelper, 'elevenlabs', 'voice_synthesis', 1);
    } catch (costError) {
      if (isCostLimitError(costError)) {
        console.error(`[VOICE] ❌ Cost limit hit: ${costError instanceof Error ? costError.message : costError}`);
        return { 
          success: false, 
          error: `cost_limit_exceeded: elevenlabs - ${costError instanceof Error ? costError.message : 'budget reached'}`,
          data: { 
            chars: charCount,
            cost_limit_hit: true,
            failure_class: 'misconfig'
          }
        };
      }
      throw costError;
    }

    // Snapshot voice request params
    await logger.snapshot('voice', 'payload', {
      voice_id: ELEVENLABS_VOICE_ID,
      model: voiceModel,
      text_length: job.story_text.length,
      word_count: job.story_text.split(/\s+/).length,
      text_preview: job.story_text.slice(0, 200),
    }, 'ElevenLabs TTS request params');

    // Call ElevenLabs with timestamps
    const response = await fetchWithError(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}/with-timestamps`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': elevenLabsKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: job.story_text,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      },
      'ElevenLabs TTS'
    );

    const data = await response.json();
    
    if (!data.audio_base64) {
      throw new Error('ElevenLabs returned no audio data');
    }

    // Decode base64 audio
    const audioBase64 = data.audio_base64;
    const binaryString = atob(audioBase64);
    const audioBytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      audioBytes[i] = binaryString.charCodeAt(i);
    }

    // Upload to storage (using standardized path)
    const storagePath = pathForAudio(job.brand_id, job.id);
    const publicUrl = await uploadToStorage(
      supabase,
      STORAGE_BUCKET,
      storagePath,
      audioBytes,
      'audio/mpeg'
    );

    // Parse timestamps if available
    let timestamps: Array<{ word: string; start: number; end: number }> = [];
    let durationMs = 0;

    if (data.alignment?.characters) {
      // Parse character-level timestamps into word timestamps
      const chars = data.alignment.characters;
      const charStarts = data.alignment.character_start_times_seconds;
      const charEnds = data.alignment.character_end_times_seconds;

      let currentWord = '';
      let wordStart = 0;
      let wordEnd = 0;

      for (let i = 0; i < chars.length; i++) {
        const char = chars[i];
        if (char === ' ' || i === chars.length - 1) {
          if (i === chars.length - 1 && char !== ' ') {
            currentWord += char;
            wordEnd = charEnds[i];
          }
          if (currentWord.trim().length > 0) {
            timestamps.push({
              word: currentWord.trim(),
              start: wordStart,
              end: wordEnd,
            });
          }
          currentWord = '';
          if (i + 1 < chars.length) {
            wordStart = charStarts[i + 1];
          }
        } else {
          if (currentWord === '') {
            wordStart = charStarts[i];
          }
          currentWord += char;
          wordEnd = charEnds[i];
        }
      }

      durationMs = (charEnds[charEnds.length - 1] || 0) * 1000;
    }

    // Store asset
    await upsertAsset(supabase, job.id, idempotencyKey, 'voice_audio', storagePath, publicUrl, {
      duration_ms: durationMs,
      word_count: timestamps.length,
      has_timestamps: timestamps.length > 0,
      story_hash: storyHash,
      timestamps: timestamps,
    });
    
    // Also store with hash key for external idempotency (billing protection)
    await upsertAsset(supabase, job.id, storyHashKey, 'voice_audio', storagePath, publicUrl, {
      duration_ms: durationMs,
      word_count: timestamps.length,
      has_timestamps: timestamps.length > 0,
      story_hash: storyHash,
      timestamps: timestamps,
    });

    // Update job meta with timestamps
    await updateJobMeta(supabase, job.id, {
      audio_url: publicUrl,
      audio_timestamps: timestamps,
      audio_duration_ms: durationMs,
    });

    console.log(`[VOICE] ✓ Generated ${durationMs}ms audio, ${timestamps.length} word timestamps`);
    
    // === COST CONTROL: Record usage + release slot ===
    const costIdempotencyKey = `job:${job.id}:elevenlabs:voice:${storyHash.slice(0, 16)}`;
    // Estimate: ~$0.30 per 1K chars = 0.03 cents per char
    const estimatedCostCents = Math.round(charCount * 0.03);
    await costHelper.recordUsage(
      'elevenlabs',
      costIdempotencyKey,
      { 
        chars_processed: charCount, 
        model: 'eleven_turbo_v2_5',
        estimated_cost_cents: estimatedCostCents
      },
      'voice',
      'voice_synthesis'
    );
    await costHelper.releaseSlot('elevenlabs', 'voice_synthesis');

    // Snapshot voice response summary
    await logger.snapshot('voice', 'response', {
      duration_ms: durationMs,
      word_count: timestamps.length,
      has_timestamps: timestamps.length > 0,
      audio_url: publicUrl,
    }, 'ElevenLabs TTS result');

    return { success: true, data: { audio_url: publicUrl, duration_ms: durationMs } };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[VOICE] ✗ Failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

// =====================================================
// STEP 5: MUSIC SELECTION (v2 — DB-driven, Background Music V1)
// Loads brand music config + tracks from DB, deterministic selection.
// Stores track URL + music_config for renderer in job_assets/meta.
// No API calls → no cost controls needed for this step.
// =====================================================

/**
 * Music configuration object stored in brand_templates.config_overrides.music
 * and passed to the FFmpeg renderer for audio mixing.
 */
interface MusicConfig {
  enabled: boolean;
  default_volume: number;       // 0.0 - 1.0 (e.g. 0.18 = 18%)
  ducking: {
    enabled: boolean;
    duck_volume: number;        // Volume during speech (e.g. 0.08)
    attack_ms: number;          // How fast to duck (e.g. 150)
    release_ms: number;         // How fast to restore (e.g. 250)
  };
  fade: {
    in_ms: number;              // Fade-in duration (e.g. 800)
    out_ms: number;             // Fade-out duration (e.g. 1200)
  };
}

interface SelectedTrack {
  track_id: string;
  display_name: string;
  file_path: string;
  storage_url: string;
  duration_seconds: number;
  loopable: boolean;
  mood: string;
  track_count: number;
}

export async function executeMusicStep(
  supabase: SupabaseClient,
  job: Job,
  workerId: string,
  env: Record<string, string>,
  logger: StepLogger
): Promise<StepResult> {
  const idempotencyKey = `${job.id}:music_select`;

  // Check if already done (idempotent resume)
  const existingAsset = await getAssetByKey(supabase, job.id, idempotencyKey);
  if (existingAsset?.meta?.track_id && existingAsset?.meta?.music_config) {
    console.log(`[MUSIC] Already selected: ${existingAsset.meta.track_id}`);
    return { success: true, skipped: true, data: existingAsset.meta as Record<string, unknown> };
  }

  // Check if job already has music track from a previous run
  if (job.meta?.music_track_id && job.meta?.music_url && job.meta?.music_config) {
    console.log(`[MUSIC] Track already set in job meta: ${job.meta.music_track_id}`);
    await upsertAsset(supabase, job.id, idempotencyKey, 'music', '', null, {
      track_id: job.meta.music_track_id as string,
      music_url: job.meta.music_url as string,
      music_config: job.meta.music_config,
      source: 'job_meta'
    });
    return { success: true, skipped: true, data: { 
      track_id: job.meta.music_track_id,
      music_url: job.meta.music_url,
    } };
  }

  const vibePreset = job.vibe_preset || (job.meta?.vibe_preset as string) || 'urban_legend';

  try {
    // -----------------------------------------------
    // 1. Load brand music config (from brand_templates or defaults)
    // -----------------------------------------------
    const { data: musicConfig, error: configError } = await supabase
      .rpc('get_brand_music_config', { p_brand_id: job.brand_id });

    if (configError) {
      console.warn(`[MUSIC] Failed to load music config: ${configError.message}, using defaults`);
    }

    const config: MusicConfig = musicConfig || {
      enabled: true,
      default_volume: 0.18,
      ducking: { enabled: true, duck_volume: 0.08, attack_ms: 150, release_ms: 250 },
      fade: { in_ms: 800, out_ms: 1200 },
    };

    // If music is disabled for this brand, skip entirely
    if (!config.enabled) {
      console.log(`[MUSIC] Music disabled for brand ${job.brand_id}, skipping`);
      await upsertAsset(supabase, job.id, idempotencyKey, 'music', '', null, {
        track_id: null,
        music_enabled: false,
        source: 'brand_config_disabled'
      });
      await updateJobMeta(supabase, job.id, { music_enabled: false });
      return { success: true, skipped: true, data: { music_enabled: false } };
    }

    // -----------------------------------------------
    // 2. Load available tracks from DB
    // -----------------------------------------------
    const { data: tracks, error: tracksError } = await supabase
      .rpc('get_brand_music_tracks', { 
        p_brand_id: job.brand_id,
        p_vibe_preset: vibePreset
      });

    if (tracksError) {
      console.error(`[MUSIC] Failed to load tracks: ${tracksError.message}`);
      // Fall back to hardcoded track map (backwards compat)
      return await musicFallback(supabase, job, vibePreset, config, idempotencyKey, logger);
    }

    if (!tracks || tracks.length === 0) {
      console.warn(`[MUSIC] No tracks found for brand ${job.brand_id} / vibe ${vibePreset}`);
      // Fall back to hardcoded
      return await musicFallback(supabase, job, vibePreset, config, idempotencyKey, logger);
    }

    // -----------------------------------------------
    // 3. Deterministic selection: hash(job_id + brand_id) % count
    // -----------------------------------------------
    const hashInput = `${job.id}::${job.brand_id}`;
    const hashHex = await computeHash(hashInput);
    const hashVal = parseInt(hashHex.slice(0, 8), 16);
    const selectedIndex = hashVal % tracks.length;
    const selected = tracks[selectedIndex];

    console.log(`[MUSIC] Deterministic selection: hash=${hashHex.slice(0,8)} → index ${selectedIndex}/${tracks.length} → ${selected.track_id}`);

    // -----------------------------------------------
    // 3b. Per-track volume override
    //     If the track has a volume set (0.0–1.0), use it
    //     instead of the brand-level default_volume.
    // -----------------------------------------------
    if (selected.volume != null && typeof selected.volume === 'number') {
      console.log(`[MUSIC] Per-track volume override: ${selected.volume} (brand default was ${config.default_volume})`);
      config.default_volume = selected.volume;
    }

    // -----------------------------------------------
    // 4. Get public URL for the track file from Storage
    // -----------------------------------------------
    const trackPath = selected.file_path || pathForBrandMusic(job.brand_id, selected.track_id);
    
    const { data: urlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(trackPath);

    const musicUrl = urlData?.publicUrl || null;

    if (!musicUrl) {
      console.warn(`[MUSIC] Could not get public URL for ${trackPath}, track may not be uploaded yet`);
      // Warn but don't fail — renderer will skip music if no URL
      await logger.snapshot('music', 'warn', {
        warn_code: 'music_missing_file',
        track_id: selected.track_id,
        file_path: trackPath,
        reason: 'Track selected but MP3 not found in storage — video will render without music',
      }, `⚠ Track file missing: ${trackPath}`);
    }

    // -----------------------------------------------
    // 5. Store asset + update job meta
    //    Include "music fingerprint" for debugging:
    //    track_id + file hash proxy + config hash
    // -----------------------------------------------
    const configHash = (await computeHash(JSON.stringify(config))).slice(0, 16);

    const assetMeta = {
      track_id: selected.track_id,
      display_name: selected.display_name,
      file_path: trackPath,
      music_url: musicUrl,
      duration_seconds: selected.duration_seconds,
      loopable: selected.loopable,
      mood: selected.mood,
      track_count: tracks.length,
      vibe_preset: vibePreset,
      selection_hash: hashHex.slice(0, 16),
      selection_index: selectedIndex,
      music_config: config,
      music_config_hash: configHash,
      source: 'db_tracks'
    };

    await upsertAsset(supabase, job.id, idempotencyKey, 'music', trackPath, musicUrl, assetMeta);

    await updateJobMeta(supabase, job.id, {
      music_track_id: selected.track_id,
      music_url: musicUrl,
      music_config: config,
      music_enabled: true,
      music_loopable: selected.loopable ?? true,
    });

    // Log snapshot
    await logger.snapshot('music', 'output', {
      track_id: selected.track_id,
      display_name: selected.display_name,
      mood: selected.mood,
      loopable: selected.loopable,
      duration_seconds: selected.duration_seconds,
      track_count: tracks.length,
      selection_index: selectedIndex,
      volume: config.default_volume,
      ducking_enabled: config.ducking.enabled,
      fade_in_ms: config.fade.in_ms,
      fade_out_ms: config.fade.out_ms,
    }, `Selected track: ${selected.track_id}`);

    console.log(`[MUSIC] ✓ Selected: ${selected.track_id} (${selected.display_name}), volume=${config.default_volume}, ducking=${config.ducking.enabled}`);
    
    return { 
      success: true, 
      data: { 
        track_id: selected.track_id,
        music_url: musicUrl,
        track_count: tracks.length,
      } 
    };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[MUSIC] ✗ Failed: ${errorMsg} — soft-failing, video will render without music`);

    // ALWAYS persist a job_assets record so downstream steps know music was attempted
    try {
      await upsertAsset(supabase, job.id, idempotencyKey, 'music', '', null, {
        track_id: null,
        music_enabled: false,
        applied: false,
        source: 'error',
        error: errorMsg.slice(0, 500),
      });
      await updateJobMeta(supabase, job.id, { music_enabled: false, music_error: errorMsg.slice(0, 500) });
    } catch (persistErr) {
      console.error(`[MUSIC] Failed to persist error asset: ${persistErr instanceof Error ? persistErr.message : String(persistErr)}`);
    }

    // Warning snapshot with structured code for observability
    try {
      await logger.snapshot('music', 'warn', {
        warn_code: 'music_selection_failed',
        error: errorMsg.slice(0, 500),
        brand_id: job.brand_id,
        vibe_preset: job.vibe_preset || job.meta?.vibe_preset || 'unknown',
        reason: 'Music step failed — video will render without music',
      }, `⚠ Music selection failed: ${errorMsg.slice(0, 120)}`);
    } catch (_) { /* snapshot is best-effort */ }

    // Soft-fail: return success so the job continues without music
    return { success: true, skipped: true, data: { music_enabled: false, error: errorMsg } };
  }
}

/**
 * Fallback music selection for brands with no DB tracks.
 * Uses hardcoded vibe→track_id map (legacy behavior).
 */
async function musicFallback(
  supabase: SupabaseClient,
  job: Job,
  vibePreset: string,
  config: MusicConfig,
  idempotencyKey: string,
  logger: StepLogger,
): Promise<StepResult> {
  const trackMap: Record<string, string> = {
    'urban_legend': 'ambient_dark_01',
    'slow_creepy': 'ambient_dark_01',
    'punchy_shock': 'tension_pulse_01',
    'atmospheric': 'ambient_dark_01',
    'one_too_many': 'tension_pulse_01',
    'nosleep': 'ambient_dark_01',
    'backrooms': 'eerie_piano_01',
    'glitch': 'tension_pulse_01',
    'reddit_trending_horror': 'ambient_dark_01',
  };

  const trackId = trackMap[vibePreset] || 'ambient_dark_01';
  const trackPath = pathForBrandMusic(job.brand_id, trackId);

  // Attempt to get public URL (track may not exist in storage)
  const { data: urlData } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(trackPath);
  const musicUrl = urlData?.publicUrl || null;

  if (!musicUrl) {
    await logger.snapshot('music', 'warn', {
      warn_code: 'music_missing_file',
      track_id: trackId,
      file_path: trackPath,
      source: 'fallback',
      reason: 'Fallback track selected but MP3 not found in storage',
    }, `⚠ Fallback track file missing: ${trackPath}`);
  }

  console.log(`[MUSIC] Fallback selection: ${trackId} for vibe ${vibePreset}`);

  const assetMeta = {
    track_id: trackId,
    music_url: musicUrl,
    file_path: trackPath,
    vibe_preset: vibePreset,
    music_config: config,
    source: 'fallback_hardcoded'
  };

  await upsertAsset(supabase, job.id, idempotencyKey, 'music', trackPath, musicUrl, assetMeta);

  await updateJobMeta(supabase, job.id, {
    music_track_id: trackId,
    music_url: musicUrl,
    music_config: config,
    music_enabled: true,
  });

  await logger.snapshot('music', 'output', {
    track_id: trackId,
    source: 'fallback',
    vibe_preset: vibePreset,
    volume: config.default_volume,
    ducking_enabled: config.ducking.enabled,
  }, `Fallback track: ${trackId}`);

  return { success: true, data: { track_id: trackId, music_url: musicUrl, source: 'fallback' } };
}

// =====================================================
// STEP 6: IMAGE GENERATION
// Supports gpt-image-1 (cheapest), dall-e-2, and dall-e-3 (highest quality)
// =====================================================

// Image model configuration - can be overridden via job.meta.image_model or env
type ImageModel = 'gpt-image-1' | 'dall-e-2' | 'dall-e-3' | 'comfyui';
const DEFAULT_IMAGE_MODEL: ImageModel = 'gpt-image-1'; // Cheapest: ~$0.016/image at low quality

// ComfyUI fallback reason enum — consistent across renderer, edge function, and job_assets
type FallbackReason = 'offline' | 'queue_full' | 'vram_low' | 'timeout' | 'error';

/**
 * Force-align original story words onto Whisper's word-level timestamps.
 * 
 * Problem: Whisper re-transcribes the audio, so its words may differ from the
 * original story_text (contractions, punctuation, minor misheard words).
 * We want the ORIGINAL words displayed as subtitles but with WHISPER's timing.
 * 
 * Approach: Greedy sequential matching with fuzzy fallback.
 *  - For each original word, try to find a matching Whisper word nearby.
 *  - "Match" = normalized forms are equal, or Levenshtein distance ≤ 2.
 *  - If matched, use Whisper's {start, end} but the original word text.
 *  - If not matched, interpolate timing from surrounding matched words.
 */
function forceAlignTimestamps(
  originalWords: string[],
  whisperWords: Array<{ word: string; start: number; end: number }>,
): Array<{ word: string; start: number; end: number }> {
  if (whisperWords.length === 0) return [];
  
  const normalize = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, '');
  
  // Simple Levenshtein distance (good enough for short words)
  const levenshtein = (a: string, b: string): number => {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        const cost = b[i - 1] === a[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost,
        );
      }
    }
    return matrix[b.length][a.length];
  };
  
  const whisperNorm = whisperWords.map(w => normalize(w.word));
  const result: Array<{ word: string; start: number; end: number; matched: boolean }> = [];
  let wIdx = 0; // Current position in whisper words
  
  for (let oIdx = 0; oIdx < originalWords.length; oIdx++) {
    const origNorm = normalize(originalWords[oIdx]);
    if (origNorm.length === 0) continue; // Skip empty after normalization
    
    // Search ahead up to 12 positions in Whisper words for a match
    let bestMatch = -1;
    let bestDist = 999;
    const searchLimit = Math.min(12, whisperWords.length - wIdx);
    
    for (let look = 0; look < searchLimit; look++) {
      const candidateIdx = wIdx + look;
      if (candidateIdx >= whisperWords.length) break;
      
      const wNorm = whisperNorm[candidateIdx];
      
      // Exact match
      if (wNorm === origNorm) {
        bestMatch = candidateIdx;
        bestDist = 0;
        break;
      }
      
      // Fuzzy match (Levenshtein ≤ 2 for words > 3 chars, ≤ 1 for short words)
      const maxDist = origNorm.length > 3 ? 2 : 1;
      const dist = levenshtein(origNorm, wNorm);
      if (dist <= maxDist && dist < bestDist) {
        bestMatch = candidateIdx;
        bestDist = dist;
      }
      
      // Also handle contractions: "didn't" might become "did" + "not" in Whisper
      // Check if origNorm starts with wNorm (partial match)
      if (origNorm.startsWith(wNorm) && wNorm.length >= 3) {
        bestMatch = candidateIdx;
        bestDist = 0;
        break;
      }
    }
    
    if (bestMatch >= 0) {
      result.push({
        word: originalWords[oIdx],
        start: whisperWords[bestMatch].start,
        end: whisperWords[bestMatch].end,
        matched: true,
      });
      wIdx = bestMatch + 1;
    } else {
      // No match — mark for interpolation
      result.push({
        word: originalWords[oIdx],
        start: -1,
        end: -1,
        matched: false,
      });
      // Don't advance wIdx — the Whisper word might match the next original word
    }
  }
  
  // Interpolate timing for unmatched words from surrounding matched words
  for (let i = 0; i < result.length; i++) {
    if (result[i].matched) continue;
    
    // Find previous matched word
    let prevEnd = 0;
    for (let p = i - 1; p >= 0; p--) {
      if (result[p].matched) {
        prevEnd = result[p].end;
        break;
      }
    }
    
    // Find next matched word
    let nextStart = whisperWords[whisperWords.length - 1].end;
    for (let n = i + 1; n < result.length; n++) {
      if (result[n].matched) {
        nextStart = result[n].start;
        break;
      }
    }
    
    // Count unmatched words in this gap (for even distribution)
    let gapCount = 1;
    let gapPosition = 0;
    for (let g = i - 1; g >= 0 && !result[g].matched; g--) gapPosition++;
    for (let g = i; g < result.length && !result[g].matched; g++) gapCount = g - i + gapPosition + 1;
    
    const gapDuration = nextStart - prevEnd;
    // Minimum 0.08s per word to prevent zero-duration clustering when
    // matched Whisper words are contiguous (end == next start)
    const MIN_WORD_DURATION = 0.08;
    const rawWordDuration = gapDuration / gapCount;
    const wordDuration = Math.max(rawWordDuration, MIN_WORD_DURATION);
    result[i].start = prevEnd + gapPosition * wordDuration;
    result[i].end = result[i].start + wordDuration;
  }
  
  const matchedCount = result.filter(r => r.matched).length;
  const matchRate = ((matchedCount / result.length) * 100).toFixed(1);
  console.log(`[FORCE_ALIGN] ${matchedCount}/${result.length} words matched (${matchRate}%), ${result.length - matchedCount} interpolated`);
  
  return result.map(r => ({ word: r.word, start: r.start, end: r.end }));
}

/**
 * Voice-Aligned Scene Re-alignment (Improvement #1)
 * Matches scene text boundaries to actual voice word timestamps so each scene's
 * start/end time reflects when those words are actually spoken.
 * 
 * This is called at the start of the images step (which runs after voice).
 * Falls back to original timing if timestamps are unavailable or matching fails.
 */
function alignScenesToVoice(
  scenes: Array<{ index: number; text: string; startTime: number; endTime: number; keywords: string[] }>,
  audioTimestamps: Array<{ word: string; start: number; end: number }>,
  totalDuration: number,
): Array<{ index: number; text: string; startTime: number; endTime: number; keywords: string[] }> {
  if (!audioTimestamps || audioTimestamps.length === 0) {
    console.log(`[VOICE_ALIGN] No audio timestamps available, keeping original timing`);
    return scenes;
  }

  // Normalize a word for matching: lowercase, strip punctuation
  const normalize = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, '');

  // Simple Levenshtein for fuzzy matching
  const levenshtein = (a: string, b: string): number => {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        const cost = b[i - 1] === a[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost,
        );
      }
    }
    return matrix[b.length][a.length];
  };

  // Build normalized voice word list
  const voiceWords = audioTimestamps.map(t => ({
    normalized: normalize(t.word),
    start: t.start,
    end: t.end,
  }));

  let voiceIdx = 0;
  const aligned = [];

  for (let si = 0; si < scenes.length; si++) {
    const scene = scenes[si];
    // Split scene text into words and normalize
    const sceneWords = scene.text.split(/\s+/).map(w => normalize(w)).filter(w => w.length > 0);
    
    if (sceneWords.length === 0) {
      // Empty scene text — use original timing
      aligned.push({ ...scene });
      continue;
    }

    // Find matching voice words sequentially
    const matchStart = voiceIdx;
    let wordsMatched = 0;

    for (const sw of sceneWords) {
      // Search ahead up to 12 positions with fuzzy matching
      let found = false;
      let bestMatch = -1;
      let bestDist = 999;
      const searchLimit = Math.min(12, voiceWords.length - voiceIdx);
      
      for (let look = 0; look < searchLimit; look++) {
        const candidateIdx = voiceIdx + look;
        if (candidateIdx >= voiceWords.length) break;
        
        // Exact match — take immediately
        if (voiceWords[candidateIdx].normalized === sw) {
          bestMatch = look;
          bestDist = 0;
          break;
        }
        
        // Fuzzy match (Levenshtein ≤ 2 for words > 3 chars, ≤ 1 for short)
        const maxDist = sw.length > 3 ? 2 : 1;
        const dist = levenshtein(sw, voiceWords[candidateIdx].normalized);
        if (dist <= maxDist && dist < bestDist) {
          bestMatch = look;
          bestDist = dist;
        }
      }
      
      if (bestMatch >= 0) {
        voiceIdx = voiceIdx + bestMatch + 1;
        wordsMatched++;
        found = true;
      }
      
      if (!found) {
        // Skip this word — minor mismatch
        voiceIdx++;
        wordsMatched++;
      }
    }

    // Determine scene timing from matched voice words
    if (matchStart < voiceWords.length && voiceIdx > matchStart) {
      const startTime = voiceWords[matchStart].start;
      const endIdx = Math.min(voiceIdx - 1, voiceWords.length - 1);
      const endTime = voiceWords[endIdx].end;
      
      aligned.push({
        ...scene,
        startTime: parseFloat(startTime.toFixed(3)),
        endTime: parseFloat(Math.max(endTime, startTime + 1.5).toFixed(3)), // Min 1.5s — short scenes get boosted early (hard floor 2s at assemble)
      });
    } else {
      // Fallback to original timing
      aligned.push({ ...scene });
    }
  }

  // Last scene: extend to total audio duration (covers any trailing silence)
  if (aligned.length > 0 && audioTimestamps.length > 0) {
    const lastVoiceEnd = audioTimestamps[audioTimestamps.length - 1].end;
    const audioDuration = Math.max(lastVoiceEnd, totalDuration);
    aligned[aligned.length - 1].endTime = parseFloat(audioDuration.toFixed(3));
  }

  // Log alignment results
  const originalDurations = scenes.map(s => (s.endTime - s.startTime).toFixed(1));
  const alignedDurations = aligned.map(s => (s.endTime - s.startTime).toFixed(1));
  console.log(`[VOICE_ALIGN] Original: ${originalDurations.join(', ')}s`);
  console.log(`[VOICE_ALIGN] Aligned:  ${alignedDurations.join(', ')}s`);

  return aligned;
}

/**
 * Compute Ken Burns mood level from visual cue data.
 * mood 1-6: classic (gentle zoom), 7-10: cinematic (pan, sweep, diagonal).
 * Climax scenes always get high mood for dramatic motion.
 */
function computeMoodLevel(
  sceneIndex: number,
  totalScenes: number,
  visualCue?: VisualCue,
): number {
  // Base tension: escalates from 3 → 8 across the video
  const progress = sceneIndex / Math.max(totalScenes - 1, 1);
  const baseMood = Math.round(3 + progress * 5);

  // Climax boost: last 1-2 scenes get max drama
  if (visualCue?.isClimax) {
    return Math.min(10, baseMood + 3);
  }

  // Scene type adjustments
  const type = visualCue?.sceneType || 'atmosphere';
  const camera = visualCue?.camera || 'medium';
  
  let mood = baseMood;
  
  // Establishing/wide shots: calmer motion
  if (type === 'establishing' || camera === 'wide') mood = Math.max(2, mood - 1);
  // Object/detail close-ups: moderate
  if (type === 'object' && camera.includes('close')) mood = Math.min(6, mood);
  // Atmosphere shots: slightly elevated
  if (type === 'atmosphere') mood = Math.min(8, mood + 1);
  // Group shots: moderate
  if (type === 'group') mood = Math.min(7, mood);
  // Character close-ups: moderate-high
  if (type === 'character' && camera.includes('close')) mood = Math.min(8, mood + 1);
  // POV shots: cinematic
  if (camera === 'pov') mood = Math.min(9, mood + 2);

  return Math.max(1, Math.min(10, mood));
}

// =====================================================
// GAMEPLAY CLIP SELECTION
// For presets with visual_type=gameplay, we skip AI image generation
// and instead select a pre-uploaded gameplay clip + random offset.
// The assemble step will then use this clip as the video background.
// =====================================================

/** Known gameplay presets — expand as new gameplay brands are added */
const GAMEPLAY_PRESETS = new Set(['no_good_choice']);

/**
 * Check if this job should use a gameplay clip instead of AI images.
 * Returns a StepResult if gameplay mode is active, null otherwise
 * (so the caller falls through to normal image generation).
 * 
 * v7.1: Also checks config_overrides.visual_type === 'gameplay' from the
 * brand_templates table, so the UI toggle in Brands > Image Settings
 * can dynamically switch any preset between gameplay and AI image modes.
 */
async function trySelectGameplayClip(
  supabase: SupabaseClient,
  job: Job,
  logger: StepLogger,
): Promise<StepResult | null> {
  const vibePreset = job.vibe_preset || (job.meta?.vibe_preset as string) || '';

  // Quick exit: not a gameplay preset (check hardcoded set first, then DB)
  let isGameplayPreset = GAMEPLAY_PRESETS.has(vibePreset);
  
  if (!isGameplayPreset && job.brand_id) {
    // Dynamic check: query the brand_templates table for visual_type
    try {
      const { data: tmpl } = await supabase
        .from('brand_templates')
        .select('config_overrides')
        .eq('brand_id', job.brand_id)
        .eq('template_type', vibePreset)
        .single();
      if (tmpl?.config_overrides?.visual_type === 'gameplay') {
        isGameplayPreset = true;
        console.log(`[IMAGES] Preset "${vibePreset}" has visual_type=gameplay in DB (dynamic)`);
      }
    } catch (e) {
      // Non-fatal — fall through to normal image generation
    }
  }
  
  if (!isGameplayPreset) {
    return null;
  }

  console.log(`[IMAGES] Gameplay preset detected: "${vibePreset}" — checking for gameplay clips`);

  // Already completed? Check idempotency
  const idempotencyKey = `${job.id}:gameplay_clip_select`;
  const existingAsset = await getAssetByKey(supabase, job.id, idempotencyKey);
  if (existingAsset?.meta?.gameplay_clip_url) {
    console.log(`[IMAGES] Gameplay clip already selected: ${existingAsset.meta.gameplay_clip_url}`);
    return { success: true, skipped: true, data: { gameplay: true, clip_url: existingAsset.meta.gameplay_clip_url as string } };
  }

  // Calculate target video duration from audio
  const audioDurationMs = job.meta?.audio_duration_ms as number | undefined;
  let videoDuration: number;
  if (audioDurationMs && audioDurationMs > 0) {
    videoDuration = Math.ceil(audioDurationMs / 1000);
  } else {
    const rawDuration = job.meta?.duration;
    if (typeof rawDuration === 'number') {
      videoDuration = rawDuration;
    } else if (rawDuration && typeof rawDuration === 'object') {
      const durObj = rawDuration as { minSeconds?: number; maxSeconds?: number };
      videoDuration = Math.round(((durObj.minSeconds || 60) + (durObj.maxSeconds || 90)) / 2);
    } else {
      videoDuration = 60;
    }
  }

  // Call RPC to select clip + offset
  const { data: clipData, error: clipError } = await supabase.rpc('select_gameplay_clip_with_offset', {
    p_job_id: job.id,
    p_brand_id: job.brand_id,
    p_video_duration: videoDuration,
    p_vibe_preset: vibePreset,
  });

  if (clipError) {
    console.warn(`[IMAGES] Gameplay clip RPC error: ${clipError.message} — falling back to AI images`);
    await logger.snapshot('images', 'gameplay_fallback', { error: clipError.message }, 'No gameplay clips available, using AI images');
    return null; // Fall through to normal image generation
  }

  const clips = clipData as Array<{
    clip_id: string;
    display_name: string;
    file_path: string;
    storage_url: string;
    duration_seconds: number;
    start_offset_seconds: number;
    game: string;
    clip_count: number;
  }>;

  if (!clips || clips.length === 0 || clips[0]?.clip_count === 0) {
    console.log(`[IMAGES] No gameplay clips found for brand=${job.brand_id}, preset=${vibePreset} — falling back to AI images`);
    await logger.snapshot('images', 'gameplay_fallback', { brand_id: job.brand_id, preset: vibePreset }, 'No gameplay clips uploaded yet, using AI images');
    return null; // Fall through to normal image generation
  }

  const selected = clips[0];

  // Build public URL for the clip from storage path
  const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(selected.file_path);
  const clipPublicUrl = urlData?.publicUrl || '';

  console.log(`[IMAGES] ✓ Gameplay clip selected: "${selected.display_name}" (${selected.game}), offset=${selected.start_offset_seconds}s, duration=${videoDuration}s, clip_count=${selected.clip_count}`);

  // Store in job meta for the assemble step
  await updateJobMeta(supabase, job.id, {
    gameplay_mode: true,
    gameplay_clip_id: selected.clip_id,
    gameplay_clip_name: selected.display_name,
    gameplay_clip_url: clipPublicUrl,
    gameplay_clip_file_path: selected.file_path,
    gameplay_clip_offset: selected.start_offset_seconds,
    gameplay_clip_duration: selected.duration_seconds,
    gameplay_video_duration: videoDuration,
    gameplay_clip_game: selected.game,
  });

  // Store idempotency asset
  await upsertAsset(supabase, job.id, idempotencyKey, 'gameplay_clip', selected.file_path, clipPublicUrl, {
    gameplay_clip_url: clipPublicUrl,
    clip_id: selected.clip_id,
    display_name: selected.display_name,
    start_offset: selected.start_offset_seconds,
    video_duration: videoDuration,
    game: selected.game,
    clip_count: selected.clip_count,
  });

  await logger.snapshot('images', 'gameplay_selected', {
    clip_id: selected.clip_id,
    display_name: selected.display_name,
    file_path: selected.file_path,
    start_offset: selected.start_offset_seconds,
    video_duration: videoDuration,
    game: selected.game,
  }, `Gameplay clip selected: "${selected.display_name}" @ ${selected.start_offset_seconds}s offset`);

  return {
    success: true,
    data: {
      gameplay: true,
      clip_id: selected.clip_id,
      clip_url: clipPublicUrl,
      offset: selected.start_offset_seconds,
    },
  };
}

export async function executeImagesStep(
  supabase: SupabaseClient,
  job: Job,
  workerId: string,
  env: Record<string, string>,
  logger: StepLogger,
  functionStartTime?: number
): Promise<StepResult> {
  // =====================================================
  // GAMEPLAY PRESET CHECK — skip AI images, select gameplay clip
  // If this brand/preset has gameplay clips uploaded, we use a random
  // segment of the clip as background video instead of generating images.
  // =====================================================
  const gameplayResult = await trySelectGameplayClip(supabase, job, logger);
  if (gameplayResult) {
    return gameplayResult;
  }

  // Load scene data
  const sceneAsset = await getAssetByKey(supabase, job.id, `${job.id}:scenes_subtitles`);
  if (!sceneAsset?.meta?.scenes) {
    return { success: false, error: 'No scene data found - run scenes step first' };
  }

  const rawScenes = sceneAsset.meta.scenes as Array<{
    index: number;
    text: string;
    startTime: number;
    endTime: number;
    keywords: string[];
  }>;

  const openaiKey = env.OPENAI_API_KEY;
  if (!openaiKey) {
    return { success: false, error: 'OPENAI_API_KEY not configured' };
  }

  // Handle duration (same logic as scenes step)
  const rawDuration = job.meta?.duration;
  let duration: number;
  if (typeof rawDuration === 'number') {
    duration = rawDuration;
  } else if (rawDuration && typeof rawDuration === 'object') {
    const durObj = rawDuration as { minSeconds?: number; maxSeconds?: number; min?: number; max?: number };
    duration = Math.round(((durObj.minSeconds ?? durObj.min ?? 60) + (durObj.maxSeconds ?? durObj.max ?? 90)) / 2);
  } else {
    duration = 60;
  }

  // ======================================================================
  // VOICE-ALIGNED SCENE TRANSITIONS (Improvement #1)
  // Re-align scene start/end times to match actual voice word timestamps.
  // This runs AFTER voice synthesis (which produces word-level timing).
  // ======================================================================
  const audioTimestamps = job.meta?.audio_timestamps as Array<{ word: string; start: number; end: number }> | undefined;
  const audioDurationMs = job.meta?.audio_duration_ms as number | undefined;
  const audioDuration = audioDurationMs ? audioDurationMs / 1000 : duration;
  
  const scenes = alignScenesToVoice(rawScenes, audioTimestamps || [], audioDuration);
  
  // Log alignment info
  if (audioTimestamps && audioTimestamps.length > 0) {
    await logger.snapshot('images', 'voice_alignment', {
      original_timing: rawScenes.map(s => ({ i: s.index, dur: parseFloat((s.endTime - s.startTime).toFixed(1)) })),
      aligned_timing: scenes.map(s => ({ i: s.index, dur: parseFloat((s.endTime - s.startTime).toFixed(1)) })),
      voice_words: audioTimestamps.length,
      audio_duration_s: audioDuration,
    }, `Voice-aligned ${scenes.length} scenes using ${audioTimestamps.length} word timestamps`);
  }

  // v1.5: Resolve image prompt config from DB (system → preset → brand → job meta)
  // Moved BEFORE image model determination so brand-level image_model preference is available
  const vibePreset = job.vibe_preset || (job.meta?.vibe_preset as string) || 'urban_legend';
  let imagePromptConfig: ImagePromptConfig | null = null;
  try {
    imagePromptConfig = await getImagePromptConfigForJob(supabase, job.brand_id, vibePreset, job.meta || {});
  } catch (cfgErr) {
    console.warn(`[IMAGES] Failed to load image prompt config: ${cfgErr instanceof Error ? cfgErr.message : cfgErr}`);
  }

  // Determine which image model to use (job meta > brand config > env > default)
  // v4.0: Validate against known models — reject gpt-4o or other non-image models
  // v5.0: Added 'comfyui' — local ComfyUI generation with auto-fallback to cloud
  // v5.1: Brand-level image_model from image prompt config (set in Brands UI)
  const VALID_IMAGE_MODELS: ImageModel[] = ['gpt-image-1', 'dall-e-2', 'dall-e-3', 'comfyui'];
  const rawImageModel = (job.meta?.image_model as string)
    || (imagePromptConfig?.image_model as string)
    || (env.IMAGE_MODEL as string)
    || '';
  const imageModel: ImageModel = VALID_IMAGE_MODELS.includes(rawImageModel as ImageModel)
    ? (rawImageModel as ImageModel)
    : DEFAULT_IMAGE_MODEL;
  if (rawImageModel && rawImageModel !== imageModel) {
    console.warn(`[IMAGES] ⚠️ Invalid image model "${rawImageModel}" in job meta — falling back to "${imageModel}"`);
  }

  // v5.1: Lock resolved image model into job meta so retries use the same model
  // This is especially important when the model was resolved from brand config
  if (!job.meta?.image_model || (job.meta.image_model as string) !== imageModel) {
    console.log(`[IMAGES] Locking resolved image_model=${imageModel} into job meta (source: ${
      job.meta?.image_model ? 'job meta' : imagePromptConfig?.image_model ? 'brand config' : env.IMAGE_MODEL ? 'env' : 'default'
    })`);
    await updateJobMeta(supabase, job.id, { image_model: imageModel, resolved_image_model: imageModel });
  }

  // Fallback to legacy hardcoded values if DB config unavailable
  const artStyle = imagePromptConfig?.art_style || (job.meta?.art_style as string) || 'cinematic';

  // v7.0 — Issue #7: Fetch art style definition from DB registry (single source of truth)
  let artStyleRow: any = null;
  try {
    const { data: styleData } = await supabase
      .from('art_styles')
      .select('*')
      .eq('id', artStyle)
      .eq('is_active', true)
      .single();
    if (styleData) {
      artStyleRow = styleData;
      console.log(`[IMAGES] ✅ Loaded art style "${artStyle}" from DB registry`);
    } else {
      console.warn(`[IMAGES] ⚠️ Art style "${artStyle}" not found in DB registry — using hardcoded fallback`);
    }
  } catch (styleErr) {
    console.warn(`[IMAGES] ⚠️ Failed to load art style from DB: ${styleErr instanceof Error ? styleErr.message : styleErr}`);
  }

  console.log(`[IMAGES] Generating ${scenes.length} images (model: ${imageModel}, style: ${artStyle}, config: ${imagePromptConfig ? 'DB' : artStyleRow ? 'art_styles_registry' : 'legacy'})`);

  // v5.0: Load content safety rules from DB (Roadmap #16)
  // Pre-filter every image prompt BEFORE sending to API — prevents moderation blocks
  let safetyRules: SafetyRule[] = [];
  try {
    const platform = (job.meta?.platform as string) || undefined;
    safetyRules = await loadContentSafetyRules(supabase, vibePreset, platform);
  } catch (safetyErr) {
    console.warn(`[SAFETY] Failed to load safety rules, will use hardcoded fallback: ${safetyErr instanceof Error ? safetyErr.message : safetyErr}`);
  }

  // v3.0: Create/load Story Anchor for visual consistency
  let storyAnchor: StoryAnchor | null = null;
  const storyAnchorCacheKey = `${job.id}:story_anchor`;
  
  try {
    // Check cache first
    const cachedAnchor = await getAssetByKey(supabase, job.id, storyAnchorCacheKey);
    if (cachedAnchor?.meta?.environment) {
      storyAnchor = cachedAnchor.meta as unknown as StoryAnchor;
      console.log(`[IMAGES] Story anchor loaded from cache: env="${(storyAnchor.environment || '').substring(0, 50)}...", group=${storyAnchor.isGroupStory}`);
    } else if (job.story_text) {
      // Create fresh story anchor
      storyAnchor = await createStoryAnchor(job.story_text, openaiKey, vibePreset, imagePromptConfig);
      if (storyAnchor) {
        // Cache for continuation invocations
        await upsertAsset(supabase, job.id, storyAnchorCacheKey, 'story_anchor', '', '', {
          ...storyAnchor,
          vibe_preset: vibePreset,
        });
        console.log(`[IMAGES] Story anchor created and cached`);
      }
    }
  } catch (saErr) {
    console.warn(`[IMAGES] Story anchor creation failed (will proceed without): ${saErr instanceof Error ? saErr.message : saErr}`);
  }

  // ======================================================================
  // v8.0: CHARACTER REFERENCE PORTRAIT (Issue #13)
  // Generate a single "hero character portrait" from the story anchor's
  // characterDescription. This portrait is then passed as a visual reference
  // to all character/group scene images via OpenAI's image editing API,
  // ensuring consistent character appearance across the entire video.
  // ======================================================================
  let characterReferenceUrl: string | null = null;
  let characterReferenceBytes: Uint8Array | null = null;
  const charRefCacheKey = `${job.id}:character_reference`;
  
  if (storyAnchor?.characterDescription && (imageModel === 'gpt-image-1' || imageModel === 'dall-e-3')) {
    try {
      // Check cache first
      const cachedRef = await getAssetByKey(supabase, job.id, charRefCacheKey);
      if (cachedRef?.public_url) {
        characterReferenceUrl = cachedRef.public_url;
        console.log(`[IMAGES] Character reference loaded from cache: ${characterReferenceUrl}`);
      } else {
        console.log(`[IMAGES] Generating character reference portrait...`);
        
        // Build a focused portrait prompt from the character description + style
        const stylePrompt = imagePromptConfig?.style_prompt || 'Cinematic photography, dramatic compositions';
        const charDesc = storyAnchor.characterDescription;
        const envContext = storyAnchor.environment ? storyAnchor.environment.substring(0, 100) : '';
        const timeContext = storyAnchor.timeOfDay || '';
        
        // v12.0: Front-load illustration medium for non-photorealistic styles
        const PORTRAIT_ILLUSTRATION_STYLES = new Set(['manga-horror', 'rnmort', 'uncanny-illustrated', 'horror-anime']);
        const isPortraitIllustration = PORTRAIT_ILLUSTRATION_STYLES.has(artStyle);
        const portraitMediumLine = isPortraitIllustration
          ? `MEDIUM: This is a DRAWING / ILLUSTRATION, NOT a photograph. Render as ${stylePrompt}.\n\n`
          : '';
        
        const portraitPrompt = [
          portraitMediumLine,
          `CHARACTER REFERENCE PORTRAIT — This image establishes the definitive look of the main character.`,
          ``,
          `Style: ${stylePrompt}`,
          ``,
          `CHARACTER (must be rendered EXACTLY as described):`,
          charDesc,
          ``,
          `COMPOSITION: Medium shot from chest up, character facing slightly left (3/4 view).`,
          `Character fills ~60% of frame. Clean, uncluttered background.`,
          envContext ? `Background hint: ${envContext}` : `Background: neutral dark gradient`,
          timeContext ? `Lighting: ${timeContext} lighting conditions` : `Lighting: dramatic side lighting`,
          ``,
          `CRITICAL: This is a CHARACTER REFERENCE SHEET. The character's face, hair, clothing,`,
          `and distinguishing features must be clearly visible and sharply rendered.`,
          `No dramatic action, no extreme angles. Just a clean, well-lit portrait.`,
          ``,
          `Portrait orientation 9:16. No text, no words, no letters.`,
          imagePromptConfig?.negative_prompt || '',
          isPortraitIllustration ? 'NEVER render as a photograph or photorealistic image. This must be a drawn/illustrated character.' : '',
        ].filter(Boolean).join('\n');

        // Generate using gpt-image-1 (same as scene images)
        const portraitResponse = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-image-1',
            prompt: portraitPrompt,
            n: 1,
            size: '1024x1536',
            quality: 'low',
            output_format: 'webp',
          }),
        });

        if (portraitResponse.ok) {
          const portraitResult = await portraitResponse.json();
          let portraitImageUrl: string | null = null;
          
          if (portraitResult.data?.[0]?.b64_json) {
            portraitImageUrl = `data:image/webp;base64,${portraitResult.data[0].b64_json}`;
          } else if (portraitResult.data?.[0]?.url) {
            portraitImageUrl = portraitResult.data[0].url;
          }

          if (portraitImageUrl) {
            // Upload to storage
            const refStoragePath = `brands/${job.brand_id}/jobs/${job.id}/images/character_reference.webp`;
            const refPublicUrl = await uploadRemoteToStorage(supabase, STORAGE_BUCKET, refStoragePath, portraitImageUrl);
            characterReferenceUrl = refPublicUrl;

            // Cache as job asset
            await upsertAsset(supabase, job.id, charRefCacheKey, 'character_reference', refStoragePath, refPublicUrl, {
              character_description: charDesc,
              art_style: artStyle,
              image_model: imageModel,
              portrait_prompt: portraitPrompt.substring(0, 500),
            });

            console.log(`[IMAGES] ✓ Character reference portrait generated and cached: ${refPublicUrl}`);
            
            await logger.snapshot('images', 'character_reference', {
              character_description: charDesc.substring(0, 200),
              portrait_url: refPublicUrl,
              art_style: artStyle,
            }, `Character reference portrait generated for: ${charDesc.substring(0, 80)}`);
          }
        } else {
          const errText = await portraitResponse.text().catch(() => '');
          console.warn(`[IMAGES] Character reference portrait generation failed: ${portraitResponse.status} ${errText.substring(0, 200)}`);
          // Non-fatal — we'll proceed without reference (same as before)
        }
      }

      // Pre-fetch the reference image bytes for use in image editing API calls
      if (characterReferenceUrl) {
        try {
          const refFetchRes = await fetch(characterReferenceUrl);
          if (refFetchRes.ok) {
            characterReferenceBytes = new Uint8Array(await refFetchRes.arrayBuffer());
            console.log(`[IMAGES] Character reference image prefetched: ${characterReferenceBytes.length} bytes`);
          }
        } catch (fetchErr) {
          console.warn(`[IMAGES] Failed to prefetch character reference: ${fetchErr instanceof Error ? fetchErr.message : fetchErr}`);
        }
      }
    } catch (charRefErr) {
      console.warn(`[IMAGES] Character reference generation failed (will proceed without): ${charRefErr instanceof Error ? charRefErr.message : charRefErr}`);
    }
  }

  // v2.0: Extract visual cues from scenes (GPT analyzes what images should depict)
  // v3.0: Now preset-aware — passes ImagePromptConfig + StoryAnchor for guided extraction
  // Cache visual cues as a job asset so continuation invocations don't re-extract
  let visualCues: VisualCue[] = [];
  const visualCuesCacheKey = `${job.id}:visual_cues`;
  
  try {
    // Check cache first (saves ~25-30s on continuation invocations)
    const cachedCues = await getAssetByKey(supabase, job.id, visualCuesCacheKey);
    if (cachedCues?.meta?.cues && Array.isArray(cachedCues.meta.cues)) {
      visualCues = cachedCues.meta.cues as VisualCue[];
      console.log(`[IMAGES] Visual cues loaded from cache: ${visualCues.length} cues`);
    } else {
      // Extract fresh visual cues (v3.0: preset-aware)
      visualCues = await extractVisualCues(scenes, openaiKey, vibePreset, imagePromptConfig, storyAnchor);
      if (visualCues.length > 0) {
        console.log(`[IMAGES] Visual cues extracted: ${visualCues.length} cues for ${scenes.length} scenes`);
        // Cache for continuation invocations
        await upsertAsset(supabase, job.id, visualCuesCacheKey, 'visual_cues', '', '', {
          cues: visualCues,
          scene_count: scenes.length,
          vibe_preset: vibePreset,
        });
      }
    }
  } catch (vcErr) {
    console.warn(`[IMAGES] Visual cue extraction failed (will use raw text): ${vcErr instanceof Error ? vcErr.message : vcErr}`);
  }

  // Log visual cues summary
  if (visualCues.length > 0) {
    // v3.0: Count scene type distribution
    const typeDistribution: Record<string, number> = {};
    for (const vc of visualCues) {
      typeDistribution[vc.sceneType] = (typeDistribution[vc.sceneType] || 0) + 1;
    }
    
    await logger.snapshot('images', 'visual_cues', {
      total_cues: visualCues.length,
      total_scenes: scenes.length,
      scene_type_distribution: typeDistribution,
      story_anchor: storyAnchor ? {
        environment: (storyAnchor.environment || '').substring(0, 100),
        isGroupStory: storyAnchor.isGroupStory,
        groupCount: storyAnchor.groupCount,
        horrorTone: storyAnchor.horrorTone,
        hasCharacterDescription: !!storyAnchor.characterDescription,
      } : null,
      sample_cues: visualCues.slice(0, 5).map(vc => ({ 
        scene: vc.sceneIndex, 
        type: vc.sceneType, 
        camera: vc.camera,
        description: (vc.description || '').substring(0, 100) 
      }))
    }, `Visual cues extracted: ${visualCues.length} for ${scenes.length} scenes (types: ${JSON.stringify(typeDistribution)})`);
  }

  // ======================================================================
  // v8.0: CROSS-SCENE CONSISTENCY AUDIT
  // Reviews all visual cue descriptions together to catch prop/object
  // contradictions (e.g., smartphone in S11 → landline in S13).
  // Runs once and gets cached with the visual cues.
  // Only runs on fresh extraction — cached cues already have fixes applied.
  //
  // v15.0: CRITICAL FIX — The audit flag is embedded IN the visual_cues cache
  // meta (consistency_audited: true). Uses a direct .update() because the
  // upsert_job_asset RPC is INSERT-only (does NOT update existing records).
  // Previously, the audit re-ran on each continuation with DIFFERENT GPT
  // results, causing images from different invocations to have mismatched
  // cue descriptions vs the final cached visual cues.
  // ======================================================================
  const consistencyCacheKey = `${job.id}:visual_cues_consistency`;
  // v15.0: Check the visual_cues cache meta for the audit flag (primary),
  // fall back to the separate marker asset (legacy compatibility)
  const cachedCuesForAuditCheck = await getAssetByKey(supabase, job.id, visualCuesCacheKey);
  const alreadyAudited = cachedCuesForAuditCheck?.meta?.consistency_audited === true
    || !!(await getAssetByKey(supabase, job.id, consistencyCacheKey));
  if (visualCues.length >= 3 && openaiKey && !alreadyAudited) {
    try {
      const auditResult = await auditVisualCueConsistency(visualCues, scenes, openaiKey, storyAnchor);
      if (auditResult.fixes.length > 0) {
        visualCues = auditResult.cues;
        await logger.snapshot('images', 'consistency_audit', {
          fixes_applied: auditResult.fixes.length,
          total_scenes: visualCues.length,
          fixes: auditResult.fixes,
        }, `🔧 Consistency audit: ${auditResult.fixes.length} contradictions fixed (${auditResult.fixes.map(f => `S${f.scene + 1}: ${f.issue}`).join(', ')})`);
      }
      // v15.0: Update the visual_cues cache meta with the audit flag + patched cues.
      // MUST use direct .update() because upsert_job_asset is INSERT-only and will
      // silently skip updates to existing records.
      const auditedMeta = {
        ...(cachedCuesForAuditCheck?.meta || {}),
        cues: visualCues,
        scene_count: scenes.length,
        vibe_preset: vibePreset,
        consistency_audited: true,
        consistency_fixes: auditResult.fixes.length > 0 ? auditResult.fixes : [],
      };
      const { error: updateErr } = await supabase
        .from('job_assets')
        .update({ meta: auditedMeta })
        .eq('job_id', job.id)
        .eq('idempotency_key', visualCuesCacheKey);
      if (updateErr) {
        console.warn(`[CONSISTENCY] Failed to persist audit flag: ${updateErr.message}`);
      } else {
        console.log(`[CONSISTENCY] ✓ Audit flag persisted in visual_cues cache (${auditResult.fixes.length} fixes)`);
      }
    } catch (auditErr) {
      console.warn(`[CONSISTENCY] Audit error (non-fatal): ${auditErr instanceof Error ? auditErr.message : auditErr}`);
      // Even on error, mark as audited to prevent re-runs with different results
      try {
        const errorMeta = {
          ...(cachedCuesForAuditCheck?.meta || {}),
          cues: visualCues,
          consistency_audited: true,
        };
        await supabase
          .from('job_assets')
          .update({ meta: errorMeta })
          .eq('job_id', job.id)
          .eq('idempotency_key', visualCuesCacheKey);
      } catch { /* best effort */ }
    }
  } else if (alreadyAudited) {
    console.log(`[CONSISTENCY] ✓ Audit already completed — skipping (cues locked for continuation consistency)`);
  }

  let generatedCount = 0;
  let skippedCount = 0;
  let moderationFailCount = 0;
  const scenesCompleted: number[] = [];

  // ======================================================================
  // IMAGE SEQUENCE PLANNING (Improvement #2: Multi-image for long scenes)
  // For scenes >10s, we generate multiple images to maintain visual interest.
  // Each image covers ~8s of screen time. This builds the flat image list
  // that the renderer will receive (with per-image durations and mood levels).
  // ======================================================================
  const LONG_SCENE_THRESHOLD = 18; // Seconds: scenes longer than this get extra images (was 12, before that 10)
  const TARGET_IMAGE_DURATION = 14; // Seconds: target on-screen time per image (was 10, before that 8)
  const MAX_SUB_IMAGES = 2; // Max images per long scene (was 3) — 2 is enough for variety

  const imageSequence: ImageSequenceEntry[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    // Use start-to-start gap (not endTime - startTime) so inter-scene pauses
    // (natural speech gaps between scenes) are included in the image display time.
    // This ensures cumulative image start times match voice-aligned scene starts.
    const nextSceneStart = i < scenes.length - 1 ? scenes[i + 1].startTime : audioDuration;
    let sceneDuration = Math.max(nextSceneStart - scene.startTime, 1.0); // Soft floor 1.0s — hard floor (2s) is enforced at assemble time after normalization

    // BUG FIX: Account for TTS leading silence before the first spoken word.
    // Scene 0's startTime is the first word timestamp (e.g. 0.3s), so without
    // this padding, sum(all durations) = audioDuration - firstWordStart, making
    // the total image video shorter than the audio. This causes cumulative
    // drift where images lag behind narration.
    if (i === 0 && scene.startTime > 0) {
      sceneDuration += scene.startTime;
      console.log(`[IMAGES] Scene 0: added ${scene.startTime.toFixed(3)}s leading silence padding (total: ${sceneDuration.toFixed(2)}s)`);
    }
    const visualCue = visualCues.find(vc => vc.sceneIndex === i);
    const moodLevel = computeMoodLevel(i, scenes.length, visualCue);
    
    if (sceneDuration > LONG_SCENE_THRESHOLD) {
      // Long scene: generate multiple images (capped at MAX_SUB_IMAGES)
      const imageCount = Math.min(MAX_SUB_IMAGES, Math.ceil(sceneDuration / TARGET_IMAGE_DURATION));
      const subDuration = sceneDuration / imageCount;
      for (let j = 0; j < imageCount; j++) {
        imageSequence.push({
          sceneIndex: i,
          subIndex: j,
          duration: parseFloat(subDuration.toFixed(2)),
          moodLevel: j === imageCount - 1 ? Math.min(10, moodLevel + 1) : moodLevel, // Slight escalation on last sub-image
          assetKey: j === 0 ? `${job.id}:image_generate:scene_${i}` : `${job.id}:image_generate:scene_${i}_sub_${j}`,
        });
      }
      console.log(`[IMAGES] Scene ${i}: ${sceneDuration.toFixed(1)}s → ${imageCount} images (${subDuration.toFixed(1)}s each)`);
    } else {
      // Normal scene: single image
      imageSequence.push({
        sceneIndex: i,
        subIndex: 0,
        duration: parseFloat(sceneDuration.toFixed(2)),
        moodLevel,
        assetKey: `${job.id}:image_generate:scene_${i}`,
      });
    }
  }

  console.log(`[IMAGES] Image sequence planned: ${imageSequence.length} images for ${scenes.length} scenes (mood_levels: ${imageSequence.map(e => e.moodLevel).join(',')})`);

  // v7.0: Store planned image_sequence in job meta BEFORE generating images.
  // This lets the UI show Duration and Mood Level while images are still being generated.
  // The sequence will be updated with final URLs after all images are done.
  await updateJobMeta(supabase, job.id, {
    image_sequence: imageSequence.map(e => ({
      sceneIndex: e.sceneIndex,
      subIndex: e.subIndex,
      duration: e.duration,
      moodLevel: e.moodLevel,
      assetKey: e.assetKey,
    })),
    image_model: imageModel,
  });

  // v4.0: Track previous prompt fingerprint for similarity detection
  let previousPromptFingerprint: string | null = null;

  // v8.1: Scene chain reference (Issue #13 Phase 2)
  // Each generated scene's image bytes are captured and passed as a soft reference
  // to the NEXT scene, creating visual style/palette continuity across the video.
  let previousSceneImageBytes: Uint8Array | null = null;

  try {
    for (let seqIdx = 0; seqIdx < imageSequence.length; seqIdx++) {
      const entry = imageSequence[seqIdx];
      const scene = scenes[entry.sceneIndex];
      const idempotencyKey = entry.assetKey;

      // Check if this scene image already exists
      const existingImage = await getAssetByKey(supabase, job.id, idempotencyKey);
      if (existingImage?.public_url) {
        console.log(`[IMAGES] Scene ${entry.sceneIndex}${entry.subIndex > 0 ? `_sub_${entry.subIndex}` : ''} already generated, skipping`);
        // v8.1: Still capture bytes for scene chain so next scene has a reference
        if (imageModel === 'gpt-image-1' && !previousSceneImageBytes) {
          try {
            const chainFetch = await fetch(existingImage.public_url);
            if (chainFetch.ok) {
              previousSceneImageBytes = new Uint8Array(await chainFetch.arrayBuffer());
              console.log(`[IMAGES] Scene ${entry.sceneIndex}: captured ${previousSceneImageBytes.length} bytes from cached image for scene chain`);
            }
          } catch { /* non-fatal */ }
        }
        skippedCount++;
        scenesCompleted.push(entry.sceneIndex);
        continue;
      }

      // =========================================
      // TIME BUDGET CHECK: Ensure enough wall-clock time for one more image
      // Supabase Edge Functions have a hard 400s limit (paid).
      // If we're running low, pause and let the orchestrator re-invoke.
      // =========================================
      if (functionStartTime) {
        const elapsedMs = Date.now() - functionStartTime;
        const timeRemainingMs = WALL_CLOCK_BUDGET_MS - elapsedMs;
        
        if (timeRemainingMs < IMAGE_RESERVE_MS) {
          console.log(`[IMAGES] ⏰ Time budget exhausted: ${Math.round(elapsedMs / 1000)}s elapsed, ${Math.round(timeRemainingMs / 1000)}s remaining (need ${IMAGE_RESERVE_MS / 1000}s). Pausing at image ${seqIdx + 1}/${imageSequence.length}.`);
          
          // Update step status with progress before pausing
          await updateStepStatus(supabase, job.id, 'images', 'running', {
            scenes_done: scenesCompleted,
            current_image: seqIdx,
            total_images: imageSequence.length,
            progress_pct: Math.round((scenesCompleted.length / imageSequence.length) * 100),
            image_model: imageModel,
            paused_for_continuation: true,
          });
          
          await logger.progress('images', scenesCompleted.length, imageSequence.length,
            `⏰ Time budget pause: ${scenesCompleted.length}/${imageSequence.length} images done (${Math.round(elapsedMs / 1000)}s elapsed)`,
            { paused: true, elapsed_ms: elapsedMs }
          );
          
          // Return partial success — the pipeline will re-invoke
          return {
            success: true,
            continuation_needed: true,
            data: {
              generated: generatedCount,
              skipped: skippedCount,
              completed: scenesCompleted.length,
              total: imageSequence.length,
              elapsed_ms: elapsedMs,
              reason: 'wall_clock_budget',
            }
          };
        }
      }

      // Heartbeat before each image (they can be slow)
      await requireLeaseOwner(supabase, job.id, workerId, `images:scene_${entry.sceneIndex}${entry.subIndex > 0 ? `_sub_${entry.subIndex}` : ''}`);

      // Build prompt — uses visual cues + DB config + story anchor when available
      // v4.0: Sub-images get a MODIFIED visual cue (different camera, sceneType, description)
      //        instead of the old weak suffix approach. This ensures the different framing
      //        is baked into the core prompt, not appended at the end where it gets ignored.
      const i = entry.sceneIndex;
      const baseVisualCue = visualCues.find(vc => vc.sceneIndex === i);
      
      // For sub-images: create a variant cue with different camera/type/focus
      const effectiveCue = entry.subIndex > 0
        ? createSubImageCue(baseVisualCue, entry.subIndex, scene.text)
        : baseVisualCue;
      
      const scenePrompt = buildImagePrompt(scene.text, scene.keywords, artStyle, i, scenes.length, imagePromptConfig, effectiveCue, storyAnchor, artStyleRow);
      entry.prompt = scenePrompt; // Persist for auditability in image_sequence manifest
      
      // === PROMPT SIMILARITY GUARD (v4.0) ===
      // Detect if this prompt is too similar to the previous one (within same scene's sub-images).
      // Uses first 250 chars of the description portion as a fingerprint.
      if (previousPromptFingerprint) {
        const currentFingerprint = scenePrompt.substring(0, 250);
        const overlap = computeCharOverlap(previousPromptFingerprint, currentFingerprint);
        if (overlap > 0.85) {
          console.warn(`[IMAGES] ⚠️ Prompt similarity warning: scene ${i}${entry.subIndex > 0 ? `_sub_${entry.subIndex}` : ''} is ${Math.round(overlap * 100)}% similar to previous image. Sub-image cue may not be diverging enough.`);
        }
      }
      previousPromptFingerprint = scenePrompt.substring(0, 250);
      
      // === EXTERNAL IDEMPOTENCY: Hash includes model+size+prompt to avoid cross-config collisions ===
      // Note: imageModel is defined at function scope from job.meta or env
      // gpt-image-1: 1024x1536 portrait, dall-e-3: 1024x1792 portrait, dall-e-2: 1024x1024 square, comfyui: 1024x1536 portrait
      const imageSize = imageModel === 'gpt-image-1' || imageModel === 'comfyui' ? '1024x1536' : 
                        imageModel === 'dall-e-3' ? '1024x1792' : '1024x1024';
      const imageQuality = 'standard';
      // v5.1: ComfyUI includes workflow+checkpoint+steps+cfg in hash so config changes invalidate cache
      const comfyConfigSuffix = imageModel === 'comfyui'
        ? `|${(imagePromptConfig as any)?.comfyui_workflow || 'txt2img_sdxl'}|${(imagePromptConfig as any)?.comfyui_checkpoint || 'default'}|${(imagePromptConfig as any)?.comfyui_steps || 28}|${(imagePromptConfig as any)?.comfyui_cfg || 5.5}`
        : '';
      const canonicalImageInput = `${imageModel}|${imageSize}|${imageQuality}|${scenePrompt}${comfyConfigSuffix}`;
      const promptHash = await computeHash(canonicalImageInput);
      const promptHashKey = `${job.id}:image_prompt_hash:${promptHash}`;
      // Quality guard: only reuse if quality_ok !== false
      const existingPromptHash = await getAssetByKey(supabase, job.id, promptHashKey, true);
      if (existingPromptHash?.public_url) {
        console.log(`[IMAGES] Scene ${i}${entry.subIndex > 0 ? `_sub_${entry.subIndex}` : ''} prompt hash match (billing protection), copying existing asset`);
        // Copy the existing asset to the scene key
        await upsertAsset(supabase, job.id, idempotencyKey, 'dalle_image', 
          existingPromptHash.storage_path, existingPromptHash.public_url, {
            scene_index: i,
            sub_index: entry.subIndex,
            prompt: scenePrompt,
            prompt_hash: promptHash,
            art_style: artStyle,
            image_model: imageModel,
            copied_from: existingPromptHash.idempotency_key,
          });
        skippedCount++;
        scenesCompleted.push(seqIdx);
        continue;
      }

      // === RUNNING CHECKPOINT: Update step status with progress ===
      await updateStepStatus(supabase, job.id, 'images', 'running', {
        scenes_done: scenesCompleted,
        current_image: seqIdx,
        total_images: imageSequence.length,
        progress_pct: Math.round((scenesCompleted.length / imageSequence.length) * 100),
        image_model: imageModel,
      });

      // Log progress event
      await logger.progress('images', seqIdx + 1, imageSequence.length, 
        `image ${seqIdx + 1}/${imageSequence.length} generating (scene ${i}${entry.subIndex > 0 ? ` sub ${entry.subIndex}` : ''}, model=${imageModel}, ${imageSize})`,
        { model: imageModel, scene_index: i, sub_index: entry.subIndex }
      );

      // Progress bar — visual log matching ComfyUI style
      const pct = Math.round(((seqIdx + 1) / imageSequence.length) * 100);
      const filled = Math.round(pct / 4);
      const bar = '█'.repeat(filled) + '░'.repeat(25 - filled);
      const cueType = visualCues.find(vc => vc.sceneIndex === i)?.sceneType || '-';
      console.log(`[IMAGES] ${pct}% |${bar}| ${seqIdx + 1}/${imageSequence.length} scene ${i}${entry.subIndex > 0 ? ` sub ${entry.subIndex}` : ''} (${cueType}) [${imageModel}]`);

      // Log prompt snapshot (first, every 5th, and last — balance storage vs visibility)
      if (seqIdx === 0 || seqIdx === imageSequence.length - 1 || seqIdx % 5 === 0) {
        const cue = visualCues.find(vc => vc.sceneIndex === i);
        await logger.snapshot('images', 'prompt', { 
          scene_index: i, 
          sub_index: entry.subIndex,
          prompt: scenePrompt.slice(0, 1200), 
          model: imageModel, 
          size: imageSize,
          visual_cue: cue ? { type: cue.sceneType, camera: cue.camera, description: (cue.description || '').slice(0, 200) } : null,
          story_anchor_used: !!storyAnchor,
          character_reference_available: !!characterReferenceBytes,
          scene_chain_available: !!previousSceneImageBytes,
          source: cue ? 'visual_cue+anchor' : 'raw_text'
        }, `Image ${seqIdx + 1}/${imageSequence.length} prompt (scene ${i}${entry.subIndex > 0 ? ` sub ${entry.subIndex}` : ''}, ${cue?.sceneType || 'no_cue'})`);
      }

      // === LEASE GRACE CHECK: Verify enough time before expensive API call ===
      await requireLeaseGrace(supabase, job.id, workerId, `${imageModel} scene ${i}${entry.subIndex > 0 ? ` sub ${entry.subIndex}` : ''}`);

      // === COST CONTROL: Check budget + acquire slot before cloud API call ===
      // ComfyUI local generation is free — skip cost control when using local
      const costHelper = new CostControlHelper(supabase, job.id, workerId);
      let costSlotAcquired = false;
      const costOperation = `scene_${i}${entry.subIndex > 0 ? `_sub_${entry.subIndex}` : ''}`;
      if (imageModel !== 'comfyui') {
        try {
          await assertCanSpend(costHelper, 'openai_image', costOperation, 1);
          costSlotAcquired = true;
        } catch (costError) {
          if (isCostLimitError(costError)) {
            // Cost limit reached - fail with clear message for DLQ (class: misconfig)
            console.error(`[IMAGES] ❌ Cost limit hit at image ${seqIdx} (scene ${i}): ${costError instanceof Error ? costError.message : costError}`);
            return { 
              success: false, 
              error: `cost_limit_exceeded: openai_image (gpt-image-1) - ${costError instanceof Error ? costError.message : 'budget reached'}`,
              data: { 
                images_completed: scenesCompleted.length,
                images_total: imageSequence.length,
                cost_limit_hit: true,
                failure_class: 'misconfig'  // Signal to DLQ this is operator-actionable
              }
            };
          }
          throw costError; // Re-throw non-cost errors
        }
      }

      // === SLOT GUARD: try/finally ensures slot is ALWAYS released ===
      // Prevents slot leaks on throw, continue, or return between acquire and release.
      try {

      // Generate image using selected model
      let imageUrl: string;
      
      // v8.0: Determine if this scene should use character reference (Issue #13)
      const effectiveSceneType = (visualCues.find(vc => vc.sceneIndex === i)?.sceneType) || 'atmosphere';
      const useCharacterReference = characterReferenceBytes 
        && (imageModel === 'gpt-image-1')
        && (effectiveSceneType === 'character' || effectiveSceneType === 'group');
      // v8.1 Phase 2: Scene chain — use previous scene's image for style/palette continuity
      // Every scene (except the first) gets a soft reference from the previous scene.
      const useSceneChain = previousSceneImageBytes && (imageModel === 'gpt-image-1');
      // Either reference type routes through /v1/images/edits instead of /v1/images/generations
      const useImageReference = useCharacterReference || useSceneChain;
      
      // === COMFYUI LOCAL GENERATION ===
      // Check health → generate via renderer → fall back to gpt-image-1 on failure
      if (imageModel === 'comfyui') {
        // Prefer COMFYUI_RENDERER_URL (local tunnel) for ComfyUI endpoints,
        // fall back to VIDEO/FFMPEG renderer URLs
        const rendererUrl = env.COMFYUI_RENDERER_URL || env.VIDEO_RENDERER_URL || env.FFMPEG_RENDERER_URL;
        let comfySuccess = false;
        let comfyFallbackReason: FallbackReason | null = null;

        if (rendererUrl) {
          try {
            // 1. Health check (2s timeout)
            const healthController = new AbortController();
            const healthTimeout = setTimeout(() => healthController.abort(), 2000);
            const healthRes = await fetch(`${rendererUrl}/comfyui-health`, {
              signal: healthController.signal,
            });
            clearTimeout(healthTimeout);

            if (healthRes.ok) {
              const health = await healthRes.json();

              if (!health.available) {
                comfyFallbackReason = health.fallback_reason || 'offline';
                console.warn(`[IMAGES] ComfyUI skipped: ${comfyFallbackReason} → cloud fallback`);
              } else {
                // 2. Submit generation
                console.log(`[IMAGES] ComfyUI available (queue=${health.queue_size}/${health.queue_limit}, vram=${health.gpu_vram_free_mb}MB). Generating scene ${i} (art_style=${artStyle})...`);
                
                const genRes = await fetch(`${rendererUrl}/comfyui-generate`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    job_id: job.id,
                    scenes: [{ index: i, prompt: scenePrompt }],
                    workflow: (job.meta?.comfyui_workflow as string)
                      || (imagePromptConfig as any)?.comfyui_workflow
                      || undefined,
                    checkpoint: (job.meta?.comfyui_checkpoint as string)
                      || (imagePromptConfig as any)?.comfyui_checkpoint
                      || undefined,
                    steps: (job.meta?.comfyui_steps as number)
                      || (imagePromptConfig as any)?.comfyui_steps
                      || undefined,
                    cfg: (job.meta?.comfyui_cfg as number)
                      || (imagePromptConfig as any)?.comfyui_cfg
                      || undefined,
                    width: 1024,
                    height: 1536,
                    brand_dna: {
                      ...(job.meta || {}),
                      art_style: artStyle,  // Ensure art_style flows to STYLE_MAP lookup in translatePromptForComfyUI
                      comfyui_tokens: artStyleRow?.comfyui_tokens || undefined,  // v7.0: DB-sourced tokens bypass hardcoded STYLE_MAP
                    },
                  }),
                });

                if (!genRes.ok) {
                  const errText = await genRes.text().catch(() => '');
                  throw new Error(`ComfyUI generate failed: ${genRes.status} ${errText.slice(0, 200)}`);
                }

                const genData = await genRes.json();
                const comfyJobId = genData.comfy_job_id;
                const statusUrl = genData.status_url;

                // 3. Poll for completion (respects COMFYUI_TIMEOUT_MS via the renderer)
                const comfyPollStart = Date.now();
                const comfyTimeoutMs = 360000; // 6 min — cold checkpoint load can take 2-3 min on VRAM-constrained GPU
                const pollIntervalMs = 3000;
                let comfyNotFoundCount = 0; // Track consecutive 404s (server restart = lost job)

                while (Date.now() - comfyPollStart < comfyTimeoutMs) {
                  // WALL CLOCK SAFETY: bail out of poll loop if we're running low on function time
                  // to ensure the outer loop can still trigger continuation_needed properly.
                  if (functionStartTime) {
                    const fnElapsed = Date.now() - functionStartTime;
                    if (fnElapsed > WALL_CLOCK_BUDGET_MS - IMAGE_RESERVE_MS) {
                      console.warn(`[IMAGES] ComfyUI poll loop hitting wall clock budget (${Math.round(fnElapsed / 1000)}s elapsed). Breaking to allow continuation.`);
                      comfyFallbackReason = 'timeout';
                      break;
                    }
                  }

                  await new Promise(r => setTimeout(r, pollIntervalMs));

                  const statusRes = await fetch(`${rendererUrl}${statusUrl}`);
                  if (!statusRes.ok) {
                    // Track consecutive 404s — server restart = lost comfy job
                    if (statusRes.status === 404) {
                      comfyNotFoundCount++;
                      if (comfyNotFoundCount >= 3) {
                        console.warn(`[IMAGES] ComfyUI job ${comfyJobId} returned 404 x3 — server likely restarted, falling back`);
                        comfyFallbackReason = 'error';
                        break;
                      }
                    }
                    continue;
                  }
                  comfyNotFoundCount = 0; // Reset on success
                  const statusData = await statusRes.json();

                  if (statusData.status === 'complete' || statusData.status === 'partial') {
                    const sceneResult = statusData.images?.find((img: any) => img.index === i);
                    if (sceneResult?.url) {
                      imageUrl = sceneResult.url;
                      comfySuccess = true;
                      console.log(`[IMAGES] ✓ ComfyUI scene ${i} generated in ${((Date.now() - comfyPollStart) / 1000).toFixed(1)}s`);

                      // Store ComfyUI-specific metadata alongside the asset
                      if (sceneResult.metadata) {
                        await logger.snapshot('images', 'comfyui_metadata', {
                          scene_index: i,
                          ...sceneResult.metadata,
                        }, `ComfyUI render metadata for scene ${i}`);
                      }
                    }
                    break;
                  }

                  // Check for scene-level errors
                  const sceneError = statusData.errors?.find((e: any) => e.index === i);
                  if (sceneError) {
                    comfyFallbackReason = sceneError.fallback_reason || 'error';
                    console.warn(`[IMAGES] ComfyUI scene ${i} error: ${sceneError.error} → cloud fallback`);
                    break;
                  }
                }

                if (!comfySuccess && !comfyFallbackReason) {
                  comfyFallbackReason = 'timeout';
                  console.warn(`[IMAGES] ComfyUI scene ${i} timed out after ${comfyTimeoutMs}ms → cloud fallback`);
                }
              }
            } else {
              comfyFallbackReason = 'offline';
              console.warn(`[IMAGES] ComfyUI health check returned ${healthRes.status} → cloud fallback`);
            }
          } catch (comfyErr) {
            comfyFallbackReason = 'error';
            if ((comfyErr as Error)?.name === 'AbortError') {
              comfyFallbackReason = 'offline';
            }
            console.warn(`[IMAGES] ComfyUI error: ${comfyErr instanceof Error ? comfyErr.message : comfyErr} → cloud fallback`);
          }
        } else {
          comfyFallbackReason = 'offline';
          console.warn(`[IMAGES] No VIDEO_RENDERER_URL configured → ComfyUI unavailable, cloud fallback`);
        }

        // If ComfyUI failed, fall back to gpt-image-1 (with retry + sanitization)
        if (!comfySuccess) {
          console.log(`[IMAGES] ComfyUI fallback → gpt-image-1 for scene ${i} (reason: ${comfyFallbackReason})`);
          
          // Record that we fell back to cloud
          await logger.snapshot('images', 'comfyui_fallback', {
            scene_index: i,
            fallback_reason: comfyFallbackReason,
            fallback_model: 'gpt-image-1',
          }, `ComfyUI → cloud fallback for scene ${i}: ${comfyFallbackReason}`);

          const MAX_FALLBACK_RETRIES = 3;
          let fallbackGenerated = false;
          let fallbackPrompt = scenePrompt;

          for (let attempt = 1; attempt <= MAX_FALLBACK_RETRIES; attempt++) {
            const response = await fetch(
              'https://api.openai.com/v1/images/generations',
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${openaiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: 'gpt-image-1',
                  prompt: fallbackPrompt,
                  n: 1,
                  size: '1024x1536',
                  quality: 'low',
                  output_format: 'webp',
                }),
              },
            );

            if (!response.ok) {
              const errorBody = await response.text().catch(() => '');
              console.error(`[IMAGES] ComfyUI fallback gpt-image-1 scene ${i} attempt ${attempt}/${MAX_FALLBACK_RETRIES}: ${response.status} - ${errorBody.substring(0, 300)}`);

              // Moderation / content policy (400) — sanitize and retry
              if (response.status === 400 && (errorBody.includes('moderation') || errorBody.includes('safety') || errorBody.includes('content_policy'))) {
                console.log(`[IMAGES] ⚠️ ComfyUI fallback moderation block on scene ${i}, attempt ${attempt}. Sanitizing prompt...`);
                if (attempt < MAX_FALLBACK_RETRIES) {
                  if (attempt === 1) {
                    const safetyResult = applyContentSafetyFilter(fallbackPrompt, safetyRules);
                    fallbackPrompt = safetyResult.filtered;
                    if (safetyResult.changeCount > 0) {
                      console.log(`[SAFETY] ComfyUI fallback scene ${i}: safety filter applied ${safetyResult.changeCount} categories (${safetyResult.categories.join(', ')})`);
                      await logger.snapshot('images', 'safety_filter', {
                        scene_index: i, sub_index: entry.subIndex,
                        categories_filtered: safetyResult.categories,
                        change_count: safetyResult.changeCount,
                        trigger: 'comfyui_fallback_moderation',
                      }, `Safety filter (ComfyUI fallback retry): ${safetyResult.changeCount} categories in scene ${i}`);
                    }
                  } else {
                    fallbackPrompt = sanitizeImagePrompt(fallbackPrompt, attempt);
                  }
                  await new Promise(r => setTimeout(r, 2000));
                  continue;
                }
                // All retries exhausted — skip scene gracefully
                console.error(`[IMAGES] ⚠️ ComfyUI fallback scene ${i} permanently blocked by moderation after ${attempt} attempts. Skipping scene.`);
                moderationFailCount++;
                await logger.snapshot('images', 'moderation_skip', {
                  scene_index: i, sub_index: entry.subIndex,
                  attempts: attempt, prompt_length: fallbackPrompt.length,
                  trigger: 'comfyui_fallback',
                }, `Scene ${i} skipped: ComfyUI fallback moderation block after ${attempt} attempts`);
                break;
              }

              // Rate limit (429) — backoff
              if (response.status === 429 && attempt < MAX_FALLBACK_RETRIES) {
                const waitTime = 20 * attempt * 1000;
                console.log(`[IMAGES] ComfyUI fallback rate limited on scene ${i}, waiting ${waitTime / 1000}s...`);
                await new Promise(r => setTimeout(r, waitTime));
                continue;
              }

              // Non-retryable / exhausted — skip scene instead of killing the step
              if (response.status === 400 && (errorBody.includes('moderation') || errorBody.includes('safety') || errorBody.includes('content_policy'))) {
                moderationFailCount++;
                await logger.snapshot('images', 'moderation_skip', {
                  scene_index: i, sub_index: entry.subIndex,
                  attempts: attempt, trigger: 'comfyui_fallback',
                }, `Scene ${i} skipped: moderation after ${attempt} attempts`);
                break;
              }
              throw new Error(`ComfyUI fallback gpt-image-1 scene ${i} failed: ${response.status} ${errorBody.slice(0, 300)}`);
            }

            const result = await response.json();
            if (result.data?.[0]?.b64_json) {
              imageUrl = `data:image/webp;base64,${result.data[0].b64_json}`;
              fallbackGenerated = true;
            } else if (result.data?.[0]?.url) {
              imageUrl = result.data[0].url;
              fallbackGenerated = true;
            }

            if (fallbackGenerated) {
              if (attempt > 1) {
                console.log(`[IMAGES] ✓ ComfyUI fallback scene ${i} succeeded on sanitized attempt ${attempt}`);
              }
              break;
            } else {
              throw new Error(`ComfyUI fallback gpt-image-1 returned no image for scene ${i}`);
            }
          }

          if (!fallbackGenerated) {
            // Don't kill the step — skip scene, assemble will use previous scene's image
            console.warn(`[IMAGES] ComfyUI fallback scene ${i} has no image (moderation or empty). Continuing.`);
            scenesCompleted.push(seqIdx);
            continue;
          }
        }
      } else if (imageModel === 'gpt-image-1') {
        // === GPT-IMAGE-1 (Cheapest: ~$0.016/image at low quality) ===
        // Has retry loop with prompt sanitization for moderation blocks
        // v8.0+8.1: Character/group scenes use hero portrait; all scenes use scene chain
        const MAX_IMAGE_RETRIES = 4;
        let imageGenerated = false;
        
        if (useImageReference) {
          const refs: string[] = [];
          if (useCharacterReference) refs.push('character_portrait');
          if (useSceneChain) refs.push('scene_chain');
          console.log(`[IMAGES] Scene ${i} (${effectiveSceneType}): using image reference [${refs.join('+')}] for visual consistency`);
        }
        
        // v6.0: Send the FULL creative prompt on first attempt (no pre-filter).
        // Safety filter only kicks in as a RETRY strategy after a moderation rejection.
        // This preserves horror vocabulary (sinister, dread, terrifying) that gpt-image-1
        // handles fine, resulting in richer, more atmospheric images.
        let currentPrompt = scenePrompt;
        
        for (let attempt = 1; attempt <= MAX_IMAGE_RETRIES; attempt++) {
          let response: Response;
          
          // v14.1: Wrap fetch+parse in try/catch to handle network errors
          // (e.g. "error reading a body from connection") with retry instead of
          // killing the entire step. These are transient Deno/TCP errors.
          try {
          
          if (useImageReference) {
            // v8.0+8.1: Use /v1/images/edits with reference image(s)
            // Phase 1: character/group scenes get hero portrait for character consistency
            // Phase 2: ALL scenes get previous scene image for style/palette continuity
            // When both apply, both images are sent as references.
            
            // Build the reference-aware prompt
            // v13.0: For illustration styles, reinforce the art medium in the reference prompt
            // to prevent scene-chain drift toward photorealism.
            const ILLUSTRATION_ART_STYLES = new Set(['manga-horror', 'rnmort', 'uncanny-illustrated', 'horror-anime']);
            const isIllustrationArtStyle = ILLUSTRATION_ART_STYLES.has(artStyle);
            const mediumReminder = isIllustrationArtStyle
              ? `\nCRITICAL: This MUST remain a DRAWN ILLUSTRATION — NOT a photograph. Maintain the ${artStyle} art style (ink, linework, cel-shading). Do NOT drift toward photorealism, sepia tones, or painterly realism.\n`
              : '';
            let refPrompt: string;
            if (useCharacterReference && useSceneChain) {
              refPrompt = `REFERENCE IMAGES: Image 1 is the CHARACTER REFERENCE — maintain this EXACT character appearance (face, hair, clothing, features).\n` +
                `Image 2 is the PREVIOUS SCENE — maintain visual style, color palette, and atmosphere continuity.\n` +
                mediumReminder +
                `Generate a NEW scene matching this prompt while keeping both consistencies:\n\n` +
                currentPrompt;
            } else if (useCharacterReference) {
              refPrompt = `IMPORTANT: The attached reference image shows the EXACT character appearance to maintain.\n` +
                mediumReminder +
                `Generate a NEW scene matching this prompt, but keep the character looking like the reference:\n\n` +
                currentPrompt;
            } else {
              // Scene chain only (atmosphere, establishing, object scenes)
              refPrompt = `STYLE REFERENCE: The attached image is the previous scene. Maintain visual consistency —\n` +
                `same color palette, lighting style, rendering technique, and atmosphere.\n` +
                mediumReminder +
                `Generate a NEW, DIFFERENT scene matching this prompt while preserving the visual style:\n\n` +
                currentPrompt;
            }
            
            // Build multipart form data (Deno-compatible)
            const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
            const encoder = new TextEncoder();
            const parts: Uint8Array[] = [];
            
            // Collect reference images to send
            const refImages: Array<{ bytes: Uint8Array; filename: string }> = [];
            if (useCharacterReference) {
              refImages.push({ bytes: characterReferenceBytes!, filename: 'character_reference.png' });
            }
            if (useSceneChain) {
              refImages.push({ bytes: previousSceneImageBytes!, filename: 'previous_scene.png' });
            }
            
            // image field(s) — use "image[]" for multiple, "image" for single
            const imageFieldName = refImages.length > 1 ? 'image[]' : 'image';
            for (const refImg of refImages) {
              parts.push(encoder.encode(
                `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="${imageFieldName}"; filename="${refImg.filename}"\r\n` +
                `Content-Type: image/png\r\n\r\n`
              ));
              parts.push(refImg.bytes);
              parts.push(encoder.encode('\r\n'));
            }
            
            // prompt field
            parts.push(encoder.encode(
              `--${boundary}\r\n` +
              `Content-Disposition: form-data; name="prompt"\r\n\r\n` +
              refPrompt + '\r\n'
            ));
            
            // model field
            parts.push(encoder.encode(
              `--${boundary}\r\n` +
              `Content-Disposition: form-data; name="model"\r\n\r\n` +
              `gpt-image-1\r\n`
            ));
            
            // size field
            parts.push(encoder.encode(
              `--${boundary}\r\n` +
              `Content-Disposition: form-data; name="size"\r\n\r\n` +
              `1024x1536\r\n`
            ));
            
            // quality field
            parts.push(encoder.encode(
              `--${boundary}\r\n` +
              `Content-Disposition: form-data; name="quality"\r\n\r\n` +
              `low\r\n`
            ));
            
            // n field
            parts.push(encoder.encode(
              `--${boundary}\r\n` +
              `Content-Disposition: form-data; name="n"\r\n\r\n` +
              `1\r\n`
            ));
            
            // closing boundary
            parts.push(encoder.encode(`--${boundary}--\r\n`));
            
            // Merge all parts into single buffer
            const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
            const body = new Uint8Array(totalLength);
            let offset = 0;
            for (const part of parts) {
              body.set(part, offset);
              offset += part.length;
            }

            response = await fetch('https://api.openai.com/v1/images/edits', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${openaiKey}`,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
              },
              body: body,
            });
          } else {
            // Standard text-only generation (atmosphere, establishing, object scenes)
            response = await fetch(
              'https://api.openai.com/v1/images/generations',
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${openaiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: 'gpt-image-1',
                  prompt: currentPrompt,
                  n: 1,
                  size: '1024x1536', // Portrait format for vertical video
                  quality: 'low',    // Cheapest option
                  output_format: 'webp',
                }),
              },
            );
          }

          if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            console.error(`[IMAGES] gpt-image-1 scene ${i} attempt ${attempt}/${MAX_IMAGE_RETRIES}: ${response.status} - ${errorBody.substring(0, 300)}`);
            
            // === MODERATION / CONTENT POLICY (400) — sanitize and retry ===
            // v9.0: 4-attempt escalation: full prompt → safety filter → atmospheric skeleton → ultra-safe
            if (response.status === 400 && (errorBody.includes('moderation') || errorBody.includes('safety') || errorBody.includes('content_policy'))) {
              console.log(`[IMAGES] ⚠️ Moderation block on scene ${i}, attempt ${attempt}/${MAX_IMAGE_RETRIES}. Sanitizing prompt...`);
              if (attempt < MAX_IMAGE_RETRIES) {
                if (attempt === 1) {
                  // First rejection: apply content safety filter (DB rules or hardcoded)
                  const safetyResult = applyContentSafetyFilter(currentPrompt, safetyRules);
                  currentPrompt = safetyResult.filtered;
                  if (safetyResult.changeCount > 0) {
                    console.log(`[SAFETY] Scene ${i}: safety filter applied ${safetyResult.changeCount} categories on retry (${safetyResult.categories.join(', ')})`);
                    await logger.snapshot('images', 'safety_filter', {
                      scene_index: i, sub_index: entry.subIndex,
                      categories_filtered: safetyResult.categories,
                      change_count: safetyResult.changeCount,
                      trigger: 'moderation_rejection',
                    }, `Safety filter (retry): ${safetyResult.changeCount} categories in scene ${i}`);
                  }
                } else if (attempt === 2) {
                  // Second rejection: strip to atmospheric skeleton (still moody/dark)
                  currentPrompt = sanitizeImagePrompt(currentPrompt, attempt);
                } else {
                  // Third rejection: ultra-safe — strip ALL dark/horror language
                  currentPrompt = sanitizeImagePrompt(currentPrompt, attempt);
                }
                await new Promise(r => setTimeout(r, 2000));
                continue;
              }
            }
            
            // === RATE LIMIT (429) — exponential backoff ===
            if (response.status === 429 && attempt < MAX_IMAGE_RETRIES) {
              const waitTime = 20 * attempt * 1000;
              console.log(`[IMAGES] Rate limited on scene ${i}, waiting ${waitTime / 1000}s...`);
              await new Promise(r => setTimeout(r, waitTime));
              continue;
            }
            
            // Out of retries or non-retryable error
            // v6.0: For moderation blocks, skip this scene instead of killing the entire step.
            // Other errors (500, network) still throw to preserve existing retry behavior.
            if (response.status === 400 && (errorBody.includes('moderation') || errorBody.includes('safety') || errorBody.includes('content_policy'))) {
              console.error(`[IMAGES] ⚠️ Scene ${i} permanently blocked by moderation after ${attempt} attempts. Skipping scene (will use adjacent image as fallback).`);
              moderationFailCount++;
              await logger.snapshot('images', 'moderation_skip', {
                scene_index: i, sub_index: entry.subIndex,
                attempts: attempt, prompt_length: currentPrompt.length,
              }, `Scene ${i} skipped: moderation block after ${attempt} attempts`);
              break; // Exit retry loop, imageGenerated stays false
            }
            throw new Error(`gpt-image-1 scene ${i} failed: ${response.status} ${response.statusText} - ${errorBody.substring(0, 300)}`);
          }

          const result = await response.json();
          // gpt-image-1 returns base64 by default
          if (result.data?.[0]?.b64_json) {
            imageUrl = `data:image/webp;base64,${result.data[0].b64_json}`;
            imageGenerated = true;
            // v8.1: Capture raw bytes for scene chain (next scene's reference)
            try {
              const rawB64 = result.data[0].b64_json;
              const binaryStr = atob(rawB64);
              const sceneBytes = new Uint8Array(binaryStr.length);
              for (let k = 0; k < binaryStr.length; k++) {
                sceneBytes[k] = binaryStr.charCodeAt(k);
              }
              previousSceneImageBytes = sceneBytes;
              console.log(`[IMAGES] Scene ${i}: captured ${sceneBytes.length} bytes for scene chain`);
            } catch (chainErr) {
              console.warn(`[IMAGES] Scene ${i}: failed to capture chain bytes (non-fatal): ${chainErr instanceof Error ? chainErr.message : chainErr}`);
            }
          } else if (result.data?.[0]?.url) {
            imageUrl = result.data[0].url;
            imageGenerated = true;
            // v8.1: Fetch image bytes for scene chain from URL
            try {
              const chainFetch = await fetch(result.data[0].url);
              if (chainFetch.ok) {
                previousSceneImageBytes = new Uint8Array(await chainFetch.arrayBuffer());
                console.log(`[IMAGES] Scene ${i}: captured ${previousSceneImageBytes.length} bytes for scene chain (from URL)`);
              }
            } catch (chainErr) {
              console.warn(`[IMAGES] Scene ${i}: failed to fetch chain bytes (non-fatal): ${chainErr instanceof Error ? chainErr.message : chainErr}`);
            }
          }

          if (imageGenerated) {
            if (attempt > 1) {
              console.log(`[IMAGES] ✓ Scene ${i} succeeded on sanitized attempt ${attempt}`);
            }
            break;
          } else {
            throw new Error(`gpt-image-1 returned no image for scene ${i}`);
          }

          } catch (networkErr) {
            // v14.1: Handle network/connection errors (e.g. "error reading a body from connection")
            // These are transient Deno TCP/TLS errors, not HTTP errors from the API.
            const netMsg = networkErr instanceof Error ? networkErr.message : String(networkErr);
            const isNetworkError = netMsg.includes('body') || netMsg.includes('connection') ||
              netMsg.includes('tcp') || netMsg.includes('tls') || netMsg.includes('socket') ||
              netMsg.includes('ECONNRESET') || netMsg.includes('fetch failed');
            
            if (isNetworkError && attempt < MAX_IMAGE_RETRIES) {
              const waitTime = 5000 * attempt;
              console.warn(`[IMAGES] ⚠️ Network error on scene ${i} attempt ${attempt}/${MAX_IMAGE_RETRIES}: ${netMsg}. Retrying in ${waitTime / 1000}s...`);
              await new Promise(r => setTimeout(r, waitTime));
              continue;
            }
            // Non-network error or out of retries — rethrow
            throw networkErr;
          }
        }
        
        if (!imageGenerated) {
          // v6.0: Don't kill the entire step — skip this scene.
          // The assemble step will use the previous scene's image as a fallback.
          console.warn(`[IMAGES] Scene ${i} has no image (moderation or empty response). Continuing with remaining scenes.`);
          scenesCompleted.push(seqIdx); // Mark as "completed" so continuation doesn't retry
          continue;
        }
      } else if (imageModel === 'dall-e-2') {
        // === DALL-E 2 IMAGE GENERATION (Cheaper) ===
        const response = await fetchWithError(
          'https://api.openai.com/v1/images/generations',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openaiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'dall-e-2',
              prompt: scenePrompt,
              n: 1,
              size: '1024x1024', // DALL-E 2 square format
            }),
          },
          `DALL-E 2 scene ${i}`
        );

        const result = await response.json();
        imageUrl = result.data?.[0]?.url;
        
        if (!imageUrl) {
          throw new Error(`DALL-E 2 returned no image for scene ${i}`);
        }
      } else {
        // === DALL-E 3 IMAGE GENERATION (Higher quality) ===
        const response = await fetchWithError(
          'https://api.openai.com/v1/images/generations',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openaiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'dall-e-3',
              prompt: scenePrompt,
              n: 1,
              size: '1024x1792', // Portrait 9:16 for DALL-E 3
              quality: 'standard',
              response_format: 'url',
            }),
          },
          `DALL-E 3 scene ${i}`
        );

        const result = await response.json();
        imageUrl = result.data?.[0]?.url;

        if (!imageUrl) {
          throw new Error(`DALL-E 3 returned no image for scene ${i}`);
        }
      }

      // Upload to storage (using standardized path — sub-images get suffixed path)
      const imageStorageIdx = entry.subIndex > 0 ? `${i}_sub_${entry.subIndex}` : String(i);
      const storagePath = pathForImage(job.brand_id, job.id, parseInt(imageStorageIdx) || i) + (entry.subIndex > 0 ? `_sub_${entry.subIndex}` : '');
      const publicUrl = await uploadRemoteToStorage(
        supabase,
        STORAGE_BUCKET,
        storagePath,
        imageUrl
      );

      // Store asset with scene key
      const assetMeta: Record<string, unknown> = {
        scene_index: i,
        sub_index: entry.subIndex,
        prompt: scenePrompt,
        prompt_hash: promptHash,
        art_style: artStyle,
        image_model: imageModel,
        character_reference_used: !!useCharacterReference,
        scene_chain_used: !!useSceneChain,
      };
      // v5.1: Include ComfyUI config for audit trail + cache invalidation
      if (imageModel === 'comfyui') {
        assetMeta.comfyui_workflow = (imagePromptConfig as any)?.comfyui_workflow || 'txt2img_sdxl';
        assetMeta.comfyui_checkpoint = (imagePromptConfig as any)?.comfyui_checkpoint || 'default';
        assetMeta.comfyui_steps = (imagePromptConfig as any)?.comfyui_steps || 28;
        assetMeta.comfyui_cfg = (imagePromptConfig as any)?.comfyui_cfg || 5.5;
      }
      await upsertAsset(supabase, job.id, idempotencyKey, 'dalle_image', storagePath, publicUrl, assetMeta);
      
      // Also store asset with prompt hash key (for external idempotency)
      await upsertAsset(supabase, job.id, promptHashKey, 'dalle_image', storagePath, publicUrl, assetMeta);

      generatedCount++;
      scenesCompleted.push(seqIdx);
      console.log(`[IMAGES] ✓ Image ${seqIdx + 1}/${imageSequence.length} (scene ${i}${entry.subIndex > 0 ? ` sub ${entry.subIndex}` : ''}) uploaded (${imageModel}): ${publicUrl}`);

      // === COST CONTROL: Record usage (only on successful generation) ===
      if (costSlotAcquired) {
        const costIdempotencyKey = `job:${job.id}:openai_image:${costOperation}:${promptHash.slice(0, 16)}`;
        await costHelper.recordUsage(
          'openai_image',
          costIdempotencyKey,
          { 
            image_count: 1, 
            model: imageModel,  // 'gpt-image-1'
            estimated_cost_cents: imageModel === 'gpt-image-1' ? 2 : (imageModel === 'dall-e-3' ? 8 : 4)
          },
          'images',
          costOperation
        );
      }

      } finally {
        // === SLOT GUARD: ALWAYS release slot to prevent accumulation ===
        // Fires on success, throw, continue, or return paths.
        if (costSlotAcquired) {
          await costHelper.releaseSlot('openai_image', costOperation).catch((releaseErr: unknown) => {
            console.error(`[IMAGES] Slot release failed for ${costOperation}:`, releaseErr);
          });
        }
      } // end slot guard try/finally
    }

    // ======================================================================
    // BUILD IMAGE SEQUENCE MANIFEST (for assemble step)
    // Resolve all asset URLs and save the ordered sequence with durations + mood levels.
    // This replaces the assembler's uniform-duration calculation.
    //
    // v15.0: PROMPT CONSISTENCY FIX — For skipped scenes (already generated in a
    // prior continuation), entry.prompt is undefined because buildImagePrompt was
    // never called. Previously, we'd fall through to asset.meta.prompt which may
    // have been built with a DIFFERENT version of the visual cues (if the consistency
    // audit ran again with different GPT results on a later invocation).
    // Now: rebuild prompts for ALL scenes using the current (locked) visual cues,
    // ensuring the image_sequence has a consistent set of cue descriptions.
    // ======================================================================
    for (const entry of imageSequence) {
      if (!entry.prompt) {
        const scene = scenes[entry.sceneIndex];
        if (scene) {
          const idx = entry.sceneIndex;
          const baseVisualCue = visualCues.find(vc => vc.sceneIndex === idx);
          const effectiveCue = entry.subIndex > 0
            ? createSubImageCue(baseVisualCue, entry.subIndex, scene.text)
            : baseVisualCue;
          entry.prompt = buildImagePrompt(scene.text, scene.keywords, artStyle, idx, scenes.length, imagePromptConfig, effectiveCue, storyAnchor, artStyleRow);
        }
      }
    }

    const resolvedSequence: ImageSequenceEntry[] = [];
    for (const entry of imageSequence) {
      const asset = await getAssetByKey(supabase, job.id, entry.assetKey);
      resolvedSequence.push({
        ...entry,
        url: asset?.public_url || undefined,
        prompt: entry.prompt || (asset?.meta as Record<string, unknown>)?.prompt as string || undefined,
      });
    }

    // Also save legacy image_urls for backward compat
    const imageUrls = resolvedSequence.map(e => e.url).filter(Boolean);

    await updateJobMeta(supabase, job.id, {
      image_urls: imageUrls,
      image_model: imageModel,
      image_sequence: resolvedSequence,
    });

    // =========================================
    // GUARD: If zero images have URLs, the step should FAIL.
    // This prevents the assemble step from receiving an empty set
    // (e.g. when all images are moderation-blocked).
    // =========================================
    if (imageUrls.length === 0) {
      const reason = moderationFailCount > 0
        ? `All ${moderationFailCount} images were blocked by content moderation (${MAX_IMAGE_RETRIES} sanitization attempts each). The prompts may need further softening.`
        : `No images were generated or cached. Generated: ${generatedCount}, Skipped: ${skippedCount}.`;
      console.error(`[IMAGES] ✗ Zero usable images: ${reason}`);
      await logger.snapshot('images', 'zero_images_failure', {
        total_planned: imageSequence.length,
        generated: generatedCount,
        skipped: skippedCount,
        moderation_skipped: moderationFailCount,
      }, `FAIL: ${reason}`);
      return { success: false, error: reason, data: { generated: generatedCount, skipped: skippedCount, moderation_skipped: moderationFailCount, total: 0, failure_class: 'moderation' } };
    }

    console.log(`[IMAGES] ✓ Complete: ${generatedCount} generated, ${skippedCount} skipped${moderationFailCount > 0 ? `, ${moderationFailCount} moderation-skipped` : ''}, ${resolvedSequence.length} total images in sequence`);
    await logger.snapshot('images', 'sequence', {
      total_images: resolvedSequence.length,
      scenes: scenes.length,
      durations: resolvedSequence.map(e => e.duration),
      mood_levels: resolvedSequence.map(e => e.moodLevel),
      multi_image_scenes: resolvedSequence.filter(e => e.subIndex > 0).length,
      moderation_skipped: moderationFailCount,
    }, `Image sequence: ${resolvedSequence.length} images, ${resolvedSequence.filter(e => e.subIndex > 0).length} sub-images${moderationFailCount > 0 ? `, ${moderationFailCount} moderation-skipped` : ''}`);

    return { success: true, data: { generated: generatedCount, skipped: skippedCount, moderation_skipped: moderationFailCount, total: resolvedSequence.length } };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[IMAGES] ✗ Failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

// =====================================================
// VISUAL CUE EXTRACTION (GPT analyzes scenes for images)
// v3.0: Now preset-aware — receives ImagePromptConfig so style rules,
// negative constraints, and counting-horror logic guide the extraction.
// =====================================================

interface VisualCue {
  sceneIndex: number;
  description: string;   // What the IMAGE should depict
  sceneType: string;      // establishing | object | atmosphere | character | group
  camera: string;         // wide, medium, close-up, overhead, etc.
  isClimax?: boolean;     // true if this is a climactic moment
  // v9.0: Animation intent — cinematographer flags ~20-25% of scenes for animation
  animate?: boolean;      // true if this scene should be animated via img2vid
  motionType?: string;    // atmospheric | environmental | fire_light | camera
  animationHint?: string; // What physical motion should be visible (e.g. "rain falling through beams")
}

/**
 * v4.0: Create a meaningfully different visual cue for sub-images of long scenes.
 * Instead of the old approach (appending "from a different angle" suffix that gets ignored),
 * this modifies the camera, sceneType, and description so the ENTIRE prompt is different.
 * 
 * Strategy per sub-index:
 *   sub 1 → DETAIL shot: close-up camera, object/character focus, zoom into a specific element
 *   sub 2 → ATMOSPHERE shot: overhead/wide camera, environment focus, mood and space
 */
function createSubImageCue(baseCue: VisualCue | undefined, subIndex: number, sceneText: string): VisualCue | undefined {
  if (!baseCue) return baseCue;

  // Camera alternatives: maps base camera → [detail_alt, atmosphere_alt]
  const cameraAlts: Record<string, [string, string]> = {
    'wide':              ['close-up',         'overhead'],
    'medium':            ['extreme-close-up', 'low-angle'],
    'close-up':          ['extreme-close-up', 'wide'],
    'extreme-close-up':  ['medium',           'overhead'],
    'overhead':          ['close-up',         'low-angle'],
    'low-angle':         ['close-up',         'overhead'],
    'pov':               ['close-up',         'wide'],
  };

  const baseCamera = (baseCue.camera || 'wide').toLowerCase();
  const [detailCam, atmoCam] = cameraAlts[baseCamera] || ['close-up', 'overhead'];

  // Scene type alternatives for detail shots
  const detailTypeMap: Record<string, string> = {
    'group': 'character',       // Zoom from group → single character
    'character': 'object',      // Zoom from character → detail/object
    'establishing': 'object',   // Zoom from wide establishing → specific detail
    'atmosphere': 'object',     // Switch from mood → concrete object
    'object': 'atmosphere',     // If already object, switch to atmosphere
  };

  // Extract a grounding detail from the scene text (first concrete noun phrase)
  const textSnippet = sceneText.substring(0, 120).replace(/[.!?].*$/, '');

  if (subIndex === 1) {
    return {
      ...baseCue,
      camera: detailCam,
      sceneType: detailTypeMap[baseCue.sceneType] || 'object',
      description: `DETAIL SHOT of this moment: ${textSnippet}. Focus on a specific OBJECT, HAND, FACE, or TEXTURE visible in the scene — NOT the same wide framing. Show something the viewer would notice if they paused the video.`,
    };
  }

  // subIndex >= 2 (atmosphere/environment variant)
  return {
    ...baseCue,
    camera: atmoCam,
    sceneType: 'atmosphere',
    description: `ENVIRONMENT SHOT of: ${textSnippet}. Show the SPACE, LIGHTING, and MOOD of the scene — walls, ceiling, floor, shadows, reflections. NOT a character or group shot. The viewer should feel the atmosphere of the empty space.`,
  };
}

/**
 * v4.0: Simple character-level overlap ratio between two strings.
 * Used for prompt similarity detection — if two consecutive prompts
 * share >85% of characters, the sub-image cue isn't diverging enough.
 */
function computeCharOverlap(a: string, b: string): number {
  if (!a || !b) return 0;
  const shorter = Math.min(a.length, b.length);
  if (shorter === 0) return 0;
  let matches = 0;
  for (let i = 0; i < shorter; i++) {
    if (a[i] === b[i]) matches++;
  }
  return matches / shorter;
}

/**
 * Computed image sequence entry — represents one image in the final video.
 * For normal scenes: 1 entry per scene. For long scenes (>10s): multiple entries per scene.
 * This is stored in job.meta.image_sequence and read by the assemble step.
 */
interface ImageSequenceEntry {
  sceneIndex: number;     // Original scene index
  subIndex: number;       // 0 for first/only image, 1+ for multi-image long scenes
  duration: number;       // Duration this image will display (seconds)
  moodLevel: number;      // Ken Burns mood intensity (1-10)
  assetKey: string;       // Asset idempotency key for lookup
  url?: string;           // Resolved public URL (populated at end of images step)
  prompt?: string;        // The final assembled DALL-E prompt (populated at resolution for auditability)
  // v9.0: Animation intent from cinematographer AI
  animate?: boolean;       // true if cinematographer flagged this for img2vid animation
  motionType?: string;     // atmospheric | environmental | fire_light | camera
  animationHint?: string;  // What physical motion should be visible
}

/**
 * Lightweight Story Anchor — extracts consistent visual identity from story + preset.
 * Cached as job asset so continuation invocations reuse it.
 */
interface StoryAnchor {
  environment: string;       // primary setting description
  consequenceEnvironment?: string; // v11.1: shifted environment for arc presets (after the "rule/cost" reveal)
  characterDescription: string | null; // main character(s) appearance, null if no humans
  recurringMotifs: string;   // visual elements to repeat across scenes
  horrorTone: string;        // type of horror/dread
  timeOfDay: string;         // lighting conditions
  isGroupStory: boolean;     // whether multiple characters are present
  groupCount: number | null; // expected group size, null if not a group story
}

/**
 * Create a lightweight Story Anchor — visual bible for consistent image generation.
 * This is a simplified version of run-job/openai.ts createStoryAnchor,
 * designed to run in ~10s and provide core consistency data.
 */
async function createStoryAnchor(
  storyText: string,
  openaiKey: string,
  vibePreset: string,
  config: ImagePromptConfig | null,
): Promise<StoryAnchor | null> {
  const stylePrompt = config?.style_prompt || 'Cinematic photography, dramatic compositions, high production value';
  const envHint = config?.environment || '';
  const moodHint = config?.mood || '';

  // Determine genre context — only request horror-specific fields for horror presets
  const HORROR_PRESETS = new Set([
    'urban_legend', 'counting_horror', 'cosmic_dread', 'folklore', 'body_horror', 'analog_horror',
    'one_too_many', 'reddit_trending_horror', 'dark_origins', 'slow_creepy', 'punchy_shock',
    'atmospheric', 'nosleep', 'backrooms', 'glitch',
  ]);
  const isHorrorPreset = HORROR_PRESETS.has(vibePreset);
  const genreField = isHorrorPreset
    ? '4. horrorTone: Type of horror (psychological, supernatural, counting, cosmic, folklore, body)'
    : '4. genreTone: The emotional tone/genre (philosophical, dramatic, contemplative, suspenseful, whimsical, etc.)';
  
  // v11.0: Contrast presets (two_doors) — avoid single dark environment, emphasize visual variety
  const CONTRAST_VIBES = new Set(['two_doors']);
  const isContrastVibe = CONTRAST_VIBES.has(vibePreset);
  const contrastInstructions = isContrastVibe
    ? `\nIMPORTANT — This is a CONTRAST/CHOICE story. The two paths should have DIFFERENT visual identities:
- environment should describe BOTH settings separated by " vs " (e.g. "sunlit mountain peak with wildflowers vs peaceful lake village at twilight")
- recurringMotifs should be ABSTRACT themes (contrasts, transitions, reflections), NOT literal objects from the story. NEVER include literal objects like ropes, doors, pills, keys, etc. as motifs — they produce unintended disturbing imagery.
- timeOfDay should reflect the BRIGHTER of the two paths
- horrorTone/genreTone should be "contemplative" or "aspirational", NOT dark/horror\n`
    : '';

  // v11.1: Arc presets (one_rule_one_power) — story has wonder→consequence structure
  const ARC_VIBES = new Set(['one_rule_one_power']);
  const isArcVibe = ARC_VIBES.has(vibePreset);
  const arcInstructions = isArcVibe
    ? `\nIMPORTANT — This story has a NARRATIVE ARC with two visual phases:
PHASE 1 (first half): The wonder/power — bright, expansive, aspirational imagery
PHASE 2 (second half): The cost/rule — shifted mood, showing consequence, loss, emptiness

You MUST provide TWO environments:
- "environment": The Phase 1 (wonder/power) setting — bright, open, awe-inspiring
- "consequenceEnvironment": The Phase 2 (cost/rule) setting — visually DIFFERENT from Phase 1 to show the shift. Same world but darker, emptier, more desolate. Show what changes when the price is paid.
- recurringMotifs should be ABSTRACT mood elements (light fading, void expanding, warmth cooling), NOT literal story objects.
- timeOfDay should reflect Phase 1 (the brighter phase)\n`
    : '';

  // v11.0: Non-horror motif guidance to prevent disturbing imagery
  const motifGuidance = isHorrorPreset
    ? '3. recurringMotifs: Visual elements to repeat (specific objects, atmospheric details, textures mentioned in story)'
    : '3. recurringMotifs: ABSTRACT visual themes to repeat (atmospheric details, textures, light qualities, color motifs). Do NOT include literal objects like ropes, chains, doors, pills, or keys — these create unintended disturbing imagery when repeated. Focus on mood elements: mist, golden light, reflections, shadows, warmth, stillness.';

  const prompt = `You are a visual director. Analyze this story and extract a consistent visual identity for generating images.

ART STYLE: ${stylePrompt}
${envHint ? `ENVIRONMENT GUIDE (stylistic reference only — do NOT list multiple locations from this): ${envHint}` : ''}
${moodHint ? `MOOD: ${moodHint}` : ''}
GENRE/VIBE: ${vibePreset}
${contrastInstructions}${arcInstructions}
STORY:
"${storyText.substring(0, 3500)}"

Extract:
1. environment: The SINGLE PRIMARY setting from THIS story — describe ONE specific location where the main action takes place (e.g. "a brightly lit carousel at a small-town fairground at dusk"). Do NOT combine multiple locations. Do NOT list alternative settings. Pick the ONE most important location from the story text.
2. characterDescription: If ANY humans appear, describe the MAIN CHARACTER (protagonist) as a SINGLE STRING starting with their NAME from the story (if given), then age, clothing, hair, distinguishing features (e.g. "Sarah, 25-year-old woman with messy dark hair in a loose bun, wearing a stained diner uniform, tired eyes with a nervous twitch"). Including the name is critical for visual consistency. Return null if no humans appear. MUST be a plain string, NOT an object or array.
${motifGuidance}
${genreField}
5. timeOfDay: Specific lighting/time
6. isGroupStory: true ONLY if multiple characters physically APPEAR TOGETHER in scenes (interacting, present in the same location at the same time). Characters who are merely MENTIONED (missing persons, historical figures, victims) but never appear on-screen do NOT count. A solo protagonist investigating multiple disappearances is NOT a group story.
7. groupCount: The EXPECTED number of people who are PHYSICALLY PRESENT TOGETHER in scenes. null if not a group story. For "one too many" stories where the group discovers an extra person, return the NORMAL count BEFORE the extra person is noticed — NOT the total with the stranger included.

Return JSON: { "environment": "...", ${isArcVibe ? '"consequenceEnvironment": "...", ' : ''}"characterDescription": "..." or null, "recurringMotifs": "...", "horrorTone": "...", "timeOfDay": "...", "isGroupStory": true/false, "groupCount": N or null }`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a visual director. Respond only with valid JSON.' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.5,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      console.warn(`[STORY_ANCHOR] GPT call failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content);

    // v6.0: Cross-validate isGroupStory — GPT sometimes misclassifies stories
    // where multiple people are MENTIONED (e.g. "four missing women") but never
    // physically appear together. Check if the story text actually has dialogue
    // or action between multiple present characters.
    if (parsed.isGroupStory && parsed.characterDescription === null) {
      // No character descriptions but claims group story — likely misclassification.
      // A true group story would have describable characters who appear on screen.
      console.log(`[STORY_ANCHOR] ⚠️ Overriding isGroupStory=false: no characterDescription but isGroupStory was true (likely mentioned-not-present misclassification)`);
      parsed.isGroupStory = false;
      parsed.groupCount = null;
    } else if (parsed.isGroupStory && parsed.groupCount && parsed.groupCount > 12) {
      // v14.1: Raised cap from 8→12. OTM (one_too_many) stories inherently have
      // large groups (9-10 friends + 1 extra). The old cap of 8 was overriding
      // isGroupStory=false for every OTM story, breaking the group rendering.
      console.log(`[STORY_ANCHOR] ⚠️ Capping groupCount from ${parsed.groupCount} to null (unreasonable count)`);
      parsed.isGroupStory = false;
      parsed.groupCount = null;
    }

    // Normalize: if GPT returned genreTone instead of horrorTone (non-horror preset), map it
    if (!parsed.horrorTone && parsed.genreTone) {
      parsed.horrorTone = parsed.genreTone;
      delete parsed.genreTone;
    }

    // Normalize: characterDescription must be a string or null
    // GPT returns many shapes: {age, hair, clothing, ...}, [{...}, {...}],
    // or nested like {baby: {...}, adults: [{...}]} — flatten ALL to readable string
    if (parsed.characterDescription && typeof parsed.characterDescription === 'object') {
      const flattenCharObj = (c: any, label?: string): string => {
        if (typeof c === 'string') return label ? `${label}: ${c}` : c;
        if (!c || typeof c !== 'object') return '';
        const parts = [c.name, c.age ? `age ${c.age}` : null, c.hair, c.clothing, c.distinguishingFeatures || c.features].filter(Boolean);
        if (parts.length > 0) return label ? `${label}: ${parts.join(', ')}` : parts.join(', ');
        return label ? `${label}: ${JSON.stringify(c)}` : JSON.stringify(c);
      };

      const desc = parsed.characterDescription as any;

      if (Array.isArray(desc)) {
        // Simple array of character objects: [{...}, {...}]
        parsed.characterDescription = desc.map((c: any, i: number) =>
          flattenCharObj(c, `Character ${i + 1}`)
        ).join('. ');
      } else {
        // Check for nested grouped shape: {baby: {...}, adults: [{...}], protagonist: {...}, ...}
        const keys = Object.keys(desc);
        const hasDirectFields = ['age', 'hair', 'clothing', 'distinguishingFeatures', 'features'].some(f => f in desc);

        if (hasDirectFields) {
          // Single flat character object: {age, hair, clothing, ...}
          parsed.characterDescription = flattenCharObj(desc);
        } else if (keys.length > 0) {
          // Nested grouped shape: {baby: {...}, adults: [{...}, {...}], narrator: {...}}
          const segments: string[] = [];
          for (const key of keys) {
            const val = desc[key];
            const label = key.charAt(0).toUpperCase() + key.slice(1);
            if (Array.isArray(val)) {
              val.forEach((item: any, i: number) => {
                segments.push(flattenCharObj(item, `${label} ${i + 1}`));
              });
            } else {
              segments.push(flattenCharObj(val, label));
            }
          }
          parsed.characterDescription = segments.filter(Boolean).join('. ');
        } else {
          parsed.characterDescription = JSON.stringify(desc);
        }
      }
      console.log(`[STORY_ANCHOR] Normalized characterDescription from object to string: "${(parsed.characterDescription as string).substring(0, 120)}..."`);
    }

    console.log(`[STORY_ANCHOR] Created: env="${(parsed.environment || '').substring(0, 60)}...", group=${parsed.isGroupStory}, count=${parsed.groupCount}, tone=${parsed.horrorTone || '-'}`);
    return parsed as StoryAnchor;
  } catch (err) {
    console.warn(`[STORY_ANCHOR] Creation failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * v8.0: Cross-scene visual consistency audit.
 * Reviews ALL visual cue descriptions together in a single GPT-4o-mini call
 * to catch prop/object contradictions before image generation.
 *
 * Examples it catches:
 * - Scene 11 shows a smartphone but Scene 13 shows a landline phone
 * - Character wearing a jacket in Scene 3 but a hoodie in Scene 7
 * - Car is a sedan in Scene 5 but an SUV in Scene 9
 * - Scene is indoors in a store but next scene implies outdoors
 *
 * Returns the same cues array with any contradictory descriptions patched.
 * If the LLM call fails, returns the original cues unchanged (graceful degradation).
 */
async function auditVisualCueConsistency(
  cues: VisualCue[],
  scenes: Array<{ index: number; text: string; keywords: string[] }>,
  openaiKey: string,
  storyAnchor: StoryAnchor | null,
): Promise<{ cues: VisualCue[]; fixes: Array<{ scene: number; issue: string; before: string; after: string }> }> {
  if (!openaiKey || cues.length < 3) {
    return { cues, fixes: [] };
  }

  try {
    // Build a compact scene+cue list for the LLM to review
    const sceneDescriptions = cues.map(c => {
      const sceneText = scenes[c.sceneIndex]?.text?.substring(0, 200) || '';
      return `Scene ${c.sceneIndex + 1} [${c.sceneType}]: Cue: "${c.description}" | Narration: "${sceneText}"`;
    }).join('\n');

    const anchorContext = storyAnchor ? `
STORY SETTING: ${storyAnchor.environment || 'unknown'}
CHARACTERS: ${storyAnchor.characterDescription || 'not specified'}
TIME: ${storyAnchor.timeOfDay || 'not specified'}` : '';

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a CONTINUITY SUPERVISOR for a short video. You review visual scene descriptions and find CONTRADICTIONS.

You are reviewing CONSISTENCY and NARRATION ALIGNMENT. Look for:
1. PROPS changing type (smartphone → landline phone, modern car → old truck, flashlight → candle)
2. CLOTHING changing unexpectedly (jacket → hoodie, formal → casual) within the same character
3. SETTING contradictions (indoors → outdoors when story didn't change location)
4. TECHNOLOGY anachronisms (modern phone in one scene, rotary phone in next)
5. VEHICLE changes (sedan → SUV, car color changing)
6. WEAPON/TOOL changes (kitchen knife → hunting knife)
7. LOCATION MISMATCH WITH NARRATION (CRITICAL): If the narration says the character is in their car, at home, outside, in a parking lot, etc. — the visual cue description MUST match that location. If narration says "I ran to my car" but the cue shows them inside a store, THAT IS A CONTRADICTION that must be fixed.
8. DEVICE ORIENTATION: If a character is described holding/using a phone, the screen should face the viewer, not the back of the phone.

Do NOT flag:
- Different camera angles or framing (that's intentional variety)
- Mood/lighting changes (that's dramatic escalation)
- Different characters holding different objects
- Scene-appropriate changes (going from inside to outside when the story says they left)

For each contradiction found, provide the FIXED description for the scene that should change.
Keep the fix minimal — only change the contradictory element, keep everything else identical.
Prefer fixing LATER scenes to match EARLIER ones (first mention establishes canon).`,
          },
          {
            role: 'user',
            content: `Review these ${cues.length} scene descriptions for visual continuity errors:${anchorContext}

${sceneDescriptions}

Respond with JSON: { "fixes": [ { "sceneIndex": <0-based>, "issue": "<brief description of the contradiction>", "fixedDescription": "<corrected description>" } ] }
If no contradictions found, respond: { "fixes": [] }`,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      console.warn(`[CONSISTENCY] GPT call failed: ${response.status} — skipping audit`);
      return { cues, fixes: [] };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return { cues, fixes: [] };

    const parsed = JSON.parse(content);
    const rawFixes = parsed.fixes || [];

    if (rawFixes.length === 0) {
      console.log(`[CONSISTENCY] ✓ No contradictions found across ${cues.length} scenes`);
      return { cues, fixes: [] };
    }

    // Apply fixes to cue descriptions
    const appliedFixes: Array<{ scene: number; issue: string; before: string; after: string }> = [];
    const patchedCues = [...cues];

    for (const fix of rawFixes) {
      const idx = patchedCues.findIndex(c => c.sceneIndex === fix.sceneIndex);
      if (idx >= 0 && fix.fixedDescription && fix.fixedDescription.length > 10) {
        const before = patchedCues[idx].description;
        patchedCues[idx] = { ...patchedCues[idx], description: fix.fixedDescription };
        appliedFixes.push({
          scene: fix.sceneIndex,
          issue: fix.issue || 'continuity fix',
          before: before.substring(0, 150),
          after: fix.fixedDescription.substring(0, 150),
        });
        console.log(`[CONSISTENCY] 🔧 Scene ${fix.sceneIndex + 1}: ${fix.issue} | "${before.substring(0, 80)}" → "${fix.fixedDescription.substring(0, 80)}"`);
      }
    }

    console.log(`[CONSISTENCY] Applied ${appliedFixes.length} continuity fixes across ${cues.length} scenes`);
    return { cues: patchedCues, fixes: appliedFixes };

  } catch (err) {
    console.warn(`[CONSISTENCY] Audit failed: ${err instanceof Error ? err.message : err} — using original cues`);
    return { cues, fixes: [] };
  }
}

/**
 * Extract visual cues from scene text using GPT-4o-mini.
 * v3.0: Now preset-aware — includes style rules, negative constraints,
 * group counting logic, and story anchor context.
 */
async function extractVisualCues(
  scenes: Array<{ index: number; text: string; keywords: string[] }>,
  openaiKey: string,
  vibePreset: string,
  config: ImagePromptConfig | null,
  storyAnchor: StoryAnchor | null,
): Promise<VisualCue[]> {
  // Use up to 350 chars per scene for better context grounding
  const sceneList = scenes.map((s, i) => 
    `Scene ${i + 1} (sceneIndex: ${i}): "${s.text.substring(0, 350)}"`
  ).join('\n');

  // Build preset-aware context for the extraction
  const styleContext = config ? `
ART STYLE: ${config.style_prompt}
ENVIRONMENT GUIDE: ${config.environment}
COLOR PALETTE: ${config.color_palette}
NEGATIVE CONSTRAINTS (things images must NEVER show): ${config.negative_prompt}` : '';

  // Story anchor context for consistency
  const anchorContext = storyAnchor ? `
STORY ENVIRONMENT: ${storyAnchor.environment}
${storyAnchor.characterDescription ? `CHARACTER(S): ${storyAnchor.characterDescription}` : 'NO HUMAN CHARACTERS (use objects, environments, and atmospheric shots only)'}
RECURRING MOTIFS: ${storyAnchor.recurringMotifs}
HORROR TONE: ${storyAnchor.horrorTone}
TIME OF DAY: ${storyAnchor.timeOfDay}
${storyAnchor.isGroupStory ? `GROUP STORY: Yes, ${storyAnchor.groupCount || 'unknown number of'} people` : ''}` : '';

  // Special rules for counting horror (one_too_many) — manga-horror style
  const countingRules = (vibePreset === 'one_too_many' && storyAnchor?.isGroupStory) ? `
COUNTING HORROR RULES (CRITICAL — MANGA STYLE):
- This is a "one too many" story — the group discovers an extra person
- Expected group size: ${storyAnchor.groupCount || 'varies'}
- BEFORE the reveal moment: show exactly the expected count, everyone looks normal
- AFTER the reveal: show one extra person, with subtly unsettling expressions
- For "implied presence" scenes (feeling watched, shadows): do NOT show extra people as humans — use shadow distortions, light anomalies, motion blur
- For scenes examining photos/footage: ALWAYS show the wrong count
- VARY the scene types — not every scene needs the full group. Use establishing shots, object close-ups, atmosphere shots, and individual character moments too.
- MANGA VISUAL STYLE: All shots should feel like dark manga panels. Use heavy black ink, cross-hatching for shadows, stark high-contrast monochrome with selective blood-red accents. Faces should show extreme detail in expressions of dread — wide eyes, sweat drops, trembling hands. Think Junji Ito spirals and obsessive patterns.
- COUNTING MOTIFS: Where possible, incorporate counting imagery — tally marks scratched into surfaces, spiraling numbers, fingers counting, repeated objects in rows. The counting obsession should feel visual, not just narrative.` : '';
  const countingRulesSolo = (vibePreset === 'one_too_many' && !storyAnchor?.isGroupStory) ? `
COUNTING HORROR RULES (NON-GROUP — MANGA STYLE):
- MANGA VISUAL STYLE: All shots should feel like dark manga panels. Heavy black ink linework, obsessive cross-hatching, extreme detail on disturbing elements. High contrast monochrome with selective blood-red accents. Junji Ito aesthetic — spiral motifs, impossible geometry, faces showing obsessive dread.
- Use dramatic foreshortening, panel-like compositions, thick bold outlines.
- Prefer extreme close-ups of faces, hands, and small unsettling details.` : '';

  // Backrooms-specific rules
  const liminalRules = vibePreset === 'backrooms' ? `
LIMINAL SPACE RULES:
- Avoid showing humans unless the scene text explicitly mentions a person
- Focus on empty impossible architecture, repeating patterns, fluorescent-lit void
- Use POV shots, impossible corridors, empty rooms` : '';

  // Contrast / choice-based preset rules (two_doors etc.)
  const CHOICE_VIBES = new Set(['two_doors']);
  const choiceRules = CHOICE_VIBES.has(vibePreset) ? `
TWO-CHOICE / CONTRAST PRESET RULES (CRITICAL — READ CAREFULLY):
This is a "choose between two options" story. The narration presents two possible paths/choices using a framing device (keys, doors, pills, etc.).

RULE 1 — SHOW WHAT THE CHOICE REPRESENTS, NOT THE LITERAL OBJECT:
- The story uses a framing device (e.g. "two keys", "two doors", "two pills") to present the choices.
- Each choice REPRESENTS a different life, outcome, or world (e.g. a luxurious mansion, a peaceful mountain cabin, a bustling creative studio).
- When the narration describes what a choice leads to, the image MUST show THAT WORLD — the mansion interior, the mountain vista, the art studio — NOT the literal key/door/pill.
- Example: narration says "The first key hints at luxury, elegant soirees, creating timeless art" → show a GRAND BALLROOM with chandeliers, or an artist's sunlit studio, NOT a close-up of a golden key.
- Example: narration says "The second key promises adventure, open roads, starlit camping" → show a WINDING MOUNTAIN ROAD at sunset, or a campfire under stars, NOT a sturdy key.
- The ONLY scenes where the framing device (key/door/pill) should appear are:
  a) The OPENING scene (introduction of the choice)
  b) The FINAL "which do you choose?" scene
- In ALL other scenes, show the WORLD/OUTCOME/LIFESTYLE that each choice leads to.

RULE 2 — ONE OPTION PER SCENE, NO SPLIT IMAGERY:
- When the narration is discussing ONE specific option/path, the image MUST commit fully to THAT option's visual world.
- Do NOT create split imagery (half warm / half cool, showing both paths simultaneously) when only ONE path is being discussed.
- If scene text talks about "the first option" → show ONLY that option's world, in its full visual identity (warm golden tones, daylight, etc.)
- If scene text talks about "the second option" → show ONLY that option's world, in its full visual identity (cool blue tones, moonlight, etc.)
- Split/dual imagery is ONLY appropriate for scenes that explicitly compare both options side by side or the final decision moment.

RULE 3 — VARIETY WITHIN EACH PATH'S WORLD:
- Even when multiple consecutive scenes discuss the same path, vary the specific subject within that world.
- Scene about luxury path could show: a gourmet dining table, then a rooftop infinity pool, then a walk-in wardrobe — NOT the same ballroom three times.
- Use the color palette from the config to differentiate: Path A scenes lean warm/golden, Path B scenes lean cool/silver.` : '';

  // Dark Origins documentary-specific rules
  const darkOriginsRules = vibePreset === 'dark_origins' ? `
DARK ORIGINS / DOCUMENTARY RULES (CRITICAL):
- This is a THIRD-PERSON DOCUMENTARY narration, NOT first-person horror. Think true-crime documentary, Investigation Discovery, Dateline.
- NEVER invent characters who do not appear in the narration. If the story is about a man, do NOT show random women reacting. Every person in a shot MUST be referenced in the story text.
- NEVER use "reaction shots" of unnamed/unmentioned people. If the narration describes a concept, evidence, or aftermath — show the EVIDENCE, the LOCATION, or the OBJECT, not a random bystander's face.
- Prefer ARCHIVAL/EVIDENCE-STYLE shots: crime scene photos, sealed files, old buildings, empty rooms, abandoned equipment, newspaper headlines, locked doors, fog-covered landscapes.
- For abstract narration (things being "unexplained", "chilling silence", aftermath): use ATMOSPHERE and OBJECT shots — an empty room, a spinning tape, a locked filing cabinet, a boarded-up building — NOT character reaction shots.
- The main subject is typically ONE specific historical figure. Only show THAT person (matching the characterDescription) when the narration is specifically about them doing something.
- Heavily favor: establishing shots of locations, close-ups of evidence/objects, atmosphere shots of empty/abandoned spaces.
- This preset should feel like flipping through a cold case file, not watching someone scream.` : '';

  const prompt = `You are an expert CINEMATOGRAPHER creating a shot list for a short horror video.
${styleContext}
${anchorContext}
${countingRules}
${countingRulesSolo}
${liminalRules}
${darkOriginsRules}
${choiceRules}

Genre/vibe: ${vibePreset}

Your job: for each scene, design a CINEMATIC SHOT that tells the story visually. Think like a film director — each image is a DIFFERENT CAMERA SETUP, not the same wide shot repeated.

SHOT DESIGN PRINCIPLES:
1. VARY THE SUBJECT: Not every shot shows the full group or the same thing. Some shots should be:
   - A CLOSE-UP of a hand, a face, an object (elevator buttons, a flickering light, sweat on a palm, a number display)
   - An OVERHEAD/birds-eye view looking straight down
   - A POV shot from a character's perspective
   - A DETAIL SHOT of something small but important (a name badge, a cracked mirror, fingers counting)
   - A REACTION SHOT focused on ONE person's face
2. FOLLOW THE NARRATIVE FOCUS: Read what the scene text is actually about:
   - If it mentions "counting" → show hands counting or numbered objects, NOT the full group
   - If it mentions "jolt of every floor" → show the floor indicator numbers changing, NOT people standing
   - If it mentions a character noticing something → show THEIR face in close-up reacting
   - If it mentions silence or unease → show an EMPTY detail (the elevator gap, emergency phone, a crack in the wall)
3. NEVER repeat the same basic composition. If scene 1 is "group in elevator", scene 2 MUST be a different angle/subject.
4. ESCALATE visually: start with normal/wide shots, progress to tighter, more unsettling compositions.

SCENE-GROUNDING RULES:
- Each description must match the DOMINANT ACTION or SUBJECT of THAT specific scene's narration.
- Do NOT bleed unique elements between scenes.
- MAINTAIN CONSISTENCY for: character appearance, recurring props.
- The BACKGROUND and CAST stay consistent, but the CAMERA FOCUS and FRAMING change every scene.
- LOCATION CHANGES (CRITICAL): If a scene's narration explicitly mentions the character is NOW IN A DIFFERENT PLACE (e.g. "I'm sitting in my car", "I got back to my apartment", "posting this from the parking lot", "I ran outside"), your visual description MUST show that NEW location — do NOT keep them in the previous setting. The narration is the authority on WHERE the character is.
- DEVICE/OBJECT USAGE: When narration mentions a character using a phone, laptop, camera, or recording device, show the SCREEN SIDE facing the viewer (not the back of the device). Show the character interacting with the device naturally — holding it, looking at the screen, typing on it.

CINEMATOGRAPHIC SHOT SELECTION (think like a movie director / cinematographer):
- For EACH scene, ask: "What shot best SERVES this moment in the story?"
- A group shot is only justified when the story beat is ABOUT the group — their collective reaction, their togetherness, or the viewer needs to SEE everyone present. If the narration focuses on a detail, an emotion, a single character, or the environment, choose the shot type that matches.
- DO NOT default to group shots. A skilled cinematographer uses wide establishing shots, tight close-ups, detail inserts, POV shots, and atmosphere shots to build tension and variety.
- The viewer should feel like they're watching a FILM, not looking at the same group photo over and over.
- Ensure strong variety across all scenes: mix establishing, object, atmosphere, character, and group types naturally based on what each story beat demands.
- At least 2-3 scenes should be non-people shots (object, atmosphere, establishing) to create breathing room and tension.
- At least 2 scenes should use close-up or extreme-close-up camera.
- At least 1 scene should use overhead, low-angle, or pov camera.
- If a scene has only 1-2 sentences of dialogue or narration, use an object/atmosphere/detail shot rather than showing people.

SCENE TYPE DESCRIPTION RULES (CRITICAL):
- If sceneType is "object": Description must focus on a SPECIFIC PHYSICAL OBJECT (buttons, mirror, display, hands, floor indicator, a crack). Do NOT mention groups of people, characters' faces, or crowds in the description.
- If sceneType is "atmosphere": Description must focus on the SPACE and ENVIRONMENT (walls, lighting, reflections, empty corridors, shadows). Do NOT describe people or groups — describe what the PLACE looks like without focusing on anyone in it.
- If sceneType is "establishing": Description must show the LOCATION as a wide establishing shot. People may be present as tiny background elements but are NOT the subject.
- If sceneType is "character": Description focuses on ONE specific person — their face, hands, or reaction. NOT a group.
- ONLY when sceneType is "group" should the description focus on multiple people together.

CLIMAX RULE:
- The last 1-2 scenes are the CLIMAX — the most dramatic, frightening moment.
- These scenes MUST show the story's most powerful visual (the monster revealed, the impossible face, the terrifying realization). Never waste the climax on an atmosphere/establishing shot.
- The final scene should be the image that lingers in the viewer's mind.

For each scene, provide:
- description: A concise 1-2 sentence visual description. Be SPECIFIC about what is visible — describe the exact subject, framing, and what makes this shot different from the others.
- sceneType: One of: establishing (wide location), object (specific item/detail focus), atmosphere (mood/environment), character (single person), group (multiple people)
- camera: One of: wide, medium, close-up, extreme-close-up, overhead, low-angle, pov
- isClimax: true if this is one of the last 1-2 scenes and represents the story's most dramatic moment, false otherwise

${sceneList}

Respond with a JSON object: { "cues": [ { "sceneIndex": 0, "description": "...", "sceneType": "...", "camera": "...", "isClimax": false }, ... ] }`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are an expert cinematographer designing a shot list. Each shot must be visually DISTINCT — vary subjects, angles, and framing like a real film. Respond only with valid JSON.' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      console.warn(`[VISUAL_CUES] GPT call failed: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content);
    const cues = parsed.cues || parsed.scenes || [];
    
    // Log scene type distribution and animation intent for diagnostics
    const typeDistribution: Record<string, number> = {};
    const animatedScenes: number[] = [];
    const motionTypes: Record<string, number> = {};
    for (const cue of cues) {
      typeDistribution[cue.sceneType] = (typeDistribution[cue.sceneType] || 0) + 1;
      if (cue.animate) {
        animatedScenes.push(cue.sceneIndex);
        if (cue.motionType) {
          motionTypes[cue.motionType] = (motionTypes[cue.motionType] || 0) + 1;
        }
      }
    }
    console.log(`[VISUAL_CUES] Extracted ${cues.length} cues for ${scenes.length} scenes. Types: ${JSON.stringify(typeDistribution)}`);
    console.log(`[VISUAL_CUES] Animation intent: ${animatedScenes.length}/${cues.length} scenes flagged for animation [${animatedScenes.join(', ')}]. Motion types: ${JSON.stringify(motionTypes)}`);
    
    return cues;
  } catch (err) {
    console.warn(`[VISUAL_CUES] Extraction failed: ${err instanceof Error ? err.message : err}`);
    return []; // Graceful fallback — images will use raw text
  }
}

// =====================================================
// PROMPT SANITIZATION FOR MODERATION RETRIES
// =====================================================
/**
 * Sanitize an image prompt after a moderation block.
 * Progressively strips violence, horror, abuse, and other flagged terms.
 * attempt 1: replace problematic words with neutral alternatives
 * attempt 2+: strip to bare atmospheric description
 */
// =====================================================
// CONTENT SAFETY FILTER (Roadmap #16)
// Proactive prompt sanitization BEFORE sending to image API.
// Rules loaded from DB → update without code deploy.
// Hardcoded fallback ensures safety even if DB is unreachable.
// =====================================================

interface SafetyRule {
  term: string;
  replacement: string;
  category: string;
  isRegex: boolean;
}

interface SafetyFilterResult {
  filtered: string;
  changeCount: number;
  categories: string[];
}

function escapeRegexStr(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Load content safety rules from the DB for a given preset + platform.
 * Returns a flat array of SafetyRule objects ready to apply.
 * Falls back to empty array on error (hardcoded filter handles it).
 */
async function loadContentSafetyRules(
  supabase: any,
  preset: string,
  platform?: string,
): Promise<SafetyRule[]> {
  try {
    const { data, error } = await supabase.rpc('get_content_safety_rules', {
      p_preset: preset || null,
      p_platform: platform || null,
    });

    if (error) {
      console.warn(`[SAFETY] DB rules unavailable: ${error.message}. Hardcoded fallback active.`);
      return [];
    }

    const rules: SafetyRule[] = [];
    const ruleGroups = (data || []) as Array<{
      category: string;
      severity: string;
      terms: Array<{ t: string; r: string; re?: boolean }>;
      scope: string;
    }>;

    for (const group of ruleGroups) {
      // 'warn' severity = log only, don't replace
      if (group.severity === 'warn') continue;
      for (const term of (group.terms || [])) {
        rules.push({
          term: term.t,
          replacement: term.r || 'mysterious',
          category: group.category,
          isRegex: !!term.re,
        });
      }
    }

    console.log(`[SAFETY] Loaded ${rules.length} safety rules from DB (preset: ${preset}, platform: ${platform || 'all'})`);
    return rules;
  } catch (err) {
    console.warn(`[SAFETY] Error loading rules: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

/**
 * Apply content safety rules to a prompt.
 * If DB rules are available, uses them. Otherwise falls back to hardcoded patterns.
 */
function applyContentSafetyFilter(prompt: string, rules: SafetyRule[]): SafetyFilterResult {
  if (!rules || rules.length === 0) {
    return applyHardcodedSafetyFilter(prompt);
  }

  let filtered = prompt;
  let changeCount = 0;
  const categoriesHit = new Set<string>();

  for (const rule of rules) {
    try {
      const pattern = rule.isRegex
        ? new RegExp(rule.term, 'gi')
        : new RegExp(`\\b${escapeRegexStr(rule.term)}\\b`, 'gi');

      const before = filtered;
      filtered = filtered.replace(pattern, rule.replacement);

      if (filtered !== before) {
        changeCount++;
        categoriesHit.add(rule.category);
      }
    } catch (_regexErr) {
      // Bad regex in DB — skip this rule
      continue;
    }
  }

  return { filtered, changeCount, categories: Array.from(categoriesHit) };
}

/**
 * Hardcoded safety filter — same patterns as sanitizeImagePrompt() attempt 1
 * but applied proactively before the FIRST API attempt.
 */
function applyHardcodedSafetyFilter(prompt: string): SafetyFilterResult {
  const patterns: Array<{ regex: RegExp; replacements: Record<string, string>; category: string }> = [
    {
      regex: /\b(blood|bloody|bleeding|gore|gory|wound|wounds|corpse|dead\s?body|death|dying|murder|killed?|stab|stabbed|slash|slashed|mutilat\w*|dismember\w*|decapitat\w*|impale\w*|slaughter\w*|massacr\w*)\b/gi,
      replacements: {
        'blood': 'red liquid', 'bloody': 'stained', 'bleeding': 'marked',
        'gore': 'darkness', 'gory': 'dark', 'wound': 'mark', 'wounds': 'marks',
        'corpse': 'figure', 'dead body': 'still figure',
        'death': 'end', 'dying': 'fading', 'murder': 'mystery',
        'kill': 'vanish', 'killed': 'vanished',
        'stab': 'strike', 'stabbed': 'struck', 'slash': 'cut', 'slashed': 'torn',
      },
      category: 'violence',
    },
    {
      regex: /\b(terrifying|horrifying|grotesque|deformed|disfigured|monstrous|demonic|evil|sinister|menacing|threatening)\b/gi,
      replacements: {
        'terrifying': 'unsettling', 'horrifying': 'mysterious', 'grotesque': 'unusual',
        'deformed': 'shadowy', 'disfigured': 'obscured', 'monstrous': 'imposing',
        'demonic': 'supernatural', 'evil': 'dark', 'sinister': 'mysterious',
        'menacing': 'looming', 'threatening': 'imposing',
      },
      category: 'scary_descriptors',
    },
    {
      regex: /\b(knife|blade|weapon|weapons|gun|guns|axe|machete|chainsaw|noose|rope\s+around\s+neck)\b/gi,
      replacements: {
        'knife': 'object', 'blade': 'metal', 'weapon': 'item', 'weapons': 'items',
        'gun': 'device', 'guns': 'devices', 'axe': 'tool', 'machete': 'tool',
        'chainsaw': 'machine', 'noose': 'loop',
      },
      category: 'weapons',
    },
    {
      regex: /\b(stalking|stalker|stalked|abduct\w*|kidnap\w*|assault\w*|attack\w*|victim|victims|prey|predator|helpless|defenseless|vulnerable|trapped|captive|hostage|abuse\w*|molest\w*|strangle\w*|choke|choking|suffocate|torture\w?|torment)\b/gi,
      replacements: {
        'stalking': 'watching', 'stalker': 'observer', 'stalked': 'watched',
        'assault': 'encounter', 'attack': 'approach', 'victim': 'witness', 'victims': 'witnesses',
        'prey': 'target', 'predator': 'presence', 'helpless': 'alone',
        'defenseless': 'exposed', 'vulnerable': 'isolated', 'trapped': 'surrounded',
        'captive': 'confined', 'hostage': 'detained', 'strangle': 'grip',
        'choke': 'pressure', 'choking': 'tightening', 'suffocate': 'smother',
        'torture': 'darkness', 'torment': 'unease',
      },
      category: 'abuse',
    },
    {
      regex: /\b(agony|suffering|pain|scream|screaming|screams|writhing|panic\w*|hysteri\w*|dread|terror|petrified|paralyzed\s+with\s+fear|frozen\s+in\s+fear|wail\w*|shriek\w*|sobbing)\b/gi,
      replacements: {
        'agony': 'stillness', 'suffering': 'solitude', 'pain': 'tension',
        'scream': 'silence', 'screaming': 'silent', 'screams': 'echoes',
        'writhing': 'shifting', 'panic': 'unease', 'dread': 'tension',
        'terror': 'unease', 'petrified': 'frozen', 'sobbing': 'silent',
      },
      category: 'panic',
    },
    {
      regex: /\b(disembowel\w*|drowned|drowning|hanging|hanged|self.harm|suicide|suicidal|decompos\w*)\b/gi,
      replacements: {
        'drowned': 'submerged', 'drowning': 'sinking', 'hanging': 'suspended',
        'hanged': 'suspended', 'suicide': 'mysterious ending', 'suicidal': 'troubled',
      },
      category: 'self_harm',
    },
    {
      regex: /\b(child|children|kid|kids|baby|infant|teenager|teen)\s*(scream|cry|fear|terror|danger|hurt|harm|alone|lost|missing|trapped|dead|dying|bleeding|injured|corpse|body|murder|killed|victim)\b/gi,
      replacements: {},
      category: 'children',
    },
    {
      regex: /\b(hunt\w*|chase|chasing|pursue|pursuing|fleeing|cornered|running\s+away)\b/gi,
      replacements: {
        'hunt': 'search', 'hunting': 'searching', 'chase': 'movement',
        'chasing': 'following', 'pursue': 'follow', 'pursuing': 'following',
        'fleeing': 'moving away', 'cornered': 'blocked',
      },
      category: 'pursuit',
    },
  ];

  let filtered = prompt;
  let changeCount = 0;
  const categoriesHit = new Set<string>();

  for (const { regex, replacements, category } of patterns) {
    const before = filtered;
    filtered = filtered.replace(regex, (match) => {
      const lower = match.toLowerCase().trim();
      return replacements[lower] || 'mysterious';
    });
    if (filtered !== before) {
      changeCount++;
      categoriesHit.add(category);
    }
  }

  return { filtered, changeCount, categories: Array.from(categoriesHit) };
}

function sanitizeImagePrompt(originalPrompt: string, attemptNumber: number): string {
  // Regex patterns for terms OpenAI commonly flags
  const problematicPatterns: Array<[RegExp, Record<string, string>]> = [
    // Violence / gore / death
    [/\b(blood|bloody|bleeding|gore|gory|wound|wounds|corpse|dead\s?body|death|dying|murder|kill|killed|stab|stabbed|slash|slashed|mutilat\w*|dismember\w*|decapitat\w*|impale\w*)\b/gi, {
      'blood': 'red liquid', 'bloody': 'stained', 'bleeding': 'marked',
      'gore': 'darkness', 'gory': 'dark', 'corpse': 'figure', 'dead body': 'still figure',
      'death': 'end', 'dying': 'fading', 'murder': 'mystery', 'kill': 'vanish',
      'killed': 'vanished', 'stab': 'strike', 'stabbed': 'struck',
    }],
    // Scary descriptors
    [/\b(terrifying|horrifying|grotesque|deformed|disfigured|monstrous|demonic|evil|sinister|menacing|threatening)\b/gi, {
      'terrifying': 'unsettling', 'horrifying': 'mysterious', 'grotesque': 'unusual',
      'deformed': 'shadowy', 'disfigured': 'obscured', 'monstrous': 'large',
      'demonic': 'supernatural', 'evil': 'dark', 'sinister': 'mysterious',
      'menacing': 'looming', 'threatening': 'imposing',
    }],
    // Weapons
    [/\b(knife|blade|weapon|gun|axe|machete|chainsaw|noose|rope\s+around\s+neck)\b/gi, {
      'knife': 'object', 'blade': 'metal', 'weapon': 'item', 'gun': 'device',
      'axe': 'tool', 'machete': 'tool',
    }],
    // Abuse / stalking / assault / pursuit
    [/\b(stalking|stalker|stalked|abduct\w*|kidnap\w*|assault\w*|attack\w*|attacked|victim|prey|predator|helpless|defenseless|vulnerable|trapped|captive|hostage|abuse\w*|molest\w*|strangle\w*|choke|choking|suffocate|hunt\w*|chase|chasing|pursue|pursuing|fleeing|cornered)\b/gi, {
      'stalking': 'watching', 'stalker': 'observer', 'stalked': 'watched',
      'abduction': 'disappearance', 'kidnapping': 'vanishing',
      'assault': 'encounter', 'attack': 'approach', 'attacked': 'confronted',
      'victim': 'witness', 'prey': 'target', 'predator': 'presence',
      'helpless': 'alone', 'defenseless': 'exposed', 'vulnerable': 'isolated',
      'trapped': 'surrounded', 'captive': 'confined', 'hostage': 'detained',
      'hunt': 'search', 'hunting': 'searching', 'chase': 'movement',
      'chasing': 'following', 'fleeing': 'moving away', 'cornered': 'blocked',
    }],
    // Panic / suffering / torture
    [/\b(torture|torment|agony|suffering|pain|scream|screaming|writhing|panic|panicked|panicking|hysteri\w*|dread|terror|petrified|paralyzed\s+with\s+fear|frozen\s+in\s+fear)\b/gi, {
      'torture': 'darkness', 'torment': 'unease', 'agony': 'stillness',
      'suffering': 'solitude', 'pain': 'tension', 'scream': 'silence',
      'screaming': 'silent', 'writhing': 'shifting', 'panic': 'unease',
      'panicked': 'unsettled', 'dread': 'tension', 'terror': 'unease',
      'petrified': 'frozen', 'hysteria': 'distress',
    }],
    // Body horror / drowning / hanging
    [/\b(disembowel\w*|drowned|drowning|hanging|hanged|self.harm|suicide|suicidal)\b/gi, {}],
    // Children in danger
    [/\b(child|children|kid|kids|baby|infant|teenager|teen)\s*(scream|cry|fear|terror|danger|hurt|harm|alone|lost|missing|trapped)\b/gi, {}],
  ];

  let sanitized = originalPrompt;

  for (const [pattern, replacements] of problematicPatterns) {
    sanitized = sanitized.replace(pattern, (match) => {
      const lower = match.toLowerCase().trim();
      return replacements[lower] || 'mysterious';
    });
  }

  // attempt 2+: strip to bare atmospheric description
  if (attemptNumber >= 2) {
    // Try to extract location and style, discard all narrative
    const locationMatch = sanitized.match(/(?:Environment|Location|Setting):\s*([^\n]+)/i);
    let location = locationMatch ? locationMatch[1].trim().substring(0, 120) : 'quiet environment';
    const styleMatch = sanitized.match(/Style:\s*([^\n]+)/i);
    let style = styleMatch ? styleMatch[1].trim().substring(0, 200) : 'Cinematic photography, soft lighting';

    // v9.0: Extra-safe sanitization for attempt 3 — remove ALL horror/dark/scary language
    // from the extracted location and style too. Previous versions kept "dark", "moody",
    // "shadows" etc. which still triggered gpt-image-1 moderation for horror brands.
    if (attemptNumber >= 3) {
      const safeReplace = (text: string) => text
        .replace(/\b(dark|darkness|shadowy|shadows?|eerie|creepy|haunted|haunting|sinister|ominous|menacing|foreboding|grim|bleak|macabre|morbid|gloomy|dread|dreary|spooky|horror|scary|frightening|terrifying|unsettling|disturbing|chilling|ghostly|spectral|demonic|supernatural|paranormal|occult|cursed|wicked|malevolent|malicious|vile|grotesque|desolate|abandoned|decayed|decrepit|ruined|derelict|crumbling|overgrown|foggy|misty|murky|dim|tomb|grave|graveyard|cemetery|crypt|dungeon|basement|cellar|attic|asylum|morgue|slaughter|blood|gore)\b/gi, '')
        .replace(/\b(moody|mysterious|mystery|enigmatic|cryptic|obscure|unknown|hidden|secret|forbidden|deadly|lethal|fatal|mortal|peril|perilous|danger|dangerous|threat|doom|doomed|cursed|hex|ritual|sacrifice)\b/gi, '')
        .replace(/\s{2,}/g, ' ').trim();
      location = safeReplace(location) || 'quiet indoor space';
      style = safeReplace(style) || 'Cinematic photography, natural lighting';
    }

    sanitized = [
      attemptNumber >= 3 ? `A calm, serene scene. ${style}` : `Atmospheric scene. ${style}`,
      `Setting: ${location}`,
      attemptNumber >= 3
        ? `Peaceful atmosphere, natural lighting, gentle colors.`
        : `Moody and mysterious atmosphere, dim lighting, deep shadows.`,
      `Professional illustration, 9:16 portrait orientation.`,
      `No text, no words, no letters, no watermarks.`,
    ].join('\n');
  }

  console.log(`[SANITIZE] Attempt ${attemptNumber}: ${sanitized.substring(0, 150)}...`);
  return sanitized;
}

/**
 * v5.0: Strip group/people language from visual cue descriptions
 * for non-group scenes. GPT sometimes leaks "characters' faces",
 * "the group", "six people" etc. into object/atmosphere/character scenes,
 * causing the image model to render crowds in every frame.
 */
function stripGroupLanguage(description: string, sceneType: string): string {
  if (!description) return description;
  let stripped = description;

  // Remove explicit group references
  // "featuring six characters pressed together" → "featuring the scene"
  stripped = stripped.replace(/\b(featuring|showing|depicting|with|of)\s+(the\s+)?(full\s+)?group\b/gi, '$1 the scene');
  stripped = stripped.replace(/\b(the|a)\s+group\s+(of\s+\w+\s+)?/gi, 'the scene ');
  stripped = stripped.replace(/\bcrowd\s+of\s+\w+/gi, 'the scene');
  
  // Remove "N characters/people/faces" patterns
  // "with six characters pressed together" → "with the cramped space"
  stripped = stripped.replace(/\b(two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(characters?|people|persons?|figures?|faces?|individuals?|colleagues?|coworkers?|friends?|members?)\b/gi, 'the setting');
  
  // Remove "characters' faces", "everyone looks", "the others"
  stripped = stripped.replace(/\b(the\s+)?(characters'?|everyone'?s?|everyone)\s+(faces?|expressions?|reactions?|looks?)\b/gi, 'the atmosphere');
  stripped = stripped.replace(/\bexpressions?\s+of\s+the\s+others\b/gi, 'the atmosphere');
  stripped = stripped.replace(/\b(the\s+)?others\s+(reflecting|showing|displaying)\b/gi, 'the scene $2');
  
  // Remove "people standing/sitting/gathered"
  stripped = stripped.replace(/\b(people|characters?|everyone)\s+(standing|sitting|gathered|pressed|crammed|crowded|huddled)\b/gi, 'the space');
  
  // Remove "stumbling out" group actions
  stripped = stripped.replace(/\bthe\s+group\s+\w+ing\b/gi, 'the scene');
  stripped = stripped.replace(/\bwith\s+the\s+group\b/gi, 'in the space');

  // Remove first-person group references from narration text
  // "We were squeezed together" → "The space was squeezed together"
  // "our shoulders" → "the shoulders"
  // "my friends" → ""
  stripped = stripped.replace(/\bwe\s+(were|are|had|have|could|would|should|all|both)\b/gi, 'the space was');
  stripped = stripped.replace(/\b(amongst|among|between)\s+us\b/gi, '$1 the space');
  stripped = stripped.replace(/\b(my|our)\s+(friends?|group|colleagues?|companions?|crew)\b/gi, 'the surroundings');
  stripped = stripped.replace(/\b(his|her|their)\s+friends?\b/gi, 'the surroundings');
  stripped = stripped.replace(/\b(our|their)\s+/gi, 'the ');
  stripped = stripped.replace(/\blike\s+sardines\b/gi, 'tightly');
  stripped = stripped.replace(/\bsqueezed\s+together\b/gi, 'cramped');
  stripped = stripped.replace(/\bI\s+glanced\s+around\s+at\b/gi, 'A glance across');
  stripped = stripped.replace(/\b(let'?s|let\s+us)\s+/gi, '');
  
  // For object scenes: reinforce the object focus
  if (sceneType === 'object') {
    // If the description still mentions multiple people, prepend focus instruction
    if (/\b(group|characters|people|everyone|faces)\b/i.test(stripped)) {
      stripped = stripped.replace(/\b(group|characters|people|everyone)\b/gi, 'surroundings');
    }
  }
  
  // For atmosphere scenes: ensure environment focus
  if (sceneType === 'atmosphere') {
    if (/\b(group|characters|people|everyone|faces)\b/i.test(stripped)) {
      stripped = stripped.replace(/\b(group|characters|people|everyone)\b/gi, 'the environment');
    }
  }

  // Clean up double spaces
  stripped = stripped.replace(/\s{2,}/g, ' ').trim();
  
  return stripped;
}

/**
 * Build a DALL-E prompt for a scene
 */
/**
 * Build an image generation prompt for a scene.
 * v3.0: Now includes story anchor for consistency, group count enforcement,
 * and character descriptions. Produces rich multi-line prompts
 * with per-preset art style, environment, color palette, camera progression,
 * tension escalation, and visual identity rules.
 */
function buildImagePrompt(
  sceneText: string,
  keywords: string[],
  artStyle: string,
  sceneIndex: number,
  totalScenes: number,
  config: ImagePromptConfig | null,
  visualCue?: VisualCue,
  storyAnchor?: StoryAnchor | null,
  artStyleRow?: any,
): string {
  // === DB-driven prompt (new path) ===
  if (config) {
    // v6.0: Narrative-aware tension — combines positional escalation with scene content signals.
    // Uses moodLevel (which considers sceneType, camera, isClimax) instead of purely linear ramp.
    // Base positional: 3→10 across video. Boosted by isClimax (+3) and dampened for calm scene types.
    let tensionLevel: number;
    if (config.tension_escalation) {
      const positionalBase = Math.floor((sceneIndex / totalScenes) * 10) + 3;
      // Blend in visual cue signals
      if (visualCue?.isClimax) {
        tensionLevel = Math.min(10, positionalBase + 3);
      } else if (visualCue?.sceneType === 'establishing' || visualCue?.sceneType === 'object') {
        // Calm scene types: reduce tension even if positioned late
        tensionLevel = Math.min(10, Math.max(3, positionalBase - 2));
      } else if (visualCue?.sceneType === 'atmosphere') {
        tensionLevel = Math.min(10, positionalBase + 1);
      } else {
        tensionLevel = Math.min(10, positionalBase);
      }
    } else {
      tensionLevel = 5;
    }

    // Thumbnail optimization: first scene image should work as a standalone thumbnail
    const thumbnailBoost = sceneIndex === 0
      ? '\nTHUMBNAIL PRIORITY: This is the FIRST scene and may be used as a video thumbnail. Compose for maximum impact at small sizes: strong central subject, clear silhouette, dramatic contrast, no fine details that disappear at thumbnail resolution. A single striking face half-lit, an ominous object, or a dramatic doorway shot work best.'
      : '';

    // Camera: prefer visual cue camera, then config progression, then fallback
    const angles = config.camera_angles || [];
    const configCamera = angles.length > 0
      ? angles[Math.min(sceneIndex, angles.length - 1)]
      : '';
    const cameraAngle = visualCue?.camera || configCamera;

    // Scene description: combine visual cue with narration for grounding
    // Always include narration context so the image matches the specific scene
    let cueDescription = visualCue?.description || '';
    const narrationSnippet = sceneText.substring(0, 180);

    // Scene-type-aware mood/environment adjustments
    const sceneType = visualCue?.sceneType || 'atmosphere';

    // v5.0: Strip group/people language from non-group scene descriptions
    // GPT visual cue extraction sometimes leaks group references ("characters' faces",
    // "the group", "six people") into object/atmosphere/establishing/character scenes.
    // These cause the image model to render crowds in every frame.
    // v5.1: Also strip from narration snippet — raw story text like "We were squeezed
    // together" or "my friends" causes groups even when cue description is clean.
    let cleanNarration = narrationSnippet;
    if (sceneType !== 'group') {
      cueDescription = stripGroupLanguage(cueDescription, sceneType);
      cleanNarration = stripGroupLanguage(narrationSnippet, sceneType);
    }

    // v5.1: Scene-type reinforcement — explicit instruction before scene description
    // to override any remaining group signals in the text
    // v14.2: For group stories (OTM), soften anti-group language — the story is
    // about a group, so non-group scenes should simply focus on their subject
    // without contradicting the group premise.
    const groupStory = !!storyAnchor?.isGroupStory;
    const sceneTypeInstruction: Record<string, string> = groupStory
      ? {
          'object': 'FOCUS: Close-up of a single OBJECT or detail.',
          'atmosphere': 'FOCUS: Empty space, environment, mood.',
          'establishing': 'FOCUS: Wide establishing shot of the LOCATION showing the full scene.',
          'character': 'FOCUS: ONE single person only — their face, hands, or body language.',
        }
      : {
          'object': 'FOCUS: Close-up of a single OBJECT or detail. Do NOT show groups of people.',
          'atmosphere': 'FOCUS: Empty space, environment, mood. Do NOT show groups of people.',
          'establishing': 'FOCUS: Wide establishing shot of the LOCATION. People may appear as tiny background elements only.',
          'character': 'FOCUS: ONE single person only — their face, hands, or body language. Do NOT show a group.',
        };
    const reinforcement = sceneType !== 'group' ? (sceneTypeInstruction[sceneType] || '') : '';

    // v12.0: Style front-loading for illustration/cartoon art styles
    // gpt-image-1 defaults to photorealism unless the medium is declared prominently
    // at the very START of the prompt. For non-photorealistic styles, prepend an
    // unambiguous medium declaration so the model renders in the correct medium.
    const ILLUSTRATION_STYLES = new Set([
      'manga-horror', 'rnmort', 'uncanny-illustrated', 'horror-anime',
    ]);
    const isIllustrationStyle = ILLUSTRATION_STYLES.has(artStyle) || ILLUSTRATION_STYLES.has(config.art_style || '');
    const styleFrontLoad = isIllustrationStyle
      ? `MEDIUM: This is a DRAWING / ILLUSTRATION, NOT a photograph. Render as ${config.style_prompt}.\n\n`
      : '';

    const sceneDescription = [
      styleFrontLoad,
      reinforcement,
      thumbnailBoost,
      cueDescription,
      cleanNarration ? `Scene context: ${cleanNarration}` : '',
    ].filter(Boolean).join('\n');
    let mood = config.mood;
    let environment = config.environment;
    if (sceneType === 'establishing') {
      environment = `${config.environment}, expansive vista`;
      mood = `atmospheric, ${config.mood}`;
    } else if (sceneType === 'object') {
      mood = `focused detail, ${config.mood}`;
    }

    // v3.0: Override environment with story anchor for consistency
    // v11.0: Skip for contrast presets (two_doors) — these need per-scene visual variety,
    // not a single global environment. The visual cue description provides scene context instead.
    // v11.1: Arc presets (one_rule_one_power) — use anchor env for first half, then switch to
    // consequenceEnvironment (or config env) for the second half to reflect narrative shift.
    const CONTRAST_PRESETS = new Set(['two_doors']);
    const ARC_PRESETS = new Set(['one_rule_one_power']);
    const artStyleName = config.art_style || '';
    const isContrastPreset = CONTRAST_PRESETS.has(artStyleName) || artStyleName === 'cinematic-contrast';
    const isArcPreset = ARC_PRESETS.has(artStyleName) || artStyleName === 'surreal-contemplative';
    const pastMidpoint = sceneIndex >= Math.floor(totalScenes * 0.45);
    if (storyAnchor?.environment && !isContrastPreset) {
      if (isArcPreset && pastMidpoint) {
        // Second half: use consequence environment if available, otherwise fall back to config
        // This lets the visual cues and config environment drive the "cost/rule" imagery
        environment = storyAnchor.consequenceEnvironment || config.environment;
      } else if (sceneType === 'establishing') {
        // v14.2: Establishing shots now use anchor environment too — the config environment
        // is a generic template (e.g. "small-town America") that doesn't match specific stories
        // (e.g. "remote island"). Keep the ", expansive vista" suffix for wide framing.
        environment = `${storyAnchor.environment}, expansive vista`;
      } else {
        // Use story-specific environment for consistency
        environment = storyAnchor.environment;
      }
    }

    // v3.1 / v10.0: Derive lighting and color_palette from the SCENE context.
    // Use the visual cue description (per-scene) as the primary location signal.
    // Only fall back to story anchor environment when no visual cue is available.
    // This prevents a global anchor like "abandoned workshop" from overriding
    // a scene-specific cue like "foggy town street."
    //
    // v13.0: ILLUSTRATION STYLE PROTECTION — For non-photorealistic art styles
    // (manga-horror, uncanny-illustrated, rnmort, horror-anime), keep the config's
    // authored lighting & color_palette. Dynamic "practical lighting" and "vivid
    // clothing colors" signals cause GPT-image-1 to drift toward photorealism,
    // which cascades through the scene-chain reference system.
    let lighting = config.lighting;
    let colorPalette = config.color_palette;
    if (storyAnchor && !isIllustrationStyle) {
      const tod = storyAnchor.timeOfDay || '';
      // v10.0: Scene-local environment — prefer visual cue description over global anchor
      const sceneEnv = cueDescription && cueDescription.length > 20
        ? cueDescription.substring(0, 80)
        : (storyAnchor.environment || '').substring(0, 80);
      const isCharacterScene = sceneType === 'group' || sceneType === 'character';
      // Build scene-aware lighting using per-scene location
      if (isCharacterScene) {
        lighting = `bright key lighting on all characters, ${tod ? tod + ' lighting conditions, ' : ''}practical lighting matching the scene (${sceneEnv}), ambient fill light so no face is lost in shadow`;
        colorPalette = `vivid clothing colors, clear skin tones, high color contrast, colors appropriate for: ${sceneEnv}, ${tod ? tod + ' tones' : 'rich deep tones'}`;
      } else {
        lighting = `${tod ? tod + ' lighting conditions, ' : ''}practical lighting matching the scene (${sceneEnv}), atmospheric ambient light, clear scene visibility`;
        colorPalette = `setting-appropriate colors for: ${sceneEnv}, ${tod ? tod + ' tones, ' : ''}high contrast, rich deep tones`;
      }
    } else if (storyAnchor && isIllustrationStyle) {
      console.log(`[IMAGES] v13.0: Preserving config lighting/color for illustration style "${artStyle}" (not overriding with anchor-derived values)`);
    }

    const keywordStr = keywords.slice(0, 3).join(', ');

    // v3.0: Build character/group context from story anchor
    let characterBlock = '';
    if (storyAnchor) {
      if (sceneType === 'character' && storyAnchor.characterDescription) {
        characterBlock = `Character: ${storyAnchor.characterDescription}`;
      } else if (sceneType === 'group' && storyAnchor.isGroupStory && storyAnchor.groupCount) {
        const count = storyAnchor.groupCount;
        // Determine if we're before or after the reveal (roughly 65% mark)
        const revealIndex = Math.floor(totalScenes * 0.65);
        const isAfterReveal = sceneIndex >= revealIndex;
        const showCount = isAfterReveal ? count + 1 : count;
        
        characterBlock = [
          `GROUP: EXACTLY ${showCount} distinct people visible, each with unique clothing and hair.`,
          storyAnchor.characterDescription ? `Characters: ${storyAnchor.characterDescription}` : '',
          isAfterReveal ? `One person has a subtly wrong expression — smile too wide, eyes slightly off.` : `Everyone looks normal and relaxed.`,
          `Every face must be clearly visible. No one blocked by another person.`,
        ].filter(Boolean).join('\n');
      }
    }

    // v3.0: Add recurring motifs for visual consistency
    let motifsBlock = '';
    if (storyAnchor?.recurringMotifs) {
      motifsBlock = `Visual motifs: ${storyAnchor.recurringMotifs}`;
    }

    // v5.1: For non-group scenes, reinforce "no groups" in the negative prompt
    // v14.2: Skip entirely for group stories (OTM) — the whole premise involves
    // a group of people. Individual scene types (character, object, atmosphere)
    // already have FOCUS instructions that guide single-subject framing.
    let negativePrompt = config.negative_prompt || '';
    const isGroupStory = !!storyAnchor?.isGroupStory;
    if (!isGroupStory && sceneType !== 'group') {
      negativePrompt = negativePrompt
        ? `${negativePrompt}\nABSOLUTELY NO: groups of people, crowds, multiple faces, multiple figures standing together.`
        : `ABSOLUTELY NO: groups of people, crowds, multiple faces, multiple figures standing together.`;
    }

    // v12.0 / v13.0: For illustration styles, explicitly reject photorealism in negative prompt
    // v13.0: Expanded blocklist — GPT-image-1 drifts toward sepia, oil painting, and
    // watercolor landscapes when prompts include "atmosphere" or "environment" scenes.
    if (isIllustrationStyle) {
      negativePrompt += '\nNEVER render as a photograph or photorealistic image. This must be a drawn/illustrated image with visible linework, ink, or cel-shading.';
      negativePrompt += '\nNO: sepia tones, oil painting, watercolor, painterly, soft blending, airbrushed, smooth gradients, bokeh, depth of field, lens flare, film still, DSLR, camera, natural lighting, studio lighting.';
    }

    // v8.1: Prevent "back of phone" issue — when scene involves device usage,
    // ensure the screen side faces the viewer and the device is held naturally
    const deviceMentioned = /\b(phone|smartphone|cell\s*phone|mobile|laptop|tablet|screen|recording|filming|posting|scrolling|texting)\b/i.test(sceneText);
    if (deviceMentioned) {
      negativePrompt += '\nNEVER show back of phone, back of device, phone rear camera facing viewer. Always show phone screen facing viewer, character looking at screen.';
    }

    // v14.1: For character/object close-ups, reduce environment to a brief hint.
    // gpt-image-1 at low quality renders the most visually concrete text — a full
    // environment description ("cabin in the mountains with crackling fire") dominates
    // over abstract subject instructions ("close-up of Mark's face").
    let environmentLine = `Environment: ${environment}`;
    if (sceneType === 'character' || sceneType === 'object') {
      // Extract just the core location name (first clause before commas/dashes)
      const briefEnv = environment.split(/[,—–]/)[0].trim();
      environmentLine = `Background hint: ${briefEnv}`;
    }

    // v14.1: Skip anchor characterBlock when visual cue describes a DIFFERENT named character.
    // The anchor describes the main character (e.g. "25-year-old woman") but visual cues
    // may focus on secondary characters (e.g. "Mark's face"). Sending both creates a
    // contradiction that causes gpt-image-1 to abandon the subject and render the environment.
    // v14.2: Also drop characterBlock when cue describes unnamed non-protagonist figures
    // (e.g. "the sixth person's shadowy figure", "a stranger in the doorway"). Without this,
    // the anchor's protagonist description gets applied to sinister/mysterious entities.
    let effectiveCharacterBlock = characterBlock;
    if (sceneType === 'character' && characterBlock && cueDescription) {
      // Check if the cue mentions a name that differs from the anchor description
      const cueNameMatch = cueDescription.match(/\b([A-Z][a-z]{2,})(?:'s|\s)/); 
      if (cueNameMatch) {
        const cueName = cueNameMatch[1].toLowerCase();
        const anchorLower = (storyAnchor?.characterDescription || '').toLowerCase();
        if (!anchorLower.includes(cueName)) {
          // Visual cue is about a different character — drop the anchor's description
          effectiveCharacterBlock = '';
        }
      } else {
        // No named character in the cue — check for non-protagonist indicators
        if (/\b(?:figure|stranger|shadow|silhouette|entity|presence|creature|shape|apparition)\b/i.test(cueDescription)) {
          // Non-protagonist entity words → drop anchor character
          effectiveCharacterBlock = '';
        } else if (/\b(?:unsettling|subtly off|subtly wrong|out of sync|uncanny|distorted|blending in|standing apart|slightly apart)\b/i.test(cueDescription)) {
          // Uncanny descriptors suggesting the OTM "extra" or a non-protagonist entity
          effectiveCharacterBlock = '';
        } else {
          // No indicators matched — check if the cue refers to a secondary character by role
          // (e.g. "the attendant", "the guide") while we know the protagonist's name.
          // Only drop when we can confirm the protagonist name is NOT in the cue.
          const protagonistMatch = (storyAnchor?.characterDescription || '').match(/^([A-Z][a-z]{2,})\b/);
          if (protagonistMatch) {
            const protName = protagonistMatch[1].toLowerCase();
            const cueLower = cueDescription.toLowerCase();
            if (!cueLower.includes(protName) && /\b(?:attendant|guide|driver|teacher|officer|bartender|clerk|worker|guard|waiter|nurse|doctor|priest|shopkeeper|captain|pilot|conductor)\b/i.test(cueDescription)) {
              effectiveCharacterBlock = '';
            }
          }
        }
      }
    }

    const parts = [
      sceneDescription,
      '',
      // v14.0: Skip Style line for illustration styles — styleFrontLoad already contains style_prompt
      isIllustrationStyle ? '' : `Style: ${config.style_prompt}`,
      environmentLine,
      `Mood: ${mood}, tension level ${tensionLevel}/10`,
      cameraAngle ? `Camera: ${cameraAngle}` : '',
      `Lighting: ${lighting}`,
      `Color: ${colorPalette}`,
      effectiveCharacterBlock,
      motifsBlock,
      keywordStr ? `Keywords: ${keywordStr}` : '',
      '',
      // v12.0: Reinforce illustration style at end to bookend the prompt
      isIllustrationStyle ? `REMINDER: This MUST be rendered as an illustration/drawing — NOT a photograph. Use ${artStyle} visual style throughout.` : '',
      negativePrompt,
      config.suffix,
    ].filter(Boolean);

    return parts.join('\n');
  }

  // === Legacy fallback (hardcoded maps) ===
  // v7.0 — Issue #7: Prefer DB art_styles registry over hardcoded templates
  let styleBase: string;
  let negativePromptSuffix = '';

  if (artStyleRow) {
    // DB registry available — use full prompt + negative from art_styles table
    styleBase = artStyleRow.base_prompt;
    if (artStyleRow.color_override) styleBase += ` Color palette: ${artStyleRow.color_override}.`;
    if (artStyleRow.technical_style) styleBase += ` Style: ${artStyleRow.technical_style}.`;
    negativePromptSuffix = artStyleRow.negative_prompt ? ` Avoid: ${artStyleRow.negative_prompt}.` : '';
  } else {
    // Final fallback — hardcoded style one-liners (kept for resilience if DB unavailable)
    const styleTemplates: Record<string, string> = {
      'cinematic-dark': 'Cinematic dark photography, moody desaturated colors, deep shadows, film grain, A24 horror aesthetic.',
      'analog-horror': 'Analog horror VHS aesthetic, heavy static, glitch artifacts, scanlines, found footage style.',
      'vhs-horror': 'Eerie horror photography with VHS tape degradation, warped distorted realism, analog video artifacts, grainy surveillance quality, chromatic aberration, found-footage documentary aesthetic.',
      'uncanny-illustrated': 'Editorial cartoon illustration, cel-shaded horror, bold black ink outlines, flat colors, uncanny faces.',
      'rnmort': 'Adult animated cartoon illustration in the style of Rick and Morty. Bold thick black outlines, flat cel-shaded coloring, exaggerated character proportions, large expressive eyes with dot pupils, vibrant saturated colors against dark moody backgrounds.',
      'manga-horror': 'Dark horror manga illustration in the style of Junji Ito. Heavy black ink linework, obsessive cross-hatching, extreme detail on faces and hands showing dread. High contrast monochrome with selective blood-red accents. Panel-like compositions, dramatic foreshortening, thick bold outlines, deep pure blacks.',
      'editorial-clean': 'Clean modern editorial photography, sharp focus, balanced neutral tones, documentary-style framing, everyday realism.',
      'surreal-contemplative': 'Surreal contemplative digital art, dreamlike atmospheric compositions, ethereal volumetric light, soft painterly edges.',
      'cinematic-contrast': 'High-contrast cinematic photography, bold dramatic compositions, vivid split-tone color grading, theatrical lighting.',
      'cinematic': 'Cinematic photography, dramatic compositions, balanced lighting, film-quality aesthetic.',
    };
    styleBase = styleTemplates[artStyle] || styleTemplates['cinematic'];
  }

  // Use visual cue description if available, else raw text
  const sceneDescription = visualCue?.description || sceneText.substring(0, 200);
  const cameraHint = visualCue?.camera ? ` Camera: ${visualCue.camera}.` : '';

  const envHints: Record<string, string> = {
    'forest': 'dark misty forest, twisted trees',
    'hallway': 'abandoned corridor, peeling walls',
    'attic': 'dusty attic, cobwebs, old furniture',
    'urban': 'empty city streets at night',
    'default': 'dramatic atmospheric environment',
  };
  const visualPreset = 'default'; // legacy default — DB config provides specific environments
  const envHint = envHints[visualPreset] || envHints['default'];

  const keywordStr = keywords.slice(0, 3).join(', ');
  return `${styleBase} Scene: ${sceneDescription}.${cameraHint} Environment: ${envHint}. Keywords: ${keywordStr}. Portrait orientation 9:16. No text, no words, no letters.${negativePromptSuffix}`;
}

// =====================================================
// ANIMATION POTENTIAL SCORING
// Scores a scene prompt for img2vid suitability based on motion keywords.
// Higher scores = more potential for visually interesting animation.
// =====================================================

/**
 * Score a scene prompt for animation potential.
 * Returns 0 if the scene has no motion keywords (static — better as Ken Burns).
 * Higher scores = better candidates for SVD/AnimateDiff animation.
 *
 * Categories scored:
 *   - Human motion: walking, running, turning, reaching, grabbing, gesturing
 *   - Vehicle motion: driving, car, truck, bicycle, motorcycle
 *   - Weather effects: rain, snow, wind, storm, fog, mist, clouds
 *   - Water/liquid: water, river, ocean, waves, dripping, flooding, pouring
 *   - Fire/smoke: fire, flames, burning, smoke, embers, candles, flickering
 *   - Nature motion: trees swaying, leaves falling, grass, branches
 *   - Camera motion: panning, tracking, dolly, following
 *   - Atmospheric: dust, particles, floating, drifting, swirling
 *   - Action/tension: chase, escape, fleeing, struggle, fight, crash
 */
function scoreAnimationPotential(prompt: string): { score: number; reasons: string[] } {
  if (!prompt) return { score: 0, reasons: ['no_prompt'] };
  const p = prompt.toLowerCase();
  let score = 0;
  const reasons: string[] = [];

  // ── Human motion (high value — SVD animates people well) ──
  const humanMotion = [
    'walk', 'walking', 'walks', 'run', 'running', 'runs', 'sprint',
    'turning', 'turns', 'reaching', 'reaches', 'grabbing', 'grabs',
    'gestur', 'waving', 'pointing', 'crawl', 'climbing', 'stumbl',
    'stagger', 'pacing', 'stepping', 'approach', 'retreat',
    'dancing', 'shaking', 'trembl', 'shiver', 'nod', 'breathing',
  ];
  const humanMatches = humanMotion.filter(k => p.includes(k));
  if (humanMatches.length > 0) {
    score += 3 + Math.min(humanMatches.length - 1, 2); // 3-5 pts
    reasons.push(`human_motion:${humanMatches.slice(0, 3).join(',')}`);
  }

  // ── Vehicle motion ──
  const vehicleMotion = [
    'car ', 'cars ', 'vehicle', 'truck', 'bus ', 'driving', 'driv',
    'motorcycle', 'bicycle', 'traffic', 'headlights moving',
  ];
  const vehicleMatches = vehicleMotion.filter(k => p.includes(k));
  if (vehicleMatches.length > 0) {
    score += 3;
    reasons.push(`vehicle:${vehicleMatches.slice(0, 2).join(',')}`);
  }

  // ── Weather effects (great for SVD — natural motion) ──
  const weather = [
    'rain', 'raining', 'snow', 'snowing', 'snowfall', 'snowflake',
    'wind', 'windy', 'storm', 'thunder', 'lightning',
    'fog ', 'foggy', 'mist', 'misty', 'haze', 'blizzard',
    'downpour', 'drizzle', 'sleet', 'hail',
  ];
  const weatherMatches = weather.filter(k => p.includes(k));
  if (weatherMatches.length > 0) {
    score += 4 + Math.min(weatherMatches.length - 1, 2); // 4-6 pts
    reasons.push(`weather:${weatherMatches.slice(0, 3).join(',')}`);
  }

  // ── Water/liquid ──
  const water = [
    'water', 'river', 'stream', 'ocean', 'sea ', 'lake',
    'wave', 'waves', 'dripping', 'drip', 'flooding', 'flood',
    'pouring', 'splash', 'puddle', 'ripple', 'current',
    'waterfall', 'fountain', 'rain',
  ];
  const waterMatches = water.filter(k => p.includes(k));
  if (waterMatches.length > 0) {
    score += 3 + Math.min(waterMatches.length - 1, 2);
    reasons.push(`water:${waterMatches.slice(0, 3).join(',')}`);
  }

  // ── Fire/smoke/light ──
  const fire = [
    'fire', 'flame', 'burning', 'burn', 'smoke', 'smoking',
    'ember', 'candle', 'flicker', 'torch', 'campfire',
    'glow', 'glowing', 'sparks', 'smolder',
  ];
  const fireMatches = fire.filter(k => p.includes(k));
  if (fireMatches.length > 0) {
    score += 4;
    reasons.push(`fire_smoke:${fireMatches.slice(0, 2).join(',')}`);
  }

  // ── Nature motion (trees, leaves, grass) ──
  const nature = [
    'sway', 'swaying', 'leaves falling', 'leaves blowing',
    'branches', 'rustling', 'grass moving', 'trees bending',
    'petals', 'blossoms', 'dandelion',
  ];
  const natureMatches = nature.filter(k => p.includes(k));
  if (natureMatches.length > 0) {
    score += 2;
    reasons.push(`nature:${natureMatches.slice(0, 2).join(',')}`);
  }

  // ── Atmospheric particles ──
  const atmospheric = [
    'dust', 'particles', 'floating', 'drifting', 'swirl',
    'rising', 'falling', 'descend', 'ascend', 'hover',
    'shimmer', 'sparkle', 'aurora', 'northern lights',
  ];
  const atmoMatches = atmospheric.filter(k => p.includes(k));
  if (atmoMatches.length > 0) {
    score += 2;
    reasons.push(`atmosphere:${atmoMatches.slice(0, 2).join(',')}`);
  }

  // ── Action/tension (climactic scenes) ──
  const action = [
    'chase', 'chasing', 'escape', 'escaping', 'flee', 'fleeing',
    'struggle', 'fight', 'crash', 'collision', 'explosion',
    'attack', 'lunge', 'leap', 'jump', 'falling', 'collapse',
  ];
  const actionMatches = action.filter(k => p.includes(k));
  if (actionMatches.length > 0) {
    score += 4;
    reasons.push(`action:${actionMatches.slice(0, 2).join(',')}`);
  }

  // ── Camera movement hints ──
  const cameraMotion = [
    'pan', 'panning', 'tracking shot', 'dolly', 'following',
    'sweeping', 'rotating', 'zoom', 'pull back', 'push in',
  ];
  const cameraMatches = cameraMotion.filter(k => p.includes(k));
  if (cameraMatches.length > 0) {
    score += 1;
    reasons.push(`camera:${cameraMatches.slice(0, 2).join(',')}`);
  }

  // ── Bonus: climax scenes (isClimax from visual cue extraction) ──
  if (p.includes('climax') || p.includes('reveal') || p.includes('final moment')) {
    score += 2;
    reasons.push('climax_bonus');
  }

  // ── Penalty: very static descriptions ──
  const staticIndicators = [
    'empty room', 'still life', 'photograph', 'portrait',
    'close-up of text', 'document', 'newspaper', 'letter',
    'static', 'motionless', 'frozen in place',
  ];
  const staticMatches = staticIndicators.filter(k => p.includes(k));
  if (staticMatches.length > 0 && score > 0) {
    score = Math.max(0, score - 2);
    reasons.push(`static_penalty:${staticMatches.slice(0, 2).join(',')}`);
  }

  if (reasons.length === 0) reasons.push('no_motion_keywords');
  return { score, reasons };
}

/**
 * Build a concise motion prompt for AnimateDiff from a scene's image prompt.
 * Extracts motion-relevant phrases (weather, human action, fire/smoke, water,
 * camera movement) and assembles them into a short, AnimateDiff-friendly prompt.
 * Falls back to a generic cinematic motion prompt if nothing specific is found.
 *
 * NOTE: This is the fast/free fallback. Prefer generateMotionPromptLLM() when
 * an OpenAI key is available — it handles arbitrary scene content (curtains,
 * paper, mouths, fabric, machinery, etc.) that no keyword list can enumerate.
 */
function buildMotionPrompt(scenePrompt: string): string {
  if (!scenePrompt) return '';
  const p = scenePrompt.toLowerCase();
  const motionPhrases: string[] = [];

  // ── Weather ──
  if (p.includes('rain') || p.includes('downpour') || p.includes('drizzle'))
    motionPhrases.push('rain pouring down with visible raindrops');
  if (p.includes('snow') || p.includes('snowfall') || p.includes('blizzard'))
    motionPhrases.push('snow falling gently');
  if (p.includes('storm') || p.includes('thunder') || p.includes('lightning'))
    motionPhrases.push('stormy atmosphere with lightning flashes');
  if (p.includes('wind') || p.includes('windy'))
    motionPhrases.push('wind blowing through the scene');
  if (p.includes('fog') || p.includes('mist') || p.includes('haze'))
    motionPhrases.push('fog drifting slowly');

  // ── Fire / smoke / light ──
  if (p.includes('fire') || p.includes('flame') || p.includes('burning') || p.includes('campfire'))
    motionPhrases.push('flickering flames and dancing fire light');
  if (p.includes('smoke') || p.includes('smoking') || p.includes('smolder'))
    motionPhrases.push('smoke rising and curling');
  if (p.includes('candle'))
    motionPhrases.push('candlelight flickering');
  if (p.includes('flicker') || p.includes('neon') || p.includes('sign'))
    motionPhrases.push('lights flickering on and off');
  if (p.includes('glow') || p.includes('sparks') || p.includes('ember'))
    motionPhrases.push('glowing embers and sparks drifting');

  // ── Water / liquid ──
  if (p.includes('river') || p.includes('stream') || p.includes('current'))
    motionPhrases.push('water flowing steadily');
  if (p.includes('ocean') || p.includes('sea ') || p.includes('wave'))
    motionPhrases.push('ocean waves rolling');
  if (p.includes('drip') || p.includes('puddle') || p.includes('ripple'))
    motionPhrases.push('water dripping with ripples');
  if (p.includes('waterfall') || p.includes('fountain'))
    motionPhrases.push('water cascading down');

  // ── Human motion ──
  if (p.includes('walk') || p.includes('pacing') || p.includes('approach'))
    motionPhrases.push('person walking slowly');
  if (p.includes('run') || p.includes('sprint') || p.includes('chase') || p.includes('flee'))
    motionPhrases.push('figure running with urgent motion');
  if (p.includes('trembl') || p.includes('shiver') || p.includes('shaking'))
    motionPhrases.push('subtle trembling movement');
  if (p.includes('crawl') || p.includes('climb'))
    motionPhrases.push('slow crawling movement');
  if (p.includes('turning') || p.includes('reaching') || p.includes('grabbing'))
    motionPhrases.push('figure reaching forward with deliberate motion');
  if (p.includes('breathing') || p.includes('nod'))
    motionPhrases.push('subtle breathing motion');

  // ── Vehicle ──
  if (p.includes('car') || p.includes('vehicle') || p.includes('truck') || p.includes('traffic') || p.includes('headlight'))
    motionPhrases.push('vehicle lights moving through the scene');

  // ── Nature ──
  if (p.includes('sway') || p.includes('branches') || p.includes('rustl') || p.includes('leaves'))
    motionPhrases.push('trees and branches swaying gently');
  if (p.includes('grass') || p.includes('field'))
    motionPhrases.push('grass moving in the wind');

  // ── Atmospheric particles ──
  if (p.includes('dust') || p.includes('particles') || p.includes('float'))
    motionPhrases.push('dust particles floating in the air');
  if (p.includes('shimmer') || p.includes('sparkle'))
    motionPhrases.push('shimmering light reflections');

  // ── Shadows / darkness (common in horror content) ──
  if (p.includes('shadow') || p.includes('silhouette'))
    motionPhrases.push('shadows shifting slowly');
  if (p.includes('dark') && (p.includes('corridor') || p.includes('hallway') || p.includes('room')))
    motionPhrases.push('subtle movement in the darkness');

  // ── Camera hints ──
  if (p.includes('pan') || p.includes('sweep'))
    motionPhrases.push('slow camera pan');
  if (p.includes('zoom') || p.includes('close-up') || p.includes('closeup'))
    motionPhrases.push('slow push-in camera movement');

  if (motionPhrases.length === 0) {
    // No specific motion detected — use atmospheric default
    return 'cinematic motion, slow atmospheric drift, subtle ambient movement';
  }

  // Cap at 4 phrases to keep the prompt focused (AnimateDiff works better with concise prompts)
  const selected = motionPhrases.slice(0, 4);
  return selected.join(', ') + ', cinematic';
}

/**
 * LLM-powered motion prompt generation.
 * Sends the scene description to GPT-4o-mini and asks it to describe
 * ONLY the physical motions that should be animated — not the scene itself.
 * Handles arbitrary content (curtains, mouths, paper, machinery, fabric, etc.)
 * that no hardcoded keyword list can cover.
 *
 * Falls back to buildMotionPrompt() if the LLM call fails or key is missing.
 *
 * @param scenePrompt - The image generation prompt describing the scene
 * @param openaiKey - OpenAI API key
 * @returns Motion prompt string for AnimateDiff
 */
async function generateMotionPromptLLM(scenePrompt: string, openaiKey: string): Promise<string> {
  if (!scenePrompt || !openaiKey) {
    return buildMotionPrompt(scenePrompt);
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 80,
        temperature: 0.4,
        messages: [
          {
            role: 'system',
            content: `You are a motion prompt writer for AnimateDiff video generation. Given a scene description, output ONLY a short motion prompt (max 20 words) describing ambient/atmospheric motion.

CRITICAL — AnimateDiff LIMITATIONS:
- AnimateDiff CANNOT move specific body parts (fingers, hands, arms, legs, mouth, eyes)
- AnimateDiff CANNOT do actions (walking, pointing, grabbing, writing, speaking)
- AnimateDiff CAN do: ambient particle motion (snow, rain, dust, smoke, fog, sparks)
- AnimateDiff CAN do: environmental sway (branches, grass, curtains, hair, fabric, water)
- AnimateDiff CAN do: lighting shifts (flickering, pulsing, shadow movement, light rays)
- AnimateDiff CAN do: camera motion (slow pan, gentle zoom, subtle drift, push-in)
- AnimateDiff CAN do: atmospheric effects (wind, clouds moving, fire, reflections)

RULES:
- NEVER suggest body part movements or human actions — they will fail
- Focus on 2-3 ambient/environmental motions the scene naturally has
- Use present participle verbs (falling, drifting, flickering, swaying, flowing)
- Include one camera hint if appropriate (slow pan, gentle zoom, static)
- Always end with "cinematic"
- Keep it concise — short focused prompts work best

EXAMPLES:
Scene: "A dark hallway with flickering fluorescent lights and a shadowy figure"
Motion: "lights flickering rapidly, shadows shifting on walls, slow push-in camera, cinematic"

Scene: "A woman sitting at a desk reading papers, window curtains behind her"
Motion: "curtains billowing gently, warm light shifting across desk, soft dust particles, cinematic"

Scene: "A snowy forest path with pine trees covered in snow"
Motion: "snowflakes drifting softly, pine branches swaying in wind, gentle camera drift, cinematic"

Scene: "An old man at a microphone in a dimly lit room with candles"
Motion: "candlelight flickering warmly, soft shadows dancing on walls, subtle camera zoom, cinematic"

Scene: "A person reading a book by a fireplace"
Motion: "fire crackling with dancing flames, warm light pulsing across pages, gentle smoke wisps, cinematic"

Output ONLY the motion prompt, nothing else.`,
          },
          {
            role: 'user',
            content: scenePrompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.warn(`[MOTION-LLM] GPT call failed: ${response.status} — falling back to keyword matching`);
      return buildMotionPrompt(scenePrompt);
    }

    const data = await response.json();
    const motionPrompt = data.choices?.[0]?.message?.content?.trim();

    if (!motionPrompt || motionPrompt.length < 5) {
      console.warn(`[MOTION-LLM] Empty response — falling back to keyword matching`);
      return buildMotionPrompt(scenePrompt);
    }

    // Ensure it ends with cinematic
    const final = motionPrompt.endsWith('cinematic')
      ? motionPrompt
      : motionPrompt.replace(/[,.\s]+$/, '') + ', cinematic';

    console.log(`[MOTION-LLM] Generated: "${final.slice(0, 120)}"`);
    return final;

  } catch (err) {
    console.warn(`[MOTION-LLM] Exception: ${err instanceof Error ? err.message : err} — falling back to keyword matching`);
    return buildMotionPrompt(scenePrompt);
  }
}

// =====================================================
// STEP 6b: IMAGE-TO-VIDEO GENERATION (Phase 2)
// Optional step: converts generated images into short video clips
// via local ComfyUI (SVD or AnimateDiff). Skipped when video_mode = 'static'.
// Smart scene selection: only animates the top ~30% of scenes based on
// animation potential scoring (motion keywords in prompts).
// =====================================================

export async function executeImg2VidStep(
  supabase: SupabaseClient,
  job: Job,
  workerId: string,
  env: Record<string, string>,
  logger: StepLogger,
  functionStartTime?: number
): Promise<StepResult> {
  // Resolve brand config to check video_mode
  const brandId = job.brand_id || job.meta?.brand_id as string || '';
  const vibePreset = job.meta?.vibe_preset as string || null;
  const imagePromptConfig = await getImagePromptConfigForJob(supabase, brandId, vibePreset, job.meta || {});

  const videoMode = (job.meta?.video_mode as string)
    || imagePromptConfig?.video_mode
    || 'static';

  // Skip entirely if video_mode is 'static' (default behavior — Ken Burns pans)
  if (videoMode !== 'img2vid') {
    console.log(`[IMG2VID] Skipping — video_mode=${videoMode} (not img2vid)`);
    await logger.snapshot('img2vid', 'result', { video_mode: videoMode, reason: 'static_mode' }, `Skipped: video_mode=${videoMode} (using Ken Burns pans)`);
    return { success: true, skipped: true, data: { video_mode: videoMode, reason: 'static_mode' } };
  }

  const img2vidWorkflow = (job.meta?.img2vid_workflow as string)
    || imagePromptConfig?.img2vid_workflow
    || 'img2vid_animatediff_ipa';
  const motionStrength = (job.meta?.img2vid_motion as number)
    || imagePromptConfig?.img2vid_motion
    || 0.5;
  const img2vidFps = imagePromptConfig?.img2vid_fps || 8;
  const img2vidFrames = imagePromptConfig?.img2vid_frames || 16;
  const img2vidMaxRatio = imagePromptConfig?.img2vid_max_ratio ?? 0.25; // v9.0: Reduced from 0.35 → 0.25 — animate fewer scenes but with higher quality
  // v8.2: Bumped from 512x768 → 640x960 — single biggest quality improvement.
  // 640x960 fits in 12GB VRAM with AnimateDiff+IPA and reduces upscale ratio (1.33x vs 1.67x).
  const img2vidRenderWidth = imagePromptConfig?.img2vid_render_width ?? 640;
  const img2vidRenderHeight = imagePromptConfig?.img2vid_render_height ?? 960;
  const img2vidOutputWidth = imagePromptConfig?.img2vid_output_width ?? 720;
  const img2vidOutputHeight = imagePromptConfig?.img2vid_output_height ?? 1280;

  console.log(`[IMG2VID] Starting — workflow=${img2vidWorkflow}, motion=${motionStrength}, fps=${img2vidFps}, frames=${img2vidFrames}, render=${img2vidRenderWidth}x${img2vidRenderHeight}, output=${img2vidOutputWidth}x${img2vidOutputHeight}, maxRatio=${img2vidMaxRatio}`);

  // Get the ComfyUI renderer URL (prefer dedicated COMFYUI_RENDERER_URL for local tunnel)
  const videoRendererUrl = env.COMFYUI_RENDERER_URL || env.VIDEO_RENDERER_URL || env.FFMPEG_RENDERER_URL;
  console.log(`[IMG2VID] Env check: COMFYUI_RENDERER_URL=${env.COMFYUI_RENDERER_URL ? 'SET' : 'UNSET'}, VIDEO_RENDERER_URL=${env.VIDEO_RENDERER_URL ? 'SET' : 'UNSET'}, using=${videoRendererUrl ? videoRendererUrl.slice(0, 50) : 'NONE'}`);
  if (!videoRendererUrl) {
    console.log(`[IMG2VID] No COMFYUI_RENDERER_URL/VIDEO_RENDERER_URL configured — skipping img2vid`);
    await logger.snapshot('img2vid', 'result', { reason: 'no_renderer_url' }, `Skipped: No ComfyUI renderer URL configured`);
    return { success: true, skipped: true, data: { reason: 'no_renderer_url' } };
  }

  // Free VRAM before health check — only on the FIRST img2vid invocation.
  // On continuation runs, SVD model may still be loaded from the previous invocation's dispatch;
  // calling /comfyui-free would kill any in-progress generation AND force a 1-2 min model reload.
  const stepMeta = (job.meta as Record<string,unknown>)?.steps 
    ? ((job.meta as Record<string,unknown>).steps as Record<string,unknown>)?.img2vid as Record<string,unknown> | undefined
    : undefined;
  const isContinuation = stepMeta?.meta && (stepMeta.meta as Record<string,unknown>)?.continuation_needed === true;
  const pendingDispatch = (job.meta as Record<string,unknown>)?.img2vid_pending_dispatch as { comfy_job_id: string; status_url: string; scene_index: number } | undefined;

  // Max-attempts guard — prevent infinite continuation cycling.
  // Each continuation increments `attempts` in the step meta. If we exceed the limit,
  // abort with a clear error instead of cycling workers forever.
  // NOTE: With 17 scenes each taking ~5 min and a 280s budget, we need ~25+ invocations.
  // Only count attempts where no progress (new clips) was made to detect true stalls.
  const currentAttempts = (stepMeta?.meta as Record<string,unknown>)?.attempts as number || 0;
  const MAX_IMG2VID_ATTEMPTS = 40;
  if (currentAttempts >= MAX_IMG2VID_ATTEMPTS) {
    console.log(`[IMG2VID] ❌ Max attempts (${MAX_IMG2VID_ATTEMPTS}) exceeded — aborting img2vid`);
    await logger.snapshot('img2vid', 'result', {
      reason: 'max_attempts_exceeded',
      attempts: currentAttempts,
    }, `Failed: exceeded ${MAX_IMG2VID_ATTEMPTS} continuation attempts`);
    return {
      success: false,
      error: `img2vid exceeded ${MAX_IMG2VID_ATTEMPTS} continuation attempts without completing`,
    };
  }

  // Free VRAM before health check — but NOT if there's a pending dispatch (in-flight generation).
  // On continuation WITHOUT pending dispatch: SVD model is idle, eating ~9GB VRAM.
  // Freeing it lets the health check pass so we can generate remaining clips.
  // On continuation WITH pending dispatch: SVD is actively generating — don't kill it.
  if (pendingDispatch) {
    console.log(`[IMG2VID] Pending dispatch for scene ${pendingDispatch.scene_index} — skipping VRAM free to protect in-flight generation`);
  } else {
    try {
      console.log(`[IMG2VID] Freeing VRAM (${isContinuation ? 'continuation, no pending dispatch' : 'first run'} — unloading idle models)...`);
      await fetch(`${videoRendererUrl}/comfyui-free`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unload_models: true, free_memory: true }),
      });
      // Wait for models to unload
      await new Promise(r => setTimeout(r, 3000));
    } catch (freeErr) {
      console.log(`[IMG2VID] VRAM free request failed (non-fatal): ${freeErr instanceof Error ? freeErr.message : freeErr}`);
    }
  }

  // Check img2vid health first (higher VRAM threshold)
  // BUT: skip VRAM check if we have a pending dispatch — SVD is actively generating
  // and will naturally free VRAM when done. Skipping here would abandon the in-flight clip.
  if (!pendingDispatch) {
    // v8.1: Retry health check up to 3 times with backoff before giving up.
    // Transient failures (tunnel briefly down during renderer restart) previously
    // caused the entire img2vid step to be skipped even when ComfyUI was healthy.
    const MAX_HEALTH_RETRIES = 3;
    const HEALTH_RETRY_DELAY_MS = 5000; // 5s between retries
    let healthPassed = false;
    let lastHealthError: string | null = null;

    for (let healthAttempt = 1; healthAttempt <= MAX_HEALTH_RETRIES; healthAttempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout for health check
        const healthResp = await fetch(`${videoRendererUrl}/comfyui-health`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (healthResp.ok) {
          const health = await healthResp.json();
          const vramFree = health.gpu_vram_free_mb || 0;
          const vramFloor = health.vram_floor_img2vid_mb || 4096;

          if (vramFree < vramFloor) {
            // On continuation with clips already generated, don't give up — request continuation to retry.
            // This prevents the step from being marked 'skipped' with only partial clips.
            const clipsSoFar = (stepMeta?.meta as Record<string,unknown>)?.clips_so_far as number || 0;
            if (isContinuation && clipsSoFar > 0) {
              console.log(`[IMG2VID] VRAM too low (${vramFree}MB < ${vramFloor}MB) but ${clipsSoFar} clips already generated — requesting continuation to retry later`);
              await logger.snapshot('img2vid', 'result', { reason: 'vram_low_retry', vram_free: vramFree, vram_floor: vramFloor, clips_so_far: clipsSoFar }, `VRAM low (${vramFree}MB) but ${clipsSoFar} clips exist — will retry`);
              return {
                success: true,
                continuation_needed: true,
                data: {
                  video_mode: videoMode,
                  completed: clipsSoFar,
                  total: 0,
                  skipped: 0,
                  failed: 0,
                  clips_so_far: clipsSoFar,
                  attempts: currentAttempts + 1,
                  pause_reason: 'vram_low_retry',
                },
              };
            }
            console.log(`[IMG2VID] VRAM too low for img2vid: ${vramFree}MB free < ${vramFloor}MB floor — skipping (static Ken Burns)`);
            await logger.snapshot('img2vid', 'result', { reason: 'vram_low', vram_free: vramFree, vram_floor: vramFloor }, `Skipped: VRAM ${vramFree}MB < ${vramFloor}MB floor`);
            return {
              success: true,
              skipped: true,
              data: { reason: 'vram_low', vram_free: vramFree, vram_floor: vramFloor },
            };
          }
          // Health check passed — VRAM is sufficient
          healthPassed = true;
          if (healthAttempt > 1) {
            console.log(`[IMG2VID] Health check passed on attempt ${healthAttempt}/${MAX_HEALTH_RETRIES}`);
          }
          break;
        } else {
          lastHealthError = `health_check_failed:${healthResp.status}`;
          console.log(`[IMG2VID] ComfyUI health check failed (${healthResp.status}) — attempt ${healthAttempt}/${MAX_HEALTH_RETRIES}`);
        }
      } catch (healthErr) {
        lastHealthError = `comfyui_offline:${healthErr instanceof Error ? healthErr.message : healthErr}`;
        console.log(`[IMG2VID] ComfyUI unreachable — attempt ${healthAttempt}/${MAX_HEALTH_RETRIES}: ${healthErr instanceof Error ? healthErr.message : healthErr}`);
      }

      // Wait before retrying (unless this was the last attempt)
      if (healthAttempt < MAX_HEALTH_RETRIES) {
        console.log(`[IMG2VID] Waiting ${HEALTH_RETRY_DELAY_MS}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, HEALTH_RETRY_DELAY_MS));
      }
    }

    if (!healthPassed) {
      const reason = lastHealthError?.startsWith('comfyui_offline') ? 'comfyui_offline' : 'health_check_failed';
      console.log(`[IMG2VID] All ${MAX_HEALTH_RETRIES} health check attempts failed (${lastHealthError}) — skipping img2vid`);
      await logger.snapshot('img2vid', 'result', { reason, details: lastHealthError, retries: MAX_HEALTH_RETRIES }, `Skipped: ${MAX_HEALTH_RETRIES} health check attempts all failed`);
      return { success: true, skipped: true, data: { reason, retries: MAX_HEALTH_RETRIES } };
    }
  } else {
    console.log(`[IMG2VID] Skipping health/VRAM check — pending dispatch exists for scene ${pendingDispatch.scene_index}, will poll its result first`);
  }

  // Get all generated image assets
  const imageAssets = await getAssetsByPrefix(supabase, job.id, `${job.id}:image_generate:`);
  if (imageAssets.length === 0) {
    console.log(`[IMG2VID] No image assets found — run images step first`);
    return { success: false, error: 'No image assets for img2vid — images step not complete' };
  }

  // Filter to primary scene images only (exclude sub-images)
  const primaryAssets = imageAssets.filter(a => !a.idempotency_key.includes('_sub_'));
  console.log(`[IMG2VID] Found ${imageAssets.length} image assets (${primaryAssets.length} primary scenes)`);

  // ── Smart Scene Selection: Only animate scenes with high animation potential ──
  // Score each scene based on motion keywords in its prompt, then select the top N%.
  // Scenes with people walking, vehicles moving, weather effects, water, fire, etc.
  // have much higher animation potential than static portraits or empty environments.
  const imageSequence = (job.meta as Record<string,unknown>)?.image_sequence as Array<{
    sceneIndex: number; prompt?: string; duration?: number;
  }> | undefined;

  // Check if we already computed the selection on a previous invocation (continuation)
  let selectedSceneIndices: Set<number>;
  const cachedSelection = (job.meta as Record<string,unknown>)?.img2vid_selected_scenes as number[] | undefined;

  if (cachedSelection) {
    selectedSceneIndices = new Set(cachedSelection);
    console.log(`[IMG2VID] Using cached scene selection: ${cachedSelection.length} scenes [${cachedSelection.join(', ')}]`);
  } else {
    // v9.1: AI-only scene selection — ONLY scenes the cinematographer AI explicitly
    // flagged with animate=true get animated. No keyword scoring fallback.
    // This ensures every animated scene was designed with animatable elements
    // baked into the prompt (rain, fog, flickering lights, etc.) rather than
    // retroactively guessing which static scenes might animate OK.
    
    // Build a map of AI animation intent from image_sequence
    const aiAnimateMap = new Map<number, { motionType?: string; animationHint?: string }>();
    if (imageSequence) {
      for (const entry of imageSequence) {
        if ((entry as Record<string, unknown>).animate === true) {
          aiAnimateMap.set(entry.sceneIndex, {
            motionType: (entry as Record<string, unknown>).motionType as string | undefined,
            animationHint: (entry as Record<string, unknown>).animationHint as string | undefined,
          });
        }
      }
    }
    console.log(`[IMG2VID] AI animation flags: ${aiAnimateMap.size} scenes flagged [${Array.from(aiAnimateMap.keys()).join(', ')}]`);
    
    // If AI didn't flag any scenes, skip img2vid entirely
    if (aiAnimateMap.size === 0) {
      console.log(`[IMG2VID] No AI-flagged scenes — skipping img2vid entirely`);
      await logger.snapshot('img2vid', 'result', { reason: 'no_ai_flagged_scenes' }, `Skipped: AI did not flag any scenes for animation`);
      return { success: true, skipped: true, data: { reason: 'no_ai_flagged_scenes' } };
    }

    // Select ONLY AI-flagged scenes — match them to primary assets
    const selected: Array<{ sceneIndex: number; aiAnimated: true; motionType?: string; animationHint?: string }> = [];
    for (const asset of primaryAssets) {
      const sceneMatch = asset.idempotency_key.match(/scene_(\d+)/);
      const sceneIdx = sceneMatch ? parseInt(sceneMatch[1]) : 0;
      const aiIntent = aiAnimateMap.get(sceneIdx);
      
      if (aiIntent) {
        selected.push({
          sceneIndex: sceneIdx,
          aiAnimated: true,
          motionType: aiIntent.motionType,
          animationHint: aiIntent.animationHint,
        });
      }
    }

    selectedSceneIndices = new Set(selected.map(s => s.sceneIndex));
    
    // Store per-scene animation metadata for dispatch (motionType → per-scene params)
    const sceneAnimationMeta: Record<number, { motionType?: string; animationHint?: string; aiAnimated: boolean }> = {};
    for (const s of selected) {
      sceneAnimationMeta[s.sceneIndex] = {
        motionType: s.motionType,
        animationHint: s.animationHint,
        aiAnimated: true,
      };
    }

    const totalScenes = primaryAssets.length;

    // Log results
    console.log(`[IMG2VID] AI-only selection: ${selected.length} scenes (no keyword fallback)`);
    for (const s of selected) {
      console.log(`[IMG2VID]   Scene ${s.sceneIndex}: ✓ AI-flagged 🎬 motionType=${s.motionType} hint="${(s.animationHint || '').slice(0, 80)}"`);
    }

    // Log the final distribution pattern (visual timeline)
    const timeline = Array.from({ length: totalScenes }, (_, i) =>
      selectedSceneIndices.has(i) ? '▓' : '░'
    ).join('');
    console.log(`[IMG2VID] Distribution: [${timeline}] (${selected.length}/${totalScenes} scenes, AI-only)`);

    // Cache selection + per-scene animation meta in job meta
    await updateJobMeta(supabase, job.id, {
      img2vid_selected_scenes: Array.from(selectedSceneIndices),
      img2vid_scene_scores: selected.map(s => ({ scene: s.sceneIndex, score: 'ai_flagged', aiAnimated: true, motionType: s.motionType })),
      img2vid_distribution: timeline,
      img2vid_scene_animation_meta: sceneAnimationMeta,
    });

    await logger.snapshot('img2vid', 'scene_selection', {
      total_primary_scenes: primaryAssets.length,
      selection_mode: 'ai_only',
      ai_flagged_count: aiAnimateMap.size,
      selected_count: selected.length,
      selected_scenes: selected.map(s => ({ scene: s.sceneIndex, motionType: s.motionType, animationHint: s.animationHint })),
      distribution: timeline,
    }, `Selected ${selected.length}/${primaryAssets.length} scenes for animation (AI-only, no keyword fallback)`);
  }

  await logger.snapshot('img2vid', 'config', {
    video_mode: videoMode,
    workflow: img2vidWorkflow,
    motion_strength: motionStrength,
    fps: img2vidFps,
    frames: img2vidFrames,
    render_resolution: `${img2vidRenderWidth}x${img2vidRenderHeight}`,
    output_resolution: `${img2vidOutputWidth}x${img2vidOutputHeight}`,
    total_scenes: primaryAssets.length,
    selected_scenes: selectedSceneIndices.size,
    max_ratio: img2vidMaxRatio,
  }, `img2vid starting: ${img2vidWorkflow}, ${selectedSceneIndices.size}/${primaryAssets.length} scenes, motion=${motionStrength}, ${img2vidRenderWidth}x${img2vidRenderHeight}→${img2vidOutputWidth}x${img2vidOutputHeight}`);

  let completed = 0;
  let skipped = 0;
  let failed = 0;
  const clipResults: Array<{ scene: number; url: string; duration: number }> = [];

  for (const asset of imageAssets) {
    // Parse scene index from asset key: "jobid:image_generate:scene_3"
    const sceneMatch = asset.idempotency_key.match(/scene_(\d+)/);
    const sceneIndex = sceneMatch ? parseInt(sceneMatch[1]) : 0;

    // Skip sub-images (scene_X_sub_Y) — only convert primary scene images
    if (asset.idempotency_key.includes('_sub_')) {
      console.log(`[IMG2VID] Skipping sub-image: ${asset.idempotency_key}`);
      skipped++;
      continue;
    }

    // Skip scenes not selected for animation (low motion potential)
    if (!selectedSceneIndices.has(sceneIndex)) {
      console.log(`[IMG2VID] Scene ${sceneIndex} not selected for animation — using Ken Burns`);
      skipped++;
      continue;
    }

    // Idempotency: check if this scene's video clip already exists
    const clipKey = `${job.id}:img2vid:scene_${sceneIndex}`;
    const existingClip = await getAssetByKey(supabase, job.id, clipKey);
    if (existingClip?.public_url) {
      console.log(`[IMG2VID] Scene ${sceneIndex} clip already exists: ${existingClip.public_url}`);
      clipResults.push({
        scene: sceneIndex,
        url: existingClip.public_url,
        duration: (existingClip.metadata as Record<string, unknown>)?.duration_seconds as number || 3,
      });
      completed++;
      continue;
    }

    // Storage fallback: the server uploads clips to Supabase storage even if the
    // edge function's poll timed out before creating the asset record. Use the
    // storage admin API (list) instead of public-URL HEAD — more reliable from
    // the edge-function Deno runtime which can struggle with public-URL fetches.
    const storageClipPath = `jobs/${job.id}/img2vid_scene_${sceneIndex}.mp4`;
    const storageClipFileName = `img2vid_scene_${sceneIndex}.mp4`;
    try {
      const { data: listData, error: listErr } = await supabase.storage
        .from('story-videos')
        .list(`jobs/${job.id}`, { limit: 200 });

      if (listErr) {
        console.log(`[IMG2VID] Storage list error: ${listErr.message}`);
      }

      const clipFile = listData?.find((f: { name: string }) => f.name === storageClipFileName);
      if (clipFile) {
        // Clip exists in storage — build public URL and create asset record
        const { data: pubUrlData } = supabase.storage
          .from('story-videos')
          .getPublicUrl(storageClipPath);
        const clipPublicUrl = pubUrlData?.publicUrl || '';

        console.log(`[IMG2VID] ✓ Scene ${sceneIndex} found in storage (orphaned clip) — recovering`);

        await upsertAsset(supabase, job.id, clipKey, 'img2vid_clip', storageClipPath, clipPublicUrl, {
          renderer: 'comfyui_img2vid',
          workflow: img2vidWorkflow,
          motion_strength: motionStrength,
          fps: img2vidFps,
          scene_index: sceneIndex,
          source_image_url: asset.public_url,
          recovered_from_storage: true,
        });

        clipResults.push({ scene: sceneIndex, url: clipPublicUrl, duration: 3 });
        completed++;
        // Clear pending dispatch if this was the pending scene
        if (pendingDispatch && pendingDispatch.scene_index === sceneIndex) {
          await updateJobMeta(supabase, job.id, { img2vid_pending_dispatch: null });
        }
        continue;
      } else {
        console.log(`[IMG2VID] Scene ${sceneIndex} not yet in storage (looked for ${storageClipFileName} among ${listData?.length || 0} files)`);
      }
    } catch (storageErr) {
      // Storage check failed (non-fatal) — proceed with normal dispatch/poll
      console.log(`[IMG2VID] Storage check for scene ${sceneIndex} error: ${storageErr instanceof Error ? storageErr.message : String(storageErr)}`);
    }

    if (!asset.public_url) {
      console.warn(`[IMG2VID] Scene ${sceneIndex} has no public_url — skipping`);
      skipped++;
      continue;
    }

    // Budget check: enough function time remaining?
    if (functionStartTime) {
      const elapsedMs = Date.now() - functionStartTime;
      const remainingMs = 280_000 - elapsedMs; // 280s budget
      if (remainingMs < 60_000) {
        console.log(`[IMG2VID] ⏰ Time budget exhausted (${Math.round(remainingMs / 1000)}s remaining) — requesting continuation for remaining ${imageAssets.length - completed - skipped - failed} scenes`);

        // Store partial progress in job meta before returning
        if (clipResults.length > 0) {
          const clipMap: Record<number, { url: string; duration: number }> = {};
          for (const clip of clipResults) {
            clipMap[clip.scene] = { url: clip.url, duration: clip.duration };
          }
          await updateJobMeta(supabase, job.id, { img2vid_clips: clipMap });
        }

        return {
          success: true,
          continuation_needed: true,
          data: {
            video_mode: videoMode,
            completed,
            total: imageAssets.length,
            skipped,
            failed,
            clips_so_far: clipResults.length,
            attempts: currentAttempts + 1,
          },
        };
      }
    }

    // Dispatch to /comfyui-img2vid — or resume polling a pending dispatch from a previous invocation
    let statusUrl: string;
    let comfyJobId: string;
    const hasPendingForThisScene = pendingDispatch && pendingDispatch.scene_index === sceneIndex;

    if (hasPendingForThisScene) {
      // Resume polling from the previous invocation's dispatch
      statusUrl = `${videoRendererUrl}${pendingDispatch!.status_url.replace(videoRendererUrl, '')}`;
      comfyJobId = pendingDispatch!.comfy_job_id;
      console.log(`[IMG2VID] Scene ${sceneIndex}: resuming poll for pending dispatch ${comfyJobId}`);
      await logger.progress('img2vid', completed + failed + skipped, imageAssets.length,
        `Scene ${sceneIndex}: resuming poll for pending dispatch ${comfyJobId}`, {
          scene_index: sceneIndex,
          comfy_job_id: comfyJobId,
          resumed: true,
        });
    } else {
      console.log(`[IMG2VID] Scene ${sceneIndex}: dispatching to ${videoRendererUrl}/comfyui-img2vid`);
      await logger.progress('img2vid', completed + failed + skipped, imageAssets.length,
        `Scene ${sceneIndex}: dispatching to ComfyUI (${img2vidWorkflow})`, {
          scene_index: sceneIndex,
          workflow: img2vidWorkflow,
          motion_strength: motionStrength,
          image_url: asset.public_url,
          status: 'dispatching',
        });
    }

    try {
      if (!hasPendingForThisScene) {
        // Build per-scene motion prompt (for AnimateDiff and CogVideoX workflows)
        const seqEntry = imageSequence?.find(e => e.sceneIndex === sceneIndex);
        const scenePrompt = seqEntry?.prompt
          || (asset.metadata as Record<string, unknown>)?.prompt as string
          || '';
        // Use LLM-generated prompt if OpenAI key is available, else fall back to keyword matching
        const openaiKey = env.OPENAI_API_KEY || '';
        const needsMotionPrompt = img2vidWorkflow.includes('animatediff') || img2vidWorkflow.includes('cogvideox');
        
        // v9.0: If AI provided an animationHint, use it directly as the motion prompt
        // (it's already written in AnimateDiff-friendly format by the cinematographer)
        const cachedAnimMeta = (job.meta as Record<string,unknown>)?.img2vid_scene_animation_meta as Record<number, { motionType?: string; animationHint?: string; aiAnimated: boolean }> | undefined;
        const sceneAnimMeta = cachedAnimMeta?.[sceneIndex];
        const aiAnimationHint = sceneAnimMeta?.animationHint;
        
        let motionPrompt: string | undefined;
        if (needsMotionPrompt) {
          if (aiAnimationHint) {
            // Use AI's animation hint directly — it was designed for this scene
            motionPrompt = aiAnimationHint.endsWith('cinematic')
              ? aiAnimationHint
              : aiAnimationHint.replace(/[,.\s]+$/, '') + ', cinematic';
            console.log(`[IMG2VID] Scene ${sceneIndex} using AI animation hint: "${motionPrompt.slice(0, 120)}"`);
          } else if (openaiKey) {
            motionPrompt = await generateMotionPromptLLM(scenePrompt, openaiKey);
          } else {
            motionPrompt = buildMotionPrompt(scenePrompt);
          }
        }
        
        // v9.0: Per-scene motion_strength based on motionType
        // Different motion types need different AnimateDiff parameter profiles:
        //   atmospheric (rain, snow, fog, dust) → moderate motion, higher denoise
        //   environmental (wind, water, swaying) → moderate-high motion
        //   fire_light (flames, flickering, neon) → lower motion to avoid warping, subtle shifts
        //   camera (slow pan, zoom, drift) → lowest motion, cleanest result
        const MOTION_TYPE_STRENGTH: Record<string, number> = {
          'atmospheric': 0.70,    // Rain/snow/fog need visible particle motion
          'environmental': 0.65,  // Trees swaying, water — moderate motion
          'fire_light': 0.55,     // Flames/flickering — subtle to avoid warping
          'camera': 0.45,         // Camera drift — minimal, clean motion
        };
        const sceneMotionType = sceneAnimMeta?.motionType;
        const perSceneMotionStrength = sceneMotionType
          ? MOTION_TYPE_STRENGTH[sceneMotionType] ?? motionStrength
          : motionStrength;
        
        // Score this scene for animation potential (for UI display)
        const { score: animScore, reasons: animReasons } = scoreAnimationPotential(scenePrompt);
        if (motionPrompt) {
          console.log(`[IMG2VID] Scene ${sceneIndex} motion prompt: "${motionPrompt.slice(0, 120)}" | score=${animScore} | motionType=${sceneMotionType || 'default'} | strength=${perSceneMotionStrength}`);
        }

        const dispatchResp = await fetch(`${videoRendererUrl}/comfyui-img2vid`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            job_id: job.id,
            scene_index: sceneIndex,
            image_url: asset.public_url,
            workflow: img2vidWorkflow,
            motion_strength: perSceneMotionStrength,
            fps: img2vidFps,
            video_frames: img2vidFrames,
            width: img2vidRenderWidth,
            height: img2vidRenderHeight,
            upscale_to_width: img2vidOutputWidth,
            upscale_to_height: img2vidOutputHeight,
            ...(motionPrompt ? { motion_prompt: motionPrompt } : {}),
          }),
        });

        if (!dispatchResp.ok) {
          const errBody = await dispatchResp.text();
          console.warn(`[IMG2VID] Scene ${sceneIndex} dispatch failed: ${dispatchResp.status} ${errBody.slice(0, 200)}`);
          // Check for VRAM fallback
          try {
            const errJson = JSON.parse(errBody);
            if (errJson.fallback_reason === 'vram_low' || errJson.fallback_reason === 'queue_full') {
              // Wait 45s + free VRAM before returning continuation to prevent rapid-fire loop.
              // Without this delay, each continuation immediately re-dispatches → gets queue_full
              // again → 7+ wasted invocations in 30s before VRAM check kills the step.
              const waitMs = 45_000;
              if (functionStartTime) {
                const fnElapsed = Date.now() - functionStartTime;
                const fnRemaining = 280_000 - fnElapsed;
                if (fnRemaining > waitMs + 30_000) {
                  console.log(`[IMG2VID] ${errJson.fallback_reason} — waiting ${waitMs/1000}s for resources to free (${Math.round(fnRemaining/1000)}s budget remaining)...`);
                  await new Promise(r => setTimeout(r, waitMs));
                  // Free VRAM before returning so next invocation has a clean slate
                  try {
                    await fetch(`${videoRendererUrl}/comfyui-free`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ unload_models: true, free_memory: true }),
                    });
                    await new Promise(r => setTimeout(r, 5_000));
                  } catch { /* ignore */ }
                } else {
                  console.log(`[IMG2VID] ${errJson.fallback_reason} — insufficient budget (${Math.round(fnRemaining/1000)}s) to wait, returning continuation immediately`);
                }
              }

              console.log(`[IMG2VID] GPU resource constraint (${errJson.fallback_reason}) — will retry remaining scenes on next invocation`);

              // Store partial progress before returning
              if (clipResults.length > 0) {
                const clipMap: Record<number, { url: string; duration: number }> = {};
                for (const clip of clipResults) {
                  clipMap[clip.scene] = { url: clip.url, duration: clip.duration };
                }
                await updateJobMeta(supabase, job.id, { img2vid_clips: clipMap });
              }

              await logger.snapshot('img2vid', 'result', {
                reason: errJson.fallback_reason,
                completed,
                failed,
                skipped,
                total: imageAssets.length,
              }, `img2vid paused: ${errJson.fallback_reason} after ${completed} clips, ${failed} failed — will continue`);

              return {
                success: true,
                continuation_needed: true,
                data: {
                  video_mode: videoMode,
                  completed,
                  total: imageAssets.length,
                  skipped,
                  failed,
                  clips_so_far: clipResults.length,
                  attempts: currentAttempts + 1,
                  pause_reason: errJson.fallback_reason,
                },
              };
            }
          } catch { /* non-JSON error */ }
          failed++;
          continue;
        }

        const dispatch = await dispatchResp.json();
        statusUrl = `${videoRendererUrl}${dispatch.status_url}`;
        comfyJobId = dispatch.comfy_job_id;
        console.log(`[IMG2VID] Scene ${sceneIndex}: ${comfyJobId}, estimated ${dispatch.estimated_seconds}s`);

        // Store pending dispatch info so a continuation can resume polling
        await updateJobMeta(supabase, job.id, {
          img2vid_pending_dispatch: {
            comfy_job_id: comfyJobId,
            status_url: dispatch.status_url,
            scene_index: sceneIndex,
          },
        });
      }

      // Poll for completion — SVD needs ~1-2 min model load + 2-4 min generation on 4070 Ti.
      // Cap poll timeout to fit within the edge function's wall_clock_budget (280s).
      // If we don't, Supabase kills the edge function mid-poll with no cleanup.
      const pollStart = Date.now();
      const elapsedSoFar = functionStartTime ? Date.now() - functionStartTime : 0;
      const budgetRemainingMs = 280_000 - elapsedSoFar;
      const pollTimeout = Math.min(420_000, Math.max(budgetRemainingMs - 15_000, 30_000)); // leave 15s buffer for cleanup, min 30s
      let clipDone = false;
      let consecutiveNotFound = 0; // track 404s from server (means server restarted, job state lost)

      while (Date.now() - pollStart < pollTimeout) {
        await new Promise(r => setTimeout(r, 5000)); // 5s poll interval (video gen is slow)

        try {
          const statusResp = await fetch(statusUrl);

          // Server restarted — in-memory job tracking lost. Check storage directly
          // instead of polling forever.
          if (statusResp.status === 404) {
            consecutiveNotFound++;
            console.log(`[IMG2VID] Scene ${sceneIndex}: status 404 (server restarted?) — attempt ${consecutiveNotFound}/3`);
            if (consecutiveNotFound >= 3) {
              // Server doesn't know about this job anymore. Check if clip landed in storage.
              console.log(`[IMG2VID] Scene ${sceneIndex}: 3x 404 — checking storage for completed clip`);
              try {
                const { data: recoveryList, error: recoveryErr } = await supabase.storage
                  .from('story-videos')
                  .list(`jobs/${job.id}`, { limit: 200 });
                const recoveredClip = recoveryList?.find((f: { name: string }) => f.name === `img2vid_scene_${sceneIndex}.mp4`);
                if (recoveredClip) {
                  const { data: recPubUrl } = supabase.storage.from('story-videos').getPublicUrl(storageClipPath);
                  const recoveredUrl = recPubUrl?.publicUrl || '';
                  console.log(`[IMG2VID] ✓ Scene ${sceneIndex}: recovered from storage after 404 — ${recoveredUrl}`);
                  await upsertAsset(supabase, job.id, clipKey, 'img2vid_clip', storageClipPath, recoveredUrl, {
                    renderer: 'comfyui_img2vid',
                    workflow: img2vidWorkflow,
                    motion_strength: motionStrength,
                    fps: img2vidFps,
                    scene_index: sceneIndex,
                    source_image_url: asset.public_url,
                    recovered_from_storage: true,
                    recovery_reason: 'server_404',
                  });
                  clipResults.push({ scene: sceneIndex, url: recoveredUrl, duration: 3 });
                  completed++;
                  clipDone = true;
                  break;
                } else {
                  console.log(`[IMG2VID] Scene ${sceneIndex}: not in storage yet (${recoveryList?.length || 0} files). Server lost job and clip not uploaded.`);
                  // Clip lost — server restarted before upload completed
                  failed++;
                  clipDone = true;
                  break;
                }
              } catch (recoveryErr) {
                console.log(`[IMG2VID] Scene ${sceneIndex}: storage recovery check failed: ${recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr)}`);
                failed++;
                clipDone = true;
                break;
              }
            }
            continue;
          }

          if (!statusResp.ok) continue;
          const status = await statusResp.json() as Record<string, unknown>;

          // Extract real-time progress info from video-renderer
          const genProgress = status.generation_progress as Record<string, unknown> | undefined;
          const stage = (status.stage as string) || 'running';
          const stageDetail = (status.stage_detail as string) || '';
          const progressStep = genProgress?.step as number || 0;
          const progressMax = genProgress?.max_steps as number || 0;
          const progressPct = genProgress?.percentage as number || 0;

          const progressSummary = progressMax > 0
            ? `step ${progressStep}/${progressMax} (${progressPct}%)`
            : stage;
          console.log(`[IMG2VID] Scene ${sceneIndex}: ${status.status} | ${stage} | ${progressSummary}`);

          // Write real-time progress to step logger so the UI can display it
          // Only write every ~15 seconds to avoid excessive DB writes  
          const pollElapsed = Date.now() - pollStart;
          if (pollElapsed > 0 && Math.floor(pollElapsed / 15_000) !== Math.floor((pollElapsed - 5000) / 15_000)) {
            await logger.progress('img2vid', completed + failed + skipped, imageAssets.length,
              `Scene ${sceneIndex}: ${stageDetail || stage}${progressMax > 0 ? ` — ${progressPct}%` : ''}`, {
                scene_index: sceneIndex,
                stage,
                status: 'rendering',
                progress_step: progressStep,
                progress_max: progressMax,
                progress_pct: progressPct,
                comfy_job_id: comfyJobId,
                elapsed_ms: pollElapsed,
                ...(typeof motionPrompt !== 'undefined' && motionPrompt ? { motion_prompt: motionPrompt } : {}),
                ...(typeof animScore !== 'undefined' ? { animation_score: animScore } : {}),
              });
          }

          if (status.status === 'complete') {
            // Store the video clip as an asset
            // video_url may be absolute (Supabase storage URL) or relative — handle both
            const rawVideoUrl = status.video_url as string;
            const clipFullUrl = rawVideoUrl.startsWith('http') ? rawVideoUrl : `${videoRendererUrl}${rawVideoUrl}`;
            // Gather per-clip motion prompt & animation score (available from dispatch block above)
            // For pending dispatches (resumed), these will be undefined — that's OK.
            const clipMotionPrompt = typeof motionPrompt !== 'undefined' ? motionPrompt : undefined;
            const clipAnimScore = typeof animScore !== 'undefined' ? animScore : undefined;
            const clipAnimReasons = typeof animReasons !== 'undefined' ? animReasons : undefined;
            await upsertAsset(supabase, job.id, clipKey, 'img2vid_clip', '', clipFullUrl, {
              renderer: 'comfyui_img2vid',
              workflow: img2vidWorkflow,
              motion_strength: motionStrength,
              duration_seconds: status.video_duration_seconds as number,
              frame_count: status.frame_count as number,
              fps: img2vidFps,
              scene_index: sceneIndex,
              source_image_url: asset.public_url,
              generation_time_ms: (status.metadata as Record<string, unknown>)?.generation_time_ms,
              comfyui_prompt_id: (status.metadata as Record<string, unknown>)?.comfyui_prompt_id,
              ...(clipMotionPrompt ? { motion_prompt: clipMotionPrompt } : {}),
              ...(clipAnimScore !== undefined ? { animation_score: clipAnimScore, animation_reasons: clipAnimReasons } : {}),
            });

            clipResults.push({
              scene: sceneIndex,
              url: clipFullUrl,
              duration: status.video_duration_seconds as number,
            });
            completed++;
            clipDone = true;
            // Progress bar for img2vid clips
            const i2vPct = Math.round(((completed + failed + skipped) / imageAssets.length) * 100);
            const i2vFilled = Math.round(i2vPct / 4);
            const i2vBar = '█'.repeat(i2vFilled) + '░'.repeat(25 - i2vFilled);
            console.log(`[IMG2VID] ${i2vPct}% |${i2vBar}| ${completed + failed + skipped}/${imageAssets.length} ✓ Scene ${sceneIndex}: ${status.video_duration_seconds}s clip`);
            await logger.progress('img2vid', completed + failed + skipped, imageAssets.length,
              `✓ Scene ${sceneIndex}: ${status.video_duration_seconds}s clip (${status.frame_count || '?'} frames)`, {
                scene_index: sceneIndex,
                duration_seconds: status.video_duration_seconds as number,
                frame_count: status.frame_count as number,
                generation_time_ms: (status.metadata as Record<string, unknown>)?.generation_time_ms,
              });
            break;
          }

          if (status.status === 'error') {
            const statusErrors = status.errors as Array<Record<string, unknown>> | undefined;
            const errMsg = statusErrors?.[0]?.error as string || 'unknown';
            console.warn(`[IMG2VID] Scene ${sceneIndex} failed: ${errMsg}`);
            failed++;
            clipDone = true;
            await logger.progress('img2vid', completed + failed + skipped, imageAssets.length,
              `✕ Scene ${sceneIndex} failed: ${errMsg}`, {
                scene_index: sceneIndex,
                error: errMsg,
              });
            break;
          }
        } catch (pollErr) {
          // Network error during poll — continue trying
        }
      }

      if (!clipDone) {
        // Clip is likely still generating on ComfyUI — don't mark as failed.
        // Instead, return continuation_needed so the next invocation can resume polling.
        console.log(`[IMG2VID] Scene ${sceneIndex} still processing after ${Math.round(pollTimeout / 1000)}s — returning for continuation (dispatch ${comfyJobId} still pending)`);
        await logger.progress('img2vid', completed + failed + skipped, imageAssets.length,
          `⏳ Scene ${sceneIndex} still processing after ${Math.round(pollTimeout / 1000)}s — will resume on next invocation`, {
            scene_index: sceneIndex,
            comfy_job_id: comfyJobId,
            poll_seconds: Math.round(pollTimeout / 1000),
            reason: 'budget_exhausted',
          });

        // Store partial progress before returning
        if (clipResults.length > 0) {
          const clipMap: Record<number, { url: string; duration: number }> = {};
          for (const clip of clipResults) {
            clipMap[clip.scene] = { url: clip.url, duration: clip.duration };
          }
          await updateJobMeta(supabase, job.id, { img2vid_clips: clipMap });
        }

        return {
          success: true,
          continuation_needed: true,
          data: {
            video_mode: videoMode,
            completed,
            total: imageAssets.length,
            skipped,
            failed,
            clips_so_far: clipResults.length,
            pending_scene: sceneIndex,
            pending_comfy_job_id: comfyJobId,
            attempts: currentAttempts + 1,
          },
        };
      }

      // Clip completed (or errored) — clear the pending dispatch
      await updateJobMeta(supabase, job.id, { img2vid_pending_dispatch: null });

    } catch (dispatchErr) {
      const dispatchErrMsg = dispatchErr instanceof Error ? dispatchErr.message : String(dispatchErr);
      console.error(`[IMG2VID] Scene ${sceneIndex} dispatch error: ${dispatchErrMsg}`);
      failed++;
      await logger.progress('img2vid', completed + failed + skipped, imageAssets.length,
        `✕ Scene ${sceneIndex} dispatch error: ${dispatchErrMsg}`, {
          scene_index: sceneIndex,
          error: dispatchErrMsg,
        });
    }
  }

  // Store clip mapping in job meta so the assemble step knows which scenes have video clips
  if (clipResults.length > 0) {
    const clipMap: Record<number, { url: string; duration: number }> = {};
    for (const clip of clipResults) {
      clipMap[clip.scene] = { url: clip.url, duration: clip.duration };
    }
    await updateJobMeta(supabase, job.id, { img2vid_clips: clipMap });
  }

  // Build distribution timeline for final result (may come from cache if continuation)
  const finalDistribution = (job.meta as Record<string,unknown>)?.img2vid_distribution as string ||
    Array.from({ length: primaryAssets.length }, (_, i) =>
      selectedSceneIndices.has(i) ? '▓' : '░'
    ).join('');

  // Log summary via StepLogger
  await logger.snapshot('img2vid', 'result', {
    video_mode: videoMode,
    workflow: img2vidWorkflow,
    motion_strength: motionStrength,
    total_scenes: imageAssets.length,
    completed,
    skipped,
    failed,
    clips: clipResults.length,
    distribution: finalDistribution,
    selected_scenes: Array.from(selectedSceneIndices),
  }, `img2vid: ${completed} clips, ${failed} failed, ${skipped} skipped`);

  console.log(`[IMG2VID] Summary: ${completed} clips generated, ${failed} failed, ${skipped} skipped`);

  // img2vid failures are non-fatal — scenes without clips use Ken Burns fallback
  return {
    success: true,
    data: {
      video_mode: videoMode,
      clips_generated: completed,
      clips_failed: failed,
      clips_skipped: skipped,
    },
  };
}

// =====================================================
// STEP 7: SUBTITLE GENERATION
// =====================================================

export async function executeSubtitlesStep(
  supabase: SupabaseClient,
  job: Job,
  workerId: string,
  env: Record<string, string>,
  logger: StepLogger
): Promise<StepResult> {
  const idempotencyKey = `${job.id}:subtitle_generation`;

  // Check if already done
  const existingAsset = await getAssetByKey(supabase, job.id, idempotencyKey);
  if (existingAsset?.public_url) {
    console.log(`[SUBTITLES] Already generated: ${existingAsset.public_url}`);
    return { success: true, skipped: true, data: { subtitle_url: existingAsset.public_url } };
  }

  // Get subtitle cues from scene data or audio timestamps
  let subtitleCues: Array<{ start: number; end: number; text: string }> = [];

  // First try audio timestamps (most accurate)
  if (job.meta?.audio_timestamps) {
    // audio_timestamps uses { word, start, end } — map .word → .text for SRT format
    const rawTimestamps = job.meta.audio_timestamps as Array<{ word: string; start: number; end: number }>;
    subtitleCues = rawTimestamps.map(t => ({ start: t.start, end: t.end, text: t.word }));
  } else {
    // Fall back to scene data
    const sceneAsset = await getAssetByKey(supabase, job.id, `${job.id}:scenes_subtitles`);
    if (sceneAsset?.meta?.subtitle_cues) {
      subtitleCues = sceneAsset.meta.subtitle_cues as typeof subtitleCues;
    }
  }

  if (subtitleCues.length === 0) {
    console.log(`[SUBTITLES] No subtitle cues available, skipping`);
    return { success: true, skipped: true, data: { reason: 'no_cues' } };
  }

  console.log(`[SUBTITLES] Generating SRT from ${subtitleCues.length} cues`);

  try {
    // Generate SRT content
    let srtContent = '';
    for (let i = 0; i < subtitleCues.length; i++) {
      const cue = subtitleCues[i];
      const startTime = formatSrtTime(cue.start);
      const endTime = formatSrtTime(cue.end);
      srtContent += `${i + 1}\n${startTime} --> ${endTime}\n${cue.text}\n\n`;
    }

    // Upload to storage (using standardized path)
    const storagePath = pathForSubtitles(job.brand_id, job.id);
    const publicUrl = await uploadToStorage(
      supabase,
      STORAGE_BUCKET,
      storagePath,
      srtContent,
      'text/srt'
    );

    // Store asset
    await upsertAsset(supabase, job.id, idempotencyKey, 'subtitles', storagePath, publicUrl, {
      cue_count: subtitleCues.length,
      format: 'srt',
    });

    // Update job meta
    await updateJobMeta(supabase, job.id, {
      subtitle_url: publicUrl,
    });

    console.log(`[SUBTITLES] ✓ Generated SRT with ${subtitleCues.length} cues`);
    return { success: true, data: { subtitle_url: publicUrl, cue_count: subtitleCues.length } };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[SUBTITLES] ✗ Failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * Format seconds to SRT timestamp (HH:MM:SS,mmm)
 */
function formatSrtTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${millis.toString().padStart(3, '0')}`;
}

// =====================================================
// STEP 8: VIDEO ASSEMBLY
// =====================================================

export async function executeAssembleStep(
  supabase: SupabaseClient,
  job: Job,
  workerId: string,
  env: Record<string, string>,
  logger: StepLogger,
  functionStartTime?: number
): Promise<StepResult> {
  const idempotencyKey = `${job.id}:video_assemble`;

  // Check if already done (asset table)
  const existingAsset = await getAssetByKey(supabase, job.id, idempotencyKey);
  if (existingAsset?.public_url) {
    console.log(`[ASSEMBLE] Already assembled: ${existingAsset.public_url}`);
    return { success: true, skipped: true, data: { video_url: existingAsset.public_url } };
  }

  // Check if the renderer already wrote video_url directly to the job record.
  // This handles the case where a continuation self-invoke failed/timed out but
  // the renderer completed in the background and wrote the URL to the jobs table.
  // Without this check, the job can get stuck on "assemble" even though the video
  // is fully rendered and available.
  if (job.video_url) {
    console.log(`[ASSEMBLE] ✓ Video already rendered (renderer wrote video_url directly): ${job.video_url}`);
    // Store as asset so subsequent checks (upload step, future retries) find it
    await upsertAsset(supabase, job.id, idempotencyKey, 'final_mp4', '', job.video_url, {
      source: 'renderer_direct_write',
      recovered: true,
    });
    return { success: true, data: { video_url: job.video_url } };
  }

  // Support both VIDEO_RENDERER_URL and FFMPEG_RENDERER_URL (run-job uses FFMPEG_RENDERER_URL)
  const videoRendererUrl = env.VIDEO_RENDERER_URL || env.FFMPEG_RENDERER_URL;
  const creatomateKey = env.CREATOMATE_API_KEY;

  console.log(`[ASSEMBLE] Env check: VIDEO_RENDERER_URL=${env.VIDEO_RENDERER_URL ? 'SET' : 'UNSET'}, FFMPEG_RENDERER_URL=${env.FFMPEG_RENDERER_URL ? 'SET' : 'UNSET'}, CREATOMATE_API_KEY=${creatomateKey ? 'SET' : 'UNSET'}`);
  console.log(`[ASSEMBLE] Will use: ${videoRendererUrl ? 'FFmpeg @ ' + videoRendererUrl : (creatomateKey ? 'Creatomate' : 'NONE!')}`);

  // Check if there's a pending render job from a previous continuation
  // The renderer uses its own UUID (not our job.id), so we store it in meta
  const pendingRenderJobId = job.meta?.pending_render_job_id as string | undefined;
  const renderContinuationCount = (job.meta?.render_continuation_count as number) || 0;
  const MAX_RENDER_CONTINUATIONS = 20; // Fail after this many continuation loops (~60min total)
  console.log(`[ASSEMBLE] Render resume check: pending_render_job_id=${pendingRenderJobId || 'NOT_SET'}, video_url=${job.video_url || 'NOT_SET'}, continuations=${renderContinuationCount}/${MAX_RENDER_CONTINUATIONS}`);

  // Fail-safe: prevent infinite continuation loops when renderer is stuck
  if (renderContinuationCount >= MAX_RENDER_CONTINUATIONS) {
    console.error(`[ASSEMBLE] ❌ Max render continuations (${MAX_RENDER_CONTINUATIONS}) exceeded — render is stuck. Failing job.`);
    await updateJobMeta(supabase, job.id, { pending_render_job_id: null, render_continuation_count: 0 });
    return { success: false, error: `Render stuck: exceeded ${MAX_RENDER_CONTINUATIONS} continuation attempts (~${MAX_RENDER_CONTINUATIONS * 3}min). Possible renderer hang.` };
  }

  // Log diagnostic snapshot for resume tracking
  await logger.snapshot('assemble', 'payload', {
    render_resume_check: true,
    pending_render_job_id: pendingRenderJobId || null,
    has_video_url: !!job.video_url,
    has_renderer_url: !!videoRendererUrl,
  }, pendingRenderJobId ? `Resuming render ${pendingRenderJobId}` : 'No pending render, starting fresh');

  if (videoRendererUrl && pendingRenderJobId) {
    try {
      const statusResponse = await fetch(`${videoRendererUrl}/status/${pendingRenderJobId}`);
      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        console.log(`[ASSEMBLE] Found pending render ${pendingRenderJobId}: status=${statusData.status}, progress=${statusData.progress || 0}%`);
        
        if (statusData.status === 'complete' || statusData.status === 'succeeded') {
          const videoUrl = statusData.supabase_url || (statusData.url ? `${videoRendererUrl}${statusData.url}` : null);
          if (videoUrl) {
            // v9.1: Log scene_sources from renderer
            const sceneSrcs = statusData.scene_sources as string[] | undefined;
            if (sceneSrcs && Array.isArray(sceneSrcs)) {
              const img2vidUsed = sceneSrcs.filter((s: string) => s === 'img2vid').length;
              const fallbackCount = sceneSrcs.filter((s: string) => s === 'kenburns-fallback').length;
              console.log(`[ASSEMBLE] 📊 Scene sources (resumed): ${img2vidUsed} img2vid, ${fallbackCount} fallback, ${sceneSrcs.length - img2vidUsed - fallbackCount} kenburns`);
            }
            console.log(`[ASSEMBLE] ✓ Render completed from previous invocation: ${videoUrl}`);
            
            // Clear pending render from meta + reset continuation counter
            await updateJobMeta(supabase, job.id, { pending_render_job_id: null, render_continuation_count: 0 });
            
            // Store asset
            await upsertAsset(supabase, job.id, idempotencyKey, 'final_mp4', '', videoUrl, {
              source: 'resumed_render_job',
              image_count: 0,
              duration: 0,
              assembly_method: 'video-renderer',
            });
            
            return { success: true, data: { video_url: videoUrl } };
          }
        } else if (statusData.status === 'processing' || statusData.status === 'queued') {
          // Render still in progress — poll with budget-aware timeout
          console.log(`[ASSEMBLE] Resuming polling for render ${pendingRenderJobId}`);
          
          // Calculate poll budget (same as assembleWithRenderer)
          let resumePollMs = 150_000; // default
          if (functionStartTime) {
            const elapsedMs = Date.now() - functionStartTime;
            const remainingMs = WALL_CLOCK_BUDGET_MS - elapsedMs;
            resumePollMs = Math.min(180_000, Math.max(5_000, Math.floor(remainingMs * 0.7)));
            console.log(`[ASSEMBLE] Resume poll budget: ${Math.round(resumePollMs / 1000)}s (${Math.round(remainingMs / 1000)}s remaining)`);
          }
          
          const pollStart = Date.now();
          let renderCompleted = false;
          
          while (Date.now() - pollStart < resumePollMs) {
            await new Promise(r => setTimeout(r, 5000));
            try {
              const pollResp = await fetch(`${videoRendererUrl}/status/${pendingRenderJobId}`);
              if (!pollResp.ok) continue;
              const pollData = await pollResp.json();
              console.log(`[ASSEMBLE] Resume poll: ${pollData.status}, progress: ${pollData.progress || 0}%`);
              
              if (pollData.status === 'complete' || pollData.status === 'succeeded') {
                const videoUrl = pollData.supabase_url || (pollData.url ? `${videoRendererUrl}${pollData.url}` : null);
                if (videoUrl) {
                  // v9.1: Log scene_sources
                  const sceneSrcs = pollData.scene_sources as string[] | undefined;
                  if (sceneSrcs && Array.isArray(sceneSrcs)) {
                    const img2vidUsed = sceneSrcs.filter((s: string) => s === 'img2vid').length;
                    const fallbackCount = sceneSrcs.filter((s: string) => s === 'kenburns-fallback').length;
                    console.log(`[ASSEMBLE] 📊 Scene sources (poll resume): ${img2vidUsed} img2vid, ${fallbackCount} fallback`);
                  }
                  console.log(`[ASSEMBLE] ✓ Render completed: ${videoUrl}`);
                  await updateJobMeta(supabase, job.id, { pending_render_job_id: null, render_continuation_count: 0 });
                  await upsertAsset(supabase, job.id, idempotencyKey, 'final_mp4', '', videoUrl, {
                    source: 'resumed_render_job',
                    image_count: 0,
                    duration: 0,
                    assembly_method: 'video-renderer',
                  });
                  return { success: true, data: { video_url: videoUrl } };
                }
              }
              if (pollData.status === 'failed') {
                console.log(`[ASSEMBLE] Previous render failed: ${pollData.error}`);
                renderCompleted = true; // Don't return continuation, let it start fresh
                break;
              }
            } catch { /* continue polling */ }
          }
          
          // If not completed and not failed, fire continuation again (keep same render ID)
          if (!renderCompleted) {
            console.log(`[ASSEMBLE] ⏰ Render ${pendingRenderJobId} still in progress — re-firing continuation (attempt ${renderContinuationCount + 1}/${MAX_RENDER_CONTINUATIONS})`);
            // Increment continuation counter to prevent infinite loops
            await updateJobMeta(supabase, job.id, { render_continuation_count: renderContinuationCount + 1 });
            return {
              success: true,
              continuation_needed: true,
              data: {
                render_job_id: pendingRenderJobId,
                reason: 'render_still_in_progress',
                completed: 'rendering',
                total: 'waiting'
              }
            };
          }
        }
        // If failed or unknown status, fall through to start new render
        console.log(`[ASSEMBLE] Previous render ${pendingRenderJobId} status=${statusData.status}, starting fresh`);
      } else {
        console.log(`[ASSEMBLE] Previous render ${pendingRenderJobId} not found (${statusResponse.status}), starting fresh`);
      }
    } catch (checkError) {
      console.log(`[ASSEMBLE] Failed to check pending render ${pendingRenderJobId}: ${checkError}`);
    }
    // Clear stale pending render before starting fresh
    await updateJobMeta(supabase, job.id, { pending_render_job_id: null });
  }

  // Also try the legacy check using job.id (in case renderer uses it as render ID)
  if (videoRendererUrl && !pendingRenderJobId) {
    try {
      const statusResponse = await fetch(`${videoRendererUrl}/status/${job.id}`);
      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        console.log(`[ASSEMBLE] Found existing render by job.id: status=${statusData.status}, progress=${statusData.progress || 0}%`);
        
        if (statusData.status === 'complete' || statusData.status === 'succeeded') {
          const videoUrl = statusData.supabase_url || (statusData.url ? `${videoRendererUrl}${statusData.url}` : null);
          if (videoUrl) {
            console.log(`[ASSEMBLE] ✓ Using existing completed render: ${videoUrl}`);
            await upsertAsset(supabase, job.id, idempotencyKey, 'final_mp4', '', videoUrl, {
              source: 'existing_render_job',
              image_count: 0,
              duration: 0,
              assembly_method: 'video-renderer',
            });
            return { success: true, data: { video_url: videoUrl } };
          }
        } else if (statusData.status === 'processing' || statusData.status === 'queued') {
          console.log(`[ASSEMBLE] Resuming polling for in-progress render job`);
          const videoUrl = await pollRendererForCompletion(videoRendererUrl, job.id);
          await upsertAsset(supabase, job.id, idempotencyKey, 'final_mp4', '', videoUrl, {
            source: 'resumed_render_job',
            image_count: 0,
            duration: 0,
            assembly_method: 'video-renderer',
          });
          return { success: true, data: { video_url: videoUrl } };
        }
      }
    } catch (checkError) {
      console.log(`[ASSEMBLE] No existing render job found, starting fresh`);
    }
  }

  // Gather required assets
  const audioAsset = await getAssetByKey(supabase, job.id, `${job.id}:voice_synthesis`);
  if (!audioAsset?.public_url) {
    return { success: false, error: 'No audio asset found - run voice step first' };
  }

  // =====================================================
  // GAMEPLAY MODE: Use background video instead of images
  // =====================================================
  const isGameplayMode = job.meta?.gameplay_mode === true;
  let imageUrls: string[] = [];
  // Map scene_number → first array index in imageUrls (for img2vid clip key remapping)
  let sceneToArrayIndex: Record<string, number> = {};

  if (isGameplayMode) {
    console.log(`[ASSEMBLE] 🎮 Gameplay mode: using background video instead of images`);
    // No image assets needed — the renderer will use background_video_url
  } else {
    const imageAssets = await getAssetsByPrefix(supabase, job.id, `${job.id}:image_generate:`);
    if (imageAssets.length === 0) {
      return { success: false, error: 'No image assets found - run images step first' };
    }

    // Parse scene_X or scene_X_sub_Y from idempotency key
    // e.g. "jobid:image_generate:scene_3" → sceneIdx=3, subIdx=0
    // e.g. "jobid:image_generate:scene_3_sub_1" → sceneIdx=3, subIdx=1
    const parseSceneKey = (key: string) => {
      const part = key.split('scene_')[1] || '0';
      const segments = part.split('_sub_');
      return {
        scene: parseInt(segments[0]) || 0,
        sub: segments.length > 1 ? parseInt(segments[1]) || 0 : 0,
      };
    };

    const sortedImageAssets = imageAssets.sort((a, b) => {
      const ak = parseSceneKey(a.idempotency_key);
      const bk = parseSceneKey(b.idempotency_key);
      return ak.scene !== bk.scene ? ak.scene - bk.scene : ak.sub - bk.sub;
    });

    imageUrls = sortedImageAssets.map(a => a.public_url).filter(Boolean) as string[];

    // Build scene_number → array_index mapping for img2vid clip key remapping.
    // img2vid clips are stored keyed by scene_number, but the renderer uses
    // array index (0, 1, 2...). Sub-images cause these to diverge.
    let filteredIdx = 0;
    for (const asset of sortedImageAssets) {
      if (!asset.public_url) continue; // matches filter(Boolean) above
      const { scene, sub } = parseSceneKey(asset.idempotency_key);
      // Map each scene's primary image (sub=0) to its array index
      if (sub === 0) {
        sceneToArrayIndex[String(scene)] = filteredIdx;
      }
      filteredIdx++;
    }
  }

  const audioUrl = audioAsset.public_url;
  
  // Use AUDIO duration as the authoritative timeline for image sync.
  // The voice narration defines how long the video actually is — images must sync to it.
  // Fallback to meta.duration only if audio_duration_ms is unavailable.
  const audioDurationMs = job.meta?.audio_duration_ms as number | undefined;
  let duration: number;
  if (audioDurationMs && audioDurationMs > 0) {
    // Use precise float seconds — Math.round() was causing normalization to
    // inflate/deflate all scene durations, creating cumulative image-narration drift.
    duration = parseFloat((audioDurationMs / 1000).toFixed(2));
    console.log(`[ASSEMBLE] Using audio duration as timeline: ${duration}s (from audio_duration_ms=${audioDurationMs})`);
  } else {
    const rawDuration = job.meta?.duration;
    if (typeof rawDuration === 'number') {
      duration = rawDuration;
    } else if (rawDuration && typeof rawDuration === 'object') {
      const durObj = rawDuration as { minSeconds?: number; maxSeconds?: number };
      const minSec = durObj.minSeconds || 60;
      const maxSec = durObj.maxSeconds || 90;
      duration = Math.round((minSec + maxSec) / 2);
    } else {
      duration = 60; // Default
    }
    console.log(`[ASSEMBLE] No audio_duration_ms, using meta.duration: ${duration}s`);
  }

  console.log(`[ASSEMBLE] Assembling video: ${imageUrls.length} images, ${duration}s duration`);

  // Determine which renderer service we'll use for cost tracking
  const rendererService: ServiceType = videoRendererUrl ? 'ffmpeg_renderer' : 'creatomate';

  try {
    let videoUrl: string;
    let effectsConfig: Record<string, unknown> | null = null; // Declared here for post-assembly snapshot access

    // === LEASE GRACE CHECK: Verify enough time before expensive rendering ===
    await requireLeaseGrace(supabase, job.id, workerId, 'video assembly');

    // === COST CONTROL: Check budget + acquire slot before rendering ===
    const costHelper = new CostControlHelper(supabase, job.id, workerId);
    try {
      await assertCanSpend(costHelper, rendererService, 'assemble', 1);
    } catch (costError) {
      if (isCostLimitError(costError)) {
        const costMsg = costError instanceof Error ? costError.message : String(costError);
        console.error(`[ASSEMBLE] ❌ Cost limit hit: ${costMsg}`);

        // Concurrent slot exhaustion is temporary contention — requeue like renderer busy
        if (/max concurrent|concurrent slots/i.test(costMsg)) {
          console.log(`[ASSEMBLE] 🔄 Concurrent slot full — requeue for next cycle`);
          return {
            success: false,
            requeue: true,
            error: `cost_limit_exceeded: ${rendererService} - ${costMsg}`,
          };
        }

        // Actual budget/daily limit — permanent, needs operator action
        return { 
          success: false, 
          error: `cost_limit_exceeded: ${rendererService} - ${costMsg}`,
          data: { 
            duration,
            cost_limit_hit: true,
            failure_class: 'misconfig'
          }
        };
      }
      throw costError;
    }

    // Prefer VIDEO_RENDERER_URL if available
    if (videoRendererUrl) {
      console.log(`[ASSEMBLE] Using video-renderer at ${videoRendererUrl}`);
      
      // Build music config for renderer from job.meta (set by music step)
      const musicUrl = job.meta?.music_url as string || null;
      const musicCfg = job.meta?.music_config as MusicConfig | undefined;
      const musicEnabled = job.meta?.music_enabled !== false && !!musicUrl;

      // v4.0: Resolve effects_config from DB (Roadmap #15 — Controlled Motion)
      try {
        effectsConfig = await getEffectsConfigForJob(
          supabase,
          job.brand_id,
          job.vibe_preset,
          job.meta
        );
      } catch (fxErr) {
        console.warn(`[ASSEMBLE] getEffectsConfigForJob failed (soft): ${fxErr instanceof Error ? fxErr.message : fxErr}`);
        // Soft failure: renderer will fall back to legacy pipeline
      }

      // v6.0: Resolve subtitle_config from DB (Roadmap #14 — Subtitle System v1)
      let subtitleConfig: SubtitleConfig | null = null;
      try {
        subtitleConfig = await getSubtitleConfigForJob(
          supabase,
          job.brand_id,
          job.vibe_preset,
          job.meta
        );
      } catch (subErr) {
        console.warn(`[ASSEMBLE] getSubtitleConfigForJob failed (soft): ${subErr instanceof Error ? subErr.message : subErr}`);
        // Soft failure: renderer will use hardcoded bold defaults
      }

      // v8.2: Log img2vid clip status in meta BEFORE assembly
      const metaClips = job.meta?.img2vid_clips as Record<string, unknown> | undefined;
      const metaClipKeys = metaClips ? Object.keys(metaClips) : [];
      console.log(`[ASSEMBLE] img2vid clips in job.meta: ${metaClipKeys.length > 0 ? `${metaClipKeys.length} clips, keys=[${metaClipKeys.join(',')}]` : 'NONE'}`);

      // Snapshot the assembly input before rendering
      await logger.snapshot('assemble', 'payload', {
        renderer: 'ffmpeg',
        renderer_url: videoRendererUrl?.slice(0, 80),
        gameplay_mode: isGameplayMode,
        gameplay_clip: isGameplayMode ? job.meta?.gameplay_clip_name : undefined,
        gameplay_offset: isGameplayMode ? job.meta?.gameplay_clip_offset : undefined,
        image_count: imageUrls.length,
        audio_url: audioUrl.slice(0, 100),
        duration: duration,
        has_music: musicEnabled,
        music_url: musicUrl ? musicUrl.slice(0, 80) : null,
        music_track: job.meta?.music_track_id || null,
        music_volume: musicCfg?.default_volume || 0.18,
        ducking_enabled: musicCfg?.ducking?.enabled || false,
        effects_config_resolved: !!effectsConfig,
        effects_config: effectsConfig || null,
        effects_enabled: effectsConfig?.enabled ?? 'legacy',
        effects_intensity: effectsConfig?.intensity ?? null,
        overlay_video_configured: !!(effectsConfig as Record<string, unknown>)?.overlay_video &&
          (effectsConfig as Record<string, unknown> & { overlay_video: { enabled?: boolean } }).overlay_video?.enabled === true,
        overlay_video_url: (effectsConfig as Record<string, unknown> & { overlay_video?: { url?: string } })?.overlay_video?.url?.slice(0, 80) || null,
        subtitle_config_resolved: !!subtitleConfig,
        subtitle_style: subtitleConfig?.style ?? 'bold',
        // v8.2: img2vid clip diagnostics
        img2vid_clips_in_meta: metaClipKeys.length,
        img2vid_clip_keys: metaClipKeys,
      }, isGameplayMode ? `Gameplay video assembly: ${job.meta?.gameplay_clip_name}` : 'Video assembly input');

      videoUrl = await assembleWithRenderer(
        videoRendererUrl,
        job.id,
        imageUrls,
        audioUrl,
        duration,
        job.meta,
        effectsConfig as Record<string, unknown> | null,
        functionStartTime,
        supabase,
        workerId,
        subtitleConfig as Record<string, unknown> | null,
        sceneToArrayIndex,
      );
      
      // Handle continuation signal — render still in progress, need re-invocation
      if (videoUrl.startsWith('__CONTINUATION__:')) {
        const renderJobId = videoUrl.split(':')[1];
        console.log(`[ASSEMBLE] Render in progress (${renderJobId}), storing in meta for resume (attempt ${renderContinuationCount + 1}/${MAX_RENDER_CONTINUATIONS})`);
        
        // Store the renderer's job ID + increment continuation counter
        await updateJobMeta(supabase, job.id, {
          pending_render_job_id: renderJobId,
          render_continuation_count: renderContinuationCount + 1,
        });
        
        await costHelper.releaseSlot(rendererService, 'assemble');
        return {
          success: true,
          continuation_needed: true,
          data: {
            render_job_id: renderJobId,
            reason: 'render_in_progress',
            completed: 'rendering',
            total: 'waiting'
          }
        };
      }
    } else if (creatomateKey) {
      console.log(`[ASSEMBLE] Using Creatomate`);
      videoUrl = await assembleWithCreatomate(
        creatomateKey,
        job.id,
        imageUrls,
        audioUrl,
        duration,
        job.meta
      );
    } else {
      return { success: false, error: 'No video assembly service configured (CREATOMATE_API_KEY or VIDEO_RENDERER_URL)' };
    }

    // Store asset
    await upsertAsset(supabase, job.id, idempotencyKey, 'final_mp4', '', videoUrl, {
      image_count: imageUrls.length,
      duration: duration,
      assembly_method: videoRendererUrl ? 'video-renderer' : 'creatomate',
    });

    // === COST CONTROL: Record usage + release slot ===
    const costIdempotencyKey = `job:${job.id}:${rendererService}:assemble`;
    // Estimate: ~$0.02 per minute of video rendered
    const estimatedCostCents = Math.round((duration / 60) * 2);
    await costHelper.recordUsage(
      rendererService,
      costIdempotencyKey,
      { 
        render_seconds: duration, 
        estimated_cost_cents: estimatedCostCents
      },
      'assemble',
      'assemble'
    );
    await costHelper.releaseSlot(rendererService, 'assemble');

    // Snapshot assembly output — include overlay pipeline details
    const overlayConfig = (effectsConfig as Record<string, unknown>)?.overlay_video as { enabled?: boolean; url?: string; opacity?: number; display_name?: string } | undefined;
    await logger.snapshot('assemble', 'output', {
      video_url: videoUrl.slice(0, 200),
      method: videoRendererUrl ? 'ffmpeg' : 'creatomate',
      image_count: imageUrls.length,
      duration: duration,
      overlay_pipeline: {
        configured: !!(overlayConfig?.enabled && overlayConfig?.url),
        source_url: overlayConfig?.url?.slice(0, 120) || null,
        source_file: overlayConfig?.display_name || overlayConfig?.url?.split('/').pop() || null,
        opacity: overlayConfig?.opacity || null,
        blend_mode: overlayConfig?.enabled ? 'screen' : null,
      },
    }, 'Final video assembled');

    console.log(`[ASSEMBLE] ✓ Video assembled: ${videoUrl}`);
    return { success: true, data: { video_url: videoUrl } };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[ASSEMBLE] ✗ Failed: ${errorMsg}`);
    
    // Detect renderer-busy failures — signal for re-queue instead of hard fail
    const isRendererBusy = errorMsg.includes('503') || errorMsg.includes('Server busy') || errorMsg.includes('all render attempts failed');
    if (isRendererBusy) {
      console.log(`[ASSEMBLE] Renderer busy — requesting re-queue for next scheduler cycle`);
      return { 
        success: false, 
        error: errorMsg,
        requeue: true,
      };
    }
    
    return { success: false, error: errorMsg };
  }
}

/**
 * Assemble video using video-renderer service (FFmpeg)
 * The renderer is async - we start a job, then poll for completion
 * 
 * NOTE: Edge Functions have a ~2 min timeout. We poll for max 90 seconds,
 * leaving time for other steps and cleanup. If rendering takes longer,
 * the job can be retried and will skip to checking the render job status.
 */
async function assembleWithRenderer(
  rendererUrl: string,
  jobId: string,
  imageUrls: string[],
  audioUrl: string,
  duration: number,
  meta: Record<string, unknown>,
  effectsConfig: Record<string, unknown> | null = null,
  functionStartTime?: number,
  supabaseClient?: SupabaseClient,
  workerId?: string,
  subtitleConfig: Record<string, unknown> | null = null,
  sceneToArrayIndex: Record<string, number> = {},
): Promise<string> {
  // ======================================================================
  // PER-SCENE DURATIONS + MOOD LEVELS (Improvements #1, #2, #4)
  // Use the image_sequence manifest from the images step instead of
  // uniform distribution. Falls back to equal distribution if not available.
  // ======================================================================
  const imageSequence = meta?.image_sequence as ImageSequenceEntry[] | undefined;
  let durations: number[];
  let moodLevels: number[];
  
  if (imageSequence && Array.isArray(imageSequence) && imageSequence.length === imageUrls.length) {
    // Use voice-aligned, word-proportional durations from the images step
    durations = imageSequence.map(e => e.duration);
    moodLevels = imageSequence.map(e => e.moodLevel);
    
    // Ensure durations sum to total duration.
    // IMPORTANT: Only adjust the LAST scene to absorb drift, NOT scale all scenes.
    // Scaling all scenes proportionally shifts every scene boundary away from its
    // voice-aligned position, causing cumulative image-narration desync ("image drift").
    const durSum = durations.reduce((s, d) => s + d, 0);
    const driftSeconds = durSum - duration; // positive = sum too long, negative = too short
    const absDrift = Math.abs(driftSeconds);
    if (absDrift > 0.05) {
      // Absorb drift by adjusting the last scene only — preserves all other scene boundaries
      const lastIdx = durations.length - 1;
      const adjusted = parseFloat((durations[lastIdx] - driftSeconds).toFixed(3));
      if (adjusted >= 1.0) {
        durations[lastIdx] = adjusted;
        console.log(`[ASSEMBLE] Absorbed ${driftSeconds.toFixed(2)}s drift into last scene: ${durations[lastIdx]}s`);
      } else {
        // Last scene would be too short — split adjustment across last 3 scenes
        const sharers = Math.min(3, durations.length);
        const perScene = driftSeconds / sharers;
        for (let si = durations.length - sharers; si < durations.length; si++) {
          durations[si] = parseFloat((durations[si] - perScene).toFixed(3));
        }
        console.log(`[ASSEMBLE] Spread ${driftSeconds.toFixed(2)}s drift across last ${sharers} scenes`);
      }
    } else {
      console.log(`[ASSEMBLE] Duration drift ${absDrift.toFixed(2)}s within tolerance — no adjustment needed`);
    }

    // FLOOR ENFORCEMENT: Ensure no scene is shorter than 1s.
    // Voice alignment deliberately creates short scenes for brief phrases.
    // A 2s floor was inflating these, pushing all subsequent images late ("image drift").
    // 1s is the minimum perceptible duration — anything shorter gets boosted.
    const MIN_SCENE_DURATION = 1.0;
    let needsRebalance = durations.some(d => d < MIN_SCENE_DURATION);
    if (needsRebalance) {
      // Pass 1: Identify short scenes and total deficit
      let totalDeficit = 0;
      for (let i = 0; i < durations.length; i++) {
        if (durations[i] < MIN_SCENE_DURATION) {
          const deficit = MIN_SCENE_DURATION - durations[i];
          console.log(`[ASSEMBLE] Scene ${i} duration ${durations[i].toFixed(3)}s below ${MIN_SCENE_DURATION}s floor — boosting by ${deficit.toFixed(3)}s`);
          totalDeficit += deficit;
          durations[i] = MIN_SCENE_DURATION;
        }
      }
      // Pass 2: Steal proportionally from ALL scenes above the minimum.
      // Each donor gives time relative to its share of the "donatable" pool.
      // This avoids wrecking any single scene.
      if (totalDeficit > 0) {
        const donors = durations
          .map((d, i) => ({ i, surplus: d - MIN_SCENE_DURATION }))
          .filter(x => x.surplus > 0);
        const donorPool = donors.reduce((s, x) => s + x.surplus, 0);

        if (donorPool >= totalDeficit) {
          // Enough surplus — steal proportionally
          for (const donor of donors) {
            const share = (donor.surplus / donorPool) * totalDeficit;
            durations[donor.i] = parseFloat((durations[donor.i] - share).toFixed(3));
          }
        } else {
          // Not enough surplus — flatten to equal distribution
          const total = durations.reduce((s, d) => s + d, 0);
          const avg = total / durations.length;
          durations = durations.map(() => parseFloat(avg.toFixed(3)));
          console.log(`[ASSEMBLE] Rebalance fallback: all scenes set to ${avg.toFixed(2)}s`);
        }
      }
      console.log(`[ASSEMBLE] After floor enforcement: (${durations.map(d => d.toFixed(1)).join(',')})s`);
    }
    
    console.log(`[ASSEMBLE] Using image_sequence: ${durations.length} images with per-scene durations (${durations.map(d => d.toFixed(1)).join(',')}s) and mood_levels (${moodLevels.join(',')})`);
  } else {
    // Fallback: equal distribution (legacy behavior)
    const sceneDuration = duration / imageUrls.length;
    durations = imageUrls.map(() => sceneDuration);
    moodLevels = []; // Let renderer use defaults
    console.log(`[ASSEMBLE] Fallback: equal distribution ${sceneDuration.toFixed(1)}s × ${imageUrls.length} images (no image_sequence in meta)`);
  }

  // Get word-level timestamps for captions (from voice synthesis step)
  const captions = Array.isArray(meta?.audio_timestamps) ? meta.audio_timestamps : [];
  console.log(`[ASSEMBLE] Sending ${captions.length} word timestamps for captions`);

  // Build music config for renderer (from music step)
  const musicUrl = meta?.music_url as string || null;
  const musicCfg = meta?.music_config as {
    default_volume?: number;
    ducking?: { enabled?: boolean; duck_volume?: number; attack_ms?: number; release_ms?: number };
    fade?: { in_ms?: number; out_ms?: number };
  } | undefined;
  
  // Convert volume from 0-1 float to 0-100 percentage for renderer
  const musicVolumePercent = musicCfg ? Math.round(musicCfg.default_volume! * 100) : 15;

  console.log(`[ASSEMBLE] Music: ${musicUrl ? 'YES' : 'NO'}, volume=${musicVolumePercent}%, ducking=${musicCfg?.ducking?.enabled || false}`);

  // When Controlled Motion is active (effects_config.enabled=true), the legacy
  // individual-effect passes (vignette, horrorGrade, filmGrain) are handled by the
  // CM filter chain.  Send them as false from the worker so they never fire — even
  // if the renderer's CM block fails to enter (e.g. null effectsConfig, build error).
  // Ken Burns & fades stay true because both pipelines use them via mergedEffects.
  const cmActive = effectsConfig?.enabled === true;
  console.log(`[ASSEMBLE] Effects pipeline: cmActive=${cmActive}, effectsConfig=${effectsConfig ? `enabled=${effectsConfig.enabled}` : 'null'}`);
  console.log(`[ASSEMBLE] Subtitle config: ${subtitleConfig ? `style=${subtitleConfig.style}, position=${subtitleConfig.position}` : 'null (using renderer defaults)'}`);

  // Build the render payload once (used for initial + retry)
  // Detect gameplay mode from job meta
  const gameplayMode = meta?.gameplay_mode === true;
  const gameplayClipUrl = meta?.gameplay_clip_url as string | undefined;
  const gameplayClipOffset = meta?.gameplay_clip_offset as number | undefined;

  // Phase 2: img2vid clips — map of scene_number → { url, duration }
  // When present, the renderer uses video clips instead of static images + Ken Burns.
  // ISSUE #8 FIX: Clips are stored keyed by scene_number (e.g. "3", "7", "12"),
  // but the renderer looks up by array index (0, 1, 2...). Sub-images cause
  // these to diverge. Remap keys here before sending to renderer.
  const rawImg2vidClips = meta?.img2vid_clips as Record<string, { url: string; duration: number }> | undefined;
  const hasImg2VidClips = rawImg2vidClips && Object.keys(rawImg2vidClips).length > 0;
  let remappedImg2vidClips: Record<string, { url: string; duration: number }> | undefined;
  console.log(`[ASSEMBLE] img2vid_clips raw check: typeof=${typeof rawImg2vidClips}, hasClips=${hasImg2VidClips}, keys=${rawImg2vidClips ? Object.keys(rawImg2vidClips).join(',') : 'N/A'}`);
  if (hasImg2VidClips) {
    console.log(`[ASSEMBLE] img2vid clips found for ${Object.keys(rawImg2vidClips!).length} scene(s): keys=[${Object.keys(rawImg2vidClips!).join(',')}]`);
    // Remap clip keys from scene_number → array_index
    if (Object.keys(sceneToArrayIndex).length > 0) {
      remappedImg2vidClips = {};
      for (const [sceneNum, clipData] of Object.entries(rawImg2vidClips!)) {
        const arrayIdx = sceneToArrayIndex[sceneNum];
        if (arrayIdx !== undefined) {
          remappedImg2vidClips[String(arrayIdx)] = clipData;
          console.log(`[ASSEMBLE] Remapped img2vid clip: scene_${sceneNum} → array_index ${arrayIdx}`);
        } else {
          console.warn(`[ASSEMBLE] ⚠ img2vid clip for scene_${sceneNum} has no matching image asset — skipped`);
        }
      }
      if (Object.keys(remappedImg2vidClips).length === 0) {
        remappedImg2vidClips = undefined;
        console.warn(`[ASSEMBLE] ⚠ All img2vid clips failed to remap — none will be used`);
      } else {
        console.log(`[ASSEMBLE] ✓ Remapped ${Object.keys(remappedImg2vidClips).length} img2vid clip(s) to array indices`);
      }
    } else {
      // Gameplay or no image assets — pass raw clips (scene_number keys match as-is)
      remappedImg2vidClips = rawImg2vidClips;
    }
  }

  const renderPayload = JSON.stringify({
    job_id: jobId,
    images: gameplayMode ? [] : imageUrls,
    audio_url: audioUrl,
    durations: gameplayMode ? [] : durations,
    audio_duration: duration, // Total audio duration in seconds — used by renderer for gameplay trim
    captions: captions,
    // Gameplay: background video instead of images
    background_video_url: gameplayMode ? gameplayClipUrl : undefined,
    background_video_offset: gameplayMode ? (gameplayClipOffset || 0) : undefined,
    // Phase 2: img2vid clips — renderer replaces Ken Burns with video for these scenes
    // Keys are now array indices (remapped from scene_numbers by Issue #8 fix)
    img2vid_clips: remappedImg2vidClips || undefined,
    _img2vid_debug: {
      raw_keys: rawImg2vidClips ? Object.keys(rawImg2vidClips) : [],
      remapped_keys: remappedImg2vidClips ? Object.keys(remappedImg2vidClips) : [],
      scene_to_array: Object.keys(sceneToArrayIndex).length,
    },
    effects: {
      kenBurns: !gameplayMode, // No Ken Burns on gameplay video (img2vid scenes auto-skip KB)
      fadeTransitions: !gameplayMode,
      fadeIn: true,
      fadeOut: true,
      filmGrain: !cmActive && !gameplayMode,
      vignette: !cmActive && !gameplayMode,
      horrorGrade: !cmActive && !gameplayMode,
      captionStyle: (subtitleConfig as Record<string, unknown>)?.style as string || 'bold',
    },
    // v4.0: Controlled Motion effects config (overrides legacy effects when present)
    // NOTE: renderer destructures 'effects_profile', not 'effects_config'
    effects_profile: effectsConfig || null,
    // v4.1: Video overlay — extract URL from effectsConfig.overlay_video if configured
    overlay_video_url: (effectsConfig as Record<string, unknown>)?.overlay_video &&
      (effectsConfig as Record<string, unknown> & { overlay_video: { enabled?: boolean; url?: string } }).overlay_video?.enabled &&
      (effectsConfig as Record<string, unknown> & { overlay_video: { url?: string } }).overlay_video?.url
        ? (effectsConfig as Record<string, unknown> & { overlay_video: { url: string } }).overlay_video.url
        : undefined,
    overlay_video_opacity: (effectsConfig as Record<string, unknown>)?.overlay_video &&
      (effectsConfig as Record<string, unknown> & { overlay_video: { opacity?: number } }).overlay_video?.opacity
        ? (effectsConfig as Record<string, unknown> & { overlay_video: { opacity: number } }).overlay_video.opacity
        : undefined,
    // v6.0: Per-brand subtitle styling (Roadmap #14)
    subtitle_config: subtitleConfig || null,
    music_url: musicUrl,
    music_volume: musicVolumePercent,
    // Background Music V1: ducking + fade config for renderer
    music_config: musicCfg ? {
      ducking: musicCfg.ducking || { enabled: false },
      fade: musicCfg.fade || { in_ms: 800, out_ms: 1200 },
      loopable: meta?.music_loopable !== false, // default true; set by music step
    } : null,
    // v5.0: Per-scene mood levels for intelligent Ken Burns selection (Improvement #4)
    mood_levels: moodLevels,
    low_memory: true, // Safe for cloud deployment
  });

  // Start the render job — retry on transient errors (502/503/504)
  // Max 4 attempts for campaigns where multiple jobs may queue up
  const MAX_RENDER_ATTEMPTS = 4;
  let response: Response | null = null;
  
  for (let attempt = 1; attempt <= MAX_RENDER_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${rendererUrl}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: renderPayload,
      });
    } catch (fetchErr) {
      // Network error (ECONNREFUSED, timeout, etc.) — retry
      if (attempt < MAX_RENDER_ATTEMPTS) {
        const backoff = 15 * attempt;
        console.log(`[ASSEMBLE] Render fetch error: ${fetchErr instanceof Error ? fetchErr.message : fetchErr}, retrying in ${backoff}s (attempt ${attempt}/${MAX_RENDER_ATTEMPTS})...`);
        await new Promise(r => setTimeout(r, backoff * 1000));
        continue;
      }
      throw new Error(`Video renderer unreachable after ${MAX_RENDER_ATTEMPTS} attempts: ${fetchErr instanceof Error ? fetchErr.message : fetchErr}`);
    }

    if (res.ok) {
      response = res;
      break;
    }

    // Handle 503 (server busy) — wait longer, renderer is processing another job
    if (res.status === 503 && attempt < MAX_RENDER_ATTEMPTS) {
      let retryAfter = 65; // Default wait
      try {
        const body = await res.json();
        retryAfter = (body.retry_after || 60) + 5; // Add 5s buffer
      } catch { /* use default */ }

      console.log(`[ASSEMBLE] Renderer busy (503), waiting ${retryAfter}s before retry (attempt ${attempt}/${MAX_RENDER_ATTEMPTS})...`);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      continue;
    }

    // Handle 502/504 (gateway error / timeout) — shorter backoff, origin may recover quickly
    if ([502, 504].includes(res.status) && attempt < MAX_RENDER_ATTEMPTS) {
      const backoff = 15 * attempt; // 15s, 30s, 45s
      console.log(`[ASSEMBLE] Renderer gateway error (${res.status}), retrying in ${backoff}s (attempt ${attempt}/${MAX_RENDER_ATTEMPTS})...`);
      await new Promise(r => setTimeout(r, backoff * 1000));
      continue;
    }

    // Non-retryable error or final attempt — throw
    const bodyText = await res.text().catch(() => 'Unable to read response body');
    throw new Error(`Video renderer failed: ${res.status} ${res.statusText} - ${bodyText}`);
  }

  if (!response) {
    throw new Error('Video renderer: all render attempts failed');
  }

  const startResult = await response.json();
  const renderJobId = startResult.job_id;
  
  if (!renderJobId) {
    throw new Error('Video renderer did not return a job_id');
  }

  console.log(`[ASSEMBLE] Render job started: ${renderJobId}, polling for completion...`);

  // Poll for completion — use remaining wall-clock budget for smart timeout
  // With waitUntil() we have up to 400s total. Calculate how much is left.
  // IMPORTANT: Do NOT impose a minimum floor (the old 120s min caused the function
  // to get killed by Deno's 400s hard limit before the continuation signal fired).
  let maxWaitMs = 150 * 1000; // default 150s
  if (functionStartTime) {
    const elapsedMs = Date.now() - functionStartTime;
    const remainingMs = WALL_CLOCK_BUDGET_MS - elapsedMs;
    // Use 70% of remaining time for polling, leave 30% for continuation signal + cleanup
    // No minimum floor — if budget is tight, poll briefly then fire continuation
    maxWaitMs = Math.min(180_000, Math.max(5_000, Math.floor(remainingMs * 0.7)));
    console.log(`[ASSEMBLE] Wall-clock: ${Math.round(elapsedMs / 1000)}s elapsed, ${Math.round(remainingMs / 1000)}s remaining → poll timeout ${Math.round(maxWaitMs / 1000)}s`);

    // If critically low on budget (<15s), skip polling entirely and return continuation
    if (remainingMs < 15_000) {
      console.log(`[ASSEMBLE] ⏰ Budget critically low (${Math.round(remainingMs / 1000)}s) — immediate continuation`);
      return `__CONTINUATION__:${renderJobId}`;
    }
  }
  const pollIntervalMs = 5000;
  const startTime = Date.now();
  let pollCount = 0;

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    pollCount++;

    // Heartbeat every 6th poll (~30s) to keep lease alive during long renders
    if (pollCount % 6 === 0 && supabaseClient && jobId && workerId) {
      try {
        await heartbeatJob(supabaseClient, jobId, workerId, 90, 'assembling');
        console.log(`[ASSEMBLE] ♥ Heartbeat sent (poll #${pollCount})`);
      } catch { /* non-fatal */ }
    }

    try {
      const statusResponse = await fetch(`${rendererUrl}/status/${renderJobId}`);
      if (!statusResponse.ok) {
        console.log(`[ASSEMBLE] Status check returned ${statusResponse.status}, retrying...`);
        continue;
      }

      const statusData = await statusResponse.json();
      console.log(`[ASSEMBLE] Render status: ${statusData.status}, progress: ${statusData.progress || 0}%`);

      if (statusData.status === 'complete' || statusData.status === 'succeeded') {
        // Prefer supabase_url (permanent) over local URL
        const videoUrl = statusData.supabase_url || (statusData.url ? `${rendererUrl}${statusData.url}` : null);
        if (!videoUrl) {
          throw new Error('Render complete but no video URL returned');
        }
        
        // v9.1: Verify scene_sources — check if img2vid clips were actually used
        const sceneSrcs = statusData.scene_sources as string[] | undefined;
        if (sceneSrcs && Array.isArray(sceneSrcs)) {
          const img2vidUsed = sceneSrcs.filter((s: string) => s === 'img2vid').length;
          const fallbackCount = sceneSrcs.filter((s: string) => s === 'kenburns-fallback').length;
          console.log(`[ASSEMBLE] 📊 Scene sources: ${img2vidUsed} img2vid, ${fallbackCount} fallback, ${sceneSrcs.length - img2vidUsed - fallbackCount} kenburns`);
          if (fallbackCount > 0) {
            console.warn(`[ASSEMBLE] ⚠ ${fallbackCount} img2vid clip(s) fell back to Ken Burns — clip download or processing failed`);
          }
        }
        
        console.log(`[ASSEMBLE] ✓ Video ready: ${videoUrl}`);
        return videoUrl;
      }

      if (statusData.status === 'failed') {
        throw new Error(`Video render failed: ${statusData.error || 'Unknown error'}`);
      }

      // Still processing, continue polling
    } catch (pollError) {
      console.log(`[ASSEMBLE] Poll error: ${pollError instanceof Error ? pollError.message : pollError}`);
      // Continue polling on transient errors
    }
  }

  // Instead of throwing, signal continuation so the pipeline self-invokes.
  // On re-invocation, the assemble step will check renderer status via /status/${job_id}
  // and find the completed render (the renderer keeps results for ~30 min).
  console.log(`[ASSEMBLE] ⏰ Render still in progress after ${maxWaitMs / 1000}s — requesting continuation`);
  return `__CONTINUATION__:${renderJobId}`;
}

/**
 * Poll for completion of an in-progress render job
 * Used when resuming from a previous timed-out attempt
 */
async function pollRendererForCompletion(
  rendererUrl: string,
  renderJobId: string
): Promise<string> {
  const maxWaitMs = 90 * 1000;  // 90 seconds
  const pollIntervalMs = 5000;
  const startTime = Date.now();

  console.log(`[ASSEMBLE] Polling for existing render job: ${renderJobId}`);

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollIntervalMs));

    try {
      const statusResponse = await fetch(`${rendererUrl}/status/${renderJobId}`);
      if (!statusResponse.ok) {
        console.log(`[ASSEMBLE] Status check returned ${statusResponse.status}, retrying...`);
        continue;
      }

      const statusData = await statusResponse.json();
      console.log(`[ASSEMBLE] Render status: ${statusData.status}, progress: ${statusData.progress || 0}%`);

      if (statusData.status === 'complete' || statusData.status === 'succeeded') {
        const videoUrl = statusData.supabase_url || (statusData.url ? `${rendererUrl}${statusData.url}` : null);
        if (!videoUrl) {
          throw new Error('Render complete but no video URL returned');
        }
        console.log(`[ASSEMBLE] ✓ Video ready: ${videoUrl}`);
        return videoUrl;
      }

      if (statusData.status === 'failed') {
        throw new Error(`Video render failed: ${statusData.error || 'Unknown error'}`);
      }
    } catch (pollError) {
      console.log(`[ASSEMBLE] Poll error: ${pollError instanceof Error ? pollError.message : pollError}`);
    }
  }

  throw new Error(`Video render timed out after ${maxWaitMs / 1000}s - job may still be rendering. Retry again.`);
}

/**
 * Assemble video using Creatomate
 */
async function assembleWithCreatomate(
  creatomateKey: string,
  jobId: string,
  imageUrls: string[],
  audioUrl: string,
  duration: number,
  meta: Record<string, unknown>
): Promise<string> {
  const sceneDuration = duration / imageUrls.length;

  // Build Creatomate source
  const elements: unknown[] = [];

  // Background images
  for (let i = 0; i < imageUrls.length; i++) {
    elements.push({
      type: 'image',
      source: imageUrls[i],
      time: i * sceneDuration,
      duration: sceneDuration + 0.5, // Overlap for transitions
      fit: 'cover',
      animations: [
        {
          type: 'scale',
          start_scale: '100%',
          end_scale: '115%',
          easing: 'linear',
        },
      ],
    });
  }

  // Audio
  elements.push({
    type: 'audio',
    source: audioUrl,
    volume: '100%',
  });

  const source = {
    output_format: 'mp4',
    width: 1080,
    height: 1920,
    frame_rate: 30,
    duration: duration,
    elements: elements,
  };

  // Start render
  const response = await fetchWithError(
    'https://api.creatomate.com/v1/renders',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${creatomateKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ source }),
    },
    'Creatomate render start'
  );

  const renderJob = await response.json();
  const renderId = renderJob[0]?.id;

  if (!renderId) {
    throw new Error('Creatomate returned no render ID');
  }

  // Poll for completion
  let attempts = 0;
  const maxAttempts = 60; // 5 minutes max

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second poll

    const statusResponse = await fetchWithError(
      `https://api.creatomate.com/v1/renders/${renderId}`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${creatomateKey}` },
      },
      'Creatomate status check'
    );

    const status = await statusResponse.json();

    if (status.status === 'succeeded') {
      return status.url;
    }

    if (status.status === 'failed') {
      throw new Error(`Creatomate render failed: ${status.error_message || 'Unknown error'}`);
    }

    attempts++;
  }

  throw new Error('Creatomate render timed out');
}

// =====================================================
// STEP 9: UPLOAD TO STORAGE
// =====================================================

export async function executeUploadStep(
  supabase: SupabaseClient,
  job: Job,
  workerId: string,
  env: Record<string, string>,
  logger: StepLogger
): Promise<StepResult> {
  const idempotencyKey = `${job.id}:upload_storage`;

  // Check if already done
  const existingAsset = await getAssetByKey(supabase, job.id, idempotencyKey);
  if (existingAsset?.public_url) {
    console.log(`[UPLOAD] Already uploaded: ${existingAsset.public_url}`);
    return { success: true, skipped: true, data: { video_url: existingAsset.public_url } };
  }

  // Check if job already has video_url set
  if (job.video_url) {
    console.log(`[UPLOAD] Job already has video_url: ${job.video_url}`);
    await upsertAsset(supabase, job.id, idempotencyKey, 'final_mp4', '', job.video_url, {
      source: 'existing_job_video_url'
    });
    return { success: true, skipped: true, data: { video_url: job.video_url } };
  }

  // Get assembled video
  const videoAsset = await getAssetByKey(supabase, job.id, `${job.id}:video_assemble`);
  if (!videoAsset?.public_url) {
    return { success: false, error: 'No assembled video found - run assemble step first' };
  }

  const sourceVideoUrl = videoAsset.public_url;
  console.log(`[UPLOAD] Uploading video to permanent storage`);

  try {
    // Upload to permanent storage location (using standardized path)
    const storagePath = pathForFinalVideo(job.brand_id, job.id);
    const publicUrl = await uploadRemoteToStorage(
      supabase,
      STORAGE_BUCKET,
      storagePath,
      sourceVideoUrl
    );

    // Update job.video_url
    await updateJobFields(supabase, job.id, {
      video_url: publicUrl,
    });

    // Store asset
    await upsertAsset(supabase, job.id, idempotencyKey, 'final_mp4', storagePath, publicUrl, {
      source_url: sourceVideoUrl,
      uploaded_at: new Date().toISOString(),
    });

    // Snapshot final output
    await logger.snapshot('upload', 'output', {
      video_url: publicUrl,
      storage_path: storagePath,
      source: sourceVideoUrl.slice(0, 100),
    }, 'Final video uploaded to storage');

    console.log(`[UPLOAD] ✓ Video uploaded: ${publicUrl}`);
    return { success: true, data: { video_url: publicUrl } };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[UPLOAD] ✗ Failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

// =====================================================
// STEP 10: SCHEDULE POST
// =====================================================

export async function executeScheduleStep(
  supabase: SupabaseClient,
  job: Job,
  workerId: string,
  env: Record<string, string>,
  logger: StepLogger
): Promise<StepResult> {
  const idempotencyKey = `${job.id}:schedule_post`;

  // Check if already done
  const existingAsset = await getAssetByKey(supabase, job.id, idempotencyKey);
  if (existingAsset?.meta?.scheduled) {
    console.log(`[SCHEDULE] Already scheduled`);
    return { success: true, skipped: true, data: existingAsset.meta as Record<string, unknown> };
  }

  // Refresh job to get latest video_url
  const freshJob = await loadJob(supabase, job.id);
  if (!freshJob) {
    return { success: false, error: 'Could not reload job for scheduling' };
  }

  // Get video URL: prefer job.video_url, fall back to upload asset, then assemble asset
  let videoUrl = freshJob.video_url;
  if (!videoUrl) {
    console.log(`[SCHEDULE] No video_url on job, checking assets...`);
    const uploadAsset = await getAssetByKey(supabase, job.id, `${job.id}:upload_storage`);
    if (uploadAsset?.public_url) {
      videoUrl = uploadAsset.public_url;
      console.log(`[SCHEDULE] Found video URL from upload asset: ${videoUrl}`);
    } else {
      const assembleAsset = await getAssetByKey(supabase, job.id, `${job.id}:video_assemble`);
      if (assembleAsset?.public_url) {
        videoUrl = assembleAsset.public_url;
        console.log(`[SCHEDULE] Found video URL from assemble asset: ${videoUrl}`);
      }
    }
  }

  if (!videoUrl) {
    return { success: false, error: 'No video_url found on job or in assets - upload step may have failed' };
  }

  if (!freshJob.brand_id) {
    return { success: false, error: 'No brand_id on job' };
  }

  // Platform name normalization map — convert any variant to canonical format
  const PLATFORM_NORMALIZE: Record<string, string> = {
    'youtube': 'youtube_shorts',
    'youtube_shorts': 'youtube_shorts',
    'shorts': 'youtube_shorts',
    'yt': 'youtube_shorts',
    'instagram': 'instagram_reels',
    'instagram_reels': 'instagram_reels',
    'reels': 'instagram_reels',
    'ig': 'instagram_reels',
    'facebook': 'facebook_reels',
    'facebook_reels': 'facebook_reels',
    'fb': 'facebook_reels',
    'tiktok': 'tiktok',
    'tt': 'tiktok',
    'threads': 'threads',
    'twitter': 'twitter',
    'x': 'twitter',
  };

  // Determine platforms and normalize names
  const rawPlatforms = (freshJob.meta?.platforms as string[]) || ['youtube_shorts', 'instagram_reels', 'facebook_reels'];
  const platforms = rawPlatforms.map(p => {
    const normalized = PLATFORM_NORMALIZE[p.toLowerCase().trim()];
    if (!normalized) {
      console.warn(`[SCHEDULE] Unknown platform "${p}", passing through as-is`);
      return p;
    }
    if (normalized !== p) {
      console.log(`[SCHEDULE] Normalized platform "${p}" → "${normalized}"`);
    }
    return normalized;
  });
  // Deduplicate (in case multiple variants map to the same canonical name)
  const allUnique = [...new Set(platforms)];

  // ── Disabled platforms ──────────────────────────────────────────────
  // Twitter/X: Requires paid API tier — posting fails permanently
  // Remove these from the schedule until their APIs are production-ready.
  const DISABLED_PLATFORMS = new Set(['twitter']);
  const afterDisabled = allUnique.filter(p => {
    if (DISABLED_PLATFORMS.has(p)) {
      console.log(`[SCHEDULE] ⏭ Skipping disabled platform "${p}" (API not available)`);
      return false;
    }
    return true;
  });

  // ── Smart connection filter ─────────────────────────────────────────
  // Query platform_tokens to find which platforms the brand actually has connected.
  // Only schedule posts for connected platforms — avoids guaranteed misconfig failures.
  // platform_tokens uses short names (instagram, facebook, youtube, tiktok, threads)
  // while schedule uses suffixed names (instagram_reels, facebook_reels, youtube_shorts).
  const SCHEDULE_TO_TOKEN_PLATFORM: Record<string, string> = {
    'youtube_shorts': 'youtube',
    'instagram_reels': 'instagram',
    'facebook_reels': 'facebook',
    'tiktok': 'tiktok',
    'threads': 'threads',
    'twitter': 'twitter',
  };

  let connectedSet: Set<string> | null = null;
  try {
    const { data: tokenRows, error: tokenErr } = await supabase
      .from('platform_tokens')
      .select('platform')
      .eq('brand_id', freshJob.brand_id)
      .eq('is_valid', true);

    if (!tokenErr && tokenRows) {
      connectedSet = new Set(tokenRows.map((r: { platform: string }) => r.platform));
      console.log(`[SCHEDULE] Connected platforms for brand: ${[...connectedSet].join(', ')}`);
    } else {
      console.warn(`[SCHEDULE] Could not query platform_tokens: ${tokenErr?.message}. Posting to all requested platforms (failures expected for unconnected).`);
    }
  } catch (connErr) {
    console.warn(`[SCHEDULE] platform_tokens query failed: ${connErr}. Posting to all requested platforms.`);
  }

  const uniquePlatforms = connectedSet
    ? afterDisabled.filter(p => {
        const tokenName = SCHEDULE_TO_TOKEN_PLATFORM[p] || p;
        const isConnected = connectedSet!.has(tokenName);
        if (!isConnected) {
          console.log(`[SCHEDULE] ⏭ Skipping "${p}" — not connected for this brand (no valid token for "${tokenName}")`);
        }
        return isConnected;
      })
    : afterDisabled; // fallback: try all if token query failed

  if (uniquePlatforms.length === 0) {
    const msg = connectedSet
      ? `No connected platforms found for this brand. Connect platforms in Settings. (requested: ${afterDisabled.join(', ')}, connected: ${connectedSet ? [...connectedSet].join(', ') : 'unknown'})`
      : 'All platforms are disabled — nothing to schedule';
    console.warn(`[SCHEDULE] ${msg}`);
    return { success: true, data: { scheduled_at: null, platforms: [], results: {}, note: msg, skipped_platforms: afterDisabled } };
  }

  if (afterDisabled.length !== uniquePlatforms.length) {
    console.log(`[SCHEDULE] Filtered ${afterDisabled.length} requested → ${uniquePlatforms.length} connected: ${uniquePlatforms.join(', ')}`);
  }

  // Determine scheduled time
  const scheduledAt = freshJob.scheduled_post_at
    ? new Date(freshJob.scheduled_post_at)
    : new Date(Date.now() + 24 * 60 * 60 * 1000); // Default: 24 hours from now

  console.log(`[SCHEDULE] Scheduling post for ${uniquePlatforms.length} platforms at ${scheduledAt.toISOString()}`);
  if (rawPlatforms.length !== uniquePlatforms.length) {
    console.log(`[SCHEDULE] (normalized from ${rawPlatforms.length} raw → ${uniquePlatforms.length} unique)`);
  }

  const results: Record<string, { post_id: string | null; was_inserted: boolean; error?: string }> = {};

  try {
    for (const platform of uniquePlatforms) {
      // Call idempotent RPC — pass story_text as description so Instagram/Facebook
      // adapters have caption content (not just the title fallback)
      const { data, error } = await supabase.rpc('schedule_post_idempotent', {
        p_job_id: freshJob.id,
        p_brand_id: freshJob.brand_id,
        p_platform: platform,
        p_scheduled_at: scheduledAt.toISOString(),
        p_video_url: videoUrl,
        p_title: freshJob.title,
        p_description: freshJob.story_text || null,
        p_tags: null,
        p_meta: { source: 'worker-v1', vibe_preset: freshJob.vibe_preset }
      });

      if (error) {
        console.error(`[SCHEDULE] RPC error for ${platform}: ${error.message}`);
        results[platform] = { post_id: null, was_inserted: false, error: error.message };
        continue;
      }

      const result = Array.isArray(data) ? data[0] : data;
      results[platform] = {
        post_id: result?.post_id,
        was_inserted: result?.was_inserted ?? false,
      };

      if (result?.was_inserted) {
        console.log(`[SCHEDULE] ✓ Created post for ${platform}: ${result.post_id}`);
      } else {
        console.log(`[SCHEDULE] Post already exists for ${platform}: ${result?.post_id}`);
      }
    }

    // Check if ALL platforms failed BEFORE storing the idempotency asset
    const failures = Object.entries(results).filter(([_, r]) => r.error);
    if (failures.length === uniquePlatforms.length) {
      // Don't store scheduled:true asset — allow retry
      return { success: false, error: `All platforms failed: ${failures.map(([p, r]) => `${p}: ${r.error}`).join(', ')}` };
    }

    // Store asset only on success/partial success
    await upsertAsset(supabase, job.id, idempotencyKey, 'story_json', '', null, {
      asset_subtype: 'post_schedule',
      scheduled: true,
      scheduled_at: scheduledAt.toISOString(),
      platforms: uniquePlatforms,
      results: results,
    });

    // Snapshot schedule results
    await logger.snapshot('schedule', 'output', {
      scheduled_at: scheduledAt.toISOString(),
      platforms: uniquePlatforms,
      successes: uniquePlatforms.length - failures.length,
      failures: failures.length,
      post_ids: Object.entries(results).filter(([_, r]) => r.post_id).map(([p, r]) => ({ platform: p, post_id: r.post_id })),
    }, 'Posts scheduled');

    console.log(`[SCHEDULE] ✓ Scheduled for ${uniquePlatforms.length - failures.length}/${uniquePlatforms.length} platforms`);
    return { success: true, data: { scheduled_at: scheduledAt.toISOString(), platforms: uniquePlatforms, results: results } };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[SCHEDULE] ✗ Failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}
