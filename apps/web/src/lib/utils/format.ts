export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  if (seconds < 60) return 'gerade eben';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `vor ${minutes} Min.`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;

  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? 'gestern' : `vor ${days} Tagen`;

  return new Date(dateStr).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

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
  const t = d.getTime();
  const diff = now - t;
  if (diff < MINUTE) return 'gerade eben';
  if (diff < HOUR) return `vor ${Math.floor(diff / MINUTE)} Min.`;
  if (diff < 6 * HOUR) return `vor ${Math.floor(diff / HOUR)} Std.`;
  const hm = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (t >= dayStart(now)) return `heute, ${hm}`;
  if (t >= dayStart(now, 1)) return `gestern, ${hm}`;
  if (t >= dayStart(now, 6)) return `${d.toLocaleDateString('de-DE', { weekday: 'short' })}, ${hm}`;
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
}

/** "heute", "gestern" or "3.10." */
export function formatDay(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (t >= dayStart(now)) return 'heute';
  if (t >= dayStart(now, 1)) return 'gestern';
  return new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' });
}

/** "Sa., 3. Okt." */
export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });

const decimal = (x: number, digits = 1) =>
  x.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** "−14,2" with a real minus sign */
export const formatLufs = (lufs: number) => decimal(lufs).replace('-', '−');

/** "0,0 dB", "−3,2 dB", "+1,0 dB" */
export function formatDb(db: number): string {
  if (Math.abs(db) < 0.05) return '0,0 dB';
  return `${db > 0 ? '+' : '−'}${decimal(Math.abs(db))} dB`;
}

/** "7,4 GB", below one GB with two decimals */
export function formatGb(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return `${decimal(gb, gb < 1 ? 2 : 1)} GB`;
}
