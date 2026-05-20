// Shared helpers for lottery adapters. Keep small — anything used by two or
// more adapters lives here so individual adapter files stay focused on the
// data-shape differences between sources.

/**
 * Hit the proxied lottery URL for a given adapter id. The proxy in server.py
 * decides which upstream URL to call — the browser only knows the id.
 */
export async function fetchLottery(id) {
  const res = await fetch(`/api/lottery/${id}`, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`lottery_${id}_${res.status}: ${text.slice(0, 120)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Spell numbers in a way Palefo TTS reads naturally in Kreyòl.
 * Two-digit lottery numbers usually sound best as one number ("trann sèt")
 * rather than two digits, so we just stringify with comma+space and let
 * Palefo's Kreyòl number model handle the pronunciation.
 */
export function joinNumbers(nums) {
  return nums.join(', ');
}

/**
 * Format a YYYY-MM-DD date as Kreyòl prose. Falls back gracefully on bad input.
 * Months use Haitian Kreyòl names (per Akademi Kreyòl Ayisyen).
 */
const HT_MONTHS = [
  'janvye', 'fevriye', 'mas', 'avril', 'me', 'jen',
  'jiyè', 'out', 'septanm', 'oktòb', 'novanm', 'desanm',
];

export function formatDateKreyol(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const year  = m[1];
  const month = HT_MONTHS[parseInt(m[2], 10) - 1] || '';
  const day   = parseInt(m[3], 10);
  return `${day} ${month} ${year}`;
}
