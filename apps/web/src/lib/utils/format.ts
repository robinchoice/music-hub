import { TRASH_DAYS } from '@music-hub/shared';
import { dateLocale, t } from '$lib/i18n/index.js';

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${decimal(bytes / 1024, 0)} KB`;
  return `${decimal(bytes / (1024 * 1024))} MB`;
}

/** Up to two initials, taken from words only: "Tom (Label)" gives "TL", not "T(" */
export const initials = (name: string) =>
  (name.match(/[\p{L}\p{N}]+/gu) ?? []).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return t().common.justNow;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t().common.minutesAgo(minutes);

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t().common.hoursAgo(hours);

  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? t().common.yesterday : t().common.daysAgo(days);

  return new Date(dateStr).toLocaleDateString(dateLocale(), {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / (24 * HOUR) + 1) / 7);
}

// Start of the local day `daysBack` days before `now`
function dayStart(now: number, daysBack = 0): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysBack);
  return d.getTime();
}

/** "vor 5 Min.", "heute, 14:05", "gestern, 09:12", "Mo., 18:20", "12. Sept." */
export function formatWhen(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const time = d.getTime();
  const diff = now - time;
  const text = t().common;
  if (diff < MINUTE) return text.justNow;
  if (diff < HOUR) return text.minutesAgo(Math.floor(diff / MINUTE));
  if (diff < 6 * HOUR) return text.hoursAgo(Math.floor(diff / HOUR));
  const language = dateLocale();
  const hm = d.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
  if (time >= dayStart(now)) return text.todayAt(hm);
  if (time >= dayStart(now, 1)) return text.yesterdayAt(hm);
  if (time >= dayStart(now, 6)) return `${d.toLocaleDateString(language, { weekday: 'short' })}, ${hm}`;
  return d.toLocaleDateString(language, { day: 'numeric', month: 'short' });
}

/** "heute", "gestern" or "3.10." */
export function formatDay(iso: string, now = Date.now()): string {
  const time = new Date(iso).getTime();
  if (time >= dayStart(now)) return t().common.today;
  if (time >= dayStart(now, 1)) return t().common.yesterday;
  return new Date(iso).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'numeric' });
}

/** "Sa., 3. Okt." */
export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' });

const decimal = (x: number, digits = 1) =>
  x.toLocaleString(dateLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** "−14,2" with a real minus sign */
export const formatLufs = (lufs: number) => decimal(lufs).replace('-', '−');

/** "−0,6 dBTP", "+0,1 dBTP": rounded up like a peak meter, so −0,96 never reads as −1,0 */
export function formatTruePeak(db: number): string {
  // Hundredths first, so float noise like 0.30000001 doesn't round up to 0,4; + 0 turns −0 into 0
  const up = Math.ceil(Math.round(db * 100) / 10) / 10 + 0;
  return `${up > 0 ? '+' : ''}${formatLufs(up)} dBTP`;
}

/** "0,0 dB", "−3,2 dB", "+1,0 dB" */
export function formatDb(db: number): string {
  if (Math.abs(db) < 0.05) return `${decimal(0)} dB`;
  return `${db > 0 ? '+' : '−'}${decimal(Math.abs(db))} dB`;
}

// Unit and decimals for an amount of storage
function gbUnit(bytes: number) {
  const gb = bytes / 1024 ** 3;
  if (gb < 0.1) {
    const mb = bytes / 1024 ** 2;
    return { unit: 'MB', size: 1024 ** 2, digits: mb > 0 && mb < 10 ? 1 : 0 };
  }
  return { unit: 'GB', size: 1024 ** 3, digits: gb < 1 ? 2 : 1 };
}

/** "7,4 GB", below one GB with two decimals, below 0,1 GB in MB: "0 MB", "5,3 MB", "87 MB" */
export function formatGb(bytes: number): string {
  const { unit, size, digits } = gbUnit(bytes);
  return `${decimal(bytes / size, digits)} ${unit}`;
}

/** Two parts rounded to the displayed total, using their own units if a nonempty part would read as zero */
export function formatGbSplit(total: number, part: number): [string, string] {
  const { unit, size, digits } = gbUnit(total);
  const steps = (bytes: number) => Math.round((bytes / size) * 10 ** digits);
  const first = steps(part);
  const second = steps(total) - first;
  if ((part > 0 && first === 0) || (total > part && second === 0)) {
    return [formatGb(part), formatGb(total - part)];
  }
  const text = (n: number) => n === 0 ? '0 MB' : `${decimal(n / 10 ** digits, digits)} ${unit}`;
  return [text(first), text(second)];
}

/** Whole days until something deleted at `deletedAt` leaves the trash, at least 1 */
export function trashDaysLeft(deletedAt: string, now = Date.now()): number {
  return Math.max(1, TRASH_DAYS - Math.floor((now - new Date(deletedAt).getTime()) / (24 * HOUR)));
}
