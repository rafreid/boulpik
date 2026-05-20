// Voice recognition + intent matcher.
//
// The browser's SpeechRecognition gives us a raw transcript ("ki rezilta loto
// ayiti yo"). We then look at each registered lottery's `names` aliases and
// find the best match. No external NLU — substring + token-overlap scoring
// keeps it small, dependency-free, and easy to debug.

import { LOTTERIES } from './lotteries/registry.js';

/* ── Speech recognition ─────────────────────────────────────────────── */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const isSupported = !!SR;

/**
 * Start listening once, resolve with the recognized phrase (lowercased).
 * Rejects on no-speech, permission denial, or browser without SR support.
 *
 * onPartial(text) is called with interim hypotheses while the user is still
 * speaking — handy for showing "I heard: …" feedback in the status bar.
 */
export function listenOnce({ onPartial } = {}) {
  return new Promise((resolve, reject) => {
    if (!SR) {
      reject(new Error('speech_unsupported'));
      return;
    }

    const rec = new SR();
    // Kreyòl ("ht-HT") is not in most browsers' shipping locale lists; fr-FR
    // is the nearest common ancestor and recognizes most Kreyòl loanwords
    // well. The matcher works on substring + tokens so exact spelling
    // doesn't matter.
    rec.lang = 'fr-FR';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 3;

    let bestFinal = '';
    let settled = false;

    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          // Take the highest-confidence alternative.
          let best = r[0];
          for (let j = 1; j < r.length; j++) {
            if (r[j].confidence > best.confidence) best = r[j];
          }
          bestFinal += ' ' + best.transcript;
        } else {
          interim += r[0].transcript;
        }
      }
      if (onPartial && interim) onPartial(interim.trim().toLowerCase());
    };

    rec.onerror = (e) => {
      if (settled) return;
      settled = true;
      reject(new Error(`speech_${e.error || 'error'}`));
    };

    rec.onend = () => {
      if (settled) return;
      settled = true;
      const text = bestFinal.trim().toLowerCase();
      if (!text) reject(new Error('speech_no_match'));
      else      resolve(text);
    };

    try {
      rec.start();
    } catch (err) {
      settled = true;
      reject(err);
    }

    // Public stop handle attached to the promise — lets the UI cancel from
    // a second tap on the mic.
    listenOnce._lastRec = rec;
  });
}

/** Stop whichever recognition session is currently active, if any. */
export function stopListening() {
  if (listenOnce._lastRec) {
    try { listenOnce._lastRec.stop(); } catch {}
  }
}

/* ── Intent matching ────────────────────────────────────────────────── */

/**
 * Find the best lottery adapter for a recognized phrase. Returns the
 * adapter object or `null` if nothing scored above the threshold.
 *
 * Scoring per adapter = best score across all of its `names` aliases.
 * Per alias:
 *   - direct substring containment        → 1.0
 *   - else token-overlap (Jaccard)         → 0.0–0.9 scaled
 *
 * The threshold (0.5) is calibrated against the example aliases — feel free
 * to tune downward if your aliases are very short single-word names.
 */
export function matchLottery(phrase) {
  const text = (phrase || '').toLowerCase().trim();
  if (!text) return null;

  let best = null;
  let bestScore = 0;

  for (const adapter of LOTTERIES) {
    for (const alias of adapter.names) {
      const score = aliasScore(text, alias);
      if (score > bestScore) {
        bestScore = score;
        best = adapter;
      }
    }
  }
  return bestScore >= 0.5 ? best : null;
}

function aliasScore(text, alias) {
  const a = alias.toLowerCase();
  if (text.includes(a)) return 1.0;

  // Token overlap (Jaccard-style) — handles paraphrases like
  // "haitian national lottery" vs alias "haiti lottery".
  const ta = new Set(a.split(/\s+/));
  const tt = new Set(text.split(/\s+/));
  let inter = 0;
  for (const t of ta) if (tt.has(t)) inter++;
  const union = new Set([...ta, ...tt]).size;
  return union ? 0.9 * (inter / union) : 0;
}
