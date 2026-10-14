import nodemailer from 'nodemailer';

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
    })
  : null;

const fromEmail = process.env.EMAIL_FROM || 'Music Hub <noreply@musichub.de>';

export async function sendMagicLinkEmail(email: string, token: string, next: string | null) {
  const url = `${process.env.APP_URL}/auth/verify?token=${token}${next ? `&next=${encodeURIComponent(next)}` : ''}`;

  if (!transport) {
    console.log(`[DEV] Magic link for ${email}: ${url}`);
    return;
  }

  await transport.sendMail({
    from: fromEmail,
    to: email,
    subject: 'Dein Login-Link für Music Hub',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 460px; margin: 0 auto; padding: 2.5rem 2rem; color: #f4f0ec; background: #0a0910;">
        <h1 style="font-size: 1.6rem; margin: 0 0 1rem; background: linear-gradient(135deg, #f43f5e, #fb923c); -webkit-background-clip: text; background-clip: text; color: transparent; display: inline-block;">Music Hub</h1>
        <p style="color: #9b96a8; line-height: 1.55; margin: 0 0 1.5rem;">Klick auf den Button um dich einzuloggen:</p>
        <a href="${url}" style="
          display: inline-block;
          padding: 0.8rem 1.6rem;
          background: linear-gradient(135deg, #f43f5e, #fb923c);
          color: #fff;
          border-radius: 10px;
          text-decoration: none;
          font-weight: 600;
          margin: 0 0 1.5rem;
        ">Einloggen</a>
        <p style="color: #5e596b; font-size: 0.85rem; margin: 0 0 0.5rem;">Der Link läuft in 15 Minuten ab.</p>
        <p style="color: #5e596b; font-size: 0.85rem; margin: 0;">Wenn du das nicht angefordert hast, ignorier diese Mail einfach.</p>
      </div>
    `,
  });
}

export async function sendRegistrationEmail(email: string, token: string) {
  const url = `${process.env.APP_URL}/auth/verify?token=${token}&register=1`;

  if (!transport) {
    console.log(`[DEV] Registration link for ${email}: ${url}`);
    return;
  }

  await transport.sendMail({
    from: fromEmail,
    to: email,
    subject: 'Bestätige deine E-Mail-Adresse für Music Hub',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 460px; margin: 0 auto; padding: 2.5rem 2rem; color: #f4f0ec; background: #0a0910;">
        <h1 style="font-size: 1.6rem; margin: 0 0 1rem; background: linear-gradient(135deg, #f43f5e, #fb923c); -webkit-background-clip: text; background-clip: text; color: transparent; display: inline-block;">Music Hub</h1>
        <p style="color: #9b96a8; line-height: 1.55; margin: 0 0 1.5rem;">Klick auf den Button und bestätige mit deinem Passwort, um die Registrierung abzuschließen:</p>
        <a href="${url}" style="
          display: inline-block;
          padding: 0.8rem 1.6rem;
          background: linear-gradient(135deg, #f43f5e, #fb923c);
          color: #fff;
          border-radius: 10px;
          text-decoration: none;
          font-weight: 600;
          margin: 0 0 1.5rem;
        ">Registrierung abschließen</a>
        <p style="color: #5e596b; font-size: 0.85rem; margin: 0 0 0.5rem;">Der Link läuft in 24 Stunden ab.</p>
        <p style="color: #5e596b; font-size: 0.85rem; margin: 0;">Wenn du dich nicht registriert hast, ignorier diese Mail einfach.</p>
      </div>
    `,
  });
}

export async function sendListenAlertEmail(
  to: string,
  listenerName: string | null,
  trackName: string,
  projectName: string,
  trackUrl: string,
) {
  const who = listenerName ?? 'Jemand';

  if (!transport) {
    console.log(`[DEV] Listen alert: ${who} hat "${trackName}" gehört — ${to}`);
    return;
  }

  await transport.sendMail({
    from: fromEmail,
    to,
    subject: `${who} hat "${trackName}" gehört`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 460px; margin: 0 auto; padding: 2.5rem 2rem; color: #f4f0ec; background: #0a0910;">
        <h1 style="font-size: 1.6rem; margin: 0 0 1rem; background: linear-gradient(135deg, #f43f5e, #fb923c); -webkit-background-clip: text; background-clip: text; color: transparent; display: inline-block;">Music Hub</h1>
        <p style="color: #9b96a8; line-height: 1.55; margin: 0 0 0.5rem;">
          <strong style="color: #f4f0ec;">${escapeHtml(who)}</strong> hat deinen Track gehört:
        </p>
        <p style="color: #f4f0ec; font-size: 1.1rem; font-weight: 600; margin: 0 0 0.25rem;">${escapeHtml(trackName)}</p>
        <p style="color: #5e596b; font-size: 0.85rem; margin: 0 0 1.5rem;">${escapeHtml(projectName)}</p>
        <a href="${trackUrl}" style="
          display: inline-block;
          padding: 0.8rem 1.6rem;
          background: linear-gradient(135deg, #f43f5e, #fb923c);
          color: #fff;
          border-radius: 10px;
          text-decoration: none;
          font-weight: 600;
        ">Analytics ansehen</a>
      </div>
    `,
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
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

  if (!transport) {
    console.log(`[DEV] Invite ${email} to project "${projectName}" by ${inviterName}: ${url}`);
    return;
  }

  await transport.sendMail({
    from: fromEmail,
    to: email,
    subject: `${inviterName} hat dich zu "${projectName}" eingeladen`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 460px; margin: 0 auto; padding: 2.5rem 2rem; color: #f4f0ec; background: #0a0910;">
        <h1 style="font-size: 1.6rem; margin: 0 0 1rem; background: linear-gradient(135deg, #f43f5e, #fb923c); -webkit-background-clip: text; background-clip: text; color: transparent; display: inline-block;">Music Hub</h1>
        <p style="color: #9b96a8; line-height: 1.55; margin: 0 0 1.5rem;"><strong style="color: #f4f0ec;">${escapeHtml(inviterName)}</strong> hat dich eingeladen, am Projekt <strong style="color: #f4f0ec;">"${escapeHtml(projectName)}"</strong> mitzuarbeiten.</p>
        <a href="${url}" style="
          display: inline-block;
          padding: 0.8rem 1.6rem;
          background: linear-gradient(135deg, #f43f5e, #fb923c);
          color: #fff;
          border-radius: 10px;
          text-decoration: none;
          font-weight: 600;
          margin: 0 0 1.5rem;
        ">Projekt öffnen</a>
        ${loginToken ? '<p style="color: #5e596b; font-size: 0.85rem; margin: 0;">Der Button meldet dich direkt an und gilt 7 Tage.</p>' : ''}
      </div>
    `,
  });
}

export async function sendOpenReportEmail(to: string[], trackName: string, url: string, reason: string, contact: string | null) {
  if (!transport) {
    console.log(`[DEV] Report about open track "${trackName}" (${url}) to ${to.join(', ')}: ${reason}`);
    return;
  }

  await transport.sendMail({
    from: fromEmail,
    to,
    replyTo: contact ?? undefined,
    subject: `Meldung zu "${trackName}"`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 460px; margin: 0 auto; padding: 2.5rem 2rem; color: #f4f0ec; background: #0a0910;">
        <h1 style="font-size: 1.6rem; margin: 0 0 1rem; background: linear-gradient(135deg, #f43f5e, #fb923c); -webkit-background-clip: text; background-clip: text; color: transparent; display: inline-block;">Music Hub</h1>
        <p style="color: #9b96a8; line-height: 1.55; margin: 0 0 0.5rem;">Jemand hat den offenen Track <strong style="color: #f4f0ec;">"${escapeHtml(trackName)}"</strong> gemeldet${contact ? ` (${escapeHtml(contact)})` : ''}:</p>
        <p style="color: #f4f0ec; line-height: 1.55; margin: 0 0 1.5rem; white-space: pre-wrap;">${escapeHtml(reason)}</p>
        <a href="${url}" style="
          display: inline-block;
          padding: 0.8rem 1.6rem;
          background: linear-gradient(135deg, #f43f5e, #fb923c);
          color: #fff;
          border-radius: 10px;
          text-decoration: none;
          font-weight: 600;
        ">Seite ansehen</a>
        <p style="color: #5e596b; font-size: 0.85rem; margin: 1.5rem 0 0;">Schließen lässt sich die Seite im Lagebild unter „Meldungen“.</p>
      </div>
    `,
  });
}

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

  if (!transport) {
    console.log(`[DEV] Versions mail to ${to}: ${subject}`);
    return;
  }

  const list = items
    .map(
      (item) => `
        <a href="${appUrl}/projects/${projectId}/tracks/${item.trackId}" style="display: block; padding: 0.7rem 0.9rem; margin: 0 0 0.5rem; background: #16151b; border-radius: 10px; color: #f4f0ec; text-decoration: none;">
          <strong>${escapeHtml(item.trackName)}</strong> <span style="color: #9b96a8;">V${item.versionNumber}</span>
        </a>`,
    )
    .join('');

  await transport.sendMail({
    from: fromEmail,
    to,
    subject,
    headers: {
      // One click in the mail client turns these mails off (RFC 8058)
      'List-Unsubscribe': `<${appUrl}/api/v1/notices/unsubscribe?t=${mailToken}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 460px; margin: 0 auto; padding: 2.5rem 2rem; color: #f4f0ec; background: #0a0910;">
        <h1 style="font-size: 1.6rem; margin: 0 0 1rem; background: linear-gradient(135deg, #f43f5e, #fb923c); -webkit-background-clip: text; background-clip: text; color: transparent; display: inline-block;">Music Hub</h1>
        <p style="color: #9b96a8; line-height: 1.55; margin: 0 0 1rem;"><strong style="color: #f4f0ec;">${escapeHtml(actorName)}</strong> hat in <strong style="color: #f4f0ec;">"${escapeHtml(projectName)}"</strong> ${items.length === 1 ? 'eine neue Version' : `${items.length} neue Versionen`} hochgeladen:</p>
        ${list}
        <a href="${appUrl}/projects/${projectId}" style="
          display: inline-block;
          padding: 0.8rem 1.6rem;
          background: linear-gradient(135deg, #f43f5e, #fb923c);
          color: #fff;
          border-radius: 10px;
          text-decoration: none;
          font-weight: 600;
          margin: 1rem 0 1.5rem;
        ">Projekt öffnen</a>
        <p style="color: #5e596b; font-size: 0.85rem; margin: 0;">Du bekommst diese Mail, weil du im Projekt mitarbeitest und keine Push-Benachrichtigungen aktiviert hast. Uploads kurz hintereinander kommen in einer Mail. <a href="${unsubscribeUrl}" style="color: #9b96a8;">Mails zu Versionen und Rückmeldungen abbestellen</a></p>
      </div>
    `,
  });
}

export async function sendContactRequestEmail(email: string, fromName: string, message: string) {
  const url = `${process.env.APP_URL}/for-you`;
  if (!transport) {
    console.log(`[DEV] Contact request from ${fromName} to ${email}: ${url}`);
    return;
  }

  await transport.sendMail({
    from: fromEmail,
    to: email,
    subject: `${fromName} hat dir eine Anfrage geschickt`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 460px; margin: 0 auto; padding: 2.5rem 2rem; color: #f4f0ec; background: #0a0910;">
        <h1 style="font-size: 1.6rem; margin: 0 0 1rem; background: linear-gradient(135deg, #f43f5e, #fb923c); -webkit-background-clip: text; background-clip: text; color: transparent; display: inline-block;">Music Hub</h1>
        <p style="color: #9b96a8; line-height: 1.55; margin: 0 0 0.5rem;"><strong style="color: #f4f0ec;">${escapeHtml(fromName)}</strong> hat dir über dein Profil geschrieben:</p>
        <p style="color: #f4f0ec; line-height: 1.55; margin: 0 0 1.5rem; white-space: pre-wrap;">${escapeHtml(message)}</p>
        <a href="${url}" style="
          display: inline-block;
          padding: 0.8rem 1.6rem;
          background: linear-gradient(135deg, #f43f5e, #fb923c);
          color: #fff;
          border-radius: 10px;
          text-decoration: none;
          font-weight: 600;
        ">Annehmen oder ablehnen</a>
        <p style="color: #5e596b; font-size: 0.85rem; margin: 1.5rem 0 0;">Antworten geht nur in Music Hub. Nimmst du an, arbeitet ihr in einem gemeinsamen Projekt weiter.</p>
      </div>
    `,
  });
}

export async function sendRequestReportEmail(to: string[], fromName: string, senderEmail: string, toName: string, message: string) {
  if (!transport) {
    console.log(`[DEV] ${toName} reported a request from ${fromName} <${senderEmail}> to ${to.join(', ')}`);
    return;
  }

  await transport.sendMail({
    from: fromEmail,
    to,
    subject: `Gemeldete Anfrage von ${fromName}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 460px; margin: 0 auto; padding: 2.5rem 2rem; color: #f4f0ec; background: #0a0910;">
        <h1 style="font-size: 1.6rem; margin: 0 0 1rem; background: linear-gradient(135deg, #f43f5e, #fb923c); -webkit-background-clip: text; background-clip: text; color: transparent; display: inline-block;">Music Hub</h1>
        <p style="color: #9b96a8; line-height: 1.55; margin: 0 0 0.5rem;"><strong style="color: #f4f0ec;">${escapeHtml(toName)}</strong> hat eine Anfrage von <strong style="color: #f4f0ec;">${escapeHtml(fromName)}</strong> (${escapeHtml(senderEmail)}) blockiert und gemeldet:</p>
        <p style="color: #f4f0ec; line-height: 1.55; margin: 0 0 1.5rem; white-space: pre-wrap;">${escapeHtml(message)}</p>
        <p style="color: #5e596b; font-size: 0.85rem; margin: 0;">Sperren lässt sich das Konto in der Nutzerliste.</p>
      </div>
    `,
  });
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

  if (!transport) {
    console.log(`[DEV] Feedback mail to ${to}: ${subject}`);
    return;
  }

  const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const list = comments
    .map(
      (c) => `
        <p style="margin: 0 0 0.5rem; padding: 0.6rem 0.9rem; background: #16151b; border-radius: 10px; color: #f4f0ec; line-height: 1.5;">
          ${c.timestampSeconds !== null ? `<span style="color: #f5ad4a; font-family: monospace;">${time(c.timestampSeconds)}</span> ` : ''}${escapeHtml(c.body)}
        </p>`,
    )
    .join('');

  await transport.sendMail({
    from: fromEmail,
    to,
    subject,
    headers: {
      'List-Unsubscribe': `<${appUrl}/api/v1/notices/unsubscribe?t=${mailToken}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 460px; margin: 0 auto; padding: 2.5rem 2rem; color: #f4f0ec; background: #0a0910;">
        <h1 style="font-size: 1.6rem; margin: 0 0 1rem; background: linear-gradient(135deg, #f43f5e, #fb923c); -webkit-background-clip: text; background-clip: text; color: transparent; display: inline-block;">Music Hub</h1>
        <p style="color: #f4f0ec; font-weight: 600; margin: 0 0 0.5rem;">${escapeHtml(title)}</p>
        <p style="color: #9b96a8; margin: 0 0 1rem;">${escapeHtml(trackName)} V${versionNumber}</p>
        ${note ? `<p style="color: #f4f0ec; line-height: 1.55; margin: 0 0 1rem; white-space: pre-wrap;">„${escapeHtml(note)}“</p>` : ''}
        ${list}
        <a href="${appUrl}/projects/${projectId}/tracks/${trackId}" style="
          display: inline-block;
          padding: 0.8rem 1.6rem;
          background: #F97F4A;
          background-image: linear-gradient(45deg, #F56853, #F97F4A, #F99747);
          color: #17171A;
          border-radius: 10px;
          text-decoration: none;
          font-weight: 600;
          margin: 1rem 0 1.5rem;
        ">Zum Track</a>
        <p style="color: #5e596b; font-size: 0.85rem; margin: 0;">Du bekommst diese Mail, weil du die Version hochgeladen und keine Push-Benachrichtigungen aktiviert hast. <a href="${unsubscribeUrl}" style="color: #9b96a8;">Mails zu Versionen und Rückmeldungen abbestellen</a></p>
      </div>
    `,
  });
}
