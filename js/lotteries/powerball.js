// Powerball adapter — NY State open data
// (https://data.ny.gov/resource/d6yy-54nr.json).
//
// Shape note: NY ships ALL winning numbers — five white balls + the
// Powerball — packed into a single space-separated `winning_numbers`
// string. The Powerball itself is the last value. This differs from the
// Mega Millions endpoint (which carries the bonus in a separate
// `mega_ball` field), so we slice the array here to honor the registry's
// normalized `{ numbers, bonus }` contract.

import { fetchLottery, joinNumbers, formatDateKreyol } from './_helpers.js';

export default {
  id: 'powerball',
  displayName: 'Powerball',

  names: [
    'powerball', 'power ball', 'pawèboul', 'pawèbòl',
    'lotri pawèboul', 'us powerball', 'lotri powerball',
  ],

  async fetchLatest() {
    const raw = await fetchLottery('powerball');
    const row = Array.isArray(raw) ? raw[0] : raw;

    // "04 13 34 61 65 12" → ["04","13","34","61","65","12"]
    const allNums = (row?.winning_numbers || '').trim().split(/\s+/).filter(Boolean);
    const whiteBalls = allNums.slice(0, -1);
    const powerball  = allNums.length ? allNums[allNums.length - 1] : null;

    return {
      game:     'Powerball',
      drawDate: (row?.draw_date || '').slice(0, 10) || null,
      drawTime: null,
      numbers:  whiteBalls,
      bonus:    powerball,
      extras:   { multiplier: row?.multiplier ?? null },
    };
  },

  formatForTTS(result) {
    const date    = formatDateKreyol(result.drawDate);
    const numbers = joinNumbers(result.numbers);
    const datePart = date ? ` pou tiraj ${date}` : '';
    const pb = result.bonus != null ? `. Powerball la se ${result.bonus}` : '';
    // Multiplier (Power Play) is only meaningful for bettors who opted in;
    // mention it as a tail clause so the core result reads first.
    const mult = result.extras?.multiplier
      ? `. Miltiplikatè a se ${result.extras.multiplier}`
      : '';
    return `Men rezilta Powerball${datePart}: ${numbers}${pb}${mult}.`;
  },
};
