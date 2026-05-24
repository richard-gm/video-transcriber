'use strict';

const { Router } = require('express');
const supabase = require('../lib/supabase');
const { config, logger } = require('../config');

const router = Router();

router.get('/api/status/:id', async (req, res) => {
  const { data, error } = await supabase
    .from(config.SUPABASE_TABLE)
    .select('id, url, status, transcript, error, progress, created_at, processed_at')
    .eq('id', req.params.id)
    .single();

  if (error) {
    logger.error({ err: error, id: req.params.id }, 'status query failed');
    if (error.code === 'PGRST116') {
      return res.status(404).json({ error: 'Job not found' });
    }
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
});

module.exports = router;
