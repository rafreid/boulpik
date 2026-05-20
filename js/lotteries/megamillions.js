// Mega Millions adapter — illustrates a foreign-source shape (NY State data,
// space-separated winning_numbers + a separate mega_ball field).
//
// Upstream returns an array of rows; we take the first (most recent) and
// re-shape it into the registry's normalized form.

import { fetchLottery, joinNumbers, formatDateKreyol } from './_helpers.js';

export default {
  id: 'megamillions',
  displayName: 'Mega Millions',

  names: [
    'mega millions', 'megamillions', 'mega', 'megamillion',
    'lotri ameriken', 'amerikan lottery', 'us lottery',
  ],

  async fetchLatest() {
    const raw = await fetchLottery('megamillions');
    const row = Array.isArray(raw) ? raw[0] : raw;
    return {
      game:     'Mega Millions',
      // NY data uses ISO timestamps — keep just the date part.
      drawDate: (row?.draw_date || '').slice(0, 10) || null,
      drawTime: null,
      numbers:  (row?.winning_numbers || '').trim().split(/\s+/).filter(Boolean),
      bonus:    row?.mega_ball ?? null,
      extras:   { multiplier: row?.multiplier ?? null },
    };
  },

  formatForTTS(result) {
    // ─── LEARNING CONTRIBUTION ─────────────────────────────────────────
    // This is the only adapter where the TTS phrasing is left for you to
    // shape. The other two adapters use a simple "Men rezilta X pou Y: …"
    // template — but Mega Millions has more pieces (5 white balls + a
    // mega ball + an optional multiplier), and how you sequence those in
    // Kreyòl is a real authoring choice.
    //
    // Trade-offs to weigh:
    //   • Short and punchy ("Mega Millions: 12, 24, 33, 45, 67. Mega ball 7")
    //     — easier to follow on first listen, less natural Kreyòl prose.
    //   • Fully-narrated ("Pou tiraj 19 me 2026, senk nimewo gayan yo se …
    //     epi mega ball la se …") — more natural but longer; costs more
    //     Palefo tokens.
    //   • Include the multiplier ("Megaplier") only when present, or skip
    //     it (most listeners don't bet on it).
    //
    // Available fields:
    //   result.game         — "Mega Millions"
    //   result.drawDate     — "2026-05-19" (may be null)
    //   result.numbers      — array of 5 strings, e.g. ["12","24","33","45","67"]
    //   result.bonus        — mega ball, string, e.g. "7" (may be null)
    //   result.extras.multiplier — e.g. "3" (may be null)
    //
    // Helpers already imported:
    //   formatDateKreyol(iso)  → "19 me 2026"
    //   joinNumbers(arr)       → "12, 24, 33, 45, 67"
    //
    // TODO: replace the body of this function with your version. Keep it
    // under ~1,500 characters (Palefo's per-request limit).
    const date    = formatDateKreyol(result.drawDate);
    const numbers = joinNumbers(result.numbers);
    const mega    = result.bonus != null ? `. Mega ball la se ${result.bonus}` : '';
    return `Rezilta Mega Millions${date ? ` pou ${date}` : ''}: ${numbers}${mega}.`;
  },
};
