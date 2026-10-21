/**
 * Email templates for authentication and account lifecycle.
 * Normative reference: Plan 25 Section 10.5, 12.8.
 *
 * Artful editorial style, high-contrast, robust fallback across mail clients.
 */

export function renderOtpEmail(input: { email: string; code: string; expiresMinutes?: number }): {
  subject: string;
  html: string;
  text: string;
} {
  const expires = input.expiresMinutes ?? 10;
  const subject = `${input.code} is your RECSY verification code`;

  const text = `Your RECSY sign-in code: ${input.code}

This code will expire in ${expires} minutes.
If you didn't request this code, you can safely ignore this email.

RECSY — Uncompromising Mobile Intelligence`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 40px 20px; background-color: #fafafa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111;">
  <div style="max-width: 520px; margin: 0 auto; background: #ffffff; border: 1px solid #eaeaea; padding: 40px; border-radius: 0;">
    <div style="margin-bottom: 32px;">
      <h1 style="font-size: 20px; font-weight: 700; letter-spacing: -0.02em; margin: 0; text-transform: uppercase;">RECSY</h1>
    </div>
    <p style="font-size: 15px; line-height: 1.5; color: #333; margin: 0 0 24px 0;">Use the following single-use verification code to complete your sign in:</p>
    <div style="background-color: #f4f4f5; border: 1px solid #e4e4e7; padding: 20px; text-align: center; margin: 0 0 24px 0; border-radius: 0;">
      <span style="font-family: ui-monospace, Menlo, Monaco, Consolas, monospace; font-size: 32px; font-weight: 700; letter-spacing: 0.25em; color: #000;">${input.code}</span>
    </div>
    <p style="font-size: 13px; line-height: 1.5; color: #666; margin: 0 0 24px 0;">This code is valid for ${expires} minutes. If you did not request this email, no further action is required.</p>
    <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 32px 0 24px 0;">
    <p style="font-size: 11px; line-height: 1.4; color: #999; margin: 0;">RECSY Mobile Recommender Platform • All rights reserved</p>
  </div>
</body>
</html>`;

  return { subject, html, text };
}

export function renderDeletionRequestedEmail(input: {
  email: string;
  cancelUrl: string;
  executeAfterIso: string;
}): { subject: string; html: string; text: string } {
  const formattedDate = new Date(input.executeAfterIso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const subject = 'RECSY Account Deletion Scheduled (30-Day Cooling Period)';

  const text = `Your RECSY account deletion request has been received.

Your account and associated personalized data are scheduled for permanent deletion on ${formattedDate}.
During this 30-day cooling period, your account is temporarily deactivated.

If you changed your mind, you can cancel this deletion at any time before ${formattedDate} by visiting:
${input.cancelUrl}

RECSY — Uncompromising Mobile Intelligence`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 40px 20px; background-color: #fafafa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111;">
  <div style="max-width: 520px; margin: 0 auto; background: #ffffff; border: 1px solid #eaeaea; padding: 40px; border-radius: 0;">
    <div style="margin-bottom: 32px;">
      <h1 style="font-size: 20px; font-weight: 700; letter-spacing: -0.02em; margin: 0; text-transform: uppercase;">RECSY</h1>
    </div>
    <h2 style="font-size: 17px; font-weight: 600; margin: 0 0 16px 0;">Account Deletion Requested</h2>
    <p style="font-size: 14px; line-height: 1.5; color: #333; margin: 0 0 20px 0;">We have received a request to permanently delete your RECSY account (${input.email}).</p>
    <div style="border-left: 2px solid #000; padding-left: 16px; margin: 0 0 24px 0;">
      <p style="font-size: 13px; line-height: 1.5; color: #555; margin: 0;">
        Permanent deletion will take place on <strong>${formattedDate}</strong>. Any active paid subscriptions will terminate, and all session histories will be purged.
      </p>
    </div>
    <p style="font-size: 14px; line-height: 1.5; color: #333; margin: 0 0 28px 0;">If this was a mistake or you change your mind, you can cancel this request at any time prior to that date:</p>
    <div style="margin: 0 0 32px 0;">
      <a href="${input.cancelUrl}" style="display: inline-block; background-color: #000; color: #fff; text-decoration: none; padding: 12px 24px; font-size: 13px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; border-radius: 0;">Cancel Deletion</a>
    </div>
    <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 32px 0 24px 0;">
    <p style="font-size: 11px; line-height: 1.4; color: #999; margin: 0;">RECSY Privacy & Security • <a href="${input.cancelUrl}" style="color: #666;">Manage Account</a></p>
  </div>
</body>
</html>`;

  return { subject, html, text };
}

export function renderDeletionCancelledEmail(input: { email: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = 'RECSY Account Deletion Cancelled';

  const text = `Your account deletion request has been cancelled.

Your RECSY account (${input.email}) has been restored to active status and your data has been preserved.

RECSY — Uncompromising Mobile Intelligence`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 40px 20px; background-color: #fafafa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111;">
  <div style="max-width: 520px; margin: 0 auto; background: #ffffff; border: 1px solid #eaeaea; padding: 40px; border-radius: 0;">
    <div style="margin-bottom: 32px;">
      <h1 style="font-size: 20px; font-weight: 700; letter-spacing: -0.02em; margin: 0; text-transform: uppercase;">RECSY</h1>
    </div>
    <h2 style="font-size: 17px; font-weight: 600; margin: 0 0 16px 0;">Account Restored</h2>
    <p style="font-size: 14px; line-height: 1.5; color: #333; margin: 0 0 20px 0;">Your request to delete your account (${input.email}) has been successfully cancelled.</p>
    <p style="font-size: 13px; line-height: 1.5; color: #555; margin: 0 0 24px 0;">Your account is fully active and all your saved recommendations and data remain intact.</p>
    <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 32px 0 24px 0;">
    <p style="font-size: 11px; line-height: 1.4; color: #999; margin: 0;">RECSY Privacy & Security</p>
  </div>
</body>
</html>`;

  return { subject, html, text };
}
