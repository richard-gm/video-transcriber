'use strict';

const { Router } = require('express');
const supabase = require('../lib/supabase');
const { config, logger } = require('../config');

const router = Router();

router.post('/api/cancel/:id', async (req, res) => {
  const { id } = req.params;

  const { data: job, error: fetchError } = await supabase
    .from(config.SUPABASE_TABLE)
    .select('status')
    .eq('id', id)
    .single();

  if (fetchError) return res.status(404).json({ error: 'Job not found' });

  if (job.status === 'done' || job.status === 'cancelled') {
    return res.status(409).json({ error: `Job is already ${job.status}` });
  }

  await supabase
    .from(config.SUPABASE_TABLE)
    .update({
      status: 'cancelled',
      progress: { percentage: 0, stage: 'cancelled', message: 'Cancelled by user' },
    })
    .eq('id', id);

  logger.info({ id }, 'job cancelled');
  res.json({ ok: true });
});

module.exports = router;
