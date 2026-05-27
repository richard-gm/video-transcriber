import * as state from './state.js';
import { buildCategoryNav, renderFiltered } from './categories.js';

export function prependResult(entry) {
  state.setAllRecords([entry, ...state.allRecords.filter(r => r.id !== entry.id)]);
  buildCategoryNav(state.allRecords);
  renderFiltered();
}

export async function loadHistory() {
  try {
    const res = await fetch('/transcriptions');
    const records = await res.json();
    if (!Array.isArray(records)) return;
    state.setAllRecords(records);
    buildCategoryNav(records);
    renderFiltered();
  } catch {}
}
