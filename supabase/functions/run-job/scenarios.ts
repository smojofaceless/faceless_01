// =====================================================
// SCENARIOS MODULE - Curated Reddit-Inspired Horror Scenarios
// VERSION: 1.0.0 - 2026-02-12
// =====================================================
// Replaces live Reddit fetching (blocked by Reddit IP restrictions).
// Provides 24 curated horror scenarios across 5 subreddit styles
// that give each "reddit_trending_horror" story a unique thematic
// direction while the DNA system handles structural uniqueness.
// =====================================================

export interface HorrorScenario {
  /** Thematic category */
  category: string;
  /** Which subreddit style this mimics */
  subreddit_style: "nosleep" | "letsnotmeet" | "creepypasta" | "paranormal" | "shortscarystories";
  /** The core fear this taps into */
  core_fear: string;
  /** Setting hint for visual/atmosphere guidance */
  setting_hint: string;
  /** One-line premise that guides the AI */
  premise: string;
  /** Specific sensory details to include */
  sensory_anchors: string[];
  /** What makes this "Reddit-authentic" */
  reddit_flavor: string;
}

/** 24 curated scenarios across 5 subreddit styles */
export const HORROR_SCENARIOS: HorrorScenario[] = [
  // ── r/nosleep style (first-person, ongoing threat) ──
  {
    category: "digital_haunting",
    subreddit_style: "nosleep",
    core_fear: "technology betraying you",
    setting_hint: "apartment at night, blue screen glow",
    premise: "Someone discovers their smart home devices are responding to commands they never gave — and the responses are getting personal.",
    sensory_anchors: ["LED light shifting color", "speaker crackling", "notification chime at 3 AM"],
    reddit_flavor: "Posted as a desperate plea for help, with edits showing escalation in real-time",
  },
  {
    category: "wrong_number",
    subreddit_style: "nosleep",
    core_fear: "being watched by a stranger",
    setting_hint: "suburban house, curtains drawn",
    premise: "A series of wrong-number texts become increasingly specific about the recipient's daily routine.",
    sensory_anchors: ["phone vibrating", "curtain moving", "car idling outside"],
    reddit_flavor: "Screenshots included in the original post, commenters telling OP to call police",
  },
  {
    category: "night_shift",
    subreddit_style: "nosleep",
    core_fear: "isolation and vulnerability at work",
    setting_hint: "empty building, fluorescent lights humming",
    premise: "A night security guard notices the building has one more floor on the elevator panel than officially exists.",
    sensory_anchors: ["elevator ding", "footsteps above", "static on radio"],
    reddit_flavor: "Part 1 of a series, guard documenting each shift's discoveries",
  },
  {
    category: "sleep_paralysis",
    subreddit_style: "nosleep",
    core_fear: "helplessness in your own body",
    setting_hint: "dark bedroom, moonlight through blinds",
    premise: "Someone's sleep paralysis entity starts leaving physical evidence of its visits.",
    sensory_anchors: ["weight on chest", "breathing nearby", "scratch marks on wall"],
    reddit_flavor: "OP attaches photos of the evidence, each update more disturbing",
  },
  {
    category: "new_house",
    subreddit_style: "nosleep",
    core_fear: "your safe space is compromised",
    setting_hint: "old house, creaking wood, basement door",
    premise: "New homeowners find a room behind a wall that doesn't appear on any blueprint — and someone has been living in it.",
    sensory_anchors: ["musty air", "worn mattress", "food wrappers", "peephole drilled into wall"],
    reddit_flavor: "Posted with shaky phone photos, commenters identifying items in the hidden room",
  },

  // ── r/letsnotmeet style (real encounter, human threat) ──
  {
    category: "rideshare_horror",
    subreddit_style: "letsnotmeet",
    core_fear: "trapped with a dangerous stranger",
    setting_hint: "car interior at night, unfamiliar route",
    premise: "A rideshare passenger realizes the driver has locked the doors and is heading in the wrong direction.",
    sensory_anchors: ["child lock clicking", "GPS showing wrong route", "driver's eyes in rearview mirror"],
    reddit_flavor: "Written years after the event, with the calm detachment of someone who survived",
  },
  {
    category: "hiking_alone",
    subreddit_style: "letsnotmeet",
    core_fear: "being followed in the wilderness",
    setting_hint: "remote trail, dense forest, no cell signal",
    premise: "A solo hiker keeps finding trail markers that someone has altered to lead deeper into unmarked territory.",
    sensory_anchors: ["snapping twigs behind", "altered cairns", "carved symbols on trees"],
    reddit_flavor: "Factual retelling with GPS coordinates, commenters identifying the area",
  },
  {
    category: "neighbor_watching",
    subreddit_style: "letsnotmeet",
    core_fear: "the threat is next door",
    setting_hint: "suburban neighborhood, fence line, windows",
    premise: "Someone discovers their neighbor has been entering their house while they're at work — the pet camera caught everything.",
    sensory_anchors: ["door handle turning", "items slightly moved", "breathing on camera mic"],
    reddit_flavor: "Includes timestamps from the camera footage, escalating over weeks",
  },
  {
    category: "late_night_gas_station",
    subreddit_style: "letsnotmeet",
    core_fear: "nowhere to run",
    setting_hint: "empty gas station, highway, flickering lights",
    premise: "A traveler stops at a remote gas station and the attendant silently slides a note under the glass: 'Don't look at the van. Get in your car. Drive.'",
    sensory_anchors: ["buzzing fluorescent light", "van engine running", "gravel crunching"],
    reddit_flavor: "Short, punchy retelling — commenter verified the gas station exists",
  },
  {
    category: "online_dating",
    subreddit_style: "letsnotmeet",
    core_fear: "digital deception made real",
    setting_hint: "restaurant, then parking lot, then car chase",
    premise: "A first date reveals increasingly wrong details — the person knows things about you that weren't in your profile.",
    sensory_anchors: ["phone buzzing with unknown calls", "familiar perfume/cologne", "photos of your house on their phone"],
    reddit_flavor: "Posted as a warning to others, with advice on digital safety",
  },

  // ── r/creepypasta style (mythological, larger-than-life) ──
  {
    category: "radio_signal",
    subreddit_style: "creepypasta",
    core_fear: "forbidden knowledge",
    setting_hint: "amateur radio setup, late night, static-filled room",
    premise: "An amateur radio operator picks up a broadcast that describes events happening in their house — in real time — narrated by their own voice.",
    sensory_anchors: ["radio static", "own voice echoing", "descriptions matching reality"],
    reddit_flavor: "Formatted as a found document or transcript, clinical and unsettling",
  },
  {
    category: "backrooms",
    subreddit_style: "creepypasta",
    core_fear: "infinite entrapment",
    setting_hint: "yellow-lit office space, endless corridors, damp carpet",
    premise: "Someone clips through reality and finds themselves in an endless space of identical rooms — but the rooms are slowly changing to match places from their childhood.",
    sensory_anchors: ["fluorescent buzz", "wet carpet smell", "familiar wallpaper appearing"],
    reddit_flavor: "Wiki-style documentation with 'levels' and survival rules",
  },
  {
    category: "ritual_game",
    subreddit_style: "creepypasta",
    core_fear: "rules you can't undo",
    setting_hint: "dark room, candles, mirrors",
    premise: "Instructions for a 'game' circulate online — those who complete it gain something, but lose something they don't notice until it's too late.",
    sensory_anchors: ["candle flame bending wrong", "mirror reflection delayed", "cold spot in room"],
    reddit_flavor: "Formatted as instructions with bold warnings and 'DO NOT' rules",
  },
  {
    category: "lost_episode",
    subreddit_style: "creepypasta",
    core_fear: "corrupted innocence",
    setting_hint: "living room, old TV, VHS static",
    premise: "Someone finds an unaired episode of a children's show from the 90s — the characters seem aware they're being watched and beg for help.",
    sensory_anchors: ["VHS tracking lines", "distorted music", "characters breaking fourth wall"],
    reddit_flavor: "Includes episode descriptions and 'recovered' dialogue transcripts",
  },

  // ── r/paranormal style (unexplained, true-account feel) ──
  {
    category: "childhood_imaginary_friend",
    subreddit_style: "paranormal",
    core_fear: "what children see that adults can't",
    setting_hint: "family home, child's bedroom, hallway at night",
    premise: "Parents find old drawings by their child of an 'imaginary friend' — the friend's description matches a person who died in the house decades ago.",
    sensory_anchors: ["crayon drawings", "child laughing alone", "cold draft from closed room"],
    reddit_flavor: "Parent posting with photos of the drawings, asking if anyone recognizes the figure",
  },
  {
    category: "inherited_house",
    subreddit_style: "paranormal",
    core_fear: "the dead aren't gone",
    setting_hint: "old family farmhouse, dusty rooms, locked doors",
    premise: "After inheriting a relative's house, someone finds a journal documenting the exact same paranormal events they're now experiencing — written 40 years ago.",
    sensory_anchors: ["yellowed pages", "identical handwriting", "door opening on its own"],
    reddit_flavor: "Side-by-side comparison of journal entries and current experiences",
  },
  {
    category: "roadside_apparition",
    subreddit_style: "paranormal",
    core_fear: "things that shouldn't exist",
    setting_hint: "empty highway, fog, headlights cutting dark",
    premise: "Multiple drivers on the same stretch of highway report picking up the same hitchhiker — who vanishes from the back seat at the same mile marker.",
    sensory_anchors: ["fog parting", "rear view mirror empty", "wet seat after vanishing"],
    reddit_flavor: "Compiled from multiple accounts, with a map of sightings",
  },
  {
    category: "hospital_ghost",
    subreddit_style: "paranormal",
    core_fear: "death lingering where it happened",
    setting_hint: "hospital corridor, night shift, room 4B",
    premise: "Night shift nurses report a patient calling for help from a room that has been sealed off since a fire — the call button still works.",
    sensory_anchors: ["call button light blinking", "smoke smell", "voice through intercom"],
    reddit_flavor: "Posted by a nurse with a throwaway account, verified by other staff in comments",
  },
  {
    category: "cemetery_photograph",
    subreddit_style: "paranormal",
    core_fear: "proof of the impossible",
    setting_hint: "old cemetery, overcast, stone angels",
    premise: "Someone photographing gravestones for a genealogy project finds that every photo contains the same figure standing in the background — getting closer in each shot.",
    sensory_anchors: ["camera shutter", "figure in peripheral vision", "stone cold to touch"],
    reddit_flavor: "Posted with the actual photos, commenters enhancing and analyzing the figure",
  },

  // ── r/shortscarystories style (micro-horror, twist ending) ──
  {
    category: "mirror_wrong",
    subreddit_style: "shortscarystories",
    core_fear: "your reflection is not you",
    setting_hint: "bathroom, single mirror, harsh lighting",
    premise: "Someone notices their reflection blinks a half-second too late — and each day the delay gets longer.",
    sensory_anchors: ["mirror condensation", "reflection smiling", "light flickering"],
    reddit_flavor: "Under 500 words, devastating punchline in the last sentence",
  },
  {
    category: "baby_monitor",
    subreddit_style: "shortscarystories",
    core_fear: "something near your child",
    setting_hint: "nursery, dim night light, monitor screen",
    premise: "A parent checks the baby monitor and sees a second figure leaning over the crib — but they're the only adult in the house.",
    sensory_anchors: ["monitor static", "baby cooing", "shadow moving across screen"],
    reddit_flavor: "Told in present tense, ending mid-action as parent runs to the room",
  },
  {
    category: "voicemail_from_self",
    subreddit_style: "shortscarystories",
    core_fear: "temporal wrongness",
    setting_hint: "quiet room, phone screen glowing",
    premise: "Someone receives a voicemail from their own number — it's their own voice, crying, begging them not to go home tonight.",
    sensory_anchors: ["phone vibrating", "own voice distorted", "clock showing wrong time"],
    reddit_flavor: "Two paragraphs, gut-punch ending, 200+ upvotes in first hour",
  },
  {
    category: "counting_people",
    subreddit_style: "shortscarystories",
    core_fear: "something hiding among us",
    setting_hint: "group setting, campfire or dinner table",
    premise: "A group photo reveals one more person than was actually present — and no one can identify the extra face.",
    sensory_anchors: ["camera flash", "unfamiliar smile", "head count mismatch"],
    reddit_flavor: "Flash fiction format, the reveal IS the ending",
  },
  {
    category: "search_history",
    subreddit_style: "shortscarystories",
    core_fear: "someone using your identity",
    setting_hint: "desk, laptop screen, dark room",
    premise: "Someone checks their browser history and finds searches they never made — increasingly specific questions about how to dispose of a body their exact weight and height.",
    sensory_anchors: ["cursor moving on its own", "search timestamps at 3 AM", "webcam light on"],
    reddit_flavor: "Micro-fiction, under 300 words, each line more disturbing than the last",
  },
];

// =====================================================
// DARK_ORIGINS SCENARIOS - Documentary Dark Biography Engine
// VERSION: 1.0.0 - 2026-03-05
// =====================================================
// Curated origin stories for fictional horror icons and
// dark biographies told in documentary narrator voice.
// Each scenario presents an ORIGINAL character inspired by
// horror archetypes — never named copyrighted characters.
// =====================================================

export interface DarkOriginsScenario {
  /** Thematic category */
  category: string;
  /** Documentary sub-genre style */
  doc_style: "true_crime_doc" | "biography_channel" | "cold_case" | "investigation_files" | "dark_history";
  /** The core fear this taps into */
  core_fear: string;
  /** Setting hint for visual/atmosphere guidance */
  setting_hint: string;
  /** One-line premise that guides the AI */
  premise: string;
  /** Specific sensory details to include */
  sensory_anchors: string[];
  /** What makes this feel like a "real" documentary */
  doc_flavor: string;
}

/** 20 curated dark origin scenarios */
export const DARK_ORIGINS_SCENARIOS: DarkOriginsScenario[] = [
  // ── Horror Icon Archetypes (original characters inspired by classics) ──
  {
    category: "masked_stalker",
    doc_style: "true_crime_doc",
    core_fear: "the shape that watches from the yard",
    setting_hint: "quiet suburban street, 1978, Halloween decorations",
    premise: "A six-year-old boy in Haddonfield, Illinois stopped speaking after his sister's death. He spent 15 years in a state institution, never blinking, never reacting — until the night he walked out. What he did next made him the most studied case in criminal psychology.",
    sensory_anchors: ["white expressionless mask", "breathing behind a hedge", "kitchen knife on linoleum"],
    doc_flavor: "Narrated like a Dateline special — calm, factual, letting the horror speak for itself",
  },
  {
    category: "drowned_revenant",
    doc_style: "cold_case",
    core_fear: "the dead that refuse to stay dead",
    setting_hint: "summer camp lakeside, 1957, foggy morning",
    premise: "Camp Crystal Pine closed in 1958 after a drowning the counselors could have prevented. The boy's mother disappeared a year later. But every summer since, someone returns to the lake. The body count at Crystal Pine now stands at 47 — and the lake has never been drained.",
    sensory_anchors: ["hockey mask half-submerged", "lake water dripping on cabin floor", "machete marks on a dock post"],
    doc_flavor: "Cold case reopened — evidence photos, suppressed police reports, interviews with survivors",
  },
  {
    category: "dream_researcher",
    doc_style: "investigation_files",
    core_fear: "a killer you cannot escape even in sleep",
    setting_hint: "burned-out boiler room, 1984, Springwood Ohio",
    premise: "Dr. Frederick Krueger ran a sleep research lab in a small Ohio town. Parents trusted him with their children. When the truth came out, the town handled it themselves — outside the law. But Krueger had been documenting something in those sleep studies. Something about the boundary between waking and dreaming that he claimed to have crossed.",
    sensory_anchors: ["industrial glove with razors", "burn scars on a fedora", "children's drawings of a striped sweater"],
    doc_flavor: "Investigation files — sealed court documents, redacted witness statements, a town that refuses to talk",
  },
  {
    category: "possessed_doll",
    doc_style: "dark_history",
    core_fear: "something alive inside a child's toy",
    setting_hint: "toy factory, 1988, Chicago industrial district",
    premise: "Charles Leclair was a toymaker who believed objects could hold consciousness. His final creation — a red-haired doll called 'Good Guy' — was found at three separate crime scenes in 1988. The doll was destroyed each time. Each time, an identical one appeared somewhere else. Leclair himself had been dead for six months before the first incident.",
    sensory_anchors: ["pull-string voice box", "tiny overalls stained dark", "a child insisting 'he told me to'"],
    doc_flavor: "Dark history — factory records, police evidence photos, a product recall that never made the news",
  },
  {
    category: "sewer_entity",
    doc_style: "dark_history",
    core_fear: "the thing that wears a friendly face",
    setting_hint: "small town storm drain, 1958-1985, Derry Maine",
    premise: "Every 27 years, the children of Derryfield, Maine go missing at six times the national average. The pattern was first documented by a local librarian in 1985. Witnesses across three generations describe the same figure: a performer in white face paint who appears near storm drains, offering something the child wants most. No adult has ever seen it directly.",
    sensory_anchors: ["red balloon floating against the wind", "paper boat in gutter water", "laughter echoing from underground"],
    doc_flavor: "Historical pattern documentary — census records, missing persons statistics, newspaper clippings spanning decades",
  },
  {
    category: "phone_killer",
    doc_style: "true_crime_doc",
    core_fear: "the voice on the line knows your secrets",
    setting_hint: "suburban house, 1996, cordless phone ringing",
    premise: "In the fall of 1996, someone began calling teenagers in Woodsboro, California. The voice asked one question: 'What's your favorite scary movie?' Those who answered wrong were found dead within the hour. The killer wore a costume anyone could buy. That was the point — anyone could be behind the mask. The calls continued for three years across four different towns.",
    sensory_anchors: ["ghostface mask on a bedroom floor", "phone cord stretched tight", "a question that shouldn't be threatening but is"],
    doc_flavor: "True crime doc — 911 call recordings, crime scene photos described by investigators, a mask sold in every costume shop",
  },
  {
    category: "puzzle_craftsman",
    doc_style: "investigation_files",
    core_fear: "someone who designs suffering as art",
    setting_hint: "abandoned warehouse, puzzle boxes on shelves, 1987",
    premise: "Philip LeMarchand was a French craftsman who built puzzle boxes in the 18th century. Of the 270 boxes he created, only six have been recovered. Everyone who solved one reported the same thing before they disappeared: the walls of whatever room they were in began to rearrange. LeMarchand's workshop journals describe 'the configuration' — a geometric arrangement that, when achieved, opens something that was never meant to be opened.",
    sensory_anchors: ["ornate golden puzzle box clicking", "chains in darkness", "skin pulled taught"],
    doc_flavor: "Investigation files — auction house records, disappearance clusters, a pattern spanning centuries",
  },
  {
    category: "backwoods_family",
    doc_style: "true_crime_doc",
    core_fear: "a family that has its own rules about meat",
    setting_hint: "rural Texas farmhouse, 1973, meatpacking equipment",
    premise: "The Sawyer family ran a slaughterhouse in rural Texas for three generations. When the plant closed in 1969, the family didn't stop working. Between 1969 and 1974, thirty-one travelers disappeared along a 40-mile stretch of Route 304. The largest family member — known locally only as 'Leatherface' — was never identified. He wore the faces of others. Literally.",
    sensory_anchors: ["chainsaw idling in a barn", "meat hooks hanging empty", "a dinner table set for guests who can't leave"],
    doc_flavor: "True crime doc — highway patrol reports, a missing persons map with a suspicious cluster, neighbors who 'never saw nothing'",
  },

  // ── Real-Feeling Dark Biographies ──
  {
    category: "cursed_musician",
    doc_style: "biography_channel",
    core_fear: "what someone traded for fame",
    setting_hint: "recording studio, 1962, Mississippi delta",
    premise: "Lucian Deville recorded one album in 1962. It sold four copies. Then he disappeared for three years. When he returned, his voice had changed — deeper, resonant, impossible. His second album went platinum. Session musicians refused to play with him. The recording engineer noted that Deville cast no shadow in the studio lights. He died on stage in 1971. The autopsy showed organs aged well beyond his 34 years.",
    sensory_anchors: ["vinyl record skipping", "crossroads at midnight", "guitar strings that hum on their own"],
    doc_flavor: "Biography channel — record labels, session musician interviews, an autopsy report that was sealed for 30 years",
  },
  {
    category: "vanishing_preacher",
    doc_style: "cold_case",
    core_fear: "a shepherd who devours his flock",
    setting_hint: "white church, 1954, small Appalachian town",
    premise: "Reverend Elias Harmon arrived in Crow Hollow, West Virginia in 1951 with no past and a voice that could fill a cathedral. His congregation grew from 12 to 400 in three years. Then members started disappearing — one or two a month, always the ones who lived alone, always after a private 'counseling session.' When the state police finally came in 1954, the church was empty. All 400 members were gone. Harmon's office contained 400 handwritten confessions — none of them his.",
    sensory_anchors: ["church bells at midnight", "empty pews still warm", "a ledger of names with dates — the last one is tomorrow"],
    doc_flavor: "Cold case — state police archives, a ghost town that used to be thriving, confessions that describe things the writers couldn't have known",
  },
  {
    category: "taxidermist",
    doc_style: "true_crime_doc",
    core_fear: "someone preserving what should decay",
    setting_hint: "taxidermy workshop, 1957, Wisconsin farmhouse",
    premise: "Edgar Holloway was the best taxidermist in Dane County — his work was so lifelike that customers said the animals' eyes followed them. After his death in 1957, authorities found his private collection in a locked basement. The 'animals' in that room were not animals. Holloway had perfected a preservation technique that no modern science can replicate. The bodies looked alive. Some of them had been dead for twenty years.",
    sensory_anchors: ["glass eyes in a jar", "formaldehyde smell", "a hand that's too soft to be fake"],
    doc_flavor: "True crime doc — evidence photos described clinically, a preservation technique that died with its creator, neighbors who noticed nothing for decades",
  },
  {
    category: "childrens_host",
    doc_style: "investigation_files",
    core_fear: "the person your children trusted most",
    setting_hint: "TV studio, 1972, colorful set now abandoned",
    premise: "Mr. Whiskers' Playhouse ran on local Channel 9 from 1968 to 1975. Children loved it. Parents trusted it. When the show was abruptly cancelled, the station claimed 'budget cuts.' But former crew members tell a different story. The show's host — real name unknown, always in costume — had been embedding messages in the background of every episode. When the messages were decoded in 2004, they contained the home addresses of every child who had ever written a fan letter.",
    sensory_anchors: ["puppet with painted smile", "test pattern at sign-off", "children's laughter on damaged tape"],
    doc_flavor: "Investigation files — recovered broadcast tapes, decoded background messages, a host whose real identity was never established",
  },
  {
    category: "night_nurse",
    doc_style: "cold_case",
    core_fear: "the caretaker who decides who lives",
    setting_hint: "hospital ward, 1983, night shift, fluorescent lights",
    premise: "Nurse Margaret Hollister worked the night shift at St. Catherine's for eleven years. She was beloved — patients requested her by name. Her ward had the highest recovery rate in the hospital. It also had the highest number of unexpected deaths. The pattern was invisible until a new intern ran the numbers: every patient Margaret 'took a special interest in' had a 50/50 chance of survival. She wasn't saving them. She was choosing.",
    sensory_anchors: ["IV drip counting seconds", "rubber-soled shoes on tile", "a clipboard with two columns"],
    doc_flavor: "Cold case — hospital records cross-referenced, an intern's discovery ignored for years, a nurse evaluation that reads 'exceptionally compassionate'",
  },
  {
    category: "photographer",
    doc_style: "dark_history",
    core_fear: "a camera that takes something from you",
    setting_hint: "portrait studio, 1891, heavy curtains and flash powder",
    premise: "Emmett Voss was a portrait photographer in Victorian Boston. His subjects praised his work — every portrait was impossibly lifelike, capturing something no other photographer could. But his subjects changed after sitting for him. They became quieter, duller, as if something had been removed. Voss's own journals describe his process: 'I do not capture the likeness. I capture the life.' His darkroom, found sealed after his death in 1903, contained 2,000 portraits. Each one still blinks.",
    sensory_anchors: ["flash powder igniting", "a portrait where the eyes track you", "developing fluid that smells like iron"],
    doc_flavor: "Dark history — Victorian-era studio records, subjects who all died young, portraits that auction houses refuse to sell",
  },
  {
    category: "radio_dj",
    doc_style: "investigation_files",
    core_fear: "a broadcast that changes the listener",
    setting_hint: "radio station, 1977, late night broadcast booth",
    premise: "WKRD 104.7 broadcast from midnight to 4 AM, seven nights a week, from 1975 to 1977. The DJ — known only as 'The Nightcrawler' — never appeared at the station in person. The equipment ran itself. Callers who got through described conversations they couldn't remember afterward, but their behavior changed. Twenty-three regular listeners were later committed to psychiatric facilities. All of them could recite the same phrase in a language that linguists cannot identify.",
    sensory_anchors: ["AM radio static", "a voice too smooth to be human", "phone ringing in an empty booth"],
    doc_flavor: "Investigation files — FCC complaints, psychiatric evaluations with identical symptoms, broadcast tapes that degrade faster than they should",
  },
  {
    category: "dollmaker_village",
    doc_style: "dark_history",
    core_fear: "a town replaced by something artificial",
    setting_hint: "German village, 1952, cobblestone streets, doll workshop",
    premise: "The village of Hallstatt in the Bavarian Alps had 200 residents in 1950. By 1953, it had 200 residents — but the postal service noticed that no one had sent or received mail in three years. When investigators arrived, every resident was present, accounted for, and alive. But something was wrong. Their movements were too precise. Their smiles arrived at exactly the same moment. The village toymaker, Heinrich Falk, had been making life-sized dolls for decades. His workshop was empty. So was every house, if you lifted the floorboards.",
    sensory_anchors: ["porcelain eyes that don't quite track", "mechanical clicking beneath a smile", "a workshop full of molds shaped like neighbors"],
    doc_flavor: "Dark history — postal service anomaly report, a village that still exists but no one visits, floorboards that should never be lifted",
  },
  {
    category: "surgeon_collector",
    doc_style: "biography_channel",
    core_fear: "someone who perfects by removing",
    setting_hint: "private clinic, 1963, sterile white, jars on shelves",
    premise: "Dr. Alistair Crane was a plastic surgeon who believed beauty had a mathematical formula. His patients left his clinic looking flawless — symmetrical, proportioned, perfect. But they couldn't stop coming back. Each visit, Dr. Crane removed something else. 'Refinement,' he called it. By the time authorities shut down his clinic in 1968, his most loyal patients were barely recognizable as human. What he removed, he kept. His collection filled seventeen jars, organized by what he called 'essence of imperfection.'",
    sensory_anchors: ["surgical lamp buzzing", "a mirror covered with a cloth", "before-and-after photos where the 'after' has no expression"],
    doc_flavor: "Biography channel — medical board hearings, patients who testified in his defense even after everything, a collection that was destroyed before it could be catalogued",
  },
  {
    category: "carnival_hypnotist",
    doc_style: "cold_case",
    core_fear: "losing control of your own mind",
    setting_hint: "traveling carnival, 1969, tent with velvet curtains",
    premise: "The Midnight Carnival traveled through the American South from 1965 to 1971. Its star attraction was Madame Zara — a hypnotist who could make volunteers forget their own names. Audiences loved it. But in every town the carnival visited, one person would be reported missing within a week of the show. Always a volunteer from the act. Always someone who lived alone. Madame Zara's real name was never discovered. Neither were the volunteers.",
    sensory_anchors: ["pocket watch swinging", "carnival calliope music distorted", "a volunteer's eyes going blank"],
    doc_flavor: "Cold case — carnival route mapped against missing persons, a tent that always smelled like lavender and something else, ticket stubs found in missing persons' homes",
  },
  {
    category: "tunnel_builder",
    doc_style: "investigation_files",
    core_fear: "what someone builds beneath your feet",
    setting_hint: "suburban neighborhood, 1985, perfectly maintained lawns above tunnels below",
    premise: "When Frank Delmore's house collapsed in 1987, rescue workers discovered something beneath the foundation: a tunnel system spanning three city blocks. Delmore had been digging for twenty-two years. The tunnels connected to the basements of fourteen neighboring homes — all accessible through hidden doors the homeowners never knew existed. The tunnels contained living quarters, surveillance equipment, and detailed journals spanning two decades. Delmore knew everything about his neighbors. Everything.",
    sensory_anchors: ["dirt walls with handprints", "a periscope made from plumbing pipe", "journals with entries for every dinner conversation"],
    doc_flavor: "Investigation files — structural engineering reports, journal excerpts that read like a nature documentary about humans, fourteen families who never felt safe again",
  },
  {
    category: "ice_cream_man",
    doc_style: "true_crime_doc",
    core_fear: "the everyday figure no one questions",
    setting_hint: "suburban street, 1978, ice cream truck melody playing",
    premise: "The ice cream truck on Maple Drive played the same melody every afternoon from May to September, 1974 through 1978. Every child on the block knew the driver as 'Mr. Freeze.' He gave free popsicles on birthdays. He knew every child's name. After his arrest in 1979, authorities discovered he had never held an ice cream vendor's license. The truck wasn't registered. The company on the side — 'Happy Time Ice Cream' — didn't exist. No one could explain where the ice cream came from. Or what was in it.",
    sensory_anchors: ["jingle playing slightly too slow", "a freezer that's colder than it should be", "a child's drawing of a smiling truck driver"],
    doc_flavor: "True crime doc — a license that was never issued, lab results that were sealed, parents who still hear the melody in their sleep",
  },
];

/**
 * Pick a dark origins scenario with setting deduplication.
 */
export function pickDarkOriginsScenario(recentSettings: string[] = []): DarkOriginsScenario {
  const available = DARK_ORIGINS_SCENARIOS.filter(
    s => !recentSettings.includes(s.setting_hint)
  );

  const pool = available.length > 0 ? available : DARK_ORIGINS_SCENARIOS;
  const idx = Math.floor(Math.random() * pool.length);
  
  const picked = pool[idx];
  console.log(`[SCENARIO] Dark Origins picked: "${picked.category}" (${picked.doc_style}) — ${picked.core_fear}`);
  console.log(`[SCENARIO] Setting: ${picked.setting_hint}`);
  console.log(`[SCENARIO] Pool size: ${pool.length}/${DARK_ORIGINS_SCENARIOS.length} (${recentSettings.length} settings avoided)`);
  
  return picked;
}

/**
 * Build a prompt injection for dark origins documentary scenarios.
 */
export function buildDarkOriginsPromptInjection(scenario: DarkOriginsScenario): string {
  return `
═══════════════════════════════════════
🎬 DARK ORIGINS — DOCUMENTARY DIRECTION
═══════════════════════════════════════
This story should feel like a segment from a true crime documentary or dark biography series.

DOCUMENTARY STYLE: ${scenario.doc_style === 'true_crime_doc' ? 'True Crime Documentary — Dateline, 48 Hours' :
  scenario.doc_style === 'biography_channel' ? 'Biography Channel — dark profile of a fascinating figure' :
  scenario.doc_style === 'cold_case' ? 'Cold Case Files — reopened investigation, suppressed evidence' :
  scenario.doc_style === 'investigation_files' ? 'Investigation Files — sealed documents, classified reports' :
  'Dark History — historical horror buried and forgotten'}

THEMATIC PREMISE (use as inspiration, not verbatim):
${scenario.premise}

CORE FEAR TO EXPLOIT: ${scenario.core_fear}
ATMOSPHERE/SETTING DIRECTION: ${scenario.setting_hint}

SENSORY DETAILS TO WEAVE IN (pick 2-3):
${scenario.sensory_anchors.map(a => `- ${a}`).join('\n')}

VOICE & FEEL (CRITICAL):
- Third-person documentary narrator — calm, factual, investigative
- "This was a real person. This really happened." energy at all times
- Open with a hook that sounds like a documentary teaser: "This man was..." / "In 1974, a small town..." / "What he left behind..."
- Include specific dates, locations, and numbers — they make fiction feel like fact
- The narrator knows more than they're telling — implication over exposition
- End with an unresolved thread or chilling postscript: "The case was never closed" / "The recordings were never explained"

IMPORTANT:
- Do NOT name real copyrighted characters — these are ORIGINAL characters inspired by archetypes
- Do NOT copy the premise literally — use it as thematic direction
- The DNA contract specifications above take priority for structure
- Use this scenario to flavor the CONTENT, not override the FORMAT
═══════════════════════════════════════`;
}

/**
 * Get the index of a dark origins scenario.
 */
export function getDarkOriginsScenarioIndex(scenario: DarkOriginsScenario): number {
  return DARK_ORIGINS_SCENARIOS.findIndex(
    s => s.category === scenario.category && s.doc_style === scenario.doc_style
  );
}

/**
 * Pick a horror scenario with setting deduplication.
 * Avoids recently used settings by checking the last N scenarios' setting_hints.
 * 
 * @param recentSettings - Array of recently used setting_hint values to avoid
 * @returns A horror scenario that hasn't been used recently
 */
export function pickHorrorScenario(recentSettings: string[] = []): HorrorScenario {
  // Try to find a scenario whose setting hasn't been used recently
  const available = HORROR_SCENARIOS.filter(
    s => !recentSettings.includes(s.setting_hint)
  );

  const pool = available.length > 0 ? available : HORROR_SCENARIOS;
  const idx = Math.floor(Math.random() * pool.length);
  
  const picked = pool[idx];
  console.log(`[SCENARIO] Picked: "${picked.category}" (${picked.subreddit_style}) — ${picked.core_fear}`);
  console.log(`[SCENARIO] Setting: ${picked.setting_hint}`);
  console.log(`[SCENARIO] Pool size: ${pool.length}/${HORROR_SCENARIOS.length} (${recentSettings.length} settings avoided)`);
  
  return picked;
}

/**
 * Build a prompt injection for Reddit-inspired horror scenarios.
 * This is appended to the contract prompt to add thematic direction.
 */
export function buildScenarioPromptInjection(scenario: HorrorScenario): string {
  return `
═══════════════════════════════════════
🎭 REDDIT-INSPIRED HORROR DIRECTION
═══════════════════════════════════════
This story should feel like a viral ${scenario.subreddit_style === 'nosleep' ? 'r/nosleep' :
  scenario.subreddit_style === 'letsnotmeet' ? 'r/LetsNotMeet' :
  scenario.subreddit_style === 'creepypasta' ? 'r/creepypasta' :
  scenario.subreddit_style === 'paranormal' ? 'r/Paranormal' :
  'r/shortscarystories'} post.

THEMATIC PREMISE (use as inspiration, not verbatim):
${scenario.premise}

CORE FEAR TO EXPLOIT: ${scenario.core_fear}
ATMOSPHERE/SETTING DIRECTION: ${scenario.setting_hint}

SENSORY DETAILS TO WEAVE IN (pick 2-3):
${scenario.sensory_anchors.map(a => `- ${a}`).join('\n')}

VOICE & FEEL (CRITICAL):
- First-person. The narrator is recounting what happened to THEM.
- Open with something mundane before the horror creeps in (checking a phone, waiting for coffee, a routine task)
- Include at least one brief line of dialogue or internal thought
- The narrator rationalizes and doubts before accepting something is wrong
- Sound like a real person confessing — NOT a horror-movie narrator

IMPORTANT:
- Do NOT mention Reddit, subreddits, or "OP"
- Do NOT copy the premise literally — use it as thematic direction
- The DNA contract specifications above take priority for structure
- Use this scenario to flavor the CONTENT, not override the FORMAT
═══════════════════════════════════════`;
}

/**
 * Get the index of a scenario in the HORROR_SCENARIOS array.
 * Useful for storing which scenario was used.
 */
export function getScenarioIndex(scenario: HorrorScenario): number {
  return HORROR_SCENARIOS.findIndex(
    s => s.category === scenario.category && s.subreddit_style === scenario.subreddit_style
  );
}
