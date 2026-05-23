FROM python:3.11-slim

# ── System packages ──────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ── Python deps ──────────────────────────────────────────────────────────────
# Install CPU-only PyTorch first so openai-whisper doesn't pull CUDA libs
# (saves ~1.5 GB compared to the default CUDA-enabled PyTorch)
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir yt-dlp openai-whisper

# Pre-download Whisper "base" model so first transcription isn't slow.
RUN python -c "import whisper; whisper.load_model('base')"

# ── Node app ─────────────────────────────────────────────────────────────────
WORKDIR /app

# Dependencies first (change less often)
COPY package.json .
RUN npm install --omit=dev

# Then source code
COPY server.js .
COPY scripts/ scripts/
COPY public/ public/

RUN mkdir -p /app/data

ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', r => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

CMD ["node", "server.js"]
