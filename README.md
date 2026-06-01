# Video Transcriber

Downloads videos from YouTube, TikTok, and Instagram, transcribes the audio using OpenAI Whisper, runs AI content analysis via Gemini, and scores viral potential across six dimensions.

Live: **https://video-transcriber-447945727637.us-central1.run.app**

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
                                                  ├── Whisper        │
                                                  ├── Gemini AI      │
                                                  └── Viral Scorer   │
                                                           │
                                                           ▼
                                                  ┌──────────────────┐
                                                  │  Supabase        │
                                                  │  (Postgres —     │
                                                  │   videos,        │
                                                  │   video_analysis,│
                                                  │   viral_scores)  │
                                                  └──────────────────┘
```

### Two modes

**Local** (no GCP needed): the server calls the processing pipeline inline. Concurrency is limited to `MAX_CONCURRENT_JOBS`. Progress is written to Supabase and the frontend polls it.

**Cloud** (Cloud Run + Cloud Tasks): the service inserts the row and enqueues a Cloud Task. The task handler creates a Cloud Run Job execution. The worker (same Docker image, `src/worker.js`) processes the video with **no timeout ceiling** — Cloud Run Jobs support up to 10-hour tasks, unlike the 1-hour limit on Cloud Run services.

### Key design decisions

- **Async by default** — API returns immediately with a job ID; the frontend polls `/api/status/:id` until completion.
- **Progress tracking** — Real yt-dlp download metrics (speed, ETA, %) and estimated transcription progress visible in the UI.
- **Single Docker image** — Both the service and the worker use the same image; the entry point is `src/server.js` (service) or `src/worker.js` (job).
- **Telegram as primary interface** — Share URLs from your phone to the Telegram bot. No browser needed.
- **iOS client bypass** — yt-dlp uses YouTube's iOS client API to avoid cloud-IP bot detection.
- **Graceful shutdown** — On SIGTERM/SIGINT, the server stops accepting new work and exits.
- **Scale to zero** — Cloud Run spins down when idle; you pay only for the seconds you use.
- **Trust proxy** — Express is configured with `trust proxy: 1` for correct IP resolution behind Google's load balancer.

## Quick start — local

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) **or** Node.js 20+, Python 3.11+, ffmpeg, yt-dlp
- A [Supabase](https://supabase.com) project

### 1. Database setup

In your Supabase dashboard → **SQL Editor**, run `schema.sql` to create all tables and enable Realtime. This creates:

- `videos` — core job table (URL, status, transcript, progress)
- `video_analysis` — AI content analysis results (1:1 with videos)
- `video_viral_scores` — viral potential scores (1:1 with videos)
- `viral_references` — baseline corpus of known viral videos
- `platforms` — per-platform viral scoring weights
- `niches` — content category taxonomy
- `chat_sessions` / `chat_messages` — persistent in-app chat (future use)

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
gcloud services enable \
  cloudrun.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  iamcredentials.googleapis.com \
  cloudtasks.googleapis.com
```

### 2. Create Terraform service account

The Terraform workflow needs a dedicated service account with permission to manage IAM:

```bash
gcloud iam service-accounts create github-actions-deployer \
  --display-name="GitHub Actions Deployer"

gcloud projects add-iam-policy-binding YOUR-PROJECT-ID \
  --member="serviceAccount:github-actions-deployer@YOUR-PROJECT-ID.iam.gserviceaccount.com" \
  --role="roles/resourcemanager.projectIamAdmin"

gcloud projects add-iam-policy-binding YOUR-PROJECT-ID \
  --member="serviceAccount:github-actions-deployer@YOUR-PROJECT-ID.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding YOUR-PROJECT-ID \
  --member="serviceAccount:github-actions-deployer@YOUR-PROJECT-ID.iam.gserviceaccount.com" \
  --role="roles/cloudtasks.admin"

gcloud projects add-iam-policy-binding YOUR-PROJECT-ID \
  --member="serviceAccount:github-actions-deployer@YOUR-PROJECT-ID.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.admin"

gcloud projects add-iam-policy-binding YOUR-PROJECT-ID \
  --member="serviceAccount:github-actions-deployer@YOUR-PROJECT-ID.iam.gserviceaccount.com" \
  --role="roles/storage.admin"
```

Then download a JSON key for this service account — you'll need it as the `GCP_SA_KEY` GitHub secret.

### 3. Create Telegram bot

Open Telegram, search for [@BotFather](https://t.me/BotFather), and run `/newbot`. Save the token (looks like `123456:ABC-DEF1234`). Also generate a random secret token for webhook verification.

### 4. Deploy infrastructure (Terraform)

Terraform manages: Artifact Registry, Cloud Tasks queue, and IAM bindings for the `video-transcriber` service account.

```bash
cp infra/terraform.tfvars.example infra/terraform.tfvars
# Fill in your values
cd infra
terraform init
terraform apply
```

> **Note:** The Cloud Run service and Job are managed by `deploy.yml` (GitHub Actions), not Terraform. Terraform only manages the queue and IAM.

### 5. Set up GitHub Actions

Add these secrets and variables in your repo → Settings → Secrets and variables → Actions:

**Secrets**

| Secret | Value | Where to get it |
|--------|-------|----------------|
| `GCP_SA_KEY` | `{"type":"service_account",...}` | IAM → Service Accounts → `github-actions-deployer` → Keys → JSON |
| `SUPABASE_URL` | `https://your-project.supabase.co` | Supabase → Settings → API |
| `SUPABASE_ANON_KEY` | `eyJ...` | Supabase → Settings → API |
| `TELEGRAM_BOT_TOKEN` | `123456:ABC-DEF1234...` | From @BotFather |
| `TELEGRAM_SECRET_TOKEN` | Your random secret string | Generate with `openssl rand -hex 32` |
| `GEMINI_API_KEY` | `AIza...` | [aistudio.google.com](https://aistudio.google.com) → Get API key (free) |

**Variables**

| Variable | Value | Notes |
|----------|-------|-------|
| `GCP_PROJECT_ID` | `your-project-id` | GCP → Project Dashboard |
| `SUPABASE_TABLE` | `videos` | Your Supabase table name |
| `WHISPER_MODEL` | `base` | `tiny`/`base`/`small`/`medium`/`large` — larger = slower but more accurate |

### 6. Deploy

Push to `main` — GitHub Actions builds the Docker image via Cloud Build, deploys the Cloud Run service (API), and creates/updates the Cloud Run Job (worker).

```bash
git push origin main
```

> **First deploy note**: The Cloud Run service URL is unknown on first deploy, so `HANDLER_URL` starts empty and Cloud Tasks are skipped. Push again after the first deploy to enable the full async queue flow.

### 7. Register the Telegram webhook

After your first successful deploy, register the webhook once:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://YOUR-CLOUD-RUN-URL/telegram-webhook",
    "secret_token": "YOUR_TELEGRAM_SECRET_TOKEN"
  }'
```

### 8. Use it

Send a YouTube/TikTok/Instagram link to your Telegram bot. You'll get "Got it!" immediately. The service enqueues a Cloud Task → the task handler creates a Cloud Run Job → the worker downloads, transcribes, analyses, and scores the video. Progress is visible in the web UI and results are sent back via Telegram.

## Configuration reference

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
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window in ms |
| `RATE_LIMIT_MAX` | `10` | Max requests per window per IP |
| `MAX_CONCURRENT_JOBS` | `2` | Max simultaneous jobs (local mode only) |
| `GCP_PROJECT_ID` | — | GCP project ID (Cloud mode) |
| `TASK_QUEUE_PATH` | — | Cloud Tasks queue path (Cloud mode) |
| `HANDLER_URL` | — | This service's public URL (Cloud mode) |
| `CLOUD_RUN_REGION` | `us-central1` | GCP region |
| `CLOUD_RUN_JOB_NAME` | `video-transcriber-worker` | Cloud Run Job name |
| `GEMINI_API_KEY` | — | Google AI Studio key for AI analysis (optional) |

## API

### `GET /health`

Returns server health status.

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

Returns the 50 most recent transcriptions, joined with AI analysis and viral scores.

### `POST /process`

Submit a new video for transcription. Rate-limited (10 req/min per IP by default).

```json
{ "url": "https://www.youtube.com/watch?v=..." }
```

Returns the created job record. Poll `/api/status/:id` for progress updates.

### `POST /telegram-webhook`

Telegram bot webhook. Accepts a Telegram Update object, extracts the URL, inserts a job, and replies "Got it!".

### `POST /api/task-handler`

Internal endpoint called by Cloud Tasks. Creates a Cloud Run Job execution to process the video. Not intended for direct use.

## Frontend

The frontend is a vanilla JS single-page app using ES modules — no build tool required.

```
public/
├── index.html          Shell page — loads CSS and JS module
├── css/
│   └── main.css        All styles
└── js/
    ├── app.js          Entry point — sets up event handlers, calls loadHistory()
    ├── api.js          Supabase fetch helpers (loadHistory, prependResult)
    ├── categories.js   Category sidebar + mobile pill nav
    ├── render.js       Card rendering, AI analysis blocks, collapsibles
    ├── state.js        Shared mutable state (allRecords, activeCategory)
    └── utils.js        escHtml, escAttr, cap helpers
```

Features:
- **Category sidebar** — auto-built from Gemini's `category` field; filters the card list
- **Progress cards** — live download/transcription progress with speed and ETA
- **AI analysis panels** — collapsible sections for summary, key takeaways, quotes, chapters, action items
- **Viral score badge** — displays `absolute_score` when available (requires `ANTHROPIC_API_KEY`)
- **Copy/delete** — copy transcript to clipboard, delete jobs
- **Cancel** — cancel a running job before it completes

## AI Analysis

After transcription, each video is automatically analysed by Gemini 1.5 Flash. Results are stored in the `video_analysis` table.

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

## Viral Scoring

After AI analysis, each video is optionally scored for viral potential by Claude Haiku. Results are stored in the `video_viral_scores` table.

Scoring is skipped if `ANTHROPIC_API_KEY` is not set. The preferred workflow is to ask the NanoClaw agent to run scoring directly — it fetches transcripts from Supabase, analyses them using Claude, and writes results back without needing an API key in the worker.

### Score dimensions

Each dimension is scored 0–100 and weighted by platform:

| Dimension | Description |
|-----------|-------------|
| `hook_strength` | How compelling the opening is |
| `pacing_score` | Information density and rhythm |
| `emotional_arc_score` | Emotional build — tension, surprise, inspiration, humour |
| `cta_score` | How natural and effective the call to action is |
| `shareability_score` | Would someone forward this? |
| `story_structure_score` | Recognisable arc — problem/solution, hero's journey, etc. |

The `absolute_score` is the platform-weighted average of all dimensions. Platform weights are stored in the `platforms` table and can be tuned per-platform.

### Platform weights (defaults)

| Platform | Hook | Pacing | Emotion | CTA | Share | Structure |
|----------|------|--------|---------|-----|-------|-----------|
| YouTube | 0.20 | 0.15 | 0.20 | 0.15 | 0.15 | 0.15 |
| TikTok | 0.35 | 0.20 | 0.15 | 0.10 | 0.15 | 0.05 |
| Instagram | 0.30 | 0.15 | 0.20 | 0.10 | 0.20 | 0.05 |
| LinkedIn | 0.20 | 0.15 | 0.15 | 0.20 | 0.15 | 0.15 |

In addition to the score, the scorer returns:
- **Hooks** — identified hooks with type, timestamp hint, and effectiveness score
- **Improvement suggestions** — 2–3 actionable suggestions ordered by potential impact
- **Reasoning** — 2–3 sentences on the overall score and biggest lever

## Project structure

```
├── src/
│   ├── server.js                Express app (trust proxy, routes, SIGTERM handler)
│   ├── worker.js                Cloud Run Job entry point
│   ├── pipeline.js              Download → transcribe → AI analysis → viral score
│   ├── config.js                Env var loading & validation
│   ├── lib/
│   │   ├── supabase.js          Supabase client singleton
│   │   ├── gemini.js            Gemini 1.5 Flash content analysis
│   │   ├── viral-scorer.js      Claude Haiku viral potential scoring
│   │   ├── telegram.js          Telegram sendMessage helper
│   │   ├── queue.js             Cloud Tasks enqueue + Cloud Run Job creation
│   │   ├── whisper.js           Python subprocess transcription (Whisper daemon)
│   │   ├── video.js             yt-dlp download (iOS client bypass) + ffmpeg extract
│   │   ├── platform.js          URL → platform detector
│   │   ├── local-queue.js       Concurrency limiter for local mode
│   │   └── job-queue.js         Queue state tracking
│   ├── routes/
│   │   ├── health.js            GET /health
│   │   ├── transcribe.js        POST /process
│   │   ├── status.js            GET /api/status/:id
│   │   ├── transcriptions.js    GET /transcriptions
│   │   ├── task-handler.js      POST /api/task-handler (Cloud Tasks delivery)
│   │   ├── cancel.js            POST /api/cancel/:id
│   │   ├── delete.js            DELETE /api/delete/:id
│   │   └── telegram.js          POST /telegram-webhook
│   └── middleware/
│       └── rate-limit.js        express-rate-limit config
├── scripts/
│   ├── transcribe_worker.py     Persistent Whisper daemon (IPC via stdin/stdout)
│   └── reanalyse.js             Backfill: run AI analysis on existing transcripts
├── public/
│   ├── index.html               Shell page
│   ├── css/main.css             All styles
│   └── js/
│       ├── app.js               Entry point (ES module)
│       ├── api.js               Fetch helpers
│       ├── categories.js        Sidebar nav
│       ├── render.js            Card/AI block rendering
│       ├── state.js             Shared state
│       └── utils.js             HTML escape helpers
├── infra/
│   ├── main.tf                  Artifact Registry + Cloud Tasks + IAM bindings
│   ├── variables.tf             Terraform input variables
│   ├── outputs.tf               Outputs (queue name, etc.)
│   └── terraform.tfvars.example Example values
├── .github/workflows/
│   ├── deploy.yml               Build image → deploy Cloud Run service + job
│   └── terraform-infra.yml      Terraform plan/apply on infra/ changes
├── schema.sql                   Full Supabase schema (all tables + RLS policies)
├── Dockerfile                   Container build (CPU-only PyTorch, fresh yt-dlp)
└── docker-compose.yml           Local runtime config
```

## Tech stack

- **Node.js** — Express server, Supabase client, pino logging, GCP SDKs
- **Supabase** — Postgres database with Row Level Security
- **Telegram Bot API** — Primary user interface (share URLs, receive results)
- **yt-dlp** — Video download (iOS client API for cloud-IP compatibility)
- **ffmpeg** — Audio extraction (WAV → 16kHz mono for Whisper)
- **OpenAI Whisper** — Local speech-to-text (Python subprocess, CPU mode)
- **Gemini 1.5 Flash** — Content analysis (summary, chapters, tags, etc.)
- **Claude Haiku** — Viral potential scoring (optional)
- **GCP Cloud Run** — Serverless container hosting (service + job)
- **GCP Cloud Tasks** — Reliable async queue with configurable retries
- **Terraform** — Infrastructure as code (queue, IAM)
- **GitHub Actions** — CI/CD (Cloud Build + deploy)

## Troubleshooting

### yt-dlp fails on cloud but works locally

YouTube blocks known cloud provider IP ranges more aggressively than residential IPs. The worker uses `--extractor-args youtube:player_client=ios` to use YouTube's iOS client API which is less restricted. If this still fails, the next step is to pass YouTube cookies via `--cookies` (export from a browser session, store in Secret Manager).

### Cloud Tasks not dispatching

1. Ensure the Cloud Tasks API is enabled: `gcloud services enable cloudtasks.googleapis.com`
2. Ensure the `video-transcriber` service account has `roles/cloudtasks.enqueuer` at project level (managed by Terraform)
3. `HANDLER_URL` must be set — it's populated from the Cloud Run service URL on the second deploy

### Terraform IAM errors

The Terraform service account needs `roles/resourcemanager.projectIamAdmin` to manage project-level IAM bindings. Grant this in GCP Console → IAM or via `gcloud projects add-iam-policy-binding`.

### First deploy: Cloud Tasks are skipped

On first deploy, the Cloud Run service URL doesn't exist yet so `HANDLER_URL` is empty. Cloud Tasks enqueue is skipped. Push again after the first deploy completes.
