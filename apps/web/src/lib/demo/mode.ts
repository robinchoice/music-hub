/** Name of the iframe in which the landing page embeds the real app with sample data. */
export const DEMO_FRAME = 'musichub-demo';

/**
 * True only inside that iframe on our own origin. API requests are then answered from
 * the sample data in the browser, nothing reaches the server.
 */
export const demoMode: boolean = (() => {
  if (typeof window === 'undefined' || window.name !== DEMO_FRAME || window.parent === window) return false;
  try {
    return window.parent.location.origin === window.location.origin;
  } catch {
    return false;
  }
})();
