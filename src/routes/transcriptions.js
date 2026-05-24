'use strict';

const { Router } = require('express');
const supabase = require('../lib/supabase');
const { config, logger } = require('../config');

const router = Router();

router.get('/transcriptions', async (_req, res) => {
  const { data, error } = await supabase
    .from(config.SUPABASE_TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
