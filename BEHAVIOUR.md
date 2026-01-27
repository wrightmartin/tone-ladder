# Tone Ladder Behaviour Contract

This document is the source of truth for algorithm behaviour. All changes must comply.

## Endpoint Rules

- **If `temperature === 0`**: neutral/grey endpoints are allowed.
- **If `temperature !== 0`**: the lightest and darkest steps **must** be tinted. Neutral grey/white/black endpoints are not allowed.

- “Tinted” means C > ε, where ε is small but non-zero, not “visually colourful”.

## Hue Rules

- **No categorical hue jumps**: e.g., green appearing in a red ladder, or mint in yellow. Adjacent hue drift is allowed.
- **No pattern-breaking "dead rungs"**: no single-step anomalies in perceived lightness, saturation, or hue.
- **Hue direction must be locally consistent**: adjacent steps must not reverse hue direction unless the reversal is perceptually invisible.

## Temperature Semantics

Temperature controls the direction of hue bias, not rotation around the base:

- **Warm light (`temperature > 0`)**: highlights bias toward warm (yellow ~65°), shadows bias toward cool (blue ~205°).
- **Cool light (`temperature < 0`)**: highlights bias toward cool, shadows bias toward warm.
- **Neutral light (`temperature === 0`)**: no hue shift; ramp is purely tonal.

## Yellow Family Guardrail (Highlight Semantics)

For yellow-family bases (OKLCH hue approximately 60°–110°):

- The **lightest 3 steps must remain recognisably yellow/cream** and must not drift into green/mint territory, especially when `temperature < 0`.
- Prioritise hue-family retention over strong cool bias for yellow highlights.
- **This is a pass/fail condition**: above a pragmatic green-boundary threshold (currently ~120° in tests) in the top 3 highlights constitute a failure for yellow-family bases.

Rationale: A yellow ramp must still read as "yellow" at the light end. Mint/green highlights break ramp semantics (it becomes a palette, not a tonal ramp).

## Red Family Highlight Guardrail (v1)

For red-family bases (OKLCH hue in the wraparound range: approximately 320°–360° or 0°–50°):

- The **lightest 3 steps must not drift into categorical non-red families**, especially green/cyan territory, when `temperature < 0`.
- **Forbidden hue band**: approximately 80°–200° (yellow-green through cyan). If a highlight step lands in this band with visible chroma (C > 0.015), it fails the guardrail.
- **Chroma-aware**: Only enforce when step chroma is above the visibility threshold. Near-zero chroma hues are perceptually meaningless.
- Prioritise red-family retention (red/orange/pink/peach) over strong cool bias for red highlights.

Rationale: A red ladder must still read as "red" or "warm" at the light end. Green/cyan highlights break ladder semantics entirely.

## Near-Neutral Temperature Study

For near-neutral bases (OKLCH chroma ≤ 0.03), temperature becomes the **dominant signal** rather than being dampened. This implements "light colour theory revealed on greys":

- **Warm light (`temperature > 0`)**: highlights bias toward warm anchor (~65°, cream/paper), shadows bias toward cool anchor (~205°, blue-grey).
- **Cool light (`temperature < 0`)**: highlights bias toward cool anchor (~205°, blue-grey), shadows bias toward warm anchor (~65°, brown/umber).

Implementation details:
- Chroma is created from scratch (not scaled from the near-zero base chroma)
- Chroma curve peaks at extremes (endpoints) and is minimal at midpoint
- Maximum tint chroma is capped at ~0.035 to keep it tasteful
- Hue direction is set purely from anchor positions based on temperature and position

This special handling **only activates** when:
1. Base chroma ≤ `NEUTRAL_BASE_C_MAX` (0.03), AND
2. Temperature ≠ 0

For bases with visible chroma (> 0.03), the standard algorithm applies unchanged.

## Mode Goals

- **Conservative**: "Looks better and could be used today without justification."
- **Painterly**: "Clearly demonstrates the concept; coherent even if bold or uncomfortable."
