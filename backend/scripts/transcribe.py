#!/usr/bin/env python3
"""Transcreve áudio usando faster-whisper (local, sem API key)."""
import sys
import json

def transcribe(audio_path):
    from faster_whisper import WhisperModel
    model = WhisperModel("base", device="cpu", compute_type="int8")
    segments, info = model.transcribe(audio_path, language="pt", beam_size=5)
    text = " ".join(seg.text.strip() for seg in segments)
    return text.strip()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: transcribe.py <audio_file>"}))
        sys.exit(1)
    try:
        text = transcribe(sys.argv[1])
        print(json.dumps({"text": text}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
