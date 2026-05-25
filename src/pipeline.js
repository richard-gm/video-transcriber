'use strict';

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { config, logger } = require('./config');
const { downloadVideo, extractAudio, getAudioDuration } = require('./lib/video');
const { transcribeAudio } = require('./lib/whisper');
const { analyseTranscript } = require('./lib/gemini');
const { sendTelegramMessage } = require('./lib/telegram');

class CancelledError extends Error {
  constructor() { super('Cancelled by user'); this.name = 'CancelledError'; }
}

async function checkCancelled(supabase, videoId) {
  const { data } = await supabase
    .from(config.SUPABASE_TABLE)
    .select('status')
    .eq('id', videoId)
    .single();
  if (data?.status === 'cancelled') throw new CancelledError();
}

function createProgressWriter(supabase, videoId) {
  let lastWrite = 0;
  let lastPct = -1;
  return (percentage, stage, message, eta) => {
    const now = Date.now();
    if (percentage - lastPct < 3 && now - lastWrite < 8000 && percentage < 100) return;
    lastPct = percentage;
    lastWrite = now;
    const progress = { percentage, stage, message };
    if (eta) progress.eta = eta;
    supabase.from(config.SUPABASE_TABLE).update({ progress }).eq('id', videoId).then(null, () => {});
  };
}

async function runPipeline(videoId) {
  const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  const writeProgress = createProgressWriter(supabase, videoId);

  logger.info({ videoId }, 'pipeline started');
  writeProgress(0, 'starting', 'Starting...');

  const { data: job, error: fetchError } = await supabase
    .from(config.SUPABASE_TABLE)
    .select('url, chat_id')
    .eq('id', videoId)
    .single();

  if (fetchError || !job) {
    logger.error({ err: fetchError?.message }, 'could not fetch job');
    return;
  }

  await checkCancelled(supabase, videoId);
  await supabase.from(config.SUPABASE_TABLE).update({ status: 'processing' }).eq('id', videoId);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtx-'));

  try {
    await checkCancelled(supabase, videoId);
    const videoFile = await downloadVideo(job.url, tmpDir, (p) => {
      writeProgress(Math.round(p.percentage * 0.15), 'downloading', p.message, p.eta);
    });

    await checkCancelled(supabase, videoId);
    writeProgress(15, 'extracting', 'Extracting audio...');
    const audioPath = await extractAudio(tmpDir, videoFile, (p) => {
      writeProgress(15 + Math.round(p.percentage * 0.05), 'extracting', p.message);
    });

    await checkCancelled(supabase, videoId);
    writeProgress(20, 'transcribing', 'Transcribing...');
    const audioDuration = await getAudioDuration(audioPath);
    const text = await transcribeAudio(audioPath, audioDuration, (p) => {
      writeProgress(20 + Math.round(p.percentage * 0.75), 'transcribing', p.message, p.eta);
    }, () => checkCancelled(supabase, videoId));

    await checkCancelled(supabase, videoId);
    writeProgress(90, 'analysing', 'Extracting insights...');
    const analysis = await analyseTranscript(text);

    writeProgress(95, 'saving', 'Saving result...');
    await supabase
      .from(config.SUPABASE_TABLE)
      .update({
        status: 'done',
        transcript: text,
        progress: { percentage: 100, stage: 'done', message: 'Complete' },
        processed_at: new Date().toISOString(),
        ...(analysis ? {
          summary: analysis.summary,
          key_takeaways: analysis.key_takeaways,
          tips_and_tricks: analysis.tips_and_tricks,
          category: analysis.category,
          tags: analysis.tags,
          chapters: analysis.chapters,
          quotes: analysis.quotes,
          action_items: analysis.action_items,
          tone: analysis.tone,
        } : {}),
      })
      .eq('id', videoId);

    logger.info({ videoId }, 'processing complete');

    const notifyText = analysis?.summary
      ? `✅ Done\n\n📝 ${analysis.summary}${analysis.tips_and_tricks?.length ? '\n\n💡 Tips:\n' + analysis.tips_and_tricks.slice(0, 3).map(t => `• ${t}`).join('\n') : ''}\n\n${job.url}`
      : `✅ Done\n${job.url}`;
    await sendTelegramMessage(job.chat_id, notifyText);
    return true;
  } catch (err) {
    if (err instanceof CancelledError) {
      logger.info({ videoId }, 'pipeline cancelled');
      await supabase
        .from(config.SUPABASE_TABLE)
        .update({
          status: 'cancelled',
          progress: { percentage: 0, stage: 'cancelled', message: 'Cancelled by user' },
        })
        .eq('id', videoId)
        .then(null, () => {});
      return false;
    }
    logger.error({ videoId, err: err.message }, 'processing failed');
    await supabase
      .from(config.SUPABASE_TABLE)
      .update({
        status: 'error',
        error: err.message,
        progress: { percentage: 0, stage: 'error', message: err.message },
      })
      .eq('id', videoId);

    await sendTelegramMessage(job.chat_id, '❌ Failed: ' + err.message + '\n' + job.url);
    return false;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = { runPipeline };
