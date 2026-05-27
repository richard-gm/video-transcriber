import { escHtml, escAttr } from './utils.js';

export function renderCollapsible(id, label, bodyHtml, bodyClass = '') {
  const uid = `cl-${id}-${label.replace(/\s+/g, '')}`;
  return `
    <div class="collapsible">
      <button class="collapsible-toggle" onclick="toggleCollapsible('${uid}')">
        <span class="arrow">▶</span> ${escHtml(label)}
      </button>
      <div class="collapsible-body ${bodyClass}" id="${uid}">${bodyHtml}</div>
    </div>`;
}

export function renderAiSection(entry) {
  if (!entry.summary && !entry.category && !entry.tone) return '';
  const id = entry.id;
  let html = '<div class="ai-section"><div class="ai-header">✨ AI Analysis</div>';
  if (entry.category || entry.tone) {
    html += '<div class="ai-badges">';
    if (entry.category) html += `<span class="ai-badge badge-category">${escHtml(entry.category)}</span>`;
    if (entry.tone) html += `<span class="ai-badge badge-tone">${escHtml(entry.tone)}</span>`;
    html += '</div>';
  }
  if (entry.tags?.length) html += `<div class="ai-tags">${entry.tags.map(t => `#${escHtml(t)}`).join(' ')}</div>`;
  if (entry.summary) html += `<div class="ai-summary">${escHtml(entry.summary)}</div>`;
  if (entry.key_takeaways?.length) {
    html += renderCollapsible(id, 'Key Takeaways', `<ul>${entry.key_takeaways.map(t => `<li>${escHtml(t)}</li>`).join('')}</ul>`);
  }
  if (entry.tips_and_tricks?.length) {
    html += renderCollapsible(id, 'Tips & Tricks', `<ul>${entry.tips_and_tricks.map(t => `<li>${escHtml(t)}</li>`).join('')}</ul>`, 'tips-body');
  }
  if (entry.chapters?.length) {
    const items = entry.chapters.map(c => `
      <div class="chapter-item">
        <div class="chapter-meta">${escHtml(c.start_time || '')}</div>
        <div class="chapter-title">${escHtml(c.title)}</div>
        ${c.summary ? `<div class="chapter-summary">${escHtml(c.summary)}</div>` : ''}
      </div>`).join('');
    html += renderCollapsible(id, 'Chapters', items);
  }
  if (entry.quotes?.length) {
    html += renderCollapsible(id, 'Quotes', entry.quotes.map(q => `<blockquote>${escHtml(q)}</blockquote>`).join(''));
  }
  if (entry.action_items?.length) {
    html += renderCollapsible(id, 'Action Items', `<ul>${entry.action_items.map(t => `<li>${escHtml(t)}</li>`).join('')}</ul>`, 'action-body');
  }
  html += '</div>';
  return html;
}

export function renderCard(entry) {
  const date = new Date(entry.created_at).toLocaleString();
  const error = entry.error ? `<div class="error">${escHtml(entry.error)}</div>` : '';
  const statusLabel = entry.status !== 'done'
    ? `<div class="status-badge ${entry.status}">${entry.status}</div>` : '';
  let transcriptHtml = '';
  let toggleBtnHtml = '';
  const copyBtnHtml = entry.transcript
    ? `<button class="copy-btn" id="copy-${escHtml(entry.id)}" onclick="copyTranscript('${escHtml(entry.id)}')">copy</button>`
    : '';
  if (entry.transcript) {
    const words = entry.transcript.split(/\s+/);
    if (words.length > 100) {
      const fullRaw = entry.transcript;
      const shortRaw = words.slice(0, 100).join(' ') + '…';
      transcriptHtml = `<div class="result-text" id="text-${escHtml(entry.id)}" data-full="${escAttr(fullRaw)}" data-short="${escAttr(shortRaw)}">${escHtml(shortRaw)}</div>`;
      toggleBtnHtml = `<button class="toggle-btn" id="toggle-${escHtml(entry.id)}" onclick="toggleText('${escHtml(entry.id)}')">show more</button>`;
    } else {
      transcriptHtml = `<div class="result-text">${escHtml(entry.transcript)}</div>`;
    }
  }
  return `
    <div class="result-card" id="card-${escHtml(entry.id)}" data-transcript="${escAttr(entry.transcript || '')}">
      <div class="result-url">${escHtml(entry.url)}</div>
      ${statusLabel}
      ${transcriptHtml}
      ${error}
      ${renderAiSection(entry)}
      <div class="result-date">${date} ${toggleBtnHtml}${copyBtnHtml}<button class="delete-btn" onclick="deleteEntry('${escHtml(entry.id)}')">delete</button></div>
    </div>`;
}
