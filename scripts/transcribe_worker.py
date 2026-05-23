#!/usr/bin/env python3
"""Persistent Whisper worker — reads JSON lines from stdin, writes JSON to stdout."""
import sys
import json
import whisper


def main():
    model_name = sys.argv[1] if len(sys.argv) > 1 else "base"
    model = whisper.load_model(model_name)

    print(json.dumps({"ready": True}))
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            audio_path = msg["audio"]
            result = model.transcribe(audio_path, fp16=False)
            response = {"text": result["text"].strip()}
            if "id" in msg:
                response["id"] = msg["id"]
            print(json.dumps(response))
            sys.stdout.flush()
        except Exception as e:
            err = {"error": str(e)}
            if "id" in msg:
                err["id"] = msg["id"]
            print(json.dumps(err))
            sys.stdout.flush()


if __name__ == "__main__":
    main()
