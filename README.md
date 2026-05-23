# Video Transcriber

Downloads videos from YouTube, TikTok, and Instagram, then transcribes the audio locally using OpenAI Whisper.

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Phone      │ ──▶ │  Telegram Bot    │ ──▶ │  Cloud Run  │
│  (share     │     │  (public API)    │     │  (container)│
│   URL)      │     └──────────────────┘     └──────┬──────┘
└─────────────┘                                     │
                                                     ├── yt-dlp
                                                     ├── ffmpeg
                                                     └── Whisper (persistent daemon)
                                                         │
                                                         ▼
                                                   ┌─────────────┐
                                                   │  Supabase   │
                                                   │  (Postgres  │
                                                   │  + Realtime)│
                                                   └─────────────┘
```

The app uses **Supabase Realtime** — new video URLs are picked up via WebSocket as soon as they're inserted. Rows left pending while the server was offline are processed at startup. Processing is capped to `MAX_CONCURRENT_JOBS` to avoid saturating the system.

### Key design decisions

- **Telegram as primary interface** — Share URLs from your phone to the Telegram bot. No browser needed.
- **Persistent Whisper worker** — The transcription model stays loaded in memory as a long-running Python child process, avoiding the ~2s reload penalty per request.
- **Graceful shutdown** — On SIGTERM/SIGINT, the server stops accepting new work and waits for active jobs to finish before exiting.
- **Scale to zero** — Cloud Run spins down when idle; you pay only for the seconds you use.

## Quick start — local

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) **or** Node.js 20+, Python 3.11+, ffmpeg, yt-dlp
- A [Supabase](https://supabase.com) project

### 1. Database setup

In your Supabase dashboard → **SQL Editor**, run `schema.sql` to create the `videos` table and enable Realtime.

### 2. Configuration

```bash
cp .env.example .env
```

Fill in your Supabase URL and anon key (Settings → API).

### 3. Run

```bash
docker compose up --build
```

Or locally:
```bash
npm install
node server.js
```

Open `http://localhost:3333`, paste a video URL, and click **Transcribe**.

---

## Deploy to Cloud Run

One-time GCP setup, then automatic deploys via GitHub Actions.

### 1. GCP project setup

```bash
gcloud auth login
gcloud projects create YOUR-PROJECT-ID --name="video-transcriber"
gcloud config set project YOUR-PROJECT-ID
gcloud services enable cloudrun.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com iamcredentials.googleapis.com
```

### 2. Create Telegram bot

Open Telegram, search for [@BotFather](https://t.me/BotFather), and run:

```
/newbot
```

Save the token it gives you (looks like `123456:ABC-DEF1234`). Also generate a random secret token for webhook verification.

### 3. Deploy infrastructure

```bash
cp infra/terraform.tfvars.example infra/terraform.tfvars
# Fill in your values
cd infra
terraform init
terraform apply
```

This creates:
- Artifact Registry repository (Docker image storage)
- Cloud Run service (auto-scaling to zero)
- Service account with minimal permissions

The output includes the Cloud Run URL and a curl command to set the Telegram webhook — run that command.

### 4. Set up GitHub Actions

| Secret | Value | Where to get it |
|--------|-------|----------------|
| `GCP_SA_KEY` | `{"type":"service_account",...}` | GCP → IAM → Service Accounts → `github-actions-deployer` → Keys → Add Key → JSON |
| `SUPABASE_URL` | `https://your-project.supabase.co` | Supabase → Settings → API |
| `SUPABASE_ANON_KEY` | `eyJ...` | Supabase → Settings → API |
| `TELEGRAM_BOT_TOKEN` | `123456:ABC-DEF1234...` | From @BotFather when you created the bot |
| `TELEGRAM_SECRET_TOKEN` | Your random secret string | You generated this in step 2 |

| Variable | Value | Where to get it |
|----------|-------|----------------|
| `GCP_PROJECT_ID` | `your-project-id` | GCP → Project Dashboard |
| `SUPABASE_TABLE` | `videos` | Your Supabase table name |
| `WHISPER_MODEL` | `base` | Your preference |

### 5. Deploy

Push to `main` — GitHub Actions builds the Docker image and deploys to Cloud Run automatically.

```bash
git add -A
git commit -m "initial deploy"
git push origin main
```

### 6. Use it

Send a YouTube/TikTok/Instagram link to your Telegram bot. You'll get "Got it! Processing…" immediately, then "✅ Done" with the URL when complete (typically 2-10 min depending on video length).

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Web server port (Cloud Run injects this) |
| `SUPABASE_URL` | — | Supabase project URL |
| `SUPABASE_ANON_KEY` | — | Supabase anon key |
| `SUPABASE_TABLE` | `videos` | Table name for transcriptions |
| `WHISPER_MODEL` | `base` | Model size: `tiny`, `base`, `small`, `medium`, `large` |
| `LOG_LEVEL` | `info` | Pino log level |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot token (optional locally) |
| `TELEGRAM_SECRET_TOKEN` | — | Webhook verification secret (optional locally) |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window |
| `RATE_LIMIT_MAX` | `10` | Max requests per window per IP |
| `MAX_CONCURRENT_JOBS` | `2` | Max simultaneous video processing jobs |

## API

### `GET /health`

Returns server health and active job count.

### `GET /transcriptions`

Returns the 50 most recent transcriptions.

### `POST /process`

Submit a new video for transcription. Rate-limited (10 req/min by default).

```json
{ "url": "https://www.youtube.com/watch?v=..." }
```

### `POST /telegram-webhook`

Telegram bot webhook (only registered if `TELEGRAM_BOT_TOKEN` is set). Accepts a Telegram Update object, extracts the URL, and inserts it into Supabase for processing.

## Project structure

```
├── server.js                         Express server, worker, Telegram bot
├── scripts/
│   └── transcribe_worker.py          Persistent Whisper daemon
├── public/
│   └── index.html                    Frontend (optional — Telegram is primary)
├── infra/
│   ├── main.tf                       Cloud Run + Artifact Registry
│   ├── variables.tf                  Terraform variables
│   ├── outputs.tf                    Cloud Run URL output
│   └── terraform.tfvars.example      Example variable values
├── .github/workflows/
│   └── deploy.yml                    CI/CD — build & deploy to Cloud Run
├── schema.sql                        Supabase table definition
├── Dockerfile                        Container build (CPU-only PyTorch)
├── docker-compose.yml                Local runtime config
├── .dockerignore                     Build context exclusions
└── .env.example                      Environment template
```

## Tech stack

- **Node.js** — Express server, Supabase client, pino logging
- **Supabase** — Postgres database + Realtime WebSocket
- **Telegram Bot API** — User interface (share URLs, receive results)
- **yt-dlp** — Video download
- **ffmpeg** — Audio extraction
- **OpenAI Whisper** — Local speech-to-text (persistent Python daemon)
- **GCP Cloud Run** — Serverless container hosting (scale to zero)
- **Terraform** — Infrastructure as code
- **GitHub Actions** — CI/CD pipeline

## TODO

- [ ] **Video categorization & downstream actions** — After transcription, auto-categorize videos by topic (e.g., via LLM or keyword rules) and trigger actions per category (e.g., append to Notion, post to Slack, save to specific folders). Plan and implement an extensible plugin pattern in server.js.
