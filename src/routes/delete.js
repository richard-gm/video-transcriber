'use strict';

const { Router } = require('express');
const supabase = require('../lib/supabase');
const { config, logger } = require('../config');

const router = Router();

router.delete('/api/delete/:id', async (req, res) => {
  const { id } = req.params;

  const { data: existing, error: fetchError } = await supabase
    .from(config.SUPABASE_TABLE)
    .select('id')
    .eq('id', id)
    .single();

  if (fetchError || !existing) return res.status(404).json({ error: 'Record not found' });

  const { error: deleteError } = await supabase
    .from(config.SUPABASE_TABLE)
    .delete()
    .eq('id', id);

  if (deleteError) {
    logger.error({ id, err: deleteError.message }, 'delete failed');
    return res.status(500).json({ error: deleteError.message });
  }

  logger.info({ id }, 'record deleted');
  res.json({ ok: true });
});

module.exports = router;
