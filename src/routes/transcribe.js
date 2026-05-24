'use strict';

const { Router } = require('express');
const supabase = require('../lib/supabase');
const { enqueueTask } = require('../lib/queue');
const { runPipeline } = require('../pipeline');
const localQueue = require('../lib/local-queue');
const { config, logger } = require('../config');
const apiLimiter = require('../middleware/rate-limit');

const router = Router();

function isValidVideoUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

router.post('/process', apiLimiter, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  if (!isValidVideoUrl(url)) return res.status(400).json({ error: 'Invalid video URL' });

  const { data, error } = await supabase
    .from(config.SUPABASE_TABLE)
    .insert({ url, status: 'pending' })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  logger.info({ id: data.id, url }, 'submitted for transcription');

  if (config.TASK_QUEUE_PATH) {
    enqueueTask(data.id).catch((err) =>
      logger.error({ err: err.message, videoId: data.id }, 'enqueue failed'),
    );
  } else {
    localQueue.add(() => runPipeline(data.id));
  }

  res.status(201).json(data);
});

module.exports = router;
