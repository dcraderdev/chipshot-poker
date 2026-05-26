// Per-game first-visit tutorial overlay (3-step carousel).
// Usage: import { showTutorialOnce } from '../lib/tutorial.js'; showTutorialOnce('holdem', steps);
// steps = [{title, body}, ...]

export function showTutorialOnce(gameId, steps) {
  if (typeof window === 'undefined') return;
  const key = 'chipshot.tutorial.' + gameId + '.v1';
  try {
    if (localStorage.getItem(key) === '1') return;
  } catch (_) { return; }
  showTutorial(gameId, steps, () => {
    try { localStorage.setItem(key, '1'); } catch (_) {}
  });
}

export function showTutorial(gameId, steps, onClose) {
  if (!Array.isArray(steps) || !steps.length) return;
  let i = 0;
  const root = document.createElement('div');
  root.className = 'cs-overlay';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Tutorial');
  root.innerHTML = `
    <div class="cs-modal">
      <div class="flex items-center justify-between">
        <p class="eyebrow" id="cs-tut-progress">Step 1 / ${steps.length}</p>
        <button class="cs-modal__close" id="cs-tut-close" aria-label="Close tutorial">×</button>
      </div>
      <h2 class="display text-2xl mt-2 text-parchment" id="cs-tut-title"></h2>
      <p class="mt-3 text-sm text-parchment-soft" id="cs-tut-body"></p>
      <div class="mt-5 flex items-center justify-between gap-3">
        <button class="cs-btn" id="cs-tut-prev" type="button">Back</button>
        <div class="flex gap-1" id="cs-tut-dots"></div>
        <button class="cs-btn cs-btn--primary" id="cs-tut-next" type="button">Next →</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const title = root.querySelector('#cs-tut-title');
  const body = root.querySelector('#cs-tut-body');
  const prog = root.querySelector('#cs-tut-progress');
  const prev = root.querySelector('#cs-tut-prev');
  const next = root.querySelector('#cs-tut-next');
  const close = root.querySelector('#cs-tut-close');
  const dots = root.querySelector('#cs-tut-dots');

  function paint() {
    const s = steps[i];
    title.textContent = s.title;
    body.textContent = s.body;
    prog.textContent = `Step ${i + 1} / ${steps.length}`;
    prev.disabled = i === 0;
    next.textContent = i === steps.length - 1 ? 'Got it' : 'Next →';
    dots.innerHTML = steps.map((_, idx) =>
      `<span style="width:8px;height:8px;border-radius:50%;background:${idx === i ? 'var(--color-gold-bright)' : 'rgba(212,175,55,0.3)'};"></span>`
    ).join('');
  }
  function done() {
    root.remove();
    if (typeof onClose === 'function') onClose();
  }
  prev.addEventListener('click', () => { if (i > 0) { i--; paint(); } });
  next.addEventListener('click', () => { if (i < steps.length - 1) { i++; paint(); } else done(); });
  close.addEventListener('click', done);
  root.addEventListener('click', (e) => { if (e.target === root) done(); });
  paint();
}
