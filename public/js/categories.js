import * as state from './state.js';
import { escAttr, cap } from './utils.js';
import { renderCard } from './render.js';

export function buildCategoryNav(records) {
  const counts = { all: records.length };
  for (const r of records) {
    const cat = r.category || 'uncategorised';
    counts[cat] = (counts[cat] || 0) + 1;
  }

  const order = ['all', ...Object.keys(counts).filter(k => k !== 'all').sort()];

  document.getElementById('cat-list').innerHTML = order.map(cat => `
    <li class="cat-item${state.activeCategory === cat ? ' active' : ''}"
        onclick="selectCategory('${escAttr(cat)}')">
      <span>${cat === 'all' ? 'All' : cap(cat)}</span>
      <span class="cat-count">${counts[cat]}</span>
    </li>`).join('');

  document.getElementById('mobile-cats').innerHTML = order.map(cat => `
    <button class="cat-pill${state.activeCategory === cat ? ' active' : ''}"
            onclick="selectCategory('${escAttr(cat)}')">
      ${cat === 'all' ? 'All' : cap(cat)} <span style="opacity:0.6;font-size:0.7rem">${counts[cat]}</span>
    </button>`).join('');

  const hasCats = order.length > 1;
  document.getElementById('sidebar').style.display = hasCats ? '' : 'none';
  document.getElementById('mobile-cats').style.display = hasCats ? 'flex' : 'none';
}

export function renderFiltered() {
  const filtered = state.activeCategory === 'all'
    ? state.allRecords
    : state.allRecords.filter(r => (r.category || 'uncategorised') === state.activeCategory);

  const container = document.getElementById('history');
  const header = document.getElementById('content-header');
  const empty = document.getElementById('empty-state');

  header.style.display = state.allRecords.length ? '' : 'none';
  document.getElementById('content-title').textContent =
    state.activeCategory === 'all' ? 'All videos' : cap(state.activeCategory);
  document.getElementById('content-count').textContent =
    filtered.length + ' video' + (filtered.length !== 1 ? 's' : '');

  if (!filtered.length) {
    container.innerHTML = '';
    empty.style.display = '';
  } else {
    empty.style.display = 'none';
    container.innerHTML = filtered.map(renderCard).join('');
  }
}

export function selectCategory(cat) {
  state.setActiveCategory(cat);
  renderFiltered();
  buildCategoryNav(state.allRecords);
}
