// First-visit onboarding modal. Asks for a name, confirms starting bankroll.

import { getUser, setUser, getBalance, resetBankroll, STARTING_BANKROLL, formatChips } from './bankroll.js';

const FLAG_KEY = 'chipshot.onboarded.v1';

export function mountOnboarding() {
  if (typeof window === 'undefined') return;
  try {
    if (localStorage.getItem(FLAG_KEY) === '1') return;
  } catch (_) { return; }
  // Make sure bankroll is initialized
  getBalance();
  // Render modal
  setTimeout(() => render(), 400);
}

function render() {
  if (document.getElementById('cs-onboard-root')) return;
  const root = document.createElement('div');
  root.id = 'cs-onboard-root';
  root.className = 'cs-overlay';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-labelledby', 'cs-onboard-title');
  root.setAttribute('aria-modal', 'true');
  root.innerHTML = `
    <div class="cs-modal">
      <p class="eyebrow mb-3">Welcome</p>
      <h2 id="cs-onboard-title" class="display text-3xl text-parchment">First time at the felt?</h2>
      <p class="mt-3 text-sm text-parchment-soft">
        Pick a handle and we'll stake you to <strong class="text-gold-bright">${formatChips(STARTING_BANKROLL)}</strong> in play chips.
        Everything lives in your browser — no signup, no server, nothing to lose.
      </p>
      <label class="block mt-5">
        <span class="stat-label">Your handle</span>
        <input
          id="cs-onboard-name"
          type="text"
          maxlength="20"
          class="block w-full mt-2 px-3 py-2 bg-felt-deep border border-gold-deep rounded text-parchment font-mono"
          style="background:#082619;border:1px solid #a3851f;color:#f3e8c8;padding:.6rem .8rem;border-radius:4px;width:100%;font-family:var(--font-mono);"
          placeholder="hero"
          autocomplete="off"
        />
      </label>
      <div class="mt-6 flex items-center justify-between gap-3">
        <button id="cs-onboard-skip" class="cs-btn" type="button">Skip</button>
        <button id="cs-onboard-go" class="cs-btn cs-btn--primary" type="button">Take my chips →</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const input = root.querySelector('#cs-onboard-name');
  const go = root.querySelector('#cs-onboard-go');
  const skip = root.querySelector('#cs-onboard-skip');

  const finish = (name) => {
    setUser({ name: name || 'hero' });
    resetBankroll();
    try { localStorage.setItem(FLAG_KEY, '1'); } catch (_) {}
    root.remove();
    // Route to lobby if user is on home page
    if (window.location.pathname === '/') {
      // Don't auto-redirect — let them click "Play". Just announce.
      flashToast('Bankroll loaded — head to /games when ready.');
    }
  };

  go.addEventListener('click', () => finish(input.value.trim()));
  skip.addEventListener('click', () => finish('hero'));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(input.value.trim()); });
  input.focus();
}

function flashToast(msg) {
  const t = document.createElement('div');
  t.className = 'cs-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}
