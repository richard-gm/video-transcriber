'use strict';

const { config, logger } = require('../config');

let client;

function getClient() {
  if (!config.ANTHROPIC_API_KEY) return null;
  if (!client) {
    const Anthropic = require('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  }
  return client;
}

const DEFAULT_WEIGHTS = {
  hook_weight: 1 / 6,
  pacing_weight: 1 / 6,
  emotional_arc_weight: 1 / 6,
  cta_weight: 1 / 6,
  shareability_weight: 1 / 6,
  story_structure_weight: 1 / 6,
};

async function scoreVideo({ videoId, transcript, platform, niche, supabase }) {
  const anthropic = getClient();
  if (!anthropic) {
    logger.info('ANTHROPIC_API_KEY not set — skipping viral scoring');
    return null;
  }

  let platformWeights = DEFAULT_WEIGHTS;
  try {
    const { data } = await supabase
      .from('platforms')
      .select('viral_weights')
      .eq('id', platform || 'unknown')
      .single();
    if (data?.viral_weights) platformWeights = data.viral_weights;
  } catch {}

  const weightsText = Object.entries(platformWeights)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  const prompt = `You are a viral content analyst. Score the following video transcript for its viral potential on ${platform || 'unknown'}.

PLATFORM: ${platform || 'unknown'}
NICHE: ${niche || 'general'}
TRANSCRIPT:
${transcript}

PLATFORM WEIGHTS (how much each factor contributes to the final score on ${platform || 'unknown'}):
${weightsText}

Analyse the transcript and return valid JSON only. Score each dimension 0-100.

{
  "absolute_score": <overall viral potential 0-100, weighted by platform_weights>,
  "hook_strength": <how compelling is the opening 0-100>,
  "pacing_score": <information density and rhythm 0-100>,
  "emotional_arc_score": <emotional build — tension, surprise, inspiration, humour 0-100>,
  "cta_score": <how natural and effective is the call to action 0-100>,
  "shareability_score": <would someone forward this 0-100>,
  "story_structure_score": <recognisable arc — problem/solution, hero's journey, etc. 0-100>,
  "hooks": [
    {
      "type": "one of: curiosity|vulnerability|shock|humour|relatability|authority|controversy",
      "timestamp_hint": "approximate position e.g. 'opening line', '0:30', 'midpoint'",
      "text": "exact quote or paraphrase of the hook",
      "score": <effectiveness 0-100>
    }
  ],
  "improvement_suggestions": [
    {
      "area": "one of: hook|pacing|emotional_arc|cta|shareability|story_structure",
      "suggestion": "specific, actionable improvement in 1-2 sentences",
      "potential_gain": <estimated score improvement 0-20>
    }
  ],
  "reasoning": "2-3 sentences explaining the overall score and the single biggest lever for improvement"
}

Scoring rules:
- Be honest and calibrated — 100 means near-perfect viral execution for this platform
- hooks array: identify 1-4 hooks; return [] if none found
- improvement_suggestions: return 2-3 suggestions ordered by potential impact
- absolute_score = weighted average using the platform_weights provided`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = message.content[0].text;
    const jsonText = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const score = JSON.parse(jsonText);

    await supabase.from('video_viral_scores').upsert({
      video_id: videoId,
      absolute_score: score.absolute_score,
      hook_strength: score.hook_strength,
      pacing_score: score.pacing_score,
      emotional_arc_score: score.emotional_arc_score,
      cta_score: score.cta_score,
      shareability_score: score.shareability_score,
      story_structure_score: score.story_structure_score,
      hooks: score.hooks ?? [],
      improvement_suggestions: score.improvement_suggestions ?? [],
      scored_at: new Date().toISOString(),
    });

    logger.info({ videoId, score: score.absolute_score }, 'viral scoring complete');
    return score;
  } catch (err) {
    logger.warn({ err: err.message }, 'viral scoring failed — continuing without score');
    return null;
  }
}

module.exports = { scoreVideo };
