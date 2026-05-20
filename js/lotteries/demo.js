// DEMO adapter — points at /mock/demo.json. Useful as a smoke test:
// the app works end-to-end even without a real lottery upstream configured.
//
// Use this file as the template when adding a new adapter.

import { fetchLottery, joinNumbers, formatDateKreyol } from './_helpers.js';

export default {
  id: 'demo',
  displayName: 'Demo',

  // Spoken aliases used by the intent matcher. Include every reasonable way
  // a Kreyòl/French/English speaker might refer to this lottery. Lowercase.
  names: ['demo', 'demonstration', 'tès', 'test'],

  async fetchLatest() {
    const raw = await fetchLottery('demo');
    return {
      game:     raw.game,
      drawDate: raw.drawDate,
      drawTime: raw.drawTime,
      numbers:  raw.numbers,
      bonus:    raw.bonus ?? null,
      extras:   { jackpot: raw.jackpot ?? null },
    };
  },

  formatForTTS(result) {
    const date    = formatDateKreyol(result.drawDate);
    const numbers = joinNumbers(result.numbers);
    const bonus   = result.bonus != null ? `. Nimewo bonis la se ${result.bonus}` : '';
    const jackpot = result.extras?.jackpot
      ? `. Gwo lo a se ${result.extras.jackpot}`
      : '';
    return `Rezilta ${result.game} pou ${date}: nimewo yo se ${numbers}${bonus}${jackpot}.`;
  },
};
