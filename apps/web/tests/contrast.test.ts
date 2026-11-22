import { bandColor, GLOW } from '@music-hub/shared';
import { expect, test } from '@playwright/test';

// WCAG contrast of the colour pairs of the dark theme, read from the rendered root layout.
// Text needs 4.5:1, the focus ring 3:1.

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

type Pair = [foreground: string, background: string, minimum: number];

// Lists every failing pair, so one run shows all of them
function failures(colors: Record<string, string>, pairs: Pair[]): string[] {
  return pairs.flatMap(([fg, bg, minimum]) => {
    const [a, b] = [colors[fg], colors[bg]];
    if (!a?.match(/^#[0-9a-f]{6}$/i) || !b?.match(/^#[0-9a-f]{6}$/i)) return [`${fg} on ${bg}: not a hex colour`];
    const ratio = contrast(a, b);
    return ratio < minimum ? [`${fg} ${a} on ${bg} ${b}: ${ratio.toFixed(2)} < ${minimum}`] : [];
  });
}

test('the colours of the web keep their contrast', async ({ page }) => {
  await page.goto('/impressum');
  const colors: Record<string, string> = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const app = document.querySelector('.app');
    const names = [
      '--color-bg-base',
      '--color-bg-raised',
      '--color-bg-overlay',
      '--color-bg-subtle',
      '--color-text-primary',
      '--color-text-secondary',
      '--color-text-tertiary',
      '--color-on-accent',
      '--color-success',
      '--color-warning',
      '--color-error',
    ];
    const tokens = Object.fromEntries(names.map((name) => [name, root.getPropertyValue(name).trim()]));
    return { ...tokens, '--color-accent': app ? getComputedStyle(app).getPropertyValue('--color-accent').trim() : '' };
  });
  const pairs: Pair[] = [];
  // Page, cards and dialogs carry every kind of text and the focus ring
  for (const bg of ['--color-bg-base', '--color-bg-raised', '--color-bg-overlay']) {
    for (const fg of [
      '--color-text-primary',
      '--color-text-secondary',
      '--color-text-tertiary',
      '--color-success',
      '--color-warning',
      '--color-error',
      '--color-accent',
    ]) {
      pairs.push([fg, bg, 4.5]);
    }
    pairs.push(['--color-accent', bg, 3]);
  }
  // The fill of buttons and badges; tertiary text sits on it only when disabled, which WCAG exempts
  for (const fg of ['--color-text-primary', '--color-text-secondary']) pairs.push([fg, '--color-bg-subtle', 4.5]);
  // Filled counters in signal colours carry dark text
  for (const bg of ['--color-success', '--color-warning', '--color-error']) pairs.push(['--color-on-accent', bg, 4.5]);
  // Every position of the family band: dark text on gradient surfaces, glow as text on the page
  for (let i = 0; i <= 600; i++) {
    const glow = `glow ${1 + i / 100}`;
    colors[glow] = bandColor(1 + i / 100, GLOW);
    pairs.push(['--color-on-accent', glow, 4.5], [glow, '--color-bg-base', 4.5], [glow, '--color-bg-raised', 4.5]);
  }
  expect(failures(colors, pairs)).toEqual([]);
});
