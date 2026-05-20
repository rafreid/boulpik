// Boulpik app controller. Pulls together:
//   • mic → speech recognition → intent matching against the lottery registry
//   • lottery adapter → fetch + normalize + formatForTTS
//   • Palefo TTS → audio blob → <audio> playback

import { PalefoAPI }                        from './tts.js';
import { isSupported, listenOnce, stopListening, matchLottery } from './voice.js';
import { LOTTERIES, LOTTERY_BY_ID }         from './lotteries/registry.js';

/* ── DOM ─────────────────────────────────────────────────────────────── */
const $ = (sel) => document.querySelector(sel);
const stage         = $('#stage');
const micBtn        = $('#mic-btn');
const listenHint    = $('#listen-hint');
const chipRow       = $('#chip-row');
const workingLabel  = $('#working-label');
const workingSub    = $('#working-sub');
const resultGame    = $('#result-game');
const resultText    = $('#result-text');
const replayBtn     = $('#replay-btn');
const againBtn      = $('#again-btn');
const errorText     = $('#error-text');
const restartBtn    = $('#restart-btn');
const balanceEl     = $('#balance');
const statusMsg     = $('#status-msg');
const player        = $('#player');
const settingsBtn   = $('#settings-btn');
const settingsPop   = $('#settings-popover');
const speedControl  = $('#speed-control');
const voiceControl  = $('#voice-control');
const lotterySelect = $('#lottery-select');
const apiToggles    = $('#api-toggles');

/* ── State ───────────────────────────────────────────────────────────── */
const api = new PalefoAPI();
const ENABLED_LS_KEY = 'boulpik.enabledLotteries';

const state = {
  voices: [],                  // [{id, displayName, gender, …}]
  voiceId: null,               // currently selected voice UUID
  speedOffset: 0,              // -20..+20 (Palefo range)
  forcedLotteryId: null,       // null = decide from voice intent
  lastAudioUrl: null,          // object URL for replay
  lastResult: null,            // last NormalizedResult, for "Mande yon lòt" → replay
  audioUnlocked: false,        // true once we've played anything via a user gesture
  enabledLotteryIds: loadEnabledIds(),  // Set<string> of adapter ids the user has switched on
};

/* ── Enabled-API persistence ─────────────────────────────────────────── */
// localStorage holds an array of adapter ids the user has enabled. If the
// key is missing or corrupt we default to "everything on" — matches the
// behavior before this feature shipped, so first-load is unsurprising.
// We also reconcile against the live registry on load: ids that no longer
// have an adapter (e.g. one was removed) get dropped silently.
function loadEnabledIds() {
  try {
    const raw = localStorage.getItem(ENABLED_LS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        const valid = arr.filter((id) => LOTTERY_BY_ID[id]);
        if (valid.length) return new Set(valid);
      }
    }
  } catch { /* fall through */ }
  return new Set(LOTTERIES.map((l) => l.id));
}

function saveEnabledIds() {
  try {
    localStorage.setItem(ENABLED_LS_KEY, JSON.stringify([...state.enabledLotteryIds]));
  } catch { /* private mode / quota — silently ignore */ }
}

function getEnabledAdapters() {
  return LOTTERIES.filter((a) => state.enabledLotteryIds.has(a.id));
}

// 44-byte silent mono WAV used to "unlock" the <audio> element on first tap.
// Browsers gate autoplay behind a user gesture; we lose that gesture context
// across the awaits in runForAdapter, so we engage the element here while the
// click is still on the stack. Once engaged, subsequent .play() calls succeed
// without needing a fresh gesture.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

function unlockAudio() {
  if (state.audioUnlocked) return;
  // Don't disturb whatever src might already be primed by replay.
  const prev = player.src;
  player.src = SILENT_WAV;
  const p = player.play();
  if (p && typeof p.then === 'function') {
    p.then(() => {
      state.audioUnlocked = true;
      player.pause();
      if (prev) player.src = prev;
    }).catch(() => {
      // Browser refused even the silent file — fall back to manual replay.
      if (prev) player.src = prev;
    });
  } else {
    state.audioUnlocked = true;
  }
}

/* ── Pane transitions ────────────────────────────────────────────────── */
function setPane(name) {
  stage.dataset.state = name;
  for (const pane of stage.querySelectorAll('.stage-pane')) {
    pane.hidden = pane.dataset.pane !== name;
  }
}

function showError(msg) {
  errorText.textContent = msg || 'Pa janm rive — eseye ankò.';
  setPane('error');
}

function setStatus(msg) {
  statusMsg.textContent = msg || '';
}

/* ── Boot ────────────────────────────────────────────────────────────── */
async function boot() {
  populateLotteryChips();
  populateLotterySelect();
  populateApiToggles();
  wireSettings();
  wireMic();
  wireReplay();
  wireAgain();
  wireRestart();

  // Speech recognition not available → still usable via chips, but flag it.
  if (!isSupported) {
    listenHint.textContent = 'Navigatè a pa konprann lavwa — chwazi yon lotri anba.';
    micBtn.disabled = true;
    micBtn.style.opacity = '0.5';
  }

  setPane('listen');

  // These two are best-effort: the app still functions if Palefo is briefly
  // down. The balance check uses the same proxy so an error here also
  // indicates the proxy itself isn't reachable.
  try {
    const [balance, voices] = await Promise.all([
      api.checkBalance().catch(() => ({ balance: null })),
      api.getVoices().catch(() => []),
    ]);
    if (balance.balance != null) balanceEl.textContent = `${balance.balance.toLocaleString()} jeton`;
    state.voices = voices;
    if (voices.length) state.voiceId = voices[0].id;
    syncVoiceButtons();
  } catch (e) {
    console.warn('boot warmup failed', e);
  }
}

/* ── Lottery chips + select + API toggles ────────────────────────────── */
function populateLotteryChips() {
  chipRow.replaceChildren();
  for (const adapter of getEnabledAdapters()) {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.textContent = adapter.displayName;
    btn.addEventListener('click', () => {
      unlockAudio();   // chip taps bypass the mic, so they own the gesture too
      runForAdapter(adapter);
    });
    chipRow.appendChild(btn);
  }
}

function populateLotterySelect() {
  // Remember the user's prior choice so we can restore it (if still valid)
  // after a re-render triggered by toggling APIs.
  const previous = state.forcedLotteryId;
  lotterySelect.replaceChildren();
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = 'Tande sa w di';
  lotterySelect.appendChild(auto);
  for (const adapter of getEnabledAdapters()) {
    const opt = document.createElement('option');
    opt.value = adapter.id;
    opt.textContent = adapter.displayName;
    lotterySelect.appendChild(opt);
  }
  if (previous && state.enabledLotteryIds.has(previous)) {
    lotterySelect.value = previous;
  } else {
    state.forcedLotteryId = null;
  }
  // Listener is attached once; safe to re-attach because we rebuilt children
  // but the element itself is the same.
  if (!lotterySelect._wired) {
    lotterySelect.addEventListener('change', () => {
      state.forcedLotteryId = lotterySelect.value || null;
    });
    lotterySelect._wired = true;
  }
}

// One pill per registered adapter. Tapping toggles the adapter on/off.
// The last enabled pill is locked — disabling it would leave the listen
// pane with no chips and no recognizable spoken intents, which is
// indistinguishable from a broken app.
function populateApiToggles() {
  apiToggles.replaceChildren();
  for (const adapter of LOTTERIES) {
    const btn = document.createElement('button');
    btn.className = 'api-toggle';
    btn.dataset.lotteryId = adapter.id;
    btn.textContent = adapter.displayName;
    btn.setAttribute('role', 'switch');
    if (state.enabledLotteryIds.has(adapter.id)) btn.classList.add('is-active');
    btn.addEventListener('click', () => {
      const isOn = state.enabledLotteryIds.has(adapter.id);
      if (isOn && state.enabledLotteryIds.size === 1) {
        // Last one — blink the lock styling and ignore.
        btn.classList.add('is-locked');
        setTimeout(() => btn.classList.remove('is-locked'), 600);
        return;
      }
      if (isOn) {
        state.enabledLotteryIds.delete(adapter.id);
        btn.classList.remove('is-active');
      } else {
        state.enabledLotteryIds.add(adapter.id);
        btn.classList.add('is-active');
      }
      btn.setAttribute('aria-checked', String(!isOn));
      saveEnabledIds();
      // Refresh surfaces that depend on the enabled set.
      populateLotteryChips();
      populateLotterySelect();
    });
    btn.setAttribute('aria-checked', String(state.enabledLotteryIds.has(adapter.id)));
    apiToggles.appendChild(btn);
  }
}

/* ── Settings popover ────────────────────────────────────────────────── */
function wireSettings() {
  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !settingsPop.hidden;
    settingsPop.hidden = open;
    settingsBtn.classList.toggle('open', !open);
  });
  document.addEventListener('click', (e) => {
    if (settingsPop.hidden) return;
    if (settingsPop.contains(e.target) || settingsBtn.contains(e.target)) return;
    settingsPop.hidden = true;
    settingsBtn.classList.remove('open');
  });

  speedControl.addEventListener('click', (e) => {
    const btn = e.target.closest('.alt-method-btn');
    if (!btn) return;
    for (const b of speedControl.querySelectorAll('.alt-method-btn')) b.classList.remove('is-active');
    btn.classList.add('is-active');
    state.speedOffset = parseInt(btn.dataset.speed, 10) || 0;
  });

  voiceControl.addEventListener('click', (e) => {
    const btn = e.target.closest('.alt-method-btn');
    if (!btn) return;
    for (const b of voiceControl.querySelectorAll('.alt-method-btn')) b.classList.remove('is-active');
    btn.classList.add('is-active');
    const wantedGender = btn.dataset.voice;
    const picked = state.voices.find((v) => v.gender === wantedGender);
    if (picked) state.voiceId = picked.id;
  });
}

function syncVoiceButtons() {
  if (!state.voiceId || !state.voices.length) return;
  const current = state.voices.find((v) => v.id === state.voiceId);
  if (!current) return;
  for (const b of voiceControl.querySelectorAll('.alt-method-btn')) {
    b.classList.toggle('is-active', b.dataset.voice === current.gender);
  }
}

/* ── Mic / intent flow ───────────────────────────────────────────────── */
function wireMic() {
  micBtn.addEventListener('click', async () => {
    if (micBtn.classList.contains('listening')) {
      stopListening();
      return;
    }
    // Engage the audio element while the user gesture is still on the stack —
    // by the time runForAdapter() reaches player.play(), we'll be past several
    // awaits and the browser would otherwise block autoplay.
    unlockAudio();
    micBtn.classList.add('listening');
    listenHint.textContent = 'M ap koute…';
    setStatus('');

    try {
      const phrase = await listenOnce({
        onPartial: (interim) => setStatus(`« ${interim} »`),
      });
      setStatus(`« ${phrase} »`);
      micBtn.classList.remove('listening');
      listenHint.textContent = 'Tape pou mande rezilta lotri a';

      // Forced choice from settings wins over intent matching — useful when
      // the recognizer is having a bad day. Intent matching is scoped to
      // the adapters the user has switched on in the settings popover.
      const adapter = state.forcedLotteryId
        ? LOTTERY_BY_ID[state.forcedLotteryId]
        : matchLottery(phrase, getEnabledAdapters());

      if (!adapter) {
        showError(`Pa rekonèt lotri sa a: « ${phrase} ». Chwazi yon nan chip yo anba.`);
        return;
      }
      await runForAdapter(adapter);
    } catch (e) {
      micBtn.classList.remove('listening');
      listenHint.textContent = 'Tape pou mande rezilta lotri a';
      const msg = mapSpeechError(e);
      showError(msg);
    }
  });
}

function mapSpeechError(e) {
  const m = String(e?.message || e || '');
  if (m.includes('not-allowed') || m.includes('denied'))
    return 'Pèmèt mikwofòn nan pou navigatè a.';
  if (m.includes('no-speech') || m.includes('no_match'))
    return 'Pa tande anyen — eseye ankò.';
  if (m.includes('unsupported'))
    return 'Navigatè a pa sipòte rekonesans vwa.';
  return 'Pa rive konprann sa w di — eseye ankò.';
}

/* ── Run an adapter end-to-end ───────────────────────────────────────── */
async function runForAdapter(adapter) {
  setPane('working');
  workingLabel.textContent = `Mwen chèche rezilta ${adapter.displayName}…`;
  workingSub.hidden = true;

  let result;
  try {
    result = await adapter.fetchLatest();
  } catch (e) {
    console.error('fetchLatest failed', e);
    showError(`Pa rive jwenn rezilta ${adapter.displayName}. Eseye ankò pita.`);
    return;
  }

  const text = adapter.formatForTTS(result);
  state.lastResult = { adapter, result, text };

  // Show the text immediately, then synthesize in the background.
  resultGame.textContent = adapter.displayName;
  resultText.textContent = text;
  workingLabel.textContent = 'M ap prepare vwa…';
  workingSub.textContent = text;
  workingSub.hidden = false;

  if (!state.voiceId) {
    // No voice loaded → still show the result, but no audio.
    setPane('result');
    setStatus('Vwa pa disponib — tèks la sèlman.');
    return;
  }

  try {
    const { audioBlob, tokensRemaining } = await api.generateTTS({
      text,
      voiceConfigId: state.voiceId,
      speedOffset:   state.speedOffset,
      format:        'wav',
    });
    if (state.lastAudioUrl) URL.revokeObjectURL(state.lastAudioUrl);
    state.lastAudioUrl = URL.createObjectURL(audioBlob);
    player.src = state.lastAudioUrl;
    if (tokensRemaining) balanceEl.textContent = `${tokensRemaining.toLocaleString()} jeton`;
    setPane('result');
    setStatus('');
    // Auto-play. The element was unlocked during the original mic/chip click,
    // so this should succeed. If a browser still refuses (e.g. iOS Low-Power
    // Mode), the replay button stays available as a manual fallback.
    player.play().catch((err) => {
      console.warn('autoplay blocked', err);
      setStatus('Tape pou koute rezilta a.');
    });
  } catch (e) {
    console.error('TTS failed', e);
    // Don't hide the text — just announce the failure in the status bar.
    setPane('result');
    setStatus('Vwa pa rive jwenn — sèlman tèks la disponib.');
  }
}

/* ── Replay / again / restart ────────────────────────────────────────── */
function wireReplay() {
  replayBtn.addEventListener('click', () => {
    if (!player.src) return;
    if (player.paused) player.play();
    else               player.pause();
  });
  player.addEventListener('play',  () => replayBtn.classList.add('playing'));
  player.addEventListener('pause', () => replayBtn.classList.remove('playing'));
  player.addEventListener('ended', () => replayBtn.classList.remove('playing'));
}

function wireAgain() {
  againBtn.addEventListener('click', () => {
    player.pause();
    setStatus('');
    setPane('listen');
  });
}

function wireRestart() {
  restartBtn.addEventListener('click', () => {
    setStatus('');
    setPane('listen');
  });
}

/* ── Go ──────────────────────────────────────────────────────────────── */
boot().catch((e) => {
  console.error('boot failed', e);
  showError('Pa rive louvri aplikasyon an.');
});
