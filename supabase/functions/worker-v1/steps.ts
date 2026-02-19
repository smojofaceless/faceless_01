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
- FIRST-PERSON narrator — conversational, authentic, like a real Reddit post
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
- Write like a real person posting on Reddit at 2 AM, not a professional writer
- Short paragraphs. Some one-sentence paragraphs for impact.
- Use line breaks for pacing — let the reader breathe between scares
- No purple prose. Plain language hits harder: "I looked under the bed. It looked back."
- Include at least ONE moment where the narrator questions their own sanity
- The horror should be IMPLIED more than shown — what we imagine is worse than what we see
- No gore — psychological horror and wrongness only
- Every sentence must be visually filmable as a dark, realistic illustrated scene

ENGAGEMENT HOOKS (MANDATORY):
- End with a line that makes viewers want to comment. Examples:
  • "Has anyone else experienced something like this?"
  • "I'm posting this from my car. I'm not going back inside."
  • "If you see [specific detail], do NOT [action]. Trust me."
  • "That was three weeks ago. Last night, it started again."
- This drives comments and shares, which boost algorithmic reach.

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

COMMENT-BAIT ENDING (MANDATORY):
- The very last sentence must be a QUESTION or PROVOCATIVE STATEMENT designed to drive comments. Examples:
  • "Do you think the neighbors really didn't know?"
  • "The question investigators still ask: who was the second set of footprints for?"
  • "Was he acting alone? The journal entries suggest otherwise."
  • "Some say the recordings are still playing. Would you listen?"
- This is the single most important engagement driver — comments boost algorithmic reach.${avoidanceSection}

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
  const duration = (job.meta?.duration as { min?: number; max?: number } | number) || 60;
  // Dark origins performs better at 90s+ (documentary pacing, algorithm retention)
  const defaultDuration = vibePreset === 'dark_origins' ? 90 : 60;
  const targetDuration = typeof duration === 'object' ? (duration.min || defaultDuration) : (duration || defaultDuration);

  // Calculate target word count (roughly 2.5 words per second for narration)
  const targetWords = Math.round(targetDuration * 2.5);
  const wordRange = { min: Math.round(targetWords * 0.85), max: Math.round(targetWords * 1.15) };

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

    // Log prompt snapshot
    await logger.snapshot('story', 'prompt', storyPrompt, `OpenAI prompt for ${vibePreset} story`);

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
        temperature: 0.9,
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
    const title = parsed.title || 'Untitled Story';
    let storyText = parsed.story || parsed.content || parsed.text;

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
    // Extract concept metadata for thematic uniqueness (GPT returns these)
    const storySetting = parsed.setting || '';
    const storyConcept = parsed.concept || '';

    if (!storyText) {
      throw new Error('Story generation returned no story text');
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
  return `You are a master storyteller specializing in short-form horror and mystery content. You create gripping, atmospheric stories perfect for TikTok/Reels narration. Your stories are ALWAYS first-person narration that feels personal and immediate.

CRITICAL FORMATTING RULE: NEVER use dashes, em-dashes (—), en-dashes (–), or hyphens (-) as punctuation in the narration. Use commas, periods, semicolons, or ellipses instead. This text will be displayed as on-screen subtitles and used as platform captions where dashes render poorly.`;
}

/**
 * Build story prompt based on vibe preset
 */
function buildStoryPrompt(vibePreset: string, wordRange: { min: number; max: number }, recentStories?: Array<{ title: string; hook: string | null; setting?: string }>): string {
  const vibeDescriptions: Record<string, string> = {
    urban_legend: 'an urban legend or creepy internet story, featuring unexplained phenomena, "that one weird thing that happened", or local folklore that turns out to be true',
    one_too_many: buildOneToManyPrompt(wordRange),
    backrooms: 'a liminal space or "backrooms" style horror about accidentally entering wrong places, glitches in reality, or spaces that shouldn\'t exist',
    nosleep: 'a first-person creepypasta/NoSleep style horror that starts mundane but escalates into something terrifying',
    glitch: 'a glitch in the matrix story about strange repetitions, déjà vu, NPCs acting weird, or reality not working right',
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
  let duration: number;
  if (typeof rawDuration === 'number') {
    duration = rawDuration;
    console.log(`[SCENES] Duration from number: ${duration}s`);
  } else if (rawDuration && typeof rawDuration === 'object') {
    // Use average of min/max, or min, or max, or default to 60
    const durObj = rawDuration as { minSeconds?: number; maxSeconds?: number; min?: number; max?: number };
    const minSec = durObj.minSeconds ?? durObj.min ?? 60;
    const maxSec = durObj.maxSeconds ?? durObj.max ?? 90;
    duration = Math.round((minSec + maxSec) / 2);
    console.log(`[SCENES] Duration from object: min=${minSec}, max=${maxSec}, avg=${duration}s`);
  } else {
    duration = 60;
    console.log(`[SCENES] Duration defaulted to: ${duration}s`);
  }
  
  // scene_count from UI (create page calculates via PACE_PRESETS + platform clamps)
  // Fallback: balanced pace ~2.5s per scene, clamped [12, 30] for social media
  const fallbackSceneCount = Math.max(12, Math.min(24, Math.round(duration / 2.5)));
  const sceneCount = (job.meta?.scene_count as number) || fallbackSceneCount;
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

      // Extract basic keywords (nouns/adjectives)
      const words = sceneText.toLowerCase().split(/\s+/).filter(w => w.length > 0);
      const keywords = words
        .filter(w => w.length > 4)
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
    const wordCount = job.story_text.split(/\s+/).length;
    const wordsPerSecond = wordCount / duration;
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
      word_count: wordCount,
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
    const artStyle = (job.meta?.art_style as string) || 'cinematic-dark';
    const visualPreset = job.visual_preset || (job.meta?.visual_preset as string) || 'forest';
    const musicTrackId = (job.meta?.music_track_id as string) || 'ambient_dark_01';
    const vibePreset = job.vibe_preset || (job.meta?.vibe_preset as string) || 'urban_legend';
    
    // Provider-aware voice info for pipeline hash
    const ttsProvider: TtsProvider = (env.TTS_PROVIDER || 'openai') as TtsProvider;
    const pipelineVoiceConfig = getPresetVoiceConfig(vibePreset);
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
  const vibePreset = job.vibe_preset || (job.meta?.vibe_preset as string) || 'urban_legend';
  const presetVoice = getPresetVoiceConfig(vibePreset);
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

    // Call OpenAI TTS API
    const response = await fetchWithError(
      'https://api.openai.com/v1/audio/speech',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: ttsModel,
          input: job.story_text,
          voice: ttsVoice,
          instructions: ttsInstructions,
          response_format: 'mp3',
        }),
      },
      'OpenAI TTS'
    );

    // OpenAI TTS returns raw audio bytes
    const audioBuffer = await response.arrayBuffer();
    const audioBytes = new Uint8Array(audioBuffer);

    if (audioBytes.length < 1000) {
      throw new Error(`OpenAI TTS returned suspiciously small audio: ${audioBytes.length} bytes`);
    }

    // Upload to storage
    const storagePath = pathForAudio(job.brand_id, job.id);
    const publicUrl = await uploadToStorage(
      supabase,
      STORAGE_BUCKET,
      storagePath,
      audioBytes,
      'audio/mpeg'
    );

    // Estimate duration from file size (MP3 ~128kbps = ~16KB/s) as fallback
    let estimatedDurationMs = Math.round((audioBytes.length / 16000) * 1000);

    // === WHISPER ALIGNMENT: Get precise word-level timestamps via transcription ===
    let timestamps: Array<{ word: string; start: number; end: number }> = [];
    let timestampsApproximate = true;

    try {
      console.log(`[VOICE] Running Whisper alignment on ${audioBytes.length} byte audio...`);
      
      // Build multipart form data for Whisper API
      const boundary = '----WhisperBoundary' + Date.now();
      const formParts: Uint8Array[] = [];
      const encoder = new TextEncoder();
      
      // File field
      formParts.push(encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`
      ));
      formParts.push(audioBytes);
      formParts.push(encoder.encode('\r\n'));
      
      // Model field
      formParts.push(encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`
      ));
      
      // Response format field
      formParts.push(encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n`
      ));
      
      // Timestamp granularities field
      formParts.push(encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\nword\r\n`
      ));
      
      // End boundary
      formParts.push(encoder.encode(`--${boundary}--\r\n`));
      
      // Combine parts
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
        
        // Extract actual duration from Whisper response
        if (whisperData.duration) {
          estimatedDurationMs = Math.round(whisperData.duration * 1000);
        }
        
        // Extract word-level timestamps from Whisper
        if (whisperData.words && Array.isArray(whisperData.words) && whisperData.words.length > 0) {
          const whisperWords = whisperData.words.map((w: { word: string; start: number; end: number }) => ({
            word: w.word.trim(),
            start: w.start,
            end: w.end,
          })).filter((w: { word: string }) => w.word.length > 0);
          
          // === FORCED ALIGNMENT: Map Whisper timestamps back onto original story words ===
          // Whisper may re-transcribe differently ("didn't" → "did not", etc.)
          // We keep original words but use Whisper's timing
          const originalWords = job.story_text!.split(/\s+/).filter(w => w.length > 0);
          timestamps = forceAlignTimestamps(originalWords, whisperWords);
          
          if (timestamps.length > 0) {
            timestampsApproximate = false;
            console.log(`[VOICE] ✓ Forced alignment: ${timestamps.length} words aligned from ${whisperWords.length} Whisper words, duration=${estimatedDurationMs}ms`);
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

    console.log(`[VOICE] ✓ OpenAI TTS: ${estimatedDurationMs}ms audio (${audioBytes.length} bytes), ${timestamps.length} word timestamps (${timestampsApproximate ? 'approx' : 'precise via Whisper'})`);
    
    // === COST CONTROL: Record usage + release slot ===
    const costIdempotencyKey = `job:${job.id}:openai_tts:voice:${storyHash.slice(0, 16)}`;
    // OpenAI TTS pricing: ~$0.015 per 1K chars for gpt-4o-mini-tts
    const estimatedCostCents = Math.round(charCount * 0.0015);
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
type ImageModel = 'gpt-image-1' | 'dall-e-2' | 'dall-e-3';
const DEFAULT_IMAGE_MODEL: ImageModel = 'gpt-image-1'; // Cheapest: ~$0.016/image at low quality

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

export async function executeImagesStep(
  supabase: SupabaseClient,
  job: Job,
  workerId: string,
  env: Record<string, string>,
  logger: StepLogger,
  functionStartTime?: number
): Promise<StepResult> {
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

  // Determine which image model to use (job meta > env > default)
  // v4.0: Validate against known models — reject gpt-4o or other non-image models
  const VALID_IMAGE_MODELS: ImageModel[] = ['gpt-image-1', 'dall-e-2', 'dall-e-3'];
  const rawImageModel = (job.meta?.image_model as string) || (env.IMAGE_MODEL as string) || '';
  const imageModel: ImageModel = VALID_IMAGE_MODELS.includes(rawImageModel as ImageModel)
    ? (rawImageModel as ImageModel)
    : DEFAULT_IMAGE_MODEL;
  if (rawImageModel && rawImageModel !== imageModel) {
    console.warn(`[IMAGES] ⚠️ Invalid image model "${rawImageModel}" in job meta — falling back to "${imageModel}"`);
  }

  // v1.5: Resolve image prompt config from DB (system → preset → brand → job meta)
  const vibePreset = job.vibe_preset || (job.meta?.vibe_preset as string) || 'urban_legend';
  let imagePromptConfig: ImagePromptConfig | null = null;
  try {
    imagePromptConfig = await getImagePromptConfigForJob(supabase, job.brand_id, vibePreset, job.meta || {});
  } catch (cfgErr) {
    console.warn(`[IMAGES] Failed to load image prompt config: ${cfgErr instanceof Error ? cfgErr.message : cfgErr}`);
  }

  // Fallback to legacy hardcoded values if DB config unavailable
  const artStyle = imagePromptConfig?.art_style || (job.meta?.art_style as string) || 'cinematic-dark';

  console.log(`[IMAGES] Generating ${scenes.length} images (model: ${imageModel}, style: ${artStyle}, config: ${imagePromptConfig ? 'DB' : 'legacy'})`);

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

  let generatedCount = 0;
  let skippedCount = 0;
  const scenesCompleted: number[] = [];

  // ======================================================================
  // IMAGE SEQUENCE PLANNING (Improvement #2: Multi-image for long scenes)
  // For scenes >10s, we generate multiple images to maintain visual interest.
  // Each image covers ~8s of screen time. This builds the flat image list
  // that the renderer will receive (with per-image durations and mood levels).
  // ======================================================================
  const LONG_SCENE_THRESHOLD = 12; // Seconds: scenes longer than this get extra images (was 10)
  const TARGET_IMAGE_DURATION = 10; // Seconds: target on-screen time per image (was 8)
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

  // v4.0: Track previous prompt fingerprint for similarity detection
  let previousPromptFingerprint: string | null = null;

  try {
    for (let seqIdx = 0; seqIdx < imageSequence.length; seqIdx++) {
      const entry = imageSequence[seqIdx];
      const scene = scenes[entry.sceneIndex];
      const idempotencyKey = entry.assetKey;

      // Check if this scene image already exists
      const existingImage = await getAssetByKey(supabase, job.id, idempotencyKey);
      if (existingImage?.public_url) {
        console.log(`[IMAGES] Scene ${entry.sceneIndex}${entry.subIndex > 0 ? `_sub_${entry.subIndex}` : ''} already generated, skipping`);
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
      
      const scenePrompt = buildImagePrompt(scene.text, scene.keywords, artStyle, i, scenes.length, imagePromptConfig, effectiveCue, storyAnchor);
      
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
      // gpt-image-1: 1024x1536 portrait, dall-e-3: 1024x1792 portrait, dall-e-2: 1024x1024 square
      const imageSize = imageModel === 'gpt-image-1' ? '1024x1536' : 
                        imageModel === 'dall-e-3' ? '1024x1792' : '1024x1024';
      const imageQuality = 'standard';
      const canonicalImageInput = `${imageModel}|${imageSize}|${imageQuality}|${scenePrompt}`;
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

      console.log(`[IMAGES] Generating image ${seqIdx + 1}/${imageSequence.length} (scene ${i}${entry.subIndex > 0 ? ` sub ${entry.subIndex}` : ''}) with ${imageModel} (hash: ${promptHash.slice(0, 8)}...)`);

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
          source: cue ? 'visual_cue+anchor' : 'raw_text'
        }, `Image ${seqIdx + 1}/${imageSequence.length} prompt (scene ${i}${entry.subIndex > 0 ? ` sub ${entry.subIndex}` : ''}, ${cue?.sceneType || 'no_cue'})`);
      }

      // === LEASE GRACE CHECK: Verify enough time before expensive API call ===
      await requireLeaseGrace(supabase, job.id, workerId, `${imageModel} scene ${i}${entry.subIndex > 0 ? ` sub ${entry.subIndex}` : ''}`);

      // === COST CONTROL: Check budget + acquire slot before gpt-image-1 call ===
      const costHelper = new CostControlHelper(supabase, job.id, workerId);
      let costSlotAcquired = false;
      try {
        await assertCanSpend(costHelper, 'openai_image', `scene_${i}${entry.subIndex > 0 ? `_sub_${entry.subIndex}` : ''}`, 1);
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

      // Generate image using selected model
      let imageUrl: string;
      
      if (imageModel === 'gpt-image-1') {
        // === GPT-IMAGE-1 (Cheapest: ~$0.016/image at low quality) ===
        // Has retry loop with prompt sanitization for moderation blocks
        const MAX_IMAGE_RETRIES = 3;
        let imageGenerated = false;
        
        // === CONTENT SAFETY PRE-FILTER (Roadmap #16) ===
        // Proactive sanitization BEFORE first API attempt — prevents moderation blocks
        // Uses DB-driven rules when available, falls back to hardcoded patterns
        const safetyResult = applyContentSafetyFilter(scenePrompt, safetyRules);
        if (safetyResult.changeCount > 0) {
          console.log(`[SAFETY] Scene ${i}${entry.subIndex > 0 ? `_sub_${entry.subIndex}` : ''}: ` +
            `pre-filtered ${safetyResult.changeCount} categories (${safetyResult.categories.join(', ')})`);
          await logger.snapshot('images', 'safety_filter', {
            scene_index: i,
            sub_index: entry.subIndex,
            categories_filtered: safetyResult.categories,
            change_count: safetyResult.changeCount,
            original_length: scenePrompt.length,
            filtered_length: safetyResult.filtered.length,
          }, `Safety filter: ${safetyResult.changeCount} categories filtered in scene ${i}${entry.subIndex > 0 ? `_sub_${entry.subIndex}` : ''}`);
        }
        let currentPrompt = safetyResult.filtered;
        
        for (let attempt = 1; attempt <= MAX_IMAGE_RETRIES; attempt++) {
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
                prompt: currentPrompt,
                n: 1,
                size: '1024x1536', // Portrait format for vertical video
                quality: 'low',    // Cheapest option
                output_format: 'webp',
              }),
            },
          );

          if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            console.error(`[IMAGES] gpt-image-1 scene ${i} attempt ${attempt}/${MAX_IMAGE_RETRIES}: ${response.status} - ${errorBody.substring(0, 300)}`);
            
            // === MODERATION / CONTENT POLICY (400) — sanitize and retry ===
            if (response.status === 400 && (errorBody.includes('moderation') || errorBody.includes('safety') || errorBody.includes('content_policy'))) {
              console.log(`[IMAGES] ⚠️ Moderation block on scene ${i}, attempt ${attempt}. Sanitizing prompt...`);
              if (attempt < MAX_IMAGE_RETRIES) {
                currentPrompt = sanitizeImagePrompt(currentPrompt, attempt);
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
            throw new Error(`gpt-image-1 scene ${i} failed: ${response.status} ${response.statusText} - ${errorBody.substring(0, 300)}`);
          }

          const result = await response.json();
          // gpt-image-1 returns base64 by default
          if (result.data?.[0]?.b64_json) {
            imageUrl = `data:image/webp;base64,${result.data[0].b64_json}`;
            imageGenerated = true;
          } else if (result.data?.[0]?.url) {
            imageUrl = result.data[0].url;
            imageGenerated = true;
          }

          if (imageGenerated) {
            if (attempt > 1) {
              console.log(`[IMAGES] ✓ Scene ${i} succeeded on sanitized attempt ${attempt}`);
            }
            break;
          } else {
            throw new Error(`gpt-image-1 returned no image for scene ${i}`);
          }
        }
        
        if (!imageGenerated) {
          throw new Error(`gpt-image-1 scene ${i} failed after ${MAX_IMAGE_RETRIES} attempts (moderation block)`);
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
      await upsertAsset(supabase, job.id, idempotencyKey, 'dalle_image', storagePath, publicUrl, {
        scene_index: i,
        sub_index: entry.subIndex,
        prompt: scenePrompt,
        prompt_hash: promptHash,
        art_style: artStyle,
        image_model: imageModel,
      });
      
      // Also store asset with prompt hash key (for external idempotency)
      await upsertAsset(supabase, job.id, promptHashKey, 'dalle_image', storagePath, publicUrl, {
        scene_index: i,
        sub_index: entry.subIndex,
        prompt: scenePrompt,
        prompt_hash: promptHash,
        art_style: artStyle,
        image_model: imageModel,
      });

      generatedCount++;
      scenesCompleted.push(seqIdx);
      console.log(`[IMAGES] ✓ Image ${seqIdx + 1}/${imageSequence.length} (scene ${i}${entry.subIndex > 0 ? ` sub ${entry.subIndex}` : ''}) uploaded (${imageModel}): ${publicUrl}`);

      // === COST CONTROL: Record usage + release slot ===
      if (costSlotAcquired) {
        const costIdempotencyKey = `job:${job.id}:openai_image:scene_${i}${entry.subIndex > 0 ? `_sub_${entry.subIndex}` : ''}:${promptHash.slice(0, 16)}`;
        await costHelper.recordUsage(
          'openai_image',
          costIdempotencyKey,
          { 
            image_count: 1, 
            model: imageModel,  // 'gpt-image-1'
            estimated_cost_cents: imageModel === 'gpt-image-1' ? 2 : (imageModel === 'dall-e-3' ? 8 : 4)
          },
          'images',
          `scene_${i}${entry.subIndex > 0 ? `_sub_${entry.subIndex}` : ''}`
        );
        await costHelper.releaseSlot('openai_image', `scene_${i}${entry.subIndex > 0 ? `_sub_${entry.subIndex}` : ''}`);
      }
    }

    // ======================================================================
    // BUILD IMAGE SEQUENCE MANIFEST (for assemble step)
    // Resolve all asset URLs and save the ordered sequence with durations + mood levels.
    // This replaces the assembler's uniform-duration calculation.
    // ======================================================================
    const resolvedSequence: ImageSequenceEntry[] = [];
    for (const entry of imageSequence) {
      const asset = await getAssetByKey(supabase, job.id, entry.assetKey);
      resolvedSequence.push({
        ...entry,
        url: asset?.public_url || undefined,
      });
    }

    // Also save legacy image_urls for backward compat
    const imageUrls = resolvedSequence.map(e => e.url).filter(Boolean);

    await updateJobMeta(supabase, job.id, {
      image_urls: imageUrls,
      image_model: imageModel,
      image_sequence: resolvedSequence,
    });

    console.log(`[IMAGES] ✓ Complete: ${generatedCount} generated, ${skippedCount} skipped, ${resolvedSequence.length} total images in sequence`);
    await logger.snapshot('images', 'sequence', {
      total_images: resolvedSequence.length,
      scenes: scenes.length,
      durations: resolvedSequence.map(e => e.duration),
      mood_levels: resolvedSequence.map(e => e.moodLevel),
      multi_image_scenes: resolvedSequence.filter(e => e.subIndex > 0).length,
    }, `Image sequence: ${resolvedSequence.length} images, ${resolvedSequence.filter(e => e.subIndex > 0).length} sub-images`);

    return { success: true, data: { generated: generatedCount, skipped: skippedCount, total: resolvedSequence.length } };

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
}

/**
 * Lightweight Story Anchor — extracts consistent visual identity from story + preset.
 * Cached as job asset so continuation invocations reuse it.
 */
interface StoryAnchor {
  environment: string;       // primary setting description
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
  const stylePrompt = config?.style_prompt || 'Cinematic dark photography, horror aesthetic';
  const envHint = config?.environment || '';
  
  const prompt = `You are a visual director. Analyze this story and extract a consistent visual identity for generating images.

ART STYLE: ${stylePrompt}
${envHint ? `ENVIRONMENT GUIDE: ${envHint}` : ''}
GENRE/VIBE: ${vibePreset}

STORY:
"${storyText.substring(0, 1500)}"

Extract:
1. environment: The PRIMARY setting — be specific (not just "forest" but "dense pine forest with twisted roots at dusk")
2. characterDescription: If ANY humans appear, describe them in detail (age, clothing, hair, distinguishing features). null if no humans.
3. recurringMotifs: Visual elements to repeat (specific objects, atmospheric details, textures mentioned in story)
4. horrorTone: Type of horror (psychological, supernatural, counting, cosmic, folklore, body)
5. timeOfDay: Specific lighting/time
6. isGroupStory: true if story involves multiple characters together
7. groupCount: The EXPECTED number of people (what the group SHOULD be). For "one too many" stories where the group discovers an extra person, return the NORMAL count BEFORE the extra person is noticed — NOT the total with the stranger included.

Return JSON: { "environment": "...", "characterDescription": "..." or null, "recurringMotifs": "...", "horrorTone": "...", "timeOfDay": "...", "isGroupStory": true/false, "groupCount": N or null }`;

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
    console.log(`[STORY_ANCHOR] Created: env="${(parsed.environment || '').substring(0, 60)}...", group=${parsed.isGroupStory}, count=${parsed.groupCount}`);
    return parsed as StoryAnchor;
  } catch (err) {
    console.warn(`[STORY_ANCHOR] Creation failed: ${err instanceof Error ? err.message : err}`);
    return null;
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

  // Special rules for counting horror (one_too_many)
  const countingRules = (vibePreset === 'one_too_many' && storyAnchor?.isGroupStory) ? `
COUNTING HORROR RULES (CRITICAL):
- This is a "one too many" story — the group discovers an extra person
- Expected group size: ${storyAnchor.groupCount || 'varies'}
- BEFORE the reveal moment: show exactly the expected count, everyone looks normal
- AFTER the reveal: show one extra person, with subtly unsettling expressions
- For "implied presence" scenes (feeling watched, shadows): do NOT show extra people as humans — use shadow distortions, light anomalies, motion blur
- For scenes examining photos/footage: ALWAYS show the wrong count
- VARY the scene types — not every scene needs the full group. Use establishing shots, object close-ups, atmosphere shots, and individual character moments too.` : '';

  // Backrooms-specific rules
  const liminalRules = vibePreset === 'backrooms' ? `
LIMINAL SPACE RULES:
- Avoid showing humans unless the scene text explicitly mentions a person
- Focus on empty impossible architecture, repeating patterns, fluorescent-lit void
- Use POV shots, impossible corridors, empty rooms` : '';

  const prompt = `You are an expert CINEMATOGRAPHER creating a shot list for a short horror video.
${styleContext}
${anchorContext}
${countingRules}
${liminalRules}

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
- MAINTAIN CONSISTENCY for: location/setting, character appearance, recurring props.
- The BACKGROUND and CAST stay consistent, but the CAMERA FOCUS and FRAMING change every scene.

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
    
    // Log scene type distribution for diagnostics
    const typeDistribution: Record<string, number> = {};
    for (const cue of cues) {
      typeDistribution[cue.sceneType] = (typeDistribution[cue.sceneType] || 0) + 1;
    }
    console.log(`[VISUAL_CUES] Extracted ${cues.length} cues for ${scenes.length} scenes. Types: ${JSON.stringify(typeDistribution)}`);
    
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
    const location = locationMatch ? locationMatch[1].trim().substring(0, 120) : 'atmospheric dark environment';
    const styleMatch = sanitized.match(/Style:\s*([^\n]+)/i);
    const style = styleMatch ? styleMatch[1].trim().substring(0, 200) : 'Cinematic dark photography, moody lighting';
    
    sanitized = [
      `Atmospheric scene. ${style}`,
      `Setting: ${location}`,
      `Moody and mysterious atmosphere, dim lighting, deep shadows.`,
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
): string {
  // === DB-driven prompt (new path) ===
  if (config) {
    const tensionLevel = config.tension_escalation
      ? Math.min(10, Math.floor((sceneIndex / totalScenes) * 10) + 3)
      : 5;

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
    const sceneTypeInstruction: Record<string, string> = {
      'object': 'FOCUS: Close-up of a single OBJECT or detail. Do NOT show groups of people.',
      'atmosphere': 'FOCUS: Empty space, environment, mood. Do NOT show groups of people.',
      'establishing': 'FOCUS: Wide establishing shot of the LOCATION. People may appear as tiny background elements only.',
      'character': 'FOCUS: ONE single person only — their face, hands, or body language. Do NOT show a group.',
    };
    const reinforcement = sceneType !== 'group' ? (sceneTypeInstruction[sceneType] || '') : '';

    const sceneDescription = [
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
    if (storyAnchor?.environment && sceneType !== 'establishing') {
      // Use story-specific environment but keep preset flavor
      environment = storyAnchor.environment;
    }

    // v3.1: Override lighting and color_palette with story anchor context
    // The DB config may reference a generic setting (e.g. "campfire glow")
    // that doesn't match the actual story (e.g. a train). When story anchor
    // provides timeOfDay/environment, derive setting-appropriate values.
    // v3.2: Scene-type-aware — only reference "characters/faces" for group/character
    // scenes. For atmosphere/establishing/object scenes, focus on environment lighting.
    let lighting = config.lighting;
    let colorPalette = config.color_palette;
    if (storyAnchor) {
      const tod = storyAnchor.timeOfDay || '';
      const env = storyAnchor.environment || '';
      const isCharacterScene = sceneType === 'group' || sceneType === 'character';
      // Build story-aware lighting — only mention characters for character scenes
      if (isCharacterScene) {
        lighting = `bright key lighting on all characters, ${tod ? tod + ' lighting conditions, ' : ''}practical lighting matching the setting (${env.substring(0, 80)}), ambient fill light so no face is lost in shadow`;
        colorPalette = `vivid clothing colors, clear skin tones, high color contrast, colors appropriate for: ${env.substring(0, 80)}, ${tod ? tod + ' tones' : 'rich deep tones'}`;
      } else {
        lighting = `${tod ? tod + ' lighting conditions, ' : ''}practical lighting matching the setting (${env.substring(0, 80)}), atmospheric ambient light, clear scene visibility`;
        colorPalette = `setting-appropriate colors for: ${env.substring(0, 80)}, ${tod ? tod + ' tones, ' : ''}high contrast, rich deep tones`;
      }
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
    let negativePrompt = config.negative_prompt || '';
    if (sceneType !== 'group') {
      negativePrompt = negativePrompt
        ? `${negativePrompt}\nABSOLUTELY NO: groups of people, crowds, multiple faces, multiple figures standing together.`
        : `ABSOLUTELY NO: groups of people, crowds, multiple faces, multiple figures standing together.`;
    }

    const parts = [
      sceneDescription,
      '',
      `Style: ${config.style_prompt}`,
      `Environment: ${environment}`,
      `Mood: ${mood}, tension level ${tensionLevel}/10`,
      cameraAngle ? `Camera: ${cameraAngle}` : '',
      `Lighting: ${lighting}`,
      `Color: ${colorPalette}`,
      characterBlock,
      motifsBlock,
      keywordStr ? `Keywords: ${keywordStr}` : '',
      '',
      negativePrompt,
      config.suffix,
    ].filter(Boolean);

    return parts.join('\n');
  }

  // === Legacy fallback (hardcoded maps) ===
  const styleTemplates: Record<string, string> = {
    'cinematic-dark': 'Cinematic dark photography, moody desaturated colors, deep shadows, film grain, A24 horror aesthetic.',
    'analog-horror': 'Analog horror VHS aesthetic, heavy static, glitch artifacts, scanlines, found footage style.',
    'uncanny-illustrated': 'Editorial cartoon illustration, cel-shaded horror, bold black ink outlines, flat colors, uncanny faces.',
  };
  const styleBase = styleTemplates[artStyle] || styleTemplates['cinematic-dark'];

  // Use visual cue description if available, else raw text
  const sceneDescription = visualCue?.description || sceneText.substring(0, 200);
  const cameraHint = visualCue?.camera ? ` Camera: ${visualCue.camera}.` : '';

  const envHints: Record<string, string> = {
    'forest': 'dark misty forest, twisted trees',
    'hallway': 'abandoned corridor, peeling walls',
    'attic': 'dusty attic, cobwebs, old furniture',
    'urban': 'empty city streets at night',
  };
  const visualPreset = 'forest'; // legacy default
  const envHint = envHints[visualPreset] || envHints['forest'];

  const keywordStr = keywords.slice(0, 3).join(', ');
  return `${styleBase} Scene: ${sceneDescription}.${cameraHint} Environment: ${envHint}. Keywords: ${keywordStr}. Portrait orientation 9:16. No text, no words, no letters.`;
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
  console.log(`[ASSEMBLE] Render resume check: pending_render_job_id=${pendingRenderJobId || 'NOT_SET'}, video_url=${job.video_url || 'NOT_SET'}`);

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
            console.log(`[ASSEMBLE] ✓ Render completed from previous invocation: ${videoUrl}`);
            
            // Clear pending render from meta
            await updateJobMeta(supabase, job.id, { pending_render_job_id: null });
            
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
                  console.log(`[ASSEMBLE] ✓ Render completed: ${videoUrl}`);
                  await updateJobMeta(supabase, job.id, { pending_render_job_id: null });
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
            console.log(`[ASSEMBLE] ⏰ Render ${pendingRenderJobId} still in progress — re-firing continuation`);
            // pending_render_job_id is already stored in meta, no need to update
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

  const imageAssets = await getAssetsByPrefix(supabase, job.id, `${job.id}:image_generate:`);
  if (imageAssets.length === 0) {
    return { success: false, error: 'No image assets found - run images step first' };
  }

  const imageUrls = imageAssets
    .sort((a, b) => {
      // Parse scene_X or scene_X_sub_Y from idempotency key
      // e.g. "jobid:image_generate:scene_3" → sceneIdx=3, subIdx=0
      // e.g. "jobid:image_generate:scene_3_sub_1" → sceneIdx=3, subIdx=1
      const parseKey = (key: string) => {
        const part = key.split('scene_')[1] || '0';
        const segments = part.split('_sub_');
        return {
          scene: parseInt(segments[0]) || 0,
          sub: segments.length > 1 ? parseInt(segments[1]) || 0 : 0,
        };
      };
      const ak = parseKey(a.idempotency_key);
      const bk = parseKey(b.idempotency_key);
      return ak.scene !== bk.scene ? ak.scene - bk.scene : ak.sub - bk.sub;
    })
    .map(a => a.public_url)
    .filter(Boolean) as string[];

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

    // === LEASE GRACE CHECK: Verify enough time before expensive rendering ===
    await requireLeaseGrace(supabase, job.id, workerId, 'video assembly');

    // === COST CONTROL: Check budget + acquire slot before rendering ===
    const costHelper = new CostControlHelper(supabase, job.id, workerId);
    try {
      await assertCanSpend(costHelper, rendererService, 'assemble', 1);
    } catch (costError) {
      if (isCostLimitError(costError)) {
        console.error(`[ASSEMBLE] ❌ Cost limit hit: ${costError instanceof Error ? costError.message : costError}`);
        return { 
          success: false, 
          error: `cost_limit_exceeded: ${rendererService} - ${costError instanceof Error ? costError.message : 'budget reached'}`,
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
      let effectsConfig = null;
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

      // Snapshot the assembly input before rendering
      await logger.snapshot('assemble', 'payload', {
        renderer: 'ffmpeg',
        image_count: imageUrls.length,
        audio_url: audioUrl.slice(0, 100),
        duration: duration,
        has_music: musicEnabled,
        music_track: job.meta?.music_track_id || null,
        music_volume: musicCfg?.default_volume || 0.18,
        ducking_enabled: musicCfg?.ducking?.enabled || false,
        effects_config_resolved: !!effectsConfig,
        effects_enabled: effectsConfig?.enabled ?? 'legacy',
        effects_intensity: effectsConfig?.intensity ?? null,
        subtitle_config_resolved: !!subtitleConfig,
        subtitle_style: subtitleConfig?.style ?? 'bold',
      }, 'Video assembly input');

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
      );
      
      // Handle continuation signal — render still in progress, need re-invocation
      if (videoUrl.startsWith('__CONTINUATION__:')) {
        const renderJobId = videoUrl.split(':')[1];
        console.log(`[ASSEMBLE] Render in progress (${renderJobId}), storing in meta for resume`);
        
        // Store the renderer's job ID so the next invocation can resume polling
        await updateJobMeta(supabase, job.id, { pending_render_job_id: renderJobId });
        
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

    // Snapshot assembly output
    await logger.snapshot('assemble', 'output', {
      video_url: videoUrl.slice(0, 200),
      method: videoRendererUrl ? 'ffmpeg' : 'creatomate',
      image_count: imageUrls.length,
      duration: duration,
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
  const renderPayload = JSON.stringify({
    job_id: jobId,
    images: imageUrls,
    audio_url: audioUrl,
    durations: durations,
    captions: captions,
    effects: {
      kenBurns: true,
      fadeTransitions: true,
      fadeIn: true,
      fadeOut: true,
      filmGrain: !cmActive,
      vignette: !cmActive,
      horrorGrade: !cmActive,
      captionStyle: (subtitleConfig as Record<string, unknown>)?.style as string || 'bold',
    },
    // v4.0: Controlled Motion effects config (overrides legacy effects when present)
    effects_config: effectsConfig || null,
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

  // Start the render job — retry on 503 (renderer busy with another job)
  // Max 4 attempts for campaigns where multiple jobs may queue up
  const MAX_RENDER_ATTEMPTS = 4;
  let response: Response | null = null;
  
  for (let attempt = 1; attempt <= MAX_RENDER_ATTEMPTS; attempt++) {
    const res = await fetch(`${rendererUrl}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: renderPayload,
    });

    if (res.ok) {
      response = res;
      break;
    }

    // Handle 503 (server busy) — wait and retry
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

    // Non-503 error or final attempt — throw
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
  // TikTok: API still in review — nothing actually posts (StubAdapter generates fake IDs)
  // Twitter/X: Requires paid API tier — posting fails permanently
  // Remove these from the schedule until their APIs are production-ready.
  const DISABLED_PLATFORMS = new Set(['tiktok', 'twitter']);
  const uniquePlatforms = allUnique.filter(p => {
    if (DISABLED_PLATFORMS.has(p)) {
      console.log(`[SCHEDULE] ⏭ Skipping disabled platform "${p}" (API not available)`);
      return false;
    }
    return true;
  });

  if (uniquePlatforms.length === 0) {
    console.warn('[SCHEDULE] All platforms are disabled — nothing to schedule');
    return { success: true, data: { scheduled_at: null, platforms: [], results: {}, note: 'All platforms disabled' } };
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
