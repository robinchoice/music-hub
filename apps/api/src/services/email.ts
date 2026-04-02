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
    subject: 'Your Music Hub Login Link',
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 400px; margin: 0 auto; padding: 2rem;">
        <h1 style="font-size: 1.5rem; color: #f0f0f0;">Music Hub</h1>
        <p style="color: #a0a0a0;">Click the button below to log in:</p>
        <a href="${url}" style="
          display: inline-block;
          padding: 0.75rem 1.5rem;
          background: #6366f1;
          color: #fff;
          border-radius: 8px;
          text-decoration: none;
          font-weight: 500;
          margin: 1rem 0;
        ">Log in to Music Hub</a>
        <p style="color: #666; font-size: 0.85rem;">This link expires in 15 minutes.</p>
        <p style="color: #666; font-size: 0.85rem;">If you didn't request this, ignore this email.</p>
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
    subject: `You've been invited to "${projectName}" on Music Hub`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 400px; margin: 0 auto; padding: 2rem;">
        <h1 style="font-size: 1.5rem; color: #f0f0f0;">Music Hub</h1>
        <p style="color: #a0a0a0;">${inviterName} invited you to collaborate on <strong>"${projectName}"</strong>.</p>
        <a href="${url}" style="
          display: inline-block;
          padding: 0.75rem 1.5rem;
          background: #6366f1;
          color: #fff;
          border-radius: 8px;
          text-decoration: none;
          font-weight: 500;
          margin: 1rem 0;
        ">Open Music Hub</a>
      </div>
    `,
  });
}
