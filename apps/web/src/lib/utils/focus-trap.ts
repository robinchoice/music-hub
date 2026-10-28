// Keeps Tab inside an open dialog and gives focus back when it closes. Dialogs can stack
// (a confirmation over a modal); only the top one takes Tab and Escape.
const stack: HTMLElement[] = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function trapFocus(node: HTMLElement, onEscape: () => void) {
  const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  stack.push(node);
  // An autofocused field keeps its focus, otherwise the dialog itself takes it
  if (!node.contains(document.activeElement)) node.focus();

  function onKeydown(e: KeyboardEvent) {
    if (stack.at(-1) !== node) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return e.preventDefault();
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === node || !node.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !node.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  // Capture, so the page's own shortcuts don't see the Escape first
  document.addEventListener('keydown', onKeydown, true);
  return {
    destroy() {
      document.removeEventListener('keydown', onKeydown, true);
      stack.splice(stack.indexOf(node), 1);
      if (before?.isConnected) before.focus();
    },
  };
}
