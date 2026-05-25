# Video Transcriber

Downloads videos from YouTube, TikTok, and Instagram, then transcribes the audio using OpenAI Whisper.

## Architecture

```
┌──────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│  Web UI      │ ──▶ │  Cloud Run Service  │ ──▶ │  Cloud Tasks     │
│  (browser)   │     │  (API — fast path)  │     │  Queue (retries) │
└──────────────┘     └─────────────────────┘     └────────┬─────────┘
                                                           │
┌──────────────┐     ┌─────────────────────┐               │
│  Telegram    │ ──▶ │  /telegram-webhook  │               │
│  Bot         │     │  (inserts + returns)│               │
└──────────────┘     └─────────────────────┘               │
                                                            ▼
                                                  ┌──────────────────┐
                                                  │  /api/task-handler│
                                                  │  (creates job)   │
                                                  └────────┬─────────┘
                                                           │
                                                  ┌────────▼─────────┐
                                                  │  Cloud Run Job   │
                                                  │  (worker — no    │
                                                  │   timeout limit) │
                                                  │                  │
                                                  ├── yt-dlp         │
                                                  ├── ffmpeg         │
                                                  └── Whisper        │
                                                           │
                                                           ▼
                                                  ┌──────────────────┐
                                                  │  Supabase        │
                                                  │  (Postgres —     │
                                                  │   status/progress│
                                                  │   polling)       │
                                                  └──────────────────┘
```

### Two modes

**Local** (no GCP needed): the server calls the processing pipeline inline. Concurrency is limited to `MAX_CONCURRENT_JOBS`. Progress is written to Supabase and the frontend polls it.

**Cloud** (Cloud Run + Cloud Tasks): the service inserts the row and enqueues a Cloud Task. The task handler creates a Cloud Run Job execution. The worker (same Docker image, `src/worker.js`) processes the video with **no timeout ceiling** — Cloud Run Jobs don't have the 1-hour limit that Cloud Run services do.

### Key design decisions

- **Async by default** — API returns immediately with a job ID; the frontend polls `/api/status/:id` until completion.
- **Progress tracking** — Real yt-dlp download metrics (speed, ETA, %) and estimated transcription progress visible in the UI.
- **Single Docker image** — Both the service and the worker use the same image; the entry point is `src/server.js` (service) or `src/worker.js` (job).
- **Telegram as primary interface** — Share URLs from your phone to the Telegram bot. No browser needed.
- **Graceful shutdown** — On SIGTERM/SIGINT, the server stops accepting new work and exits.
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

Fill in your Supabase URL and anon key (Settings → API). Leave the `TASK_QUEUE_PATH` / GCP variables blank — when they're unset, the app runs in local mode (inline processing).

### 3. Run

```bash
docker compose up --build
```

Or locally:
```bash
npm install
node src/server.js
```

Open `http://localhost:3333`, paste a video URL, and click **Transcribe**. The frontend polls for progress and shows you the result when done.

## Deploy to Cloud Run

### 1. GCP project setup

```bash
gcloud auth login
gcloud projects create YOUR-PROJECT-ID --name="video-transcriber"
gcloud config set project YOUR-PROJECT-ID
gcloud services enable cloudrun.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com iamcredentials.googleapis.com cloudtasks.googleapis.com
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
- Cloud Tasks queue (retries, rate-limited dispatching)
- Cloud Run Job (long-running worker, 10-hour timeout)
- Service account with minimal permissions (artifact reader, task enqueuer, job runner)

The output includes the Cloud Run URL and a curl command to set the Telegram webhook — run that command.

### 4. Set up GitHub Actions

| Secret | Value | Where to get it |
|--------|-------|----------------|
| `GCP_SA_KEY` | `{"type":"service_account",...}` | GCP → IAM → Service Accounts → `github-actions-deployer` → Keys → Add Key → JSON |
| `SUPABASE_URL` | `https://your-project.supabase.co` | Supabase → Settings → API |
| `SUPABASE_ANON_KEY` | `eyJ...` | Supabase → Settings → API |
| `TELEGRAM_BOT_TOKEN` | `123456:ABC-DEF1234...` | From @BotFather when you created the bot |
| `TELEGRAM_SECRET_TOKEN` | Your random secret string | You generated this in step 2 |
| `GEMINI_API_KEY` | `AIza...` | [aistudio.google.com](https://aistudio.google.com) → Get API key (free, optional) |

| Variable | Value | Where to get it |
|----------|-------|----------------|
| `GCP_PROJECT_ID` | `your-project-id` | GCP → Project Dashboard |
| `SUPABASE_TABLE` | `videos` | Your Supabase table name |
| `WHISPER_MODEL` | `base` | Your preference |

### 5. Deploy

Push to `main` — GitHub Actions builds the Docker image, deploys the Cloud Run service (API), and creates/updates the Cloud Run Job (worker).

```bash
git add -A
git commit -m "initial deploy"
git push origin main
```

> **First deploy note**: The Cloud Run service URL is unknown on first deploy, so `HANDLER_URL` starts empty and Cloud Tasks are skipped. Push again after the first deploy to enable the full async queue flow.

### 6. Use it

Send a YouTube/TikTok/Instagram link to your Telegram bot. You'll get "Got it!" immediately. The service enqueues a Cloud Task → the task handler creates a Cloud Run Job → the worker processes the video (no 1-hour timeout). The frontend polls for status and shows a progress bar with ETA.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Web server port |
| `SUPABASE_URL` | — | Supabase project URL |
| `SUPABASE_ANON_KEY` | — | Supabase anon key |
| `SUPABASE_TABLE` | `videos` | Table name for transcriptions |
| `WHISPER_MODEL` | `base` | Model size: `tiny`, `base`, `small`, `medium`, `large` |
| `LOG_LEVEL` | `info` | Pino log level |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot token (optional locally) |
| `TELEGRAM_SECRET_TOKEN` | — | Webhook verification secret (optional locally) |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window |
| `RATE_LIMIT_MAX` | `10` | Max requests per window per IP |
| `MAX_CONCURRENT_JOBS` | `2` | Max simultaneous video processing (local mode only) |
| `GCP_PROJECT_ID` | — | GCP project ID (required for Cloud mode) |
| `TASK_QUEUE_PATH` | — | Cloud Tasks queue path (required for Cloud mode) |
| `HANDLER_URL` | — | This service's public URL (required for Cloud mode) |
| `CLOUD_RUN_REGION` | `us-central1` | GCP region |
| `CLOUD_RUN_JOB_NAME` | `video-transcriber-worker` | Cloud Run Job name |
| `GEMINI_API_KEY` | — | Google AI Studio key for AI analysis (optional — get free key at [aistudio.google.com](https://aistudio.google.com)) |

## API

### `GET /health`

Returns server health.

### `GET /api/status/:id`

Returns the current status, transcript, and progress of a transcription job.

```json
{
  "id": "uuid",
  "url": "https://...",
  "status": "processing",
  "transcript": null,
  "error": null,
  "progress": {
    "percentage": 42,
    "stage": "transcribing",
    "message": "Transcribing (42%, ETA 45m 12s)",
    "eta": "45m 12s"
  },
  "created_at": "...",
  "processed_at": null
}
```

### `GET /transcriptions`

Returns the 50 most recent transcriptions.

### `POST /process`

Submit a new video for transcription. Rate-limited (10 req/min by default).

```json
{ "url": "https://www.youtube.com/watch?v=..." }
```

Returns the created job record with the job ID. The frontend then polls `/api/status/:id` for progress.

### `POST /telegram-webhook`

Telegram bot webhook (only registered if `TELEGRAM_BOT_TOKEN` is set). Accepts a Telegram Update object, extracts the URL, and inserts it into Supabase.

## Project structure

```
├── src/
│   ├── server.js                Express app setup & boot
│   ├── worker.js                Cloud Run Job entry point (thin wrapper)
│   ├── pipeline.js              Shared processing pipeline (download → transcribe → save)
│   ├── config.js                Centralized env var loading & validation
│   ├── lib/
│   │   ├── supabase.js          Supabase client singleton
│   │   ├── gemini.js            Gemini 1.5 Flash AI analysis
│   │   ├── telegram.js          Telegram sendMessage helper
│   │   ├── queue.js             Cloud Tasks enqueue + Cloud Run Job creation
│   │   ├── whisper.js           Python subprocess transcription
│   │   ├── video.js             yt-dlp download + ffmpeg extract (with progress callbacks)
│   │   └── job-queue.js         Concurrency limiter for local mode
│   ├── routes/
│   │   ├── health.js            GET /health
│   │   ├── transcribe.js        POST /process
│   │   ├── status.js            GET /api/status/:id
│   │   ├── transcriptions.js    GET /transcriptions
│   │   ├── task-handler.js      POST /api/task-handler (Cloud Tasks delivery)
│   │   └── telegram.js          POST /telegram-webhook
│   └── middleware/
│       └── rate-limit.js        Rate limiter config
├── scripts/
│   ├── transcribe_worker.py     Persistent Whisper daemon
│   └── reanalyse.js             One-off backfill: run AI analysis on existing transcripts
├── public/
│   └── index.html               Frontend with progress bar
├── infra/
│   ├── main.tf                  Cloud Tasks queue + Cloud Run Job + IAM
│   ├── variables.tf             Terraform variables
│   ├── outputs.tf               Cloud Run URL output
│   └── terraform.tfvars.example Example variable values
├── .github/workflows/
│   ├── deploy.yml               CI/CD — build image, deploy service + job
│   └── terraform-infra.yml      Terraform apply on infra/ changes
├── schema.sql                   Supabase table definition
├── Dockerfile                   Container build (CPU-only PyTorch)
└── docker-compose.yml           Local runtime config
```

## Tech stack

- **Node.js** — Express server, Supabase client, pino logging, GCP SDKs
- **Supabase** — Postgres database (status, progress polling)
- **Telegram Bot API** — User interface (share URLs, receive results)
- **yt-dlp** — Video download
- **ffmpeg** — Audio extraction
- **OpenAI Whisper** — Local speech-to-text (Python subprocess)
- **GCP Cloud Run** — Serverless container hosting (service + job)
- **GCP Cloud Tasks** — Reliable async queue with retries
- **Terraform** — Infrastructure as code
- **GitHub Actions** — CI/CD pipeline

## AI Analysis

After transcription, each video is automatically analysed by Gemini 1.5 Flash. The following fields are extracted and saved to the database:

| Field | Description |
|-------|-------------|
| `summary` | 3–5 sentence overview |
| `key_takeaways` | Bullet points of the main ideas |
| `tips_and_tricks` | Actionable advice extracted from the content |
| `category` | Auto-classified topic (education, marketing, technology, etc.) |
| `tags` | 3–5 searchable keywords |
| `chapters` | Titled sections with timestamps for long videos |
| `quotes` | Most memorable/shareable quotes |
| `action_items` | Step-by-step instructions (tutorials only) |
| `tone` | Content style (educational, motivational, tutorial, etc.) |

AI analysis is **optional** — if `GEMINI_API_KEY` is not set, transcription still works and AI fields are left null.

### Backfilling existing videos

To run AI analysis on videos that were transcribed before this feature was added:

```bash
# 1. Make sure your .env has SUPABASE_URL, SUPABASE_ANON_KEY, and GEMINI_API_KEY
# 2. Run the one-off backfill script
node scripts/reanalyse.js
```

The script skips videos that already have a summary, so it's safe to re-run.
