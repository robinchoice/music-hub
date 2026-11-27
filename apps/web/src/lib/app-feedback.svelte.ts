import { type AppFeedbackContext, withoutTokens } from '@music-hub/shared';
import { browser } from '$app/environment';
import { api, recentErrors } from '$lib/api/client.js';
import { locale } from '$lib/i18n/index.js';

type Kind = 'bug' | 'idea';

// Feedback on the app (README, „Feedback zur App“): bugs come from the floating button with a
// screenshot, ideas from the account menu. The context is taken when the panel opens, as the
// tester saw the page.
export const appFeedback = $state({
  kind: null as Kind | null,
  screenshot: null as string | null,
  context: null as AppFeedbackContext | null,
});

const TEST_MODE_KEY = 'test-mode';

// Shows the bug button. Music Hub is live, so it is off until someone switches it on in the
// footer. The choice stays on this device.
export const testMode = $state({ on: browser && localStorage.getItem(TEST_MODE_KEY) === 'true' });

export function setTestMode(on: boolean) {
  testMode.on = on;
  localStorage.setItem(TEST_MODE_KEY, JSON.stringify(on));
}

export function openFeedback(kind: Kind, screenshot: string | null = null) {
  appFeedback.kind = kind;
  appFeedback.screenshot = screenshot;
  appFeedback.context = feedbackContext();
}

export function closeFeedback() {
  appFeedback.kind = null;
  appFeedback.screenshot = null;
  appFeedback.context = null;
}

// What the tester sees right now, without anything marked data-feedback-ignore.
// JPEG keeps a full screen at around 200 KB.
export async function takeScreenshot() {
  const { domToJpeg } = await import('modern-screenshot');
  return domToJpeg(document.documentElement, {
    width: innerWidth,
    height: innerHeight,
    scale: Math.min(devicePixelRatio, 2),
    quality: 0.85,
    backgroundColor: getComputedStyle(document.body).backgroundColor,
    style: { transform: `translate(${-scrollX}px, ${-scrollY}px)` },
    filter: (node) => !(node instanceof Element && node.hasAttribute('data-feedback-ignore')),
  });
}

export type Rect = { x: number; y: number; width: number; height: number };

// Draws the frame into the image, so the mail shows it too. The rect is relative to the image, from 0 to 1.
export async function markScreenshot(dataUrl: string, rect: Rect) {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  ctx.strokeStyle = '#F2545B';
  ctx.lineWidth = Math.max(3, canvas.width / 200);
  ctx.strokeRect(rect.x * canvas.width, rect.y * canvas.height, rect.width * canvas.width, rect.height * canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

function feedbackContext(): AppFeedbackContext {
  return {
    platform: 'web',
    // Without the query and link tokens, the issue is public
    page: withoutTokens(location.pathname),
    device: navigator.userAgent.slice(0, 300),
    viewport: `${innerWidth}×${innerHeight} @${devicePixelRatio}x`,
    locale: locale(),
    errors: recentErrors.map(withoutTokens),
  };
}

export function sendFeedback(message: string) {
  return api.post('/app-feedback', {
    kind: appFeedback.kind,
    message,
    screenshot: appFeedback.screenshot?.split(',')[1],
    context: appFeedback.context,
  });
}
