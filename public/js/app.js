import * as state from './state.js';
import { escHtml } from './utils.js';
import { buildCategoryNav, renderFiltered, selectCategory } from './categories.js';
import { loadHistory, prependResult } from './api.js';

async function processVideo() {
  const urlInput = document.getElementById('url');
  const btn = document.getElementById('submit-btn');
  const statusEl = document.getElementById('status');
  const url = urlInput.value.trim();
  if (!url) return;

  btn.disabled = true;
  statusEl.innerHTML = '<span class="spinner"></span> Queuing transcription…';
  statusEl.className = 'status';

  try {
    const res = await fetch('/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) {
      statusEl.textContent = '❌ ' + (data.error || 'Something went wrong');
      statusEl.className = 'status error';
      return;
    }

    const jobId = data.id;
    statusEl.setAttribute('data-job-id', jobId);
    statusEl.innerHTML = '<span class="spinner"></span> Job queued — waiting for result…';
    let pollRetries = 0;

    state.setPollInterval(setInterval(async () => {
      if (!statusEl.getAttribute('data-job-id')) return;
      const pollRes = await fetch('/api/status/' + jobId);
      const job = await pollRes.json();
      if (!pollRes.ok) {
        if (++pollRetries < 10) return;
        statusEl.textContent = '❌ ' + (job.error || 'Failed to check status');
        statusEl.className = 'status error';
        clearInterval(state.pollInterval);
        return;
      }
      pollRetries = 0;
      if (job.status === 'done') {
        statusEl.innerHTML = '✓ Done';
        urlInput.value = '';
        prependResult(job);
        loadHistory();
        clearInterval(state.pollInterval);
        return;
      }
      if (job.status === 'error') {
        statusEl.innerHTML = '❌ ' + (job.error || 'Processing failed');
        statusEl.className = 'status error';
        clearInterval(state.pollInterval);
        return;
      }
      if (job.status === 'cancelled') {
        statusEl.innerHTML = '✕ Cancelled';
        statusEl.className = 'status';
        clearInterval(state.pollInterval);
        return;
      }
      const p = job.progress || {};
      const pct = p.percentage || 0;
      const msg = p.message || job.status;
      const eta = p.eta ? ' &middot; ETA ' + p.eta : '';
      statusEl.innerHTML = `
        <span class="spinner"></span> ${escHtml(msg)}${eta}
        <div class="progress-bar">
          <div class="progress-bar-fill" style="width:${pct}%"></div>
        </div>
        <div class="progress-info">
          <span>${pct}%</span>
          <span>${escHtml(p.stage || 'processing')}</span>
        </div>
        <button class="cancel-btn" onclick="cancelJob()">Cancel</button>`;
    }, 3000));
  } catch (err) {
    statusEl.textContent = '❌ Network error: ' + err.message;
    statusEl.className = 'status error';
  } finally {
    btn.disabled = false;
  }
}

window.cancelJob = function () {
  const statusEl = document.getElementById('status');
  const jobId = statusEl.getAttribute('data-job-id');
  if (!jobId) return;
  statusEl.removeAttribute('data-job-id');
  if (state.pollInterval) { clearInterval(state.pollInterval); state.setPollInterval(null); }
  statusEl.innerHTML = '<span class="spinner"></span> Cancelling…';
  fetch('/api/cancel/' + jobId, { method: 'POST' }).catch(() => {});
};

window.confirmModal = function (msg) {
  return new Promise(resolve => {
    const overlay = document.getElementById('modal');
    document.getElementById('modal-message').textContent = msg;
    overlay.classList.add('active');
    const cleanup = () => overlay.classList.remove('active');
    document.getElementById('modal-cancel').onclick = () => { cleanup(); resolve(false); };
    document.getElementById('modal-confirm').onclick = () => { cleanup(); resolve(true); };
    overlay.onclick = e => { if (e.target === overlay) { cleanup(); resolve(false); } };
  });
};

window.deleteEntry = async function (id) {
  if (!await window.confirmModal('Delete this transcription?')) return;
  const res = await fetch('/api/delete/' + id, { method: 'DELETE' });
  if (!res.ok) return alert('Failed to delete');
  state.setAllRecords(state.allRecords.filter(r => r.id !== id));
  buildCategoryNav(state.allRecords);
  renderFiltered();
};

window.copyTranscript = function (id) {
  const card = document.getElementById('card-' + id);
  const btn = document.getElementById('copy-' + id);
  if (!card || !btn) return;
  const text = card.getAttribute('data-transcript');
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = 'copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'copy'; btn.classList.remove('copied'); }, 1500);
  }).catch(() => {
    btn.textContent = 'failed';
    setTimeout(() => { btn.textContent = 'copy'; }, 1500);
  });
};

window.toggleText = function (id) {
  const el = document.getElementById('text-' + id);
  const btn = document.getElementById('toggle-' + id);
  if (!el || !btn) return;
  const full = el.getAttribute('data-full');
  const short = el.getAttribute('data-short');
  if (el.__collapsed === undefined) el.__collapsed = true;
  if (el.__collapsed) { el.innerHTML = escHtml(full); btn.textContent = 'show less'; el.__collapsed = false; }
  else { el.innerHTML = escHtml(short); btn.textContent = 'show more'; el.__collapsed = true; }
};

window.toggleCollapsible = function (uid) {
  const body = document.getElementById(uid);
  if (!body) return;
  body.classList.toggle('open');
  body.previousElementSibling?.classList.toggle('open');
};

window.selectCategory = selectCategory;
window.processVideo = processVideo;

document.getElementById('url').addEventListener('keydown', e => { if (e.key === 'Enter') processVideo(); });

loadHistory();
