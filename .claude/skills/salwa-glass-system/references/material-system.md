# Material and typography system

The starting palette in assets/glass-foundation.css is a proposal. Replace its values deliberately when actual identity assets are available, retaining the semantic token roles.

| Layer | Role | Treatment |
| --- | --- | --- |
| Base | visual continuity | quiet deep neutral or mineral light |
| Reading surface | chat answers, plots, tables | opaque/nearly opaque; stable contrast |
| Glass | navigation, selected controls, overlays | restrained alpha, subtle highlight, limited blur |
| Focus | active element and keyboard affordance | clear solid accent, not glow alone |

## Implementation sequence
1. Set the text hierarchy with real Arabic copy.
2. Set layout spacing and density before adding blur.
3. Add one glass material family; keep shadow and border recipes coherent.
4. Test the solid fallback first, then enhance with backdrop-filter.
5. Add explicit reduced-transparency and high-contrast states.
6. Verify composited contrast and zoom.

Use CSS logical properties and bdi for mixed text. Avoid fixed heights on Arabic paragraphs; allow diacritics and line spacing. Keep body text readable on a phone, and input text large enough to avoid unwanted mobile zoom. Do not hide scrolling or selection on actual text in an attempt to make the app feel native.

The number system should be consistent and selectable. Displayed localized numerals and underlying numeric values must remain distinct concerns. Preserve exact precision for official reports; do not abbreviate a copied count to an ambiguous K value.

## References
- Anthropic frontend-design, bundled upstream.
- CSS backdrop-filter: https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter
- CSS logical properties: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_logical_properties_and_values
- WCAG contrast guidance: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
