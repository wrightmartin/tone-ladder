Tone Ladder Behaviour Contract (refined)

This document defines observable behaviour.
All algorithm changes must preserve these outcomes.

⸻

1. Endpoint Behaviour
	•	temperature === 0
Endpoints may be neutral (grey/white/black).
	•	temperature ≠ 0
Endpoints must be tinted. Pure neutral endpoints are not allowed.

Notes:
	•	“Tinted” means chroma > ε (small but non-zero), not “visibly colourful”.

⸻

2. Global Hue & Pattern Rules
	•	No categorical hue jumps
A ladder must not cross into a different colour family (e.g. green in red, mint in yellow).
Small adjacent hue drift is allowed.
	•	No pattern-breaking rungs
No single step may appear lighter, duller, or hue-shifted out of sequence.
	•	Local hue continuity
Hue direction must remain locally consistent unless a reversal is perceptually invisible.

⸻

3. Temperature Semantics

Temperature biases hue by light behaviour, not by rotating the base colour.
	•	Warm light (temperature > 0)
	•	Highlights bias warm (~65°, yellow/cream)
	•	Shadows bias cool (~205°, blue)
	•	Cool light (temperature < 0)
	•	Highlights bias cool
	•	Shadows bias warm
	•	Neutral light (temperature === 0)
	•	No hue bias; purely tonal ladder

⸻

4. Yellow Family Guardrail (Highlights)

Applies to yellow-family bases (≈ 60°–110°).
	•	The top 3 highlights must remain recognisably yellow/cream.
	•	They must not drift into green/mint territory, especially under cool light.
	•	Pass/fail rule: hue beyond the green boundary (≈ 120° in tests) in the top 3 highlights is a failure.

Principle:

A yellow ladder must still read as yellow at the light end.
Green highlights turn a ladder into a palette.

⸻

5. Red Family Guardrail (Highlights)

Applies to red-family bases (≈ 330°–360° or 0°–40°).
	•	The top 3 highlights must remain within the red family under cool light.
	•	Forbidden band: ≈ 80°–170° (yellow-green → green).
If a highlight enters this band with visible chroma, it fails.
	•	Guardrail is chroma-aware: near-zero chroma hues are ignored.
	•	When triggered, softly clamp hue to ≤ 75° (warm/orange range).

Principle:

A red ladder must still read as red or warm at the light end.
Green/khaki highlights break ladder semantics.

⸻

6. Near-Neutral Base Behaviour

For near-neutral bases (chroma ≤ 0.03), light colour becomes the dominant signal.
	•	Warm light reveals warm highlights and cool shadows.
	•	Cool light reveals cool highlights and warm shadows.

Rules:
	•	Chroma is generated (not scaled from the base).
	•	Chroma peaks at the endpoints and collapses toward the midpoint.	
	•	Maximum tint chroma is capped (~0.035).
	•	Hue direction is set directly from light anchors.

This behaviour activates only when:
	•	base chroma ≤ NEUTRAL_BASE_C_MAX, and
	•	temperature ≠ 0

Otherwise, the standard algorithm applies unchanged.

Principle:

Greys reveal the colour of the light.

⸻

7. Control Meaningfulness

Tone Ladder controls must remain meaningful to a designer.
	•	For base colours with visible chroma, changing temperature or mode should create a perceptible difference in the highlight region.
	•	This requirement is chroma/headroom-aware:
	•	If highlight steps have sufficient chroma to carry hue/saturation information, the difference must be perceptible (e.g. via OKLab ΔE above a small threshold).
	•	If chroma collapses near-white (or guardrails/gamut limits compress variation), differences may legitimately converge — but the selected setting should still express itself in the highest-chroma highlight steps (typically just below the endpoint).

Rationale: controls that silently collapse undermine trust, but the model must not be forced into artificial differences when the colour space has no meaningful room to express them.

⸻

8. Mode Intent
	•	Conservative
Looks better and could be used today without explanation.
	•	Painterly
Clearly expresses the model, even if bold or uncomfortable.