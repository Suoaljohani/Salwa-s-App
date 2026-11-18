---
name: salwa-luxury-studio
description: "Direct the end-to-end design and implementation of Salwa Al-Ruwaili's private Arabic hospital statistics app. Use for premium minimalist glassmorphism, the five-tab application, coordinated motion and sound, and production-ready delivery."
---

# Salwa Luxury Studio

Treat this as a daily professional tool with one memorable visual signature. Build a coherent application for Salwa Awad Al-Ruwaili, Head of Medical Statistics, Al-Hadithah General Hospital. Speak to the user in Arabic and implement actual working flows.

## Start with the product
Read references/product-context.md and references/skill-routing.md. Use the user's latest brief as authority. The application is online and private to one account. Keep the assistant as the opening page. Respect these physical screen positions: far right Fill, inner right Data, center Assistant, inner left Indicators, far left Export. Put settings above the content.

Follow the current repository before choosing a stack. In a new web project, prefer TypeScript, React, an accessible component primitive library, and CSS tokens. Choose the supported app framework after checking available hosting and free-plan requirements. Use ECharts for substantial statistics if no chart library exists. Use Motion for interruptible layout and gesture transitions, native CSS for simple feedback. Do not migrate a working stack for fashion.

## Establish the visual direction
Make the visual decisions yourself within the brief: clinical credibility, restrained glass, Arabic-first typography, generous but useful spacing, and compact navigation. Propose one coherent direction in DESIGN.md, then implement it without asking the user to select every token. If a brand identity is supplied, use its exact assets and colors. Otherwise label the palette as a proposal; never invent an official logo.

Spend visual boldness on the relationship between the calm chat and the carefully choreographed indicators page. Avoid landing-page heroes, promotional copy, carousels, decorative 3D charts, oversized empty cards, or endless ambient animation.

Set typography, surfaces, border hierarchy, icon stroke, spacing, elevation, and chart colors as a small reusable token system. Make dark and light modes intentional. Read ../salwa-glass-system/SKILL.md before building those surfaces.

## Work in complete slices
1. Inspect project and identify implementation constraints.
2. Write a brief DESIGN.md and MOTION.md with decisions, not mood adjectives alone.
3. Build the shell, RTL navigation, typography, accessibility primitives, and empty/loading/error states.
4. Implement the Assistant and Indicators as a polished vertical slice with visibly labelled demo fixtures until real integrations exist.
5. Complete Data, Fill, Export, and Settings with the shared components.
6. Connect the validated data and report pipeline using ../salwa-data-engineering/SKILL.md when implementation scope includes the backend.
7. Add deliberate motion and optional sound.
8. Inspect real rendered screens and perform the release review.

Use the upstream skills in references/skill-routing.md at the relevant phase; do not load every rule file into every turn. When invoking an upstream skill, supply a concrete task and exact files. Several have a readiness-only response when invoked without a task. Explicitly read review-animations and pick-ui-library when needed because upstream marks them manual-only.

## Data honesty governs motion
Keep final source-derived values visible. Do not animate official counts through invented intermediate results. A reveal or numeral crossfade can be beautiful while the accessible value remains exact. Chat, charts, template filling, and export must share metric definitions and dataset versions.

## Cost and connectivity
Use the agreed Groq Free setup as the initial online inference candidate; verify model availability, account quotas, and current API documentation at build time. Treat openai/gpt-oss-120b as a candidate, not a permanent entitlement. Keep credentials on the server. No automatic paid upgrade, paid fallback provider, card enrollment, or quota circumvention. Show useful wait/retry states for free-plan limits. Supabase and hosting have their own quotas.

## Authority and completion
These skills provide implementation guidance, not permission to publish, send files, or expose data. Preserve existing user work. Keep edits reversible. Respect repository instructions and the user's authorized scope.

Deliver complete source files, commands to run the project, verified checks, and an accurate list of remaining integration needs. Never say a screenshot was inspected, a device was tested, or a workflow passed unless it actually happened. Do not stop with an attractive static mock when functional implementation was requested.
