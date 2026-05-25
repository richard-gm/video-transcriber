'use strict';

const { config, logger } = require('../config');

let genAI;

function getClient() {
  if (!config.GEMINI_API_KEY) return null;
  if (!genAI) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);
  }
  return genAI;
}

async function analyseTranscript(transcript) {
  const client = getClient();
  if (!client) {
    logger.info('GEMINI_API_KEY not set — skipping AI analysis');
    return null;
  }

  try {
    const model = client.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: { responseMimeType: 'application/json' },
    });

    const prompt = `You are analysing a video transcript. Extract the following and return valid JSON only.

TRANSCRIPT:
${transcript}

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
- quotes: pick the most memorable or shareable statements (1-3 quotes)`;

    const result = await model.generateContent(prompt);
    const analysis = JSON.parse(result.response.text());
    logger.info('gemini analysis complete');
    return analysis;
  } catch (err) {
    logger.warn({ err: err.message }, 'gemini analysis failed — continuing without AI fields');
    return null;
  }
}

module.exports = { analyseTranscript };
