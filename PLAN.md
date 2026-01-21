PLAN.md

Implementation plan for Tone Ladder, a hue-shift tonal ramp generator.

⸻

1. Project Structure

The codebase should remain small and legible.

Modularity is applied only where it provides clear benefit:
	•	the colour algorithm (core intellectual property)
	•	persistence and history logic (stateful and error-prone)

All other coordination logic may live in app.js to avoid unnecessary plumbing.

/
├── index.html
├── assets/
│   ├── css/
│   │   └── styles.css        (compiled from SCSS)
│   ├── scss/
│   │   └── styles.scss
│   └── js/
│       ├── app.js            (UI, state, event wiring, orchestration)
│       ├── storage.js        (localStorage read/write, schema versioning)
│       ├── history.js        (recent list, starred list, undo buffer)
│       └── colorModels/
│           ├── index.js      (public API: generateRamp)
│           ├── convert.js    (colour space conversions)
│           └── hueShift.js   (core hue-shift algorithm)
├── CLAUDE.md
├── PLAN.md
└── README.md                (setup notes + usage notice)

No additional modules should be created unless they clearly reduce complexity.
The goal is clarity, not architectural purity.

All paths are relative. No absolute URLs. Compatible with GitHub Pages deployment from repository root.

2. Core Algorithm Approach

The algorithm is the reason this app exists. It must produce artist-style tonal ramps where warm light creates cool shadows (and vice versa), not naive HSL lightness scaling.

2.1 Colour Space

The algorithm operates internally in OKLCH (or another perceptually uniform colour space). OKLCH provides:
	•	perceptually uniform lightness (L)
	•	predictable chroma behaviour (C)
	•	controllable hue shifts (H)

Hex input is converted to OKLCH for manipulation, then converted back to hex for output.

2.2 Interface
generateRamp(baseHex, temperature, steps, mode) → string[]

Parameters:
	•	baseHex: 6-digit hex string (with or without #, default #2F6FED) 
	•	temperature: number
	•	range: -1.0 (cool light) → 0.0 (neutral) → +1.0 (warm light)
	•	steps: integer (allowed values: 9 or 11)
	•	mode: “conservative” or “painterly” (default 'painterly')

Returns an array of hex strings ordered from darkest → lightest.

2.3 Behavioural Rules
	1.	Base placement
The input colour appears at or near the perceptual midpoint of the ramp.
	2.	Hue shift direction and strength
	•	Hue shift is driven by the light temperature value.
	•	A temperature of 0 represents neutral light and produces no hue shift.
	•	Positive temperature values (warm light):
	•	highlights drift toward yellow/orange hues
	•	shadows drift toward blue/purple hues
	•	Negative temperature values (cool light):
	•	highlights drift toward blue/cyan hues
	•	shadows drift toward orange/red hues
The absolute value of temperature controls shift strength; the sign controls direction.
	3.	Hue shift magnitude
	•	Zero shift at the base colour position
	•	Shift increases toward the extremes
	•	Conservative mode: maximum shift approximately ±6°
	•	Painterly mode: maximum shift approximately ±14°
	4.	Saturation curve
	•	Saturation peaks near midtones
	•	Saturation decreases toward both extremes
	•	Prevents oversaturated highlights or muddy shadows
	5.	Lightness extremes
	•	Lightest step must not be pure white (L < 0.98 in OKLCH)
	•	Darkest step must not be pure black (L > 0.08 in OKLCH)
	•	Extremes are compressed to produce usable endpoint colours

2.4 Validation Requirement

The algorithm must pass this acceptance test:

In Painterly mode with default demo settings, the generated ramp must show:
	•	at least 8° hue difference between the lightest step and the base
	•	at least 8° hue difference in the opposite direction between the darkest step and the base

   Default demo values must be chosen so this behaviour is visible immediately on page load.

If this test fails, the algorithm is too conservative and the app has no value over naive HSL tools.



3. Application State and Data Flow

3.1 State Shape
{
  input: {
    baseHex: string,
    label: string,
    temperature: number,
    steps: number,
    mode: "conservative" | "painterly"
  },
  preview: {
    rampHexes: string[] | null
  },
  history: {
    recent: HistoryEntry[],
    starred: HistoryEntry[]
  },
  undo: {
    removed: { entry: HistoryEntry, index: number } | null
  }
}

HistoryEntry:
{
  id: string,
  label: string,
  slugLabel: string,
  baseHex: string,
  temperature: number,
  steps: number,
  mode: string,
  rampHexes: string[],
  createdAt: number
}

3.2 Data Flow
	1.	User edits input fields → input state updates → preview regenerates (not a generation)
	2.	User clicks Generate → new HistoryEntry created → added to recent → undo buffer cleared → this is a generation
	3.	User clicks “X” on recent item → entry removed → stored in undo buffer (in-memory)
	4.	User clicks Undo → entry restored to previous index → undo buffer cleared
	5.	User stars an item → entry copied to starred list
	6.	User unstars an item → entry removed from starred list
	7.	User clicks Clear all → confirmation prompt → recent, starred, and undo buffer cleared

3.3 Definition of “Generation”

A generation occurs only when:
	•	a new history entry is committed to the recent list

A generation does not occur when:
	•	input fields change
	•	preview updates
	•	items are removed, restored, starred, or unstarred

When a new generation is committed:
	•	the undo buffer is cleared

4. History, Undo, and Storage Semantics

4.1 Storage

Single localStorage key: toneLadder

Schema:
{
  version: 1,
  recent: HistoryEntry[],
  starred: HistoryEntry[]
}

Storage writes occur:
	•	when an entry is added to recent
	•	when an entry is removed from recent
	•	when an entry is starred or unstarred
	•	when clear all is confirmed

Storage does not write:
	•	undo buffer (in-memory only)
	•	preview state
	•	input field state

4.2 Recent List
	•	Maximum 10 entries
	•	Newest entries appear first
	•	De-duplication: identical label + baseHex + temperature + steps + mode replaces older entry
	•	Each entry displays an “X” remove button

4.3 Starred List
	•	No maximum
	•	No “X” remove button
	•	Star action copies entry into starred list
	•	Unstar action removes entry from starred list
	•	Recent list remains unchanged

4.4 Undo Behaviour
	•	Scope: Recent list only
	•	Single-level, in-memory buffer

On “X” remove:
	•	store removed entry and index in undo buffer
	•	remove entry from recent
	•	write updated lists to storage

On Undo:
	•	restore entry to original index
	•	clear undo buffer
	•	write updated lists to storage

Undo buffer is cleared when:
	•	page reloads
	•	a new generation is committed
	•	undo is performed
	•	clear all is confirmed

4.5 Clear All
	•	Display confirmation prompt: “Are you sure?”
	•	On confirm: clear recent, starred, and undo buffer
	•	Write empty state to storage


5. UI Responsibilities

This section describes what each UI region does, not how it looks.

5.1 Input Panel
	•	Hex colour input
	•	Colour label input (canonical, never auto-changed)
	•	Light temperature slider
	•	Cool ← Neutral → Warm
	•	Default: slightly warm (e.g. +0.25)
	•	Steps selector (9 or 11)
	•	Mode toggle (conservative / painterly)
	•	Generate button

Input changes update preview only. Generate commits to history.

5.2 Preview Panel
	•	Displays tonal ramp as swatches
	•	Shows hex values
	•	May show hue angles for validation (optional, non-essential)
	•	No history mutation

5.3 History Panel

Recent:
	•	Up to 10 entries
	•	X remove button
	•	Star button
	•	Clicking entry loads it into preview

Starred:
	•	Persistent favourites
	•	Star / unstar only
	•	No X remove

Undo:
	•	Visible only when undo buffer exists
	•	Restores last removed recent item

Clear all:
	•	Prompts confirmation
	•	Clears recent and starred

5.4 Export Panel
	•	Visible when ramp exists
	•	Two formats:
	•	–{slug}-{step}
	•	–color-{slug}-{step}
	•	Copy to clipboard
   •	Step values are indices: 0..(steps-1), where 0 is darkest and steps-1 is lightest.

Slug rules:
	•	lowercase
	•	spaces → hyphens
	•	remove non-alphanumeric characters

⸻

6. Implementation Sequence

Phase 1: Algorithm Foundation
	1.	Implement colour conversion utilities (hex ↔ OKLCH)
	2.	Implement hue-shift algorithm
	3.	Expose generateRamp API
	4.	Validate painterly hue shift ≥8° at extremes

Phase 2: Storage and History
	5.	Implement storage.js
	6.	Implement history.js with undo rules

Phase 3: HTML and SCSS
	7.	Build semantic HTML
	8.	Write SCSS and compile to CSS

Phase 4: Application Wiring
	9.	Implement app.js:
	•	state ownership
	•	preview rendering
	•	generation commit
	•	history interactions
	•	export + copy

Phase 5: Validation
	10.	End-to-end behaviour testing
	11.	Algorithm validation
	12.	Export validation

⸻

7. Acceptance Checks

Algorithm
	•	Correct number of steps
	•	Darkest → lightest order
	•	Base near midpoint
	•	Painterly ≥8° hue shift
	•	No pure white / black
	•	Saturation peaks near midtones

History & State
	•	Preview does not create generations
	•	Generate creates generation
	•	Undo is session-only
	•	X remove only in Recent
	•	Starred unaffected by undo

Constraints
	•	No frameworks or libraries
	•	Relative paths only
	•	Algorithm isolated from app.js
	•	Single compiled CSS file

⸻

Appendix: Canonical Label Handling
	•	Display label stored exactly as entered
	•	Slug stored separately for exports
	•	Slug rules:
	•	lowercase
	•	spaces to hyphens
	•	remove non-alphanumeric
	•	collapse repeated hyphens

Examples:
Ocean Blue → ocean-blue
Primary_Red → primary-red
BRAND ACCENT → brand-accent
Test–Color → test-color
