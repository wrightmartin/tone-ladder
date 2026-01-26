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

## Mode Goals

- **Conservative**: "Looks better and could be used today without justification."
- **Painterly**: "Clearly demonstrates the concept; coherent even if bold or uncomfortable."
