'use strict';

const { Router } = require('express');
const { createJobExecution } = require('../lib/queue');
const { logger } = require('../config');

const router = Router();

router.post('/api/task-handler', async (req, res) => {
  const { videoId } = req.body;
  if (!videoId) return res.status(400).json({ error: 'videoId required' });

  logger.info({ videoId }, 'task handler received');
  try {
    await createJobExecution(videoId);
    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error({ err: err.message, videoId }, 'failed to create job execution');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
