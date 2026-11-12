import { OtpPurpose } from '../schemas/otp-code.schema';

export interface EmailContent {
  subject: string;
  text: string; // plain-text version for mail apps that don't show HTML
  html: string;
}

const SUBJECTS: Record<OtpPurpose, string> = {
  verify_email: 'Your MedPrep AI verification code',
  reset_password: 'Your MedPrep AI password reset code',
  change_email: 'Confirm your new MedPrep AI email address',
  login: 'Your MedPrep AI login code',
};

// The words before the code, so each email says what the code is for
const LEADS: Record<OtpPurpose, string> = {
  verify_email: 'Your MedPrep AI verification code is',
  reset_password: 'Your MedPrep AI password reset code is',
  change_email: 'Your code to confirm this new MedPrep AI email address is',
  login: 'Your MedPrep AI login code is',
};

/**
 * The OTP email. Plain inline styles because many mail apps ignore <style> blocks.
 * `code` is always 6 digits (we generate it), so it needs no HTML escaping.
 */
export function renderOtpEmail(code: string, purpose: OtpPurpose, validMinutes: number): EmailContent {
  const sentence = `${LEADS[purpose]} ${code}.`;
  const expiry = `It expires in ${validMinutes} minutes.`;
  const ignore = "If you didn't request this, ignore this email.";

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f7f8fc;font-family:Segoe UI,Arial,sans-serif;color:#0f1f3d;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="max-width:480px;background:#ffffff;border-radius:16px;padding:32px;">
          <tr><td style="font-weight:700;font-size:18px;color:#0c7c7c;padding-bottom:16px;">MedPrep AI</td></tr>
          <tr><td style="font-size:16px;line-height:1.5;padding-bottom:16px;">${LEADS[purpose]}</td></tr>
          <tr><td style="font-size:32px;font-weight:700;letter-spacing:8px;padding:12px 0 20px;">${code}</td></tr>
          <tr><td style="font-size:15px;line-height:1.5;padding-bottom:16px;">${expiry}</td></tr>
          <tr><td style="font-size:13px;line-height:1.5;color:#55627a;">${ignore}</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject: SUBJECTS[purpose], text: `${sentence} ${expiry} ${ignore}`, html };
}
