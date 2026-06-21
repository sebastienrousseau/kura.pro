/**
 * Transactional email helper. Single integration point so swapping
 * providers (Resend → SES → Postmark) is a one-file change.
 *
 * Current backend: Resend (https://resend.com). Picked because:
 *  - Free tier covers transactional volume for Phase 0 (100/day)
 *  - Cloudflare-friendly API (single HTTPS POST, no SDK required)
 *  - From: works with a sender domain you control via DNS, which
 *    matches the existing GitOps deploy pattern (no extra ops surface)
 *
 * Without `RESEND_API_KEY` configured, sendTransactionalEmail returns
 * `{ sent: false, dev: true }` and (in development) logs the payload
 * to console so a local `wrangler pages dev` walk-through doesn't need
 * a real Resend account.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "CloudCDN <no-reply@cloudcdn.pro>";

export async function sendTransactionalEmail(env, { to, subject, html, text }) {
  if (!to || !subject || (!html && !text)) {
    throw new Error("sendTransactionalEmail: to, subject and one of {html, text} are required");
  }

  if (!env.RESEND_API_KEY) {
    /* v8 ignore next 4 — dev-only log path; CI sets RESEND_API_KEY to
       a mocked value so the production path is exercised, and this
       branch is hit only in `wrangler pages dev` without secrets. */
    if (env.STRICT_AUTH !== "1") {
      console.log(`[email/dev] would send to=${to} subject=${JSON.stringify(subject)}`);
      return { sent: false, dev: true };
    }
    return { sent: false, error: "RESEND_API_KEY not configured" };
  }

  const body = {
    from: env.RESEND_FROM || DEFAULT_FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
  };
  if (html) body.html = html;
  if (text) body.text = text;

  let res;
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { sent: false, error: `network: ${err && err.message || err}` };
  }

  if (!res.ok) {
    let detail = "";
    try { detail = await res.text(); } catch { /* ignore */ }
    return { sent: false, status: res.status, error: detail.slice(0, 256) };
  }

  let id;
  try { id = (await res.json()).id; } catch { /* Resend always returns JSON on 2xx */ }
  return { sent: true, id };
}

// ── HTML helpers ─────────────────────────────────────────────────

// Minimal CSS-inlined OTP email. No external assets, no images — keeps
// past the spam-filter "shape of a transactional email" heuristic.
export function buildOtpEmail({ code, ttlMinutes = 10 }) {
  const subject = `${code} is your CloudCDN verification code`;
  const text =
    `Your CloudCDN verification code is ${code}\n\n` +
    `It expires in ${ttlMinutes} minutes. If you didn't request this, ignore this email.\n\n` +
    `CloudCDN · https://cloudcdn.pro\n`;
  const html =
`<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f7f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1d27;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="440" style="max-width:440px;background:#ffffff;border:1px solid #eaecf2;border-radius:12px;padding:32px;">
        <tr><td style="font-size:14px;color:#5b5f73;letter-spacing:0.08em;text-transform:uppercase;">CloudCDN</td></tr>
        <tr><td style="padding-top:8px;font-size:20px;font-weight:700;color:#0a0c12;">Verify your email</td></tr>
        <tr><td style="padding-top:8px;font-size:13px;color:#5b5f73;line-height:1.6;">Enter this code on the sign-up page to finish creating your account.</td></tr>
        <tr><td align="center" style="padding:24px 0;">
          <div style="display:inline-block;font-family:'SF Mono','JetBrains Mono','Fira Code',Consolas,monospace;font-size:32px;font-weight:600;letter-spacing:0.25em;color:#0a0c12;background:#f0f2f7;border:1px solid #eaecf2;border-radius:8px;padding:16px 24px;">${escapeHtml(String(code))}</div>
        </td></tr>
        <tr><td style="font-size:12px;color:#5b5f73;line-height:1.6;">Code expires in ${ttlMinutes} minutes. If you didn't request this, you can ignore this email.</td></tr>
      </table>
      <p style="font-size:11px;color:#9da1b5;padding-top:16px;">© CloudCDN · <a href="https://cloudcdn.pro" style="color:#4338ca;text-decoration:none;">cloudcdn.pro</a></p>
    </td></tr>
  </table>
</body></html>`;
  return { subject, html, text };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
