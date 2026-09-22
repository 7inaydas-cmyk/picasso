# The anti-slop contract (guidance, not a fence)

Against the documented failure mode of agent-generated UI: generic purple
gradients, flat layouts, cookie-cutter cards. Distilled from taste-skill and
ui-ux-pro-max; enforced only where a rule is machine-checkable (those live in
the fenced layer).

1. **Deliberate whitespace.** Space is the primary grouping tool, not padding
   accident. One rhythm scale (Tailwind's); never arbitrary values
   (`p-[13px]` is fenced off for exactly this reason).
2. **Proportional typography.** A type scale with real steps (1.25 ratio or
   finer); body ≥16px; measure ≤70ch; headings track tighter than body.
3. **Color with intent.** Fewer than five hues + neutrals; every color comes
   from the token register; contrast is a floor, not a target (axe enforces
   the floor — the judgment above it is this contract).
4. **Subtle borders and depth.** 1px borders over shadows; one elevation
   system; no glow unless the design names a reason.
5. **Micro-interactions over decoration.** Motion earns its keep: state change
   = visible feedback (hover/focus/active); 150–250ms; respect
   `prefers-reduced-motion`.
6. **No default-gradient anything.** A gradient must survive the question
   "what does this communicate?" or it goes.
7. **Empty, loading, and error states are first-class.** A card with no data
   is a designed state, not a shrug.
