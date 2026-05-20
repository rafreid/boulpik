// NY State Win 4 adapter — 4-digit pick, drawn twice daily
// (midday + evening). Shares upstream dataset hsys-3def with the
// ny_numbers adapter; they look at different fields in the same row.

import { fetchLottery, formatDateKreyol } from './_helpers.js';

export default {
  id: 'ny_win4',
  displayName: 'NY Win 4',

  names: [
    'win 4', 'win four', 'win4', 'ny win 4',
    'new york win 4', 'pick 4', 'pick four',
  ],

  async fetchLatest() {
    const raw = await fetchLottery('ny_win4');
    const row = Array.isArray(raw) ? raw[0] : raw;
    return {
      game:     'NY Win 4',
      drawDate: (row?.draw_date || '').slice(0, 10) || null,
      drawTime: null,
      numbers:  [row?.midday_win_4, row?.evening_win_4].filter(Boolean),
      bonus:    null,
      extras:   {
        midday:  row?.midday_win_4  ?? null,
        evening: row?.evening_win_4 ?? null,
      },
    };
  },

  formatForTTS(result) {
    const date = formatDateKreyol(result.drawDate);
    const datePart = date ? ` pou ${date}` : '';
    const parts = [];
    if (result.extras?.midday)  parts.push(`midi a se ${result.extras.midday}`);
    if (result.extras?.evening) parts.push(`aswè a se ${result.extras.evening}`);
    if (!parts.length) {
      return `Rezilta NY Win 4${datePart} poko soti.`;
    }
    return `Rezilta NY Win 4${datePart}: ${parts.join(', ')}.`;
  },
};
