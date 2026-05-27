# Viral Scoring Prompt

Used by: `src/lib/viral-scorer.js` (to be built)  
Model: `claude-haiku-4-5-20251001` (fast + cheap for scoring)  
Trigger: After `video_analysis` is written; called on demand or post-pipeline  
Output table: `video_viral_scores`

Platform-specific weights are loaded from `platforms.viral_weights` in the DB and injected at runtime.

---

## Prompt

```
You are a viral content analyst. Score the following video transcript for its viral potential on {{platform}}.

PLATFORM: {{platform}}
NICHE: {{niche}}
TRANSCRIPT:
{{transcript}}

PLATFORM WEIGHTS (how much each factor contributes to the final score on {{platform}}):
{{platform_weights}}

Analyse the transcript and return valid JSON only. Score each dimension 0-100.

{
  "absolute_score": <overall viral potential 0-100, weighted by platform_weights>,
  "hook_strength": <how compelling is the opening — does it create curiosity, tension, or immediate value? 0-100>,
  "pacing_score": <information density and rhythm — too slow loses attention, too fast loses comprehension. 0-100>,
  "emotional_arc_score": <does the content build emotion — tension, surprise, inspiration, humour? 0-100>,
  "cta_score": <how natural and effective is the call to action? 0-100>,
  "shareability_score": <would someone forward this — does it have a 'wow' or 'that's me' moment? 0-100>,
  "story_structure_score": <does it follow a recognisable arc — problem/agitation/solution, hero's journey, etc.? 0-100>,
  "hooks": [
    {
      "type": "one of: curiosity|vulnerability|shock|humour|relatability|authority|controversy",
      "timestamp_hint": "approximate position e.g. 'opening line', '0:30', 'midpoint'",
      "text": "exact quote or paraphrase of the hook",
      "score": <effectiveness of this specific hook 0-100>
    }
  ],
  "improvement_suggestions": [
    {
      "area": "one of: hook|pacing|emotional_arc|cta|shareability|story_structure",
      "suggestion": "specific, actionable improvement in 1-2 sentences",
      "potential_gain": <estimated score improvement if implemented 0-20>
    }
  ],
  "reasoning": "2-3 sentences explaining the overall score and the single biggest lever for improvement"
}

Scoring rules:
- Be honest and calibrated — a score of 100 means near-perfect viral execution for this platform
- hooks array: identify 1-4 hooks; return empty array [] if none found
- improvement_suggestions: return 2-3 actionable suggestions, ordered by potential impact
- absolute_score = weighted average: (hook_strength × hook_weight) + (pacing_score × pacing_weight) + ...
  Use the platform_weights provided above for the weighting
```

---

## Platform weights reference

Weights are stored in `platforms.viral_weights` and injected at runtime. Example for TikTok:

```json
{
  "hook_weight": 0.35,
  "pacing_weight": 0.20,
  "emotional_arc_weight": 0.15,
  "cta_weight": 0.10,
  "shareability_weight": 0.15,
  "story_structure_weight": 0.05
}
```

---

## Relative scoring (library percentile)

Computed at query time using a SQL window function — not stored:

```sql
select
  v.id,
  v.url,
  vvs.absolute_score,
  percent_rank() over (
    partition by v.platform
    order by vvs.absolute_score
  ) as library_percentile
from videos v
join video_viral_scores vvs on vvs.video_id = v.id
where v.platform = '{{platform}}';
```

---

## Reference corpus baseline

Scores are anchored against `viral_references` — known viral videos (1M+ views) pre-analysed with this same prompt. The `absolute_score` represents performance relative to that baseline, not relative to the user's own library.

See `viral_references` table: `platform`, `niche`, `view_count`, `viral_analysis`.

---

## Output fields → `video_viral_scores` columns

| JSON field              | Column                  | Type    |
|-------------------------|-------------------------|---------|
| absolute_score          | absolute_score          | integer |
| — (computed later)      | platform_adjusted_score | integer |
| hook_strength           | hook_strength           | integer |
| pacing_score            | pacing_score            | integer |
| emotional_arc_score     | emotional_arc_score     | integer |
| cta_score               | cta_score               | integer |
| shareability_score      | shareability_score      | integer |
| story_structure_score   | story_structure_score   | integer |
| hooks                   | hooks                   | jsonb   |
| improvement_suggestions | improvement_suggestions | jsonb   |
