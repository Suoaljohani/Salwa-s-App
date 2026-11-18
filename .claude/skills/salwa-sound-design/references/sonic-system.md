# Sonic system

| Cue | Intended event | Length target |
| --- | --- | --- |
| select | explicit sound preview or rare confirmed selection | about 60 ms |
| success | import validation completed successfully | about 150 ms |
| complete | requested report or filled template ready | about 210 ms |
| notice | a non-urgent condition needing attention | about 130 ms |

All cues are optional, muted by default, and supplementary. Do not play select on every tab switch by default. Map at most one cue to one completed action, not every intermediate step.

assets/salwa-sound-player.ts synthesizes the cues with Web Audio and has no third-party dependency. assets/sounds contains generated WAV versions of the same note family for an existing file-based audio system. Choose one implementation, not both.

## Integration
Create one player in the app's client root. Save sound preferences separately from sensitive data. When the user enables sound, apply mute/volume then await unlock inside that click handler. Use preview from a subsequent explicit user action or the same handler after unlock. Call play only for eligible events. Treat a false return as silent suppression, not a failed task.

Dispose during the app-root lifecycle. Do not run AudioContext at module import or during SSR. A task finishing in the background should not reopen a suspended context.

The WAV generator has a fixed sample rate, short attack, smooth release, fixed note definitions, and a peak ceiling. It produces original material; the measurements are digital peak levels and durations, not a promise of acoustic loudness or clinical appropriateness at every speaker setting.

## References
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices
- https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay
