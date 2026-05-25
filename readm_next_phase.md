# Next Phase — Roadmap & Ideas

## What's been built so far

- ✅ Async transcription pipeline (Cloud Run Service + Cloud Tasks + Cloud Run Job)
- ✅ Whisper speech-to-text with progress tracking
- ✅ Telegram bot interface (send URL, receive result)
- ✅ AI post-processing via Gemini 1.5 Flash (summary, key takeaways, tips & tricks, category, tags, chapters, quotes, action items, tone)
- ✅ Collapsible AI Analysis UI on each transcription card
- ✅ Telegram notification includes summary and top tips
- ✅ One-off backfill script to analyse existing videos (`scripts/reanalyse.js`)

---

## Still to do

### Infrastructure / DevOps

- [ ] **Secret Manager via Terraform** — move `GEMINI_API_KEY` (and other secrets) into GCP Secret Manager managed by Terraform, and reference via `--set-secrets` in Cloud Run instead of `--set-env-vars`. Cleaner, audited, no secrets in env vars.
- [ ] **Gate Terraform apply** — `terraform-infra.yml` currently auto-applies on every push to `infra/**`. Add a manual approval step or restrict `apply` to `workflow_dispatch` only to prevent accidental infra changes.
- [ ] **Image SHA tagging** — Docker images are only tagged `latest`. Add git SHA tag (`app:${{ github.sha }}`) to enable rollback and trace which commit is running in production.
- [ ] **Post-deploy health check** — after Cloud Run deploy, curl `/health` and fail the workflow if the service doesn't respond, rather than silently succeeding.

---

## Next feature ideas

### 1. Per-category webhook actions

After AI analysis assigns a category, automatically route the result to different destinations:

```
category = "marketing"  → post summary + tips to a Notion database
category = "education"  → save to Google Docs
category = "technology" → send to a Slack channel
```

Implementation: add `CATEGORY_<NAME>_WEBHOOK` env vars and a post-categorization dispatch step in `pipeline.js`.

---

### 2. Agent-based processing per entry

Instead of a single fixed pipeline, each transcription entry could trigger a **specialist AI agent** to do deeper work based on the category:

```
Transcription done
      │
      ├── category = "marketing"
      │       └── spawn MarketingAgent
      │               ├── extract hook, CTA, and headline ideas
      │               ├── score virality potential 1-10
      │               └── post structured report to Telegram
      │
      ├── category = "education"
      │       └── spawn StudyAgent
      │               ├── generate flashcards / quiz questions
      │               ├── create a structured study guide
      │               └── export to Notion
      │
      └── category = "technology"
              └── spawn TechAgent
                      ├── extract code snippets or commands mentioned
                      ├── identify tools/libraries referenced
                      └── generate a "what I learned" summary
```

Each agent runs independently, reports back to Telegram when done, and can call external APIs (Notion, Sheets, etc.). This is the natural evolution once webhook routing is in place.

---

### 3. Ask questions about a video (RAG via Telegram)

Let users ask questions about any transcribed video directly in Telegram:

```
User: /ask <video_id> what did they say about thumbnail design?
Bot: At around the 12-minute mark, the creator said...
```

Implementation: store transcript chunks as vector embeddings in Supabase (`pgvector`), retrieve relevant chunks on query, pass to Gemini with context.

---

### 4. Cross-video search

"Find all videos where they mention CTR" — semantic search across all transcripts using vector embeddings. Would require adding `pgvector` extension to Supabase and an embedding step in the pipeline.

---

### 5. Export to Notion / Google Docs

After transcription + AI analysis, push a structured document to:
- **Notion**: title, summary, key takeaways, tips, full transcript as a toggle
- **Google Docs**: formatted doc with chapters as headings

Triggered manually ("export this video") or automatically per category.

---

### 6. Translation

After transcription, optionally translate the transcript and summary to another language. Gemini can handle this in the same API call. Add a `TRANSLATE_TO` env var (e.g. `es`, `fr`, `pt`).

---

### 7. Speaker diarization

Identify who is speaking when in multi-speaker videos (interviews, podcasts). Whisper doesn't do this natively — would require an additional model (e.g. `pyannote.audio`) or a third-party API (AssemblyAI).

---

### 8. Smarter Whisper model selection

Currently model is fixed at deploy time. Could auto-select based on video duration:
- < 10 min → `small` (fast, accurate)
- 10–60 min → `tiny` (stays within Cloud Run Job budget)
- > 60 min → `tiny` with chunked processing

---

## Architecture direction

The natural evolution of this app is towards a **pipeline of agents**:

```
Video URL
   └─▶ Transcription Worker (Whisper)
           └─▶ Analysis Agent (Gemini — current)
                   └─▶ Specialist Agent (per category — next)
                           └─▶ Delivery Agent (Notion / Slack / Telegram)
```

Each stage is decoupled via Cloud Tasks, runs independently, and reports status back to Supabase. The user interacts only via Telegram and the web UI — the whole pipeline runs silently in the background.
