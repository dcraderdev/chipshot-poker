// Shared action-log helper.
// Renders a chronological stream of game actions. Limits to a visible window
// (default 8) for quick scanning; older entries can scroll into view.

const MAX_LINES = 30;

export function createActionLog(rootEl, { visible = 8 } = {}) {
  if (!rootEl) return null;
  rootEl.classList.add('action-log');
  rootEl.style.setProperty('--action-log-visible', String(visible));
  rootEl.setAttribute('aria-live', 'polite');
  return {
    el: rootEl,
    push(msg, kind = '') {
      const line = document.createElement('div');
      line.className = ['action-log__line', kind ? `action-log__line--${kind}` : '']
        .filter(Boolean).join(' ');
      line.textContent = msg;
      rootEl.prepend(line);
      while (rootEl.children.length > MAX_LINES) {
        rootEl.removeChild(rootEl.lastChild);
      }
    },
    clear() { rootEl.innerHTML = ''; },
  };
}
