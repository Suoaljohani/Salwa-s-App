---
name: salwa-statistical-motion
description: "Choreograph precise, elegant entrances and updates for Salwa's statistical dashboard. Use for chart reveals, KPI presentation, transitions, filter changes, reduced motion, and responsive data visualization without distorting numbers."
---

# Salwa Statistical Motion

Read ../animate/SKILL.md and ../choreograph/SKILL.md with a concrete task. Read references/dashboard-score.md. Use assets/motion-tokens.json as the initial shared timing vocabulary.

## Animate the information hierarchy
Keep navigation available immediately. Reveal the page heading, then a few KPI surfaces, then the primary plot. Start chart drawing only after the matching validated dataset and font/layout are ready. The sequence should read as one event.

Use a restrained first-visit plot reveal. As an initial product-specific budget, finish the whole first dashboard composition in roughly 600–700 ms; this is a design target, not a guaranteed performance measurement. Interactive chrome should still settle around 150–250 ms. Repeated tab visits use a short transition rather than replaying the full sequence. Loading time is never extended just to finish a flourish.

The slightly longer first chart reveal applies to plotted data, not menus or controls. This is an intentional exception to upstream's normal sub-300ms UI guidance. Stop animation immediately on interruption and respect the new state.

## Keep the statistics exact
Expose the final numeric value immediately to assistive technology and copy/export actions. Prefer a crossfade or a short digit-position transition for a changed value. Never use random values, decorative percentage indicators, or rolling through made-up clinical counts. Mark fixture data clearly as demo data.

Use stable category identifiers, deterministic ordering, explicit units, and consistent scales for comparisons. Bars normally start at zero. Keep chronological time in a clearly labelled chronological direction even in an RTL interface. Never mirror axes mechanically because the surrounding page is Arabic.

Use ECharts' native enter/update mechanism for series, or the existing chart library's equivalent. Avoid wrapping a chart in one animation while the library runs a second conflicting animation. Preserve chart instances on filter changes; update data rather than remounting. Clean up resize observers, listeners, and chart instances on disposal.

## Filter and request discipline
Cancel obsolete requests or tag them with a monotonic request id. Only the latest matching filter result may replace the visible dataset. The source line, metric value, chart, and table must all use the same snapshot. If retained data remains visible while updating, label that state.

Differentiate no records, missing coverage, unavailable service, and genuine zero. Respect gaps; do not connect missing months as if they were measured. Provide a table alternative and meaningful chart description. Keep tooltips usable with keyboard and touch.

## Performance and accessibility
Read ../animation-performance/SKILL.md for jank and ../review-animations/SKILL.md for the final motion pass. Animate surface transform/opacity rather than blur or layout whenever possible. Series rendering has its own measured cost; simplify or disable plot animation for large datasets.

Reduced motion uses static final series plus at most a brief opacity change. Screenshots and image exports must capture the settled state. Do not replay entrance motion because a background refetch occurred.
