export function toast(msg, opts = {}) {
  if (typeof document === 'undefined') return;
  const t = document.createElement('div');
  t.className = 'cs-toast';
  if (opts.kind === 'win') t.style.borderColor = 'var(--color-win)';
  if (opts.kind === 'lose') t.style.borderColor = 'var(--color-loss)';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), opts.duration ?? 2800);
}
