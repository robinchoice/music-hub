import nodemailer from 'nodemailer';
import { APP_BAND, bandColor, GLOW, type UpdateContent, loginTexts } from '@music-hub/shared';

const smtpPort = Number(process.env.SMTP_PORT || 587);

// Without SMTP_HOST magic links go to the log, so local dev needs no mail account.
// In production the log would hand out logins, so the boot aborts.
if (!process.env.SMTP_HOST && process.env.NODE_ENV === 'production') {
  throw new Error('SMTP_HOST is required in production, otherwise magic links would end up in the log');
}

const transport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      // Update mails go out inside a database transaction, a hanging server must not hold it for minutes
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    })
  : null;

const fromEmail = process.env.EMAIL_FROM || 'Music Hub <noreply@musichub.de>';

type Mail = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: { name: string; address: string };
  headers?: Record<string, string>;
};

// Without SMTP the mail goes to the log as devLog, in dev only
async function sendMail(mail: Mail, devLog: string) {
  if (!transport) {
    console.log(`[DEV] ${devLog}`);
    return;
  }
  await transport.sendMail({ from: fromEmail, ...mail });
}

// The shared template in the app's dark colours: the band gradient from APP_BAND
// with dark text on buttons, like the primary buttons in the app. Inline styles,
// mail clients ignore most CSS. A solid colour first, Outlook draws no gradients.
const [FROM, MID, TO] = [APP_BAND.from, (APP_BAND.from + APP_BAND.to) / 2, APP_BAND.to].map((p) => bandColor(p, GLOW));
const GRADIENT = `linear-gradient(45deg, ${FROM}, ${MID}, ${TO})`;
const TEXT = '#f4f0ec';
const MUTED = '#9b96a8';
const FAINT = '#5e596b';
const CARD = '#16151b';

const strong = (value: string) => `<strong style="color: ${TEXT};">${escapeHtml(value)}</strong>`;
const paragraph = (html: string, margin = '0 0 1.5rem') =>
  `<p style="color: ${MUTED}; line-height: 1.55; margin: ${margin};">${html}</p>`;
const quote = (text: string) =>
  `<p style="color: ${TEXT}; line-height: 1.55; margin: 0 0 1.5rem; white-space: pre-wrap;">${escapeHtml(text)}</p>`;
const small = (html: string, margin = '0') => `<p style="color: ${FAINT}; font-size: 0.85rem; margin: ${margin};">${html}</p>`;

function button(label: string, href: string, margin = '0 0 1.5rem') {
  return `<a href="${href}" style="display: inline-block; padding: 0.8rem 1.6rem; background: ${MID}; background-image: ${GRADIENT}; color: #17171a; border-radius: 10px; text-decoration: none; font-weight: 600; margin: ${margin};">${escapeHtml(label)}</a>`;
}

function layout(body: string) {
  return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 460px; margin: 0 auto; padding: 2.5rem 2rem; color: ${TEXT}; background: #0a0910;">
        <h1 style="font-size: 1.6rem; margin: 0 0 1rem; background: ${GRADIENT}; -webkit-background-clip: text; background-clip: text; color: transparent; display: inline-block;">Music Hub</h1>
        ${body}
      </div>
    `;
}

export async function sendMagicLinkEmail(email: string, token: string, next: string | null, updates = false, code: string, language?: string) {
  const url = `${process.env.APP_URL}/auth/verify?token=${token}${next ? `&next=${encodeURIComponent(next)}` : ''}`;
  const texts = loginTexts(language);
  await sendMail(
    {
      to: email,
      subject: `${code} – ${texts.mailSubject}`,
      html: layout(
        `${paragraph('Klick auf den Button um dich einzuloggen:')}${button('Einloggen', url)}${paragraph(`${texts.mailCode} ${strong(code)}`)}${optIn(updates)}${small('Der Link läuft in 15 Minuten ab.', '0 0 0.5rem')}${small('Wenn du das nicht angefordert hast, ignorier diese Mail einfach.')}`,
      ),
    },
    `Magic link for ${email}: ${url}`,
  );
}

export async function sendRegistrationEmail(email: string, token: string, updates = false) {
  const url = `${process.env.APP_URL}/auth/verify?token=${token}&register=1`;
  await sendMail(
    {
      to: email,
      subject: 'Bestätige deine E-Mail-Adresse für Music Hub',
      html: layout(
        `${paragraph('Klick auf den Button und bestätige mit deinem Passwort, um die Registrierung abzuschließen:')}${button('Registrierung abschließen', url)}${optIn(updates)}${small('Der Link läuft in 24 Stunden ab.', '0 0 0.5rem')}${small('Wenn du dich nicht registriert hast, ignorier diese Mail einfach.')}`,
      ),
    },
    `Registration link for ${email}: ${url}`,
  );
}

// With the ticked checkbox the login mail says so, opening the link confirms it (double opt-in)
const optIn = (updates: boolean) =>
  updates
    ? paragraph('Mit diesem Link schaltest du auch Updates zu neuen Funktionen per Mail ein. Abbestellen geht jederzeit in deinem Konto.')
    : '';

export async function sendListenAlertEmail(
  to: string,
  listenerName: string | null,
  trackName: string,
  projectName: string,
  trackUrl: string,
) {
  const who = listenerName ?? 'Jemand';
  await sendMail(
    {
      to,
      subject: `${who} hat "${trackName}" gehört`,
      html: layout(
        `${paragraph(`${strong(who)} hat deinen Track gehört:`, '0 0 0.5rem')}<p style="color: ${TEXT}; font-size: 1.1rem; font-weight: 600; margin: 0 0 0.25rem;">${escapeHtml(trackName)}</p>${small(escapeHtml(projectName), '0 0 1.5rem')}${button('Analytics ansehen', trackUrl, '0')}`,
      ),
    },
    `Listen alert: ${who} hat "${trackName}" gehört — ${to}`,
  );
}

export async function sendInviteEmail(
  email: string,
  projectId: string,
  projectName: string,
  inviterName: string,
  loginToken: string | null,
) {
  const projectPath = `/projects/${projectId}`;
  const url = loginToken
    ? `${process.env.APP_URL}/auth/verify?token=${loginToken}&next=${encodeURIComponent(projectPath)}`
    : `${process.env.APP_URL}${projectPath}`;
  await sendMail(
    {
      to: email,
      subject: `${inviterName} hat dich zu "${projectName}" eingeladen`,
      html: layout(
        `${paragraph(`${strong(inviterName)} hat dich eingeladen, am Projekt ${strong(`"${projectName}"`)} mitzuarbeiten.`)}${button('Projekt öffnen', url)}${loginToken ? small('Der Button meldet dich direkt an und gilt 7 Tage.') : ''}`,
      ),
    },
    `Invite ${email} to project "${projectName}" by ${inviterName}: ${url}`,
  );
}

export async function sendOpenReportEmail(to: string[], trackName: string, url: string, reason: string, contact: string | null) {
  await sendMail(
    {
      to,
      replyTo: contact ? { name: '', address: contact } : undefined,
      subject: `Meldung zu "${trackName}"`,
      html: layout(
        `${paragraph(`Jemand hat den offenen Track ${strong(`"${trackName}"`)} gemeldet${contact ? ` (${escapeHtml(contact)})` : ''}:`, '0 0 0.5rem')}${quote(reason)}${button('Seite ansehen', url, '0')}${small('Schließen lässt sich die Seite im Lagebild unter „Meldungen“.', '1.5rem 0 0')}`,
      ),
    },
    `Report about open track "${trackName}" (${url}) to ${to.join(', ')}: ${reason}`,
  );
}

const unsubscribeHeaders = (url: string) => ({
  // One click in the mail client turns these mails off (RFC 8058)
  'List-Unsubscribe': `<${url}>`,
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
});

export async function sendVersionsEmail(
  to: string,
  mailToken: string,
  batch: { projectId: string; projectName: string; actorName: string; items: { trackId: string; trackName: string; versionNumber: number }[] },
) {
  const appUrl = process.env.APP_URL;
  const { projectId, projectName, actorName, items } = batch;
  const subject =
    items.length === 1
      ? `${projectName}: ${items[0].trackName} V${items[0].versionNumber} von ${actorName}`
      : `${projectName}: ${items.length} neue Versionen von ${actorName}`;
  const unsubscribeUrl = `${appUrl}/abbestellen?t=${mailToken}`;

  const list = items
    .map(
      (item) => `
        <a href="${appUrl}/projects/${projectId}/tracks/${item.trackId}" style="display: block; padding: 0.7rem 0.9rem; margin: 0 0 0.5rem; background: ${CARD}; border-radius: 10px; color: ${TEXT}; text-decoration: none;">
          <strong>${escapeHtml(item.trackName)}</strong> <span style="color: ${MUTED};">V${item.versionNumber}</span>
        </a>`,
    )
    .join('');

  await sendMail(
    {
      to,
      subject,
      headers: unsubscribeHeaders(`${appUrl}/api/v1/notices/unsubscribe?t=${mailToken}`),
      html: layout(
        `${paragraph(`${strong(actorName)} hat in ${strong(`"${projectName}"`)} ${items.length === 1 ? 'eine neue Version' : `${items.length} neue Versionen`} hochgeladen:`, '0 0 1rem')}${list}${button('Projekt öffnen', `${appUrl}/projects/${projectId}`, '1rem 0 1.5rem')}${small(`Du bekommst diese Mail, weil du im Projekt mitarbeitest und keine Push-Benachrichtigungen aktiviert hast. Uploads kurz hintereinander kommen in einer Mail. <a href="${unsubscribeUrl}" style="color: ${MUTED};">Mails zu Versionen und Rückmeldungen abbestellen</a>`)}`,
      ),
    },
    `Versions mail to ${to}: ${subject}`,
  );
}

export async function sendContactRequestEmail(email: string, fromName: string, message: string) {
  const url = `${process.env.APP_URL}/for-you`;
  await sendMail(
    {
      to: email,
      subject: `${fromName} hat dir eine Anfrage geschickt`,
      html: layout(
        `${paragraph(`${strong(fromName)} hat dir über dein Profil geschrieben:`, '0 0 0.5rem')}${quote(message)}${button('Annehmen oder ablehnen', url, '0')}${small('Antworten geht nur in Music Hub. Nimmst du an, arbeitet ihr in einem gemeinsamen Projekt weiter.', '1.5rem 0 0')}`,
      ),
    },
    `Contact request from ${fromName} to ${email}: ${url}`,
  );
}

export async function sendRequestReportEmail(to: string[], fromName: string, senderEmail: string, toName: string, message: string) {
  await sendMail(
    {
      to,
      subject: `Gemeldete Anfrage von ${fromName}`,
      html: layout(
        `${paragraph(`${strong(toName)} hat eine Anfrage von ${strong(fromName)} (${escapeHtml(senderEmail)}) blockiert und gemeldet:`, '0 0 0.5rem')}${quote(message)}${small('Sperren lässt sich das Konto in der Nutzerliste.')}`,
      ),
    },
    `${toName} reported a request from ${fromName} <${senderEmail}> to ${to.join(', ')}`,
  );
}

// One finished listening pass, for an uploader without push. Shares the opt-out with the version mails.
export async function sendFeedbackEmail(
  to: string,
  mailToken: string,
  feedback: { title: string; projectId: string; trackId: string; trackName: string; versionNumber: number; note: string | null; comments: { body: string; timestampSeconds: number | null }[] },
) {
  const appUrl = process.env.APP_URL;
  const { title, projectId, trackId, trackName, versionNumber, note, comments } = feedback;
  const subject = `${title} – ${trackName}`;
  const unsubscribeUrl = `${appUrl}/abbestellen?t=${mailToken}`;

  const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const list = comments
    .map(
      (c) => `
        <p style="margin: 0 0 0.5rem; padding: 0.6rem 0.9rem; background: ${CARD}; border-radius: 10px; color: ${TEXT}; line-height: 1.5;">
          ${c.timestampSeconds !== null ? `<span style="color: ${MID}; font-family: monospace;">${time(c.timestampSeconds)}</span> ` : ''}${escapeHtml(c.body)}
        </p>`,
    )
    .join('');

  await sendMail(
    {
      to,
      subject,
      headers: unsubscribeHeaders(`${appUrl}/api/v1/notices/unsubscribe?t=${mailToken}`),
      html: layout(
        `<p style="color: ${TEXT}; font-weight: 600; margin: 0 0 0.5rem;">${escapeHtml(title)}</p>${paragraph(`${escapeHtml(trackName)} V${versionNumber}`, '0 0 1rem')}${note ? `<p style="color: ${TEXT}; line-height: 1.55; margin: 0 0 1rem; white-space: pre-wrap;">„${escapeHtml(note)}“</p>` : ''}${list}${button('Zum Track', `${appUrl}/projects/${projectId}/tracks/${trackId}`, '1rem 0 1.5rem')}${small(`Du bekommst diese Mail, weil du die Version hochgeladen und keine Push-Benachrichtigungen aktiviert hast. <a href="${unsubscribeUrl}" style="color: ${MUTED};">Mails zu Versionen und Rückmeldungen abbestellen</a>`)}`,
      ),
    },
    `Feedback mail to ${to}: ${subject}`,
  );
}

type UpdateMail = {
  id: string;
  content: UpdateContent;
  hasImage: boolean;
  // Date in the kicker, the send date or today for test mails and previews
  date: Date;
};

// An update about new features with the recipient's unsubscribe link. One-click
// unsubscribe (RFC 8058) lets Gmail and Apple Mail offer it next to the sender.
export function updateMail({ id, content, hasImage, date }: UpdateMail, mailToken: string) {
  const appUrl = process.env.APP_URL;
  const features = content.features.filter(Boolean);
  const day = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long' }).format(date);
  const unsubscribeUrl = `${appUrl}/abbestellen?liste=updates&t=${mailToken}`;
  const settings = `${appUrl}/account`;

  const list = features
    .map(
      (feature) =>
        `<p style="margin: 0 0 0.5rem; padding: 0.6rem 0.9rem; background: ${CARD}; border-radius: 10px; color: ${TEXT}; line-height: 1.5;"><span style="color: ${MID};">●</span>&nbsp; ${escapeHtml(feature)}</p>`,
    )
    .join('');
  const image = hasImage
    ? `<img src="${appUrl}/api/v1/updates/${id}/image" width="396" alt="" style="display: block; width: 100%; max-width: 396px; height: auto; border: 0; border-radius: 10px; margin: 0 0 1rem;">`
    : '';

  return {
    subject: `Neu in Music Hub: ${content.title}`,
    headers: unsubscribeHeaders(`${appUrl}/api/v1/updates/unsubscribe?t=${mailToken}`),
    html: layout(
      `${small(`Neu in Music Hub · ${escapeHtml(day)}`, '0 0 0.5rem')}<p style="color: ${TEXT}; font-size: 1.25rem; font-weight: 600; line-height: 1.3; margin: 0 0 1rem;">${escapeHtml(content.title)}</p>${image}${list}${button('Music Hub öffnen', `${appUrl}/dashboard`, '1rem 0 1.5rem')}${small(`Du bekommst diese Mail, weil du in Music Hub Updates per Mail eingeschaltet hast. <a href="${unsubscribeUrl}" style="color: ${MUTED};">Updates abbestellen</a> · <a href="${settings}" style="color: ${MUTED};">Konto</a>`)}`,
    ),
    text: [
      `Neu in Music Hub · ${day}`,
      '',
      content.title,
      '',
      ...features.map((feature) => `- ${feature}`),
      '',
      `Music Hub öffnen: ${appUrl}/dashboard`,
      '',
      '--',
      'Du bekommst diese Mail, weil du in Music Hub Updates per Mail eingeschaltet hast.',
      `Updates abbestellen: ${unsubscribeUrl}`,
    ].join('\n'),
  };
}

// Throws on SMTP errors, the caller logs them without the address
export function sendUpdateMail(to: string, mail: ReturnType<typeof updateMail>) {
  return sendMail({ to, ...mail }, `Update mail to ${to}: ${mail.subject}`);
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
