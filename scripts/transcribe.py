#!/usr/bin/env python3
"""Transcribe an audio file using local Whisper and print JSON to stdout."""
import sys
import json
import whisper

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: transcribe.py <audio_path> [model]"}))
        sys.exit(1)

    audio_path = sys.argv[1]
    model_name = sys.argv[2] if len(sys.argv) > 2 else "base"

    model = whisper.load_model(model_name)
    result = model.transcribe(audio_path, fp16=False)  # fp16=False for CPU
    print(json.dumps({"text": result["text"].strip()}))

if __name__ == "__main__":
    main()
