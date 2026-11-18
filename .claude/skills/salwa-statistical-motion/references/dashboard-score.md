# Dashboard motion score

These are proposed starting values. Tune them after inspecting a real recording on representative hardware. Fetch duration and easing details from the installed library documentation rather than guessing API syntax.

| Beat | Initial target | Purpose |
| --- | --- | --- |
| Navigation | immediately available | maintain agency |
| Header | 0–160 ms, opacity and 6–8 px movement | establish context |
| First 3 KPI surfaces | roughly 40–280 ms, 35–50 ms offsets | guide reading order |
| Main series reveal | roughly 120–620 ms | show the distribution |
| Labels and source | visible as soon as correct; no long delay | preserve comprehension |
| Repeat visit | roughly 150–220 ms | maintain orientation |
| Filter update | roughly 180–260 ms | show a changed result |

The user must be able to interact before the sequence finishes. The numbers and accessible data stay final throughout. A chart reveal is not a data processing progress indicator.

## Library choices
Use the current chart library if suitable. For a new statistics-heavy interface, ECharts is a useful default. Use series ids and category ids, update with setOption, and separate enter timing from update timing. Verify supported options against current documentation. Animation thresholds for large series should be measured.

Use Motion for interruptible layout, exits, and gestures, or CSS/WAAPI for simple transitions. Keep one owner for each animated property. Avoid layout remounts and repeated full chart initialization.

## Failure checks
- New filters arrive while an older request is still pending.
- Navigation changes halfway through the entrance.
- Reduced motion switches on while the page is open.
- A visible chart gets a background data refresh.
- An export screenshot is requested while the chart is animating.
- Arabic category labels become two lines or are unusually long.
- Values are all zero, all missing, negative where allowed, or extremely large.

## References
- https://echarts.apache.org/handbook/en/how-to/animation/transition/
- https://motion.dev/docs/react-reduced-motion
- Bundled animate, choreograph, animation-performance, and review-animations.
