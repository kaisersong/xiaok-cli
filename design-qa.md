# Conversation Prompt Index — Design QA

## Evidence

- Reference: `/var/folders/47/8dvpkx39261gks3fvlkz51980000gn/T/codex-clipboard-37731a20-5673-42a3-98d5-135699779a2a.png`
- Final prompt-1 hover state: `/tmp/xiaok-index-summary-first-1054x400.jpeg`
- Final prompt-4 hover state: `/tmp/xiaok-index-summary-fourth-1054x400.jpeg`
- Runtime viewport: Xiaok Desktop development window at `1200 × 768`, dark theme.
- Pixel normalization: source and focused implementation crops are both `1054 × 400`; full Computer Use captures are `1199 × 768` at the app's native capture density.
- Runtime state: a real five-prompt conversation; prompts 1 and 4 were selected through native Computer Use.

## Comparison and interaction evidence

1. The rail is anchored immediately beside the sidebar/main-content divider. Its expanded offset uses the same `15rem` source as the sidebar `w-60`, so root-font or display scaling cannot separate the rail from the divider.
2. With no hover, all ticks remain `10px` wide. The current prompt differs only by brighter color/opacity; active state no longer changes geometry.
3. Hover/focus is the only geometry-changing state. Prompt 1 and prompt 4 captures show the wave and tooltip moving vertically with the selected tick instead of remaining at the rail midpoint.
4. The tooltip presents the prompt as one primary line and the associated assistant response as at most two smaller secondary-gray lines. Common Markdown markers are removed from the plain-text summary.
5. Native Computer Use clicked prompts 1 and 4; each action updated the tooltip content/position and smooth-scrolled the real conversation to its corresponding user message.
6. Accessibility inspection exposed the rail as `提示词索引`, each target as a labeled button, and the tooltip text as prompt plus response summary.

## Findings and iteration history

- Initial browser-only renderer preview was rejected as evidence because Electron preload APIs were unavailable and the app rendered blank.
- The earlier active state used a longer tick. This was rejected after the follow-up requirement; the active tick now only changes brightness.
- The first divider anchoring attempt used fixed `240px`, while the sidebar uses `15rem`; real UI comparison showed a scale-dependent gap. Both now share `15rem`, and the rail adds only a `4px` outer offset plus its internal padding.
- The previous tooltip was fixed at rail `top: 50%` and only showed the prompt. The final version calculates top from the real hovered/focused button (and recalculates on rail scroll), associates only the first assistant message before the next user turn, and omits the response row when no answer exists.
- The first response styling used tertiary text and was too dim in the dark theme. The post-fix capture uses secondary gray at reduced opacity, retaining hierarchy without sacrificing scanability.
- The final reference/implementation comparison shows the requested Codex-like hover wave while preserving Xiaok's typography, dark theme, output width, and composer.
- No clipping, right-side panel collision, composer overlap, or horizontal layout shift was observed at the tested viewport.

final result: passed
