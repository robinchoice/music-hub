import nodemailer from 'nodemailer';

const smtpPort = Number(process.env.SMTP_PORT || 587);

const transport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

const fromEmail = process.env.EMAIL_FROM || 'Music Hub <noreply@musichub.de>';

export async function sendMagicLinkEmail(email: string, token: string) {
  const url = `${process.env.APP_URL}/auth/verify?token=${token}`;

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
) {
  const url = `${process.env.APP_URL}/projects/${projectId}`;

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
        <p style="color: #5e596b; font-size: 0.85rem; margin: 0;">Noch kein Konto? Dann melde dich per Magic Link mit dieser E-Mail-Adresse an.</p>
      </div>
    `,
  });
}
