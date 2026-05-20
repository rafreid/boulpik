// NY State Numbers adapter — 3-digit pick, drawn twice daily
// (midday + evening). Shares upstream dataset hsys-3def with the
// ny_win4 adapter; they look at different fields in the same row.
//
// Evening fields are null until the evening draw happens (~10:30 PM ET),
// so the TTS formatter only announces draws that are present.

import { fetchLottery, formatDateKreyol } from './_helpers.js';

export default {
  id: 'ny_numbers',
  displayName: 'NY Numbers',

  names: [
    'numbers', 'ny numbers', 'new york numbers', 'pick 3',
    'pick three', 'lotri nyou yòk', 'lotri new york',
  ],

  async fetchLatest() {
    const raw = await fetchLottery('ny_numbers');
    const row = Array.isArray(raw) ? raw[0] : raw;
    return {
      game:     'NY Numbers',
      drawDate: (row?.draw_date || '').slice(0, 10) || null,
      drawTime: null,
      // Per the registry contract `numbers` is an array — we cram both
      // draws into one ordered pair (midday, evening) for callers that
      // only look at .numbers. The formatter below uses the named
      // fields from extras for clearer phrasing.
      numbers:  [row?.midday_daily, row?.evening_daily].filter(Boolean),
      bonus:    null,
      extras:   {
        midday:  row?.midday_daily  ?? null,
        evening: row?.evening_daily ?? null,
      },
    };
  },

  formatForTTS(result) {
    const date = formatDateKreyol(result.drawDate);
    const datePart = date ? ` pou ${date}` : '';
    const parts = [];
    if (result.extras?.midday)  parts.push(`midi a se ${result.extras.midday}`);
    if (result.extras?.evening) parts.push(`aswè a se ${result.extras.evening}`);
    // If both draws are null (shouldn't happen on a populated row but be safe),
    // announce that the result isn't out yet instead of saying nothing.
    if (!parts.length) {
      return `Rezilta NY Numbers${datePart} poko soti.`;
    }
    return `Rezilta NY Numbers${datePart}: ${parts.join(', ')}.`;
  },
};
