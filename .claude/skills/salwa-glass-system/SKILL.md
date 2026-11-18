---
name: salwa-glass-system
description: "Design and implement a premium Arabic glassmorphism system for the Salwa statistics app. Use for translucent surfaces, depth, typography, RTL layout, navigation, responsive component design, and accessible light/dark themes."
---

# Salwa Glass System

Read ../frontend-design/SKILL.md for visual direction. Read references/material-system.md before implementing glass. Treat assets/glass-foundation.css as a tested starting surface system, not a claimed hospital identity.

## Make glass functional
Use three surface roles: a quiet base, opaque or nearly opaque reading surfaces, and a restrained translucent navigation/overlay layer. Depth comes from contrast, border light, spacing, and a small amount of blur. Place chart labels and dense tables on stable reading surfaces. Avoid stacking blur on every card and row.

Pick one deep clinical base, one accent family, and one neutral family. A proposed petrol/mineral palette is included as a seed. The final palette must suit actual brand assets. Preserve semantic CTAS colors for clinical meaning; accent colors must not silently redefine those categories.

Use the supplied Arabic font when available. Otherwise select and self-host a licensed Arabic family such as IBM Plex Sans Arabic or Noto Sans Arabic. Verify the license and retain notices. Never apply letter spacing to Arabic text. Use tabular numerals where the font supports them and isolate LTR identifiers and mixed numbers with bdi or equivalent.

## Component hierarchy
Build a small library: AppShell, BottomNavigation, ChatComposer, AnswerCard, SourceDetails, MetricCard, ChartPanel, FilterBar, FileDropzone, ImportPreview, TemplateMapping, ExportPreview, and SettingsSheet.

Keep one clear primary action per context. Place secondary detail behind disclosure. Show provenance in a compact legible form; never dim it below readable contrast.

On small screens respect safe areas, virtual keyboard resize, and thumb reach. Keep five labelled navigation items; do not make the center item a sixth floating action. Use CSS logical properties. On wide screens expand useful charts and tables without changing tab meaning.

## Interaction quality
Use real buttons and links, labelled inputs, visible focus, and accessible popovers/sheets. Use a proven primitive package already present in the project; consult ../pick-ui-library/SKILL.md before adding one. Touch targets should normally be at least 44 by 44 CSS px in this app. Allow zoom and text scaling.

Make glass work with a solid fallback, a reduced-transparency setting, and forced-colors. Respect prefers-reduced-motion separately. Contrast must be checked on the actual composited background, including worst-case content behind navigation.

## Inspect instead of guessing
Review the actual Chat and Indicators screens at 390 px and a desktop width. Inspect a narrower 320 px layout and enlarged text. Verify Arabic labels, dates, mixed numbers, keyboard overlap, and focus order. A beautiful screenshot at one width does not prove the system is ready.
