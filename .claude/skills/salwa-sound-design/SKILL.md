---
name: salwa-sound-design
description: "Design and implement subtle original interface sounds for Salwa's hospital statistics app. Use for optional interaction audio, import/export completion cues, Web Audio lifecycle, sound preferences, and quiet accessible feedback."
---

# Salwa Sound Design

Read references/sonic-system.md. Use assets/salwa-sound-player.ts for a lightweight implementation and assets/sounds/ for original generated WAV alternatives. All included sound material is created for this pack, not copied from another product.

## Design a quiet identity
Use a small, coherent family of damped tones: select, success, complete, and notice. Make completion feel precise rather than celebratory. Keep cues brief and restrained. There must be no background music, clinical alarm imitation, notification barrage, or sound on every keystroke or chart point.

Default to sound off in this hospital workflow. Include an explicit enable control, a preview, a separate volume slider, and persistent mute preference. Enablement must be an intentional user action. Sound is always supplementary to visual and accessible text feedback.

## Integrate safely
Create or resume AudioContext inside a user gesture. Reuse one player at the application root; do not allocate one per card. Call unlock in the enable/preview interaction. A background export may play only if sound was enabled earlier and the audio context is running. If audio is unavailable, complete the workflow silently.

Observe visibility: no audio from a hidden tab. Deduplicate repeated completion events and apply a short cooldown. Avoid overlap with optional spoken answers. Dispose nodes and the shared context when the application truly unmounts; do not close it on every route change.

Prefer the included native Web Audio implementation to a new audio dependency for four short cues. If the project already has an established audio system, extend it instead of installing a second one.

## Verify the experience
Test enable, preview, mute, slider, rapid repeat, background-tab suppression, reload preference, and failed audio initialization. Test iOS Safari or the actual device when available; do not claim real-device testing based on emulation. Peak measurements describe files, not perceived loudness at every device setting. Ask for a user listening check only when its result matters to the final mix.
