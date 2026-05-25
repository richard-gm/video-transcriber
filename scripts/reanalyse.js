#!/usr/bin/env node
// =============================================================================
// ONE-OFF BACKFILL SCRIPT — run once to add AI analysis to existing videos
//
// This script finds all videos that have a transcript but no AI summary yet,
// sends each transcript to Gemini 1.5 Flash, and saves the results back to
// Supabase. It does NOT re-download or re-transcribe anything.
//
// HOW TO RUN:
//   1. Make sure your .env file has SUPABASE_URL, SUPABASE_ANON_KEY,
//      SUPABASE_TABLE, and GEMINI_API_KEY set.
//   2. Install dependencies if not already done:
//        npm install
//   3. Run:
//        node scripts/reanalyse.js
//
// The script logs progress for each video and skips any that already have
// a summary. Safe to re-run — it will only process videos still missing
// AI fields.
// =============================================================================

'use strict';

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'videos';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Delay between Gemini calls (ms) — keeps well within 15 req/min free tier
const DELAY_MS = 5000;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env');
  process.exit(1);
}
if (!GEMINI_API_KEY) {
  console.error('ERROR: GEMINI_API_KEY must be set in .env');
  console.error('Get a free key at https://aistudio.google.com');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function analyseTranscript(transcript) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash-lite',
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
  return JSON.parse(result.response.text());
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('Fetching videos with transcripts but no AI analysis...\n');

  const { data: videos, error } = await supabase
    .from(SUPABASE_TABLE)
    .select('id, url, transcript')
    .eq('status', 'done')
    .is('summary', null)
    .not('transcript', 'is', null)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to fetch videos:', error.message);
    process.exit(1);
  }

  if (!videos.length) {
    console.log('No videos to process — all done already!');
    return;
  }

  console.log(`Found ${videos.length} video(s) to analyse.\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    const label = `[${i + 1}/${videos.length}]`;
    const shortUrl = video.url.length > 60 ? video.url.slice(0, 60) + '…' : video.url;

    process.stdout.write(`${label} ${shortUrl} — analysing...`);

    try {
      const analysis = await analyseTranscript(video.transcript);

      const { error: updateError } = await supabase
        .from(SUPABASE_TABLE)
        .update({
          summary: analysis.summary,
          key_takeaways: analysis.key_takeaways,
          tips_and_tricks: analysis.tips_and_tricks,
          category: analysis.category,
          tags: analysis.tags,
          chapters: analysis.chapters,
          quotes: analysis.quotes,
          action_items: analysis.action_items,
          tone: analysis.tone,
        })
        .eq('id', video.id);

      if (updateError) throw new Error(updateError.message);

      console.log(` ✅ ${analysis.category} — ${analysis.tone}`);
      success++;
    } catch (err) {
      console.log(` ❌ ${err.message}`);
      failed++;
    }

    if (i < videos.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\nDone. ${success} succeeded, ${failed} failed.`);
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
