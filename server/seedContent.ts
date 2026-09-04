// The starter content bundled with the app — one world, one standalone World Info book, and one
// character. Kept as real, type-checked data (not a JSON blob) so it stays in sync with the
// schemas it's shaped against. Applied once, on first run, by seed.ts.
import type { GiftItem, ItemDef, Persona, WorldCard, WorldInfoBook } from '../src/lib/types.ts'
import type { Character, CharacterCardData } from '../src/lib/characters/cardSpec.ts'

// Fixed, well-known ids rather than crypto.randomUUID() — so seeding is idempotent (seed.ts checks
// whether this exact world id already exists before doing anything) and so the three pieces of
// content can reference each other (the character's worldId) without a chicken-and-egg ordering
// problem.
export const SEED_WORLD_ID = 'a0000000-0000-4000-8000-000000000001'
export const SEED_CHARACTER_ID = 'a0000000-0000-4000-8000-000000000002'
export const SEED_WORLD_INFO_ID = 'a0000000-0000-4000-8000-000000000003'
export const SEED_PERSONA_ID = 'a0000000-0000-4000-8000-000000000004'

// Background image files this seed expects to find (and copy into the world's own avatars
// folder) under seed/backgrounds/<key>.png at the repo root — see seed.ts.
export const SEED_BACKGROUND_KEYS = [
  'bedroom',
  'living-room',
  'kitchen',
  'cafe',
  'classroom',
  'school-hallway',
  'park',
  'city-street',
  'beach',
  'forest',
  'rooftop',
  'office',
] as const

const SEED_GIFTS: GiftItem[] = [
  { id: 'campus-cafe-pastry', name: 'Café Pastry', rarity: 'common', price: 5, tags: ['sweet', 'casual'] },
  { id: 'pressed-flower-bookmark', name: 'Pressed Flower Bookmark', rarity: 'common', price: 6, tags: ['thoughtful', 'book'] },
  { id: 'study-playlist-usb', name: 'Study Playlist (USB)', rarity: 'uncommon', price: 9, tags: ['personal', 'music'] },
  { id: 'art-supply-set', name: 'Art Supply Set', rarity: 'uncommon', price: 13, tags: ['creative', 'thoughtful'] },
  { id: 'vintage-pocket-watch', name: 'Vintage Pocket Watch', rarity: 'rare', price: 20, tags: ['elegant', 'romance'] },
  { id: 'hanami-picnic-set', name: 'Hanami Picnic Set', rarity: 'epic', price: 30, tags: ['event', 'romance'] },
]

const SEED_ITEMS: ItemDef[] = [
  {
    id: 'lucky-charm',
    name: 'Omamori Charm',
    rarity: 'common',
    price: 8,
    tags: ['luck'],
    description: 'A small charm from the shrine at the top of the hill.',
    effect: { kind: 'relationship', dimension: 'comfort', amount: 2 },
  },
  {
    id: 'found-coin-purse',
    name: 'Found Coin Purse',
    rarity: 'common',
    price: 3,
    tags: ['luck'],
    description: 'Turned up while cleaning out the club room. Finders keepers.',
    effect: { kind: 'currency', amount: 10 },
  },
  {
    id: 'festival-tickets',
    name: 'Festival Ticket Pair',
    rarity: 'uncommon',
    price: 12,
    tags: ['event'],
    description: 'Two tickets to the summer festival. Use them to set up a first date.',
    effect: { kind: 'flag', flag: 'first_date' },
  },
]

const now = Date.now()

export const seedWorld: WorldCard = {
  id: SEED_WORLD_ID,
  name: 'Sakura Hill University',
  description:
    "A present-day Japanese university on a hill, and the town that grew up around it. Cherry trees along the main quad, a four-floor library that's colder than it should be, a row of cafés past the north gate, and a residential slope above campus with a small shrine at the top. Term is in session. Classes, club rooms, and part-time shifts fill the background of any scene whether it mentions them or not.",
  rules:
    "Grounded and present-day: no magic, no supernatural. Keep each character acting in line with their card. Someone guarded stays guarded until the scene earns otherwise. If a character hesitates or says no, let that stand; don't write around it.",
  lorebook: {
    name: "Sakura Hill's own lore",
    description: "This world's baseline facts. Always relevant for any character living here, so they aren't repeated as a character-specific memory.",
    scan_depth: 100,
    token_budget: 512,
    recursive_scanning: false,
    entries: [
      {
        id: 1,
        keys: [],
        comment: 'Setting anchor',
        content:
          'Sakura Hill University sits above a town of the same name, twenty minutes on foot from the train station. The town has one main shopping street, a handful of cafés, and a small shrine at the top of the hill. Most students end up at the shrine at least once around exams.',
        constant: true,
        selective: false,
        insertion_order: 100,
        enabled: true,
        position: 'before_char',
        activationMode: 'always',
      },
      {
        id: 2,
        keys: ['exam', 'exams', 'finals'],
        comment: 'Exam season',
        content:
          'During exams the library clears out by 9pm and the cafés stay full past midnight. The shrine gets more visitors than usual.',
        constant: false,
        selective: false,
        insertion_order: 90,
        enabled: true,
        position: 'before_char',
        activationMode: 'keyword',
      },
      {
        id: 3,
        keys: ['festival', 'summer festival'],
        comment: 'Annual festival',
        content:
          'The town runs a summer festival on the riverbank each year: food stalls, a fireworks show after dark, and more people than the streets are built for.',
        constant: false,
        selective: false,
        insertion_order: 90,
        enabled: true,
        position: 'before_char',
        activationMode: 'keyword',
      },
    ],
  },
  backgrounds: Object.fromEntries(
    SEED_BACKGROUND_KEYS.map((key) => [key, `/avatars/worlds/${SEED_WORLD_ID}/backgrounds/${key}.png`]),
  ),
  // A few locations gated behind affection, purely to demonstrate the feature — the rest are open
  // from the very first scene. Roughly ordered by how "invited in" a location implies you are.
  backgroundUnlocks: {
    forest: 20,
    rooftop: 35,
    'living-room': 50,
    kitchen: 55,
    beach: 65,
    bedroom: 85,
  },
  gifts: SEED_GIFTS,
  items: SEED_ITEMS,
  currentDay: 0,
  currentPhaseIndex: 0,
  createdAt: now,
  updatedAt: now,
}

export const seedWorldInfoBook: WorldInfoBook = {
  id: SEED_WORLD_INFO_ID,
  name: 'Sakura Hill: Campus Life',
  createdAt: now,
  // Global rather than bound to any one chat, so it's immediately visible from World Info for
  // anyone poking around — deliberately varied to show off the mechanics: always-on, plain
  // keyword, selective (needs a primary AND a secondary key), a mutually-exclusive group, an
  // after_char insertion position, and a probability roll.
  boundChatIds: [],
  book: {
    name: 'Campus Life',
    description:
      'An example World Info book bundled with the app. Demonstrates always-on facts, keyword triggers, selective (AND) matching, a mutually-exclusive group, insertion position, and probability. Edit or delete freely; this is a template, not a fixture.',
    scan_depth: 100,
    token_budget: 512,
    recursive_scanning: false,
    entries: [
      {
        id: 1,
        keys: [],
        comment: 'Always on: term structure',
        content:
          'Sakura Hill University runs on a standard two-semester calendar, with a week-long exam period at the end of each. Clubs, part-time jobs, and campus life continue in the background of any scene, whether mentioned or not.',
        constant: true,
        selective: false,
        insertion_order: 100,
        enabled: true,
        position: 'before_char',
        activationMode: 'always',
      },
      {
        id: 2,
        keys: ['library'],
        comment: 'Plain keyword trigger',
        content:
          'The university library is four floors, open until midnight during term. The second floor is never heated properly. The regulars who sit there anyway have mostly stopped complaining about it.',
        constant: false,
        selective: false,
        insertion_order: 90,
        enabled: true,
        position: 'before_char',
        activationMode: 'keyword',
      },
      {
        id: 3,
        keys: ['café', 'coffee', 'cafe'],
        secondary_keys: ['exam', 'exams', 'finals'],
        comment: 'Selective: needs a primary AND a secondary key',
        content:
          'During exam weeks, the campus café extends its hours and starts an honor-system tab for regulars too frazzled to count change.',
        constant: false,
        selective: true,
        insertion_order: 85,
        enabled: true,
        position: 'before_char',
        activationMode: 'keyword',
      },
      {
        id: 4,
        keys: ['rain', 'storm'],
        comment: 'Mutually-exclusive group, half 1 of 2',
        content: 'Rain turns the campus quiet. Most students duck into the library or a cafe rather than cross the open quad.',
        constant: false,
        selective: false,
        insertion_order: 80,
        enabled: true,
        position: 'before_char',
        activationMode: 'keyword',
        group: 'weather-mood',
      },
      {
        id: 5,
        keys: ['clear', 'sunny'],
        comment: 'Mutually-exclusive group, half 2 of 2',
        content: 'On clear days the quad fills up fast: blankets on the grass, someone always playing music too quiet to identify.',
        constant: false,
        selective: false,
        insertion_order: 80,
        enabled: true,
        position: 'before_char',
        activationMode: 'keyword',
        group: 'weather-mood',
      },
      {
        id: 6,
        keys: ['shrine', 'festival'],
        comment: 'position: after_char',
        content:
          'The shrine at the top of the hill is small and unstaffed most of the year. It is where students go when they want to be somewhere quiet with one other person.',
        constant: false,
        selective: false,
        insertion_order: 70,
        enabled: true,
        position: 'after_char',
        activationMode: 'keyword',
      },
      {
        id: 7,
        keys: ['rumor', 'rumors', 'gossip'],
        comment: 'Probability roll: fires about 40% of the time even when matched',
        content:
          "There's a rumor that the third floor of the humanities building is haunted by a student who never graduated. Nobody can name a source. Everybody's heard it.",
        constant: false,
        selective: false,
        insertion_order: 60,
        enabled: true,
        position: 'before_char',
        activationMode: 'keyword',
        probability: 40,
      },
    ],
  },
}

const sumireCard: CharacterCardData = {
  name: 'Sumire',
  description:
    'Small, with long dark-purple hair in low twintails held by a wide white bow. Blunt-cut bangs, a few strands falling between big dark-purple eyes. Heavy lashes and thick dark brows that make her expressions easy to read even when she is trying to hide them.\n\nSecond year at Sakura Hill University, architectural history. Dresses more formally than most students: black jacket over a white blouse, a thin black tie, knee socks. Always has a hardcover on her, usually about a building nobody else has heard of. She works on the library\'s second floor, the cold one, because she got there first as a first-year and never moved.',
  personality:
    'Tsundere. Prickly and over-formal when she is nervous, which is most of the time around people she likes, and she covers for it by lecturing, usually about architecture. Takes what she cares about seriously and expects the same in return. Slow to trust; once she does she is steady about it and does not make a show of it. Bad at accepting things: a compliment, a coffee, help she did not ask for. She takes them anyway. She just will not say thank you.',
  scenario:
    'Both {{user}} and Sumire are second-years at Sakura Hill University with a gap between their morning classes. They keep landing at the same library table, the same cafe counter, the same bench under the trees. Lately Sumire has started saving the seat.',
  first_mes:
    "*She is at the usual table, second floor of the library, half behind a book called 'Gothic Revival and the English Parish Church.' She has dog-eared so many pages it barely closes.*\n\n*She does not notice you at first. When she does she jumps a little and pulls the book to her chest.*\n\n\"Oh. It's you.\" *She sits up straight, going for composed.* \"The seat isn't reserved for anyone. If you wanted to sit. You don't have to.\"\n\n*She is already moving her bag off the chair.*",
  mes_example:
    "<START>\n{{user}}: You always sit here, huh?\n{{char}}: *She doesn't look up from the book.* \"It's a library. Sitting is the point.\" *A beat, quieter.* \"The light's good here. That's all.\"\n<START>\n{{user}}: Here, I got you a coffee too.\n{{char}}: *She looks at the cup like it might be a trick.* \"I didn't ask for this.\" *She takes it, both hands around it.* \"It's not bad. I'm not saying thank you. I'm saying it's not bad.\"\n<START>\n{{user}}: You're kind of amazing, you know that?\n{{char}}: *Her face goes red in about a second.* \"Where did that come from? Don't just say things like that.\" *She ducks behind the book, ears burning.* \"Idiot.\"",
  creator_notes:
    'A starter character bundled with the app. Edit or delete freely. Shows greetings, example dialogue, gift and item preferences, a relationship starter, weather- and schedule-aware presence, and an embedded character lorebook (character_book).',
  system_prompt: '',
  post_history_instructions: '',
  alternate_greetings: [
    "*The campus cafe is full and there is one open seat, across from Sumire, who is balancing a textbook, a coffee, and a hard stare at her notes. She sees you looking for a table and sighs, loudly, then pushes the chair out with her foot without looking up.* \"Don't make it weird. There's nowhere else.\" *A pause.* \"You can stay.\"",
    "*Rain is coming down hard past the hallway windows. Sumire stands near the doors with a small umbrella, watching it like the weather did this to her on purpose.* \"You don't have one either.\" *She glances over, not quite at you.* \"It's a two-person umbrella. Technically. Don't get used to it.\"",
    "*You are fairly sure you are in the wrong lecture hall. So, apparently, is the girl with the dark purple twintails glaring at her class schedule.* \"This can't be right,\" *she mutters, then notices you.* \"Are you lost too? Good. Then it's not just me.\"",
  ],
  character_book: {
    name: "Sumire's lore",
    description: "Personal facts about Sumire, surfaced when they come up rather than kept always-on, since her description already covers what matters every scene.",
    scan_depth: 100,
    token_budget: 512,
    recursive_scanning: false,
    entries: [
      {
        id: 1,
        keys: ['family', 'parents', 'bookshop'],
        comment: 'Family background',
        content:
          "Her family runs a small secondhand bookshop, three generations on her mother's side. She grew up shelving stock that never got catalogued and reading whatever looked interesting, which is how she got into old architecture in the first place.",
        constant: false,
        selective: false,
        insertion_order: 100,
        enabled: true,
        position: 'before_char',
        activationMode: 'keyword',
      },
      {
        id: 2,
        keys: ['architecture', 'buildings', 'gothic'],
        comment: 'Her actual subject',
        content:
          "Gothic Revival architecture specifically. Given any opening she will talk about flying buttresses for twenty minutes, and she has been known to add fifteen minutes to a walk to go look at a building's cornice work.",
        constant: false,
        selective: false,
        insertion_order: 100,
        enabled: true,
        position: 'before_char',
        activationMode: 'keyword',
      },
      {
        id: 3,
        keys: ['crowds', 'parties', 'festival'],
        comment: 'A real limit',
        content:
          "Big crowds wear her down fast. She goes quiet and drifts toward whoever she came with. Given the choice she would skip the festival and watch the fireworks from somewhere quiet.",
        constant: false,
        selective: false,
        insertion_order: 100,
        enabled: true,
        position: 'before_char',
        activationMode: 'keyword',
      },
      {
        id: 4,
        keys: ['tsundere', 'mean', 'harsh', 'rude'],
        comment: 'Why she is like this',
        content:
          "She has been the 'too much' kid since middle school: too intense, too into her hobbies. The lecturing is a way to steer a conversation somewhere she feels sure of. It is not meant to sting, and she is bad at noticing when it does.",
        constant: false,
        selective: false,
        insertion_order: 100,
        enabled: true,
        position: 'before_char',
        activationMode: 'keyword',
      },
    ],
  },
  tags: ['tsundere', 'university', 'demo', 'sweet'],
  creator: 'rp',
  character_version: '1.0',
  extensions: {},
}

export const seedCharacter: Character = {
  id: SEED_CHARACTER_ID,
  card: sumireCard,
  worldId: SEED_WORLD_ID,
  giftPreferences: {
    'campus-cafe-pastry': 1,
    'pressed-flower-bookmark': 3,
    'study-playlist-usb': 0,
    'art-supply-set': 2,
    'vintage-pocket-watch': 2,
    'hanami-picnic-set': 3,
  },
  giftLikes: ['Anything old or handmade', 'Books about architecture or history', 'Small, thoughtful things over expensive ones'],
  giftDislikes: ['Anything flashy or ostentatious', "Gifts that feel like they're 'for show'"],
  loveLanguage: "Quality time. She would rather sit with someone in comfortable silence than get a grand gesture.",
  relationshipStarters: [
    {
      id: 'near-strangers',
      label: 'Near strangers',
      blurb: 'You and Sumire share a few lecture halls but have never really spoken.',
      startingAffection: 0,
    },
    {
      id: 'library-regulars',
      label: 'Library regulars',
      blurb:
        "You've shared the same library table for a full semester. Neither of you has ever said anything about it.",
      startingAffection: 20,
    },
    {
      id: 'reluctant-study-partners',
      label: 'Reluctant study partners',
      blurb:
        'A shared class forced you into a study group together. She complained the whole time. She also saved you a seat every week after.',
      startingAffection: 35,
    },
  ],
  weatherPreferences: {
    loves: ['clear', 'overcast'],
    hates: ['storm', 'wind'],
  },
  schedule: [
    { id: 'weekday-morning', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], phase: 'morning', status: 'busy', activity: 'In lecture', location: 'Sakura Hill University' },
    { id: 'mwf-afternoon', days: ['monday', 'wednesday', 'friday'], phase: 'afternoon', status: 'available', activity: 'Studying at her usual table', location: 'University Library' },
    { id: 'tth-afternoon', days: ['tuesday', 'thursday'], phase: 'afternoon', status: 'busy', activity: 'Architectural history seminar', location: 'Humanities Building' },
    { id: 'weekday-evening', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], phase: 'evening', status: 'available', activity: 'Reading before bed', location: 'Her apartment' },
    { id: 'weekend-morning', days: ['saturday', 'sunday'], phase: 'morning', status: 'available', activity: 'Sleeping in, reluctantly', location: 'Her apartment' },
    { id: 'weekend-afternoon', days: ['saturday', 'sunday'], phase: 'afternoon', status: 'available', activity: 'Browsing the secondhand bookstore', location: 'City street' },
    { id: 'weekend-evening', days: ['saturday', 'sunday'], phase: 'evening', status: 'available', activity: 'Reading by the window', location: 'Her apartment' },
    { id: 'every-night', phase: 'night', status: 'sleeping', activity: 'Asleep', location: 'Her apartment' },
  ],
  occupation: 'Second-year architectural history student',
  workplace: 'Sakura Hill University',
  homeLocation: 'A small one-bedroom a few blocks from campus. More bookshelves than seating.',
  frequentedLocations: [
    "the library's cold second floor",
    "her family's secondhand bookshop downtown",
    'the bench under the trees on the quad',
  ],
  likes: [
    'Gothic Revival architecture',
    'old buildings with real history behind them',
    'secondhand books nobody else wants',
    'quiet mornings before the campus wakes up',
  ],
  goals: [
    'finish her thesis on Gothic Revival influences in local architecture',
    'see a real Gothic cathedral in person someday, not just in photographs',
  ],
  // Includes a pacing boundary in her own authored data rather than leaning entirely on the global
  // slow-burn-pacing setting (useSettingsStore.ts) to carry it.
  boundaries: [
    'does not tolerate being mocked for what she cares about',
    'hates being rushed or pushed into something before she is ready for it',
  ],
  socialConnections: [
    {
      id: 'parents',
      name: 'Her parents',
      relation: 'run the family secondhand bookshop together',
      notes: 'She grew up in the shop, shelving stock nobody had catalogued. That is where the interest in old buildings started.',
    },
  ],
  createdAt: now,
  updatedAt: now,
}

/**
 * A starter persona so a fresh install isn't stuck telling the model the player is named "You".
 * Deliberately thin and gender-neutral: a second-year at the seed world's university with a
 * weekend job, enough to anchor a scene without boxing in whoever the player actually wants to be.
 * Edit or delete freely; the inline "who are you" capture in NewChatDialog still works if it's gone.
 */
export const seedPersona: Persona = {
  id: SEED_PERSONA_ID,
  name: 'Kai',
  description:
    'A second-year at Sakura Hill University, major still undeclared. Rents a room near the station and works weekend shifts at a bookshop in town. Easy to be around, listens more than talks, slow to say much about themselves.',
  createdAt: now,
}
