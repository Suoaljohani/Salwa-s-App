---
name: salwa-release-polish
description: "Perform the final product, visual, motion, sound, accessibility, and data-integrity review for Salwa's app. Use before delivery to verify real workflows, inspect rendered RTL screens, measure animation behavior, and report accurate evidence."
---

# Salwa Release Polish

Read references/release-gates.md. Review the real running build and exact changed files. Use ../review-animations/SKILL.md for the motion pass and ../mobile-native/SKILL.md for the mobile platform pass.

## Review the whole experience
Walk through Chat, Indicators, Data, Fill, Export, and Settings. Include empty, pending, partial, successful, quota-limited, and failed states. Verify the app opens in Chat and the five tab positions match the brief. Test back navigation, refresh, keyboard focus, file pickers, and virtual keyboard layout.

Check the coherent material system: text contrast against actual glass backgrounds; stable tables; icon consistency; restrained borders and shadows; chart labels and units. Remove decoration that competes with the statistic. Keep one shared token system.

Inspect settled screenshots and at least one recording of the dashboard transition if tooling is available. Test reduced motion and reduced transparency. Test interruption and rapid filter changes. A mock recording is not evidence of an actual device or service.

## Review audio and integrity
Confirm audio starts disabled, requires a gesture to enable, respects volume and mute, and remains supplementary. Confirm no repeated completion noise or background-tab sound.

Match chat, charts, filled template cells, and extracted report against the same known result. Inspect Excel output for formulas, formatting, unexpected edits, broken links, and repair warnings. Verify the exported files represent the chosen dataset version.

## Test efficiently
Run the project's required checks plus tests that target material risks. Use component/e2e tests for request races, preserved templates, and critical flows; do not add tests that merely assert every CSS token. Use accessible names and keyboard checks. Measure performance on a representative device or throttled environment; label the environment.

Target smooth frame delivery and responsive input as goals, not unmeasured guarantees. If no browser/device/audio tooling exists, name that limit and deliver a reproducible check procedure.

## Finish with evidence
Fix critical findings within scope, then report what changed, the workflows verified, the actual checks run, and any remaining integration constraint. Never claim a Claude Code execution, a live backend, or a real device test that did not occur. Do not publish or send anything as a side effect of a review.
