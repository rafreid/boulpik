// Loto Haïti adapter — replace the upstream URL in server.py LOTTERY_SOURCES
// with the actual endpoint you have access to, then adjust the shape mapping
// below to match what that endpoint returns.

import { fetchLottery, joinNumbers, formatDateKreyol } from './_helpers.js';

export default {
  id: 'loto_haiti',
  displayName: 'Loto Ayiti',

  names: [
    'loto ayiti', 'lotri ayiti', 'loto haiti', 'lotri haiti',
    'lotri', 'loto', 'haiti lottery', 'haitian lottery',
    'loterie haiti', 'loterie haïti',
  ],

  async fetchLatest() {
    const raw = await fetchLottery('loto_haiti');
    // Defensive mapping — real upstreams change shape over time, and a
    // missing field shouldn't crash the announcer.
    return {
      game:     raw.game     ?? 'Loto Ayiti',
      drawDate: raw.draw_date ?? raw.drawDate ?? null,
      drawTime: raw.draw_time ?? raw.drawTime ?? null,
      numbers:  raw.numbers   ?? raw.winningNumbers ?? [],
      bonus:    raw.bonus     ?? raw.bonus_ball ?? null,
      extras:   {},
    };
  },

  formatForTTS(result) {
    const date    = formatDateKreyol(result.drawDate);
    const numbers = joinNumbers(result.numbers);
    const bonus   = result.bonus != null
      ? `. Nimewo siplemantè a se ${result.bonus}`
      : '';
    const datePart = date ? ` pou tiraj ${date}` : '';
    return `Men rezilta ${result.game}${datePart}: ${numbers}${bonus}.`;
  },
};
