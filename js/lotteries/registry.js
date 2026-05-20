// Central lottery adapter registry.
//
// To ADD a lottery:
//   1. Create a new file in this directory exporting a default object that
//      satisfies the LotteryAdapter contract (see CONTRACT below).
//   2. Import it here.
//   3. Push it into the LOTTERIES array.
//   4. Add the matching `id → upstream URL` row in server.py LOTTERY_SOURCES.
//
// To REMOVE a lottery: delete the file, delete the import + array entry, and
// delete the row in server.py. No central dispatcher needs editing — every
// piece of the rest of the app looks at LOTTERIES generically.
//
// CONTRACT — every adapter must export an object with:
//   id:           string           // stable, matches server.py LOTTERY_SOURCES key
//   displayName:  string           // shown in UI chips + result card
//   names:        string[]         // spoken aliases for intent matching, lowercase
//                                  // include Kreyòl, French, English variants
//   fetchLatest:  () => Promise<NormalizedResult>
//   formatForTTS: (result) => string  // Kreyòl sentence to send to Palefo
//
// NormalizedResult = {
//   game:     string,         // human-readable name
//   drawDate: string | null,  // "YYYY-MM-DD"
//   drawTime: string | null,  // "HH:MM" 24h, optional
//   numbers:  number[]|string[],  // winning numbers in draw order
//   bonus:    number | string | null,  // bonus/star/mega ball, if any
//   extras:   Record<string, any>      // adapter-specific extras (jackpot, multiplier…)
// }
//
// All three demo adapters below illustrate different shapes so you can copy
// whichever is closest to your real source.

import demoAdapter        from './demo.js';
import lotoHaitiAdapter   from './loto_haiti.js';
import megamillionsAdapter from './megamillions.js';
import powerballAdapter   from './powerball.js';
import nyNumbersAdapter   from './ny_numbers.js';
import nyWin4Adapter      from './ny_win4.js';

export const LOTTERIES = [
  demoAdapter,
  lotoHaitiAdapter,
  megamillionsAdapter,
  powerballAdapter,
  nyNumbersAdapter,
  nyWin4Adapter,
];

// Quick lookup by id. Built once so the rest of the app can `O(1)` resolve.
export const LOTTERY_BY_ID = Object.fromEntries(LOTTERIES.map((l) => [l.id, l]));
