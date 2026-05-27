export let allRecords = [];
export let activeCategory = 'all';
export let pollInterval = null;

export function setAllRecords(records) { allRecords = records; }
export function setActiveCategory(cat) { activeCategory = cat; }
export function setPollInterval(id) { pollInterval = id; }
