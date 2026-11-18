#!/usr/bin/env python3
"""Generate original short Salwa interface cues with the standard library."""
from __future__ import annotations
import argparse
import json
import math
from pathlib import Path
import struct
import wave

SAMPLE_RATE = 48000
CUES = {
    "select": [(460.0, 0.0, 0.06, 0.05)],
    "success": [(523.25, 0.0, 0.09, 0.045), (659.25, 0.045, 0.105, 0.04)],
    "complete": [(440.0, 0.0, 0.11, 0.04), (659.25, 0.065, 0.145, 0.038)],
    "notice": [(330.0, 0.0, 0.13, 0.045)],
}

def synthesize(notes):
    length = max(offset + duration for _, offset, duration, _ in notes) + 0.005
    samples = [0.0] * math.ceil(length * SAMPLE_RATE)
    for frequency, offset, duration, gain in notes:
        start = round(offset * SAMPLE_RATE)
        count = round(duration * SAMPLE_RATE)
        attack = min(0.008, duration / 4)
        for index in range(count):
            t = index / SAMPLE_RATE
            if t <= attack:
                envelope = 0.00001 * (gain / 0.00001) ** (t / attack)
            else:
                envelope = gain * (0.00001 / gain) ** ((t - attack) / (duration - attack))
            samples[start + index] += math.sin(2 * math.pi * frequency * t) * envelope
    peak = max(map(abs, samples), default=0.0)
    if peak > 0.15:
        samples = [value * 0.15 / peak for value in samples]
    return samples

def generate(destination):
    destination.mkdir(parents=True, exist_ok=True)
    report = []
    for name, notes in CUES.items():
        samples = synthesize(notes)
        path = destination / (name + ".wav")
        pcm = b"".join(struct.pack("<h", round(max(-1, min(1, value)) * 32767)) for value in samples)
        with wave.open(str(path), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(SAMPLE_RATE)
            output.writeframes(pcm)
        peak = max(map(abs, samples), default=0.0)
        report.append({"file": path.name, "seconds": len(samples) / SAMPLE_RATE, "sample_rate": SAMPLE_RATE, "peak_dbfs": round(20 * math.log10(peak), 2) if peak else None})
    return report

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent.parent / "assets" / "sounds")
    args = parser.parse_args()
    print(json.dumps(generate(args.output), indent=2))
