import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const fromEmail = process.env.EMAIL_FROM || 'Music Hub <noreply@musichub.de>';

export async function sendMagicLinkEmail(email: string, token: string) {
  const url = `${process.env.APP_URL}/auth/verify?token=${token}`;

  if (!resend) {
    console.log(`[DEV] Magic link for ${email}: ${url}`);
    return;
  }

  await resend.emails.send({
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

export async function sendListenAlertEmail(
  to: string,
  listenerName: string | null,
  trackName: string,
  projectName: string,
  trackUrl: string,
) {
  const who = listenerName ?? 'Jemand';

  if (!resend) {
    console.log(`[DEV] Listen alert: ${who} hat "${trackName}" gehört — ${to}`);
    return;
  }

  await resend.emails.send({
    from: fromEmail,
    to,
    subject: `${who} hat "${trackName}" gehört`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 460px; margin: 0 auto; padding: 2.5rem 2rem; color: #f4f0ec; background: #0a0910;">
        <h1 style="font-size: 1.6rem; margin: 0 0 1rem; background: linear-gradient(135deg, #f43f5e, #fb923c); -webkit-background-clip: text; background-clip: text; color: transparent; display: inline-block;">Music Hub</h1>
        <p style="color: #9b96a8; line-height: 1.55; margin: 0 0 0.5rem;">
          <strong style="color: #f4f0ec;">${who}</strong> hat deinen Track gehört:
        </p>
        <p style="color: #f4f0ec; font-size: 1.1rem; font-weight: 600; margin: 0 0 0.25rem;">${trackName}</p>
        <p style="color: #5e596b; font-size: 0.85rem; margin: 0 0 1.5rem;">${projectName}</p>
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

export async function sendInviteEmail(email: string, projectName: string, inviterName: string) {
  const url = `${process.env.APP_URL}`;

  if (!resend) {
    console.log(`[DEV] Invite ${email} to project "${projectName}" by ${inviterName}`);
    return;
  }

  await resend.emails.send({
    from: fromEmail,
    to: email,
    subject: `${inviterName} hat dich zu "${projectName}" eingeladen`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 460px; margin: 0 auto; padding: 2.5rem 2rem; color: #f4f0ec; background: #0a0910;">
        <h1 style="font-size: 1.6rem; margin: 0 0 1rem; background: linear-gradient(135deg, #f43f5e, #fb923c); -webkit-background-clip: text; background-clip: text; color: transparent; display: inline-block;">Music Hub</h1>
        <p style="color: #9b96a8; line-height: 1.55; margin: 0 0 1.5rem;"><strong style="color: #f4f0ec;">${inviterName}</strong> hat dich eingeladen, am Projekt <strong style="color: #f4f0ec;">"${projectName}"</strong> mitzuarbeiten.</p>
        <a href="${url}" style="
          display: inline-block;
          padding: 0.8rem 1.6rem;
          background: linear-gradient(135deg, #f43f5e, #fb923c);
          color: #fff;
          border-radius: 10px;
          text-decoration: none;
          font-weight: 600;
        ">Projekt öffnen</a>
      </div>
    `,
  });
}
