# Skill routing

The user's product brief is the authority. Read only the relevant skill and rule files for the current task.

| Phase | Skill path, relative to this studio folder |
| --- | --- |
| Overall visual direction | ../frontend-design/SKILL.md |
| Surfaces, typography, RTL | ../salwa-glass-system/SKILL.md |
| Component library selection | ../pick-ui-library/SKILL.md |
| React data flow and performance | ../vercel-react-best-practices/SKILL.md |
| A single animation | ../animate/SKILL.md |
| Several coordinated animations | ../choreograph/SKILL.md |
| Statistical charts and numbers | ../salwa-statistical-motion/SKILL.md |
| Jank and frame delivery | ../animation-performance/SKILL.md |
| Mobile viewport and touch | ../mobile-native/SKILL.md |
| Optional sound | ../salwa-sound-design/SKILL.md |
| Imports, database, AI, Excel | ../salwa-data-engineering/SKILL.md |
| Focused motion audit | ../review-animations/SKILL.md |
| Final whole-app checks | ../salwa-release-polish/SKILL.md |

Always pass a concrete task and target files to the upstream skills. Do not invoke them as empty readiness checks. Manually read skills whose upstream frontmatter disables model invocation.

## Resolve overlaps
The glass system owns material and tokens. Statistical motion owns chart timing. Sound owns audio. Data engineering owns metric semantics. The release skill inspects their interaction. Reuse the repository's existing token system and dependencies.

Upstream design skills sometimes discuss heroes and marketing. This product starts with a chat, so adapt their craft principles without importing landing-page structure. Upstream UI transitions generally stay under 300 ms; the custom score permits one slightly longer first-visit chart reveal while keeping controls responsive. Never use two animation libraries to own the same property.

The original upstream files are preserved with provenance and licenses in SOURCES_AND_LICENSES.md. They are not proof of measured results for this particular application. The custom skills are newly authored for this brief.
