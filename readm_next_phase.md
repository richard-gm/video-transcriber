# Next Phase — LLM Categorization & Downstream Actions

## Goal

After transcription, automatically categorize each video (technology, cooking, news, etc.), generate tags and a summary, and optionally trigger different actions per category.

---

## 1. LLM — Gemini 1.5 Flash (free tier)

| Factor | Detail |
|--------|--------|
| Model | Gemini 1.5 Flash (or 2.0 Flash when stable) |
| Free tier | 1,500 requests/day, 1M tokens/min input |
| Cost after free | ~$0.075/1M input tokens (negligible) |
| Context window | 1M tokens — covers hour-long transcripts |
| API Key | Get from [aistudio.google.com](https://aistudio.google.com) → **Get API key** (free, no credit card) |
| Integration | Simple `fetch()` POST in Node.js — no SDK needed |

### API call

```js
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}
Content-Type: application/json

{
  "system_instruction": { "parts": [{ "text": "You categorize video transcripts." }] },
  "contents": [{ "parts": [{ "text": "Transcript: ...\n\nReturn JSON." }] }]
}
```

Returns:

```json
{
  "candidates": [{
    "content": {
      "parts": [{ "text": "{\"category\":\"technology\",\"tags\":[\"AI\",\"machine learning\",\"tutorial\"],\"summary\":\"An introduction to transformer models...\"}" }]
    }
  }]
}
```

---

## 2. Schema — new columns in `videos` table

No new tables needed. Add three columns to the existing `videos` table:

```sql
alter table videos add column if not exists category text;
alter table videos add column if not exists tags     jsonb default '[]';
alter table videos add column if not exists summary  text;

-- RLS policies already cover all columns via "anon can update"
```

### Column reference

| Column | Type | Example |
|--------|------|---------|
| `category` | `text` | `"technology"` |
| `tags` | `jsonb` | `["AI", "machine learning", "tutorial"]` |
| `summary` | `text` | `"An introduction to transformer models for NLP tasks."` |

---

## 3. Architecture — inline in `processVideo`

Categorization runs **inside** the existing `processVideo` function, right after Whisper returns the transcript, before saving to Supabase.

```
processVideo(id, url, chatId):
  1. yt-dlp download
  2. ffmpeg extract audio
  3. Whisper transcribe  ──────▶  text
  4. Gemini categorize  ───────▶  { category, tags, summary }
  5. Save to Supabase: status='done', transcript, category, tags, summary
  6. Telegram: "✅ {category} — {summary}"
```

Non-blocking: if Gemini fails, the video is still saved as `done` with the transcript but null category. The error is logged but doesn't fail the pipeline.

Uses the existing `JobQueue` for concurrency control — categorization is just one more async step in the pipeline.

---

## 4. Prompt design

```
System:
  You are a video categorization assistant. Categorize the transcript
  and return valid JSON only (no markdown, no code fences).

User:
  Transcript:
  {transcript}

  Return JSON with exactly these fields:
    - category: one of technology, cooking, news, education, entertainment, music, sports, other
    - tags: array of 3-5 short keywords in the transcript's language
    - summary: 1-2 sentence summary in the transcript's language
    - language: BCP-47 code of the transcript language (e.g., "en", "es", "ja")
```

Adding `language` lets us later support translation and language-specific routing.

---

## 5. Files to modify

| File | Change |
|------|--------|
| `schema.sql` | Add `category`, `tags`, `summary` columns |
| `server.js` | Add `GEMINI_API_KEY` config, `categorizeTranscript()` function, integrate into `processVideo` |
| `.env.example` | Add `GEMINI_API_KEY=` |
| `infra/main.tf` | Add `GEMINI_API_KEY` env var to Cloud Run |
| `.github/workflows/deploy.yml` | Add `GEMINI_API_KEY` to secrets |
| `public/index.html` | Show category and summary in result cards |
| `README.md` | Add categorization section, update config table |

---

## 6. Gemini response handling

```js
async function categorizeTranscript(transcript) {
  if (!GEMINI_API_KEY || !transcript) return null;

  const prompt = `...`;  // see section 4

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      },
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty Gemini response');

    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch (err) {
    logger.warn({ err: err.message }, 'categorization failed');
    return null;  // non-blocking — video still saved as done
  }
}
```

---

## 7. Cost estimate (100 videos/month)

| Service | Cost |
|---------|------|
| Gemini 1.5 Flash | Free (1,500 req/day limit, we use ~3/day) |
| Cloud Run | ~$0.05 (10 min/video, free tier covers most) |
| Supabase | Free tier (500 MB DB) |
| **Total** | **~$0.05/month** |

---

## 8. Future: categories → downstream actions (placeholder)

Once categorization is in place, the next phase is per-category action triggers:

```env
CATEGORY_TECHNOLOGY_WEBHOOK=https://notion.example.com/tech
CATEGORY_COOKING_WEBHOOK=https://sheets.example.com/recipes
CATEGORY_NEWS_WEBHOOK=https://slack.example.com/news
```

In `server.js`, after categorization succeed:

```js
if (category && process.env[`CATEGORY_${category.toUpperCase()}_WEBHOOK`]) {
  jobQueue.add(() => postToWebhook(category, { url, transcript, summary, tags }));
}
```

Webhook payload design to be finalized when this phase starts.
