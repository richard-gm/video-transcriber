'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { config, logger } = require('../config');

function transcribeAudio(audioPath, audioDurationSecs, onProgress, checkCancelled) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [
      path.join(__dirname, '..', '..', 'scripts', 'transcribe_worker.py'),
      config.WHISPER_MODEL,
    ], {
      env: { ...process.env, OMP_NUM_THREADS: String(config.WHISPER_THREADS) },
    });

    const MODEL_SPEED_FACTORS = {
      tiny: 0.05,
      base: 0.15,
      small: 0.4,
      medium: 1.2,
      large: 3,
    };
    let buf = '';
    let resolved = false;
    let killed = false;
    const startTime = Date.now();
    const speedFactor = MODEL_SPEED_FACTORS[config.WHISPER_MODEL] || 0.15;
    let estimateTotal = audioDurationSecs > 0 ? Math.max(audioDurationSecs * speedFactor, 30) : 300;

    const progressInterval = setInterval(async () => {
      if (resolved || killed) return;
      if (checkCancelled) {
        try {
          await checkCancelled();
        } catch {
          killed = true;
          clearInterval(progressInterval);
          proc.kill();
          reject(new Error('Cancelled by user'));
          return;
        }
      }
      const elapsed = (Date.now() - startTime) / 1000;
      if (elapsed > estimateTotal * 1.2) {
        estimateTotal = elapsed * 1.5;
      }
      const pct = Math.min(94, Math.round((elapsed / estimateTotal) * 100));
      const remaining = Math.max(0, Math.round(estimateTotal - elapsed));
      const eta = remaining > 60
        ? `${Math.floor(remaining / 60)}m ${remaining % 60}s`
        : `${remaining}s`;
      onProgress({ percentage: pct, message: `Transcribing (${pct}%, ETA ${eta})`, eta });
    }, 5000);

    proc.stdout.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.ready) continue;
          resolved = true;
          clearInterval(progressInterval);
          if (msg.error) reject(new Error(msg.error));
          else resolve(msg.text);
        } catch {
          // malformed JSON — ignore
        }
      }
    });

    proc.stderr.on('data', (d) => {
      logger.warn({ stderr: d.toString() }, 'whisper stderr');
    });

    proc.on('exit', (code) => {
      clearInterval(progressInterval);
      if (!resolved && !killed) reject(new Error(`Whisper process exited with code ${code}`));
    });

    proc.on('error', (err) => {
      clearInterval(progressInterval);
      if (!killed) reject(err);
    });

    proc.stdin.write(JSON.stringify({ id: 1, audio: audioPath }) + '\n');
    proc.stdin.end();
  });
}

module.exports = { transcribeAudio };
