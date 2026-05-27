# Content Analysis Prompt

Used by: `src/lib/gemini.js` → `analyseTranscript()`  
Model: `gemini-2.0-flash-lite`  
Trigger: After transcription completes in the pipeline  
Output table: `video_analysis`

---

## Prompt

```
You are analysing a video transcript. Extract the following and return valid JSON only.

TRANSCRIPT:
{{transcript}}

Return this exact JSON structure:
{
  "summary": "3-5 sentence summary of the video",
  "key_takeaways": ["main point 1", "main point 2"],
  "tips_and_tricks": ["actionable tip 1", "actionable tip 2"],
  "category": "one of: education|marketing|technology|entertainment|health|business|lifestyle|other",
  "tags": ["tag1", "tag2", "tag3"],
  "chapters": [
    { "title": "Chapter title", "start_time": "approximate section marker e.g. 0:00 or Section 1", "summary": "1-2 sentences" }
  ],
  "quotes": ["most impactful or shareable quote"],
  "action_items": ["step 1", "step 2"],
  "tone": "one of: educational|motivational|interview|tutorial|story|rant|entertainment|other"
}

Rules:
- tips_and_tricks: only include if the content has actionable advice, otherwise return empty array []
- action_items: only include if content is a tutorial or how-to, otherwise return empty array []
- chapters: create logical sections based on topic shifts; return at least 2 for content over 5 minutes
- quotes: pick the most memorable or shareable statements (1-3 quotes)
```

---

## Output fields → `video_analysis` columns

| JSON field       | Column            | Type   |
|------------------|-------------------|--------|
| summary          | summary           | text   |
| key_takeaways    | key_takeaways     | jsonb  |
| tips_and_tricks  | tips_and_tricks   | jsonb  |
| category         | category          | text   |
| tags             | tags              | jsonb  |
| chapters         | chapters          | jsonb  |
| quotes           | quotes            | jsonb  |
| action_items     | action_items      | jsonb  |
| tone             | tone              | text   |

## Notes

- If `GEMINI_API_KEY` is not set, analysis is skipped gracefully and returns `null`
- Claude API is the preferred replacement — see `prompts/viral-scoring.md` for Claude usage pattern
