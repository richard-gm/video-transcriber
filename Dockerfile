FROM python:3.11-slim

# ── System packages ──────────────────────────────────────────────────────────
# ffmpeg: audio extraction
# curl: used to install Node.js
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ── Python deps ──────────────────────────────────────────────────────────────
# yt-dlp: downloads from YouTube, TikTok, Instagram
# openai-whisper: local speech-to-text (pulls PyTorch — image will be ~4 GB)
RUN pip install --no-cache-dir yt-dlp openai-whisper

# Pre-download Whisper "base" model so first run isn't slow.
# Remove this line and set WHISPER_MODEL=tiny for a faster/lighter setup.
RUN python -c "import whisper; whisper.load_model('base')"

# ── Node app ─────────────────────────────────────────────────────────────────
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev

COPY server.js .
COPY scripts/ scripts/
COPY public/ public/

# /app/data is mounted as a volume so transcriptions survive restarts
RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "server.js"]
