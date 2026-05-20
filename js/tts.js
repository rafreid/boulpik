// Palefo TTS HTTP client. Mirrors piktrans/js/api.js shape so debugging across
// the two apps feels identical. The API key lives in server.py and is injected
// by the proxy — this file never sees it.

const BASE_URL = '/api/v1/engine';

const RETRYABLE_STATUSES = new Set([502, 503, 504, 521, 522, 523, 524]);
const RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [600, 1200];

async function _retry(label, doFetch) {
  let last;
  for (let i = 0; i < RETRY_ATTEMPTS; i++) {
    const res = await doFetch();
    if (res.ok || !RETRYABLE_STATUSES.has(res.status)) return res;
    last = res;
    if (i === RETRY_ATTEMPTS - 1) break;
    console.warn(`Palefo ${label} ${res.status} (attempt ${i + 1}/${RETRY_ATTEMPTS}) — retrying`);
    await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[i]));
  }
  return last;
}

export class PalefoAPI {
  async checkBalance() {
    const res = await fetch(`${BASE_URL}/balance`);
    if (!res.ok) throw new Error(`balance_${res.status}`);
    return res.json();
  }

  async getVoices() {
    const res = await fetch(`${BASE_URL}/voices`);
    if (!res.ok) throw new Error(`voices_${res.status}`);
    return res.json();
  }

  /**
   * Direct Kreyòl text → Kreyòl audio.
   * Returns { audioBlob, tokensRemaining }.
   */
  async generateTTS({ text, voiceConfigId, speedOffset = 0, format = 'wav' }) {
    const body = { text, voiceConfigId, format };
    if (speedOffset !== 0) body.speedOffset = speedOffset;

    const res = await _retry('tts', () => fetch(`${BASE_URL}/tts/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));

    if (res.ok) {
      const buffer = await res.arrayBuffer();
      const mime = res.headers.get('Content-Type') || `audio/${format}`;
      return {
        audioBlob: new Blob([buffer], { type: mime }),
        tokensRemaining: parseInt(res.headers.get('X-Tokens-Remaining') || '0', 10),
      };
    }

    const bodyText = await res.text().catch(() => '');
    let parsed = null;
    try { parsed = JSON.parse(bodyText); } catch {}
    const detail = parsed?.error || bodyText.slice(0, 200) || '(no body)';
    const err = new Error(`tts_${res.status}: ${detail}`);
    err.status = res.status;
    err.body = bodyText;
    throw err;
  }
}
