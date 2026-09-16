const nodemailer = require('nodemailer');

const getSetting = (...names) => names
  .map((name) => process.env[name])
  .find((value) => value !== undefined && value !== null && String(value).trim() !== '')
  ?.trim();
const getEmailPassword = () => String(getSetting('SMTP_PASSWORD', 'EMAIL_PASSWORD', 'MAIL_PASSWORD') || '').replace(/\s+/g, '');

const getEmailConfigurationStatus = () => {
  const host = getSetting('SMTP_HOST', 'EMAIL_HOST', 'MAIL_HOST');
  const user = getSetting('SMTP_USER', 'EMAIL_USER', 'MAIL_USER');
  const password = getEmailPassword();
  const brevoKey = getSetting('BREVO_API_KEY');
  return {
    configured: Boolean((host && user && password) || brevoKey),
    hostConfigured: Boolean(host),
    userConfigured: Boolean(user),
    passwordConfigured: Boolean(password),
    brevoConfigured: Boolean(brevoKey)
  };
};

const sendViaBrevo = async (to, subject, text, html) => {
  const apiKey = getSetting('BREVO_API_KEY');
  const fromEmail = getSetting('BREVO_FROM_EMAIL', 'SMTP_FROM', 'SMTP_USER', 'EMAIL_USER');
  const fromName = getSetting('BREVO_FROM_NAME') || 'GYMSTAT';
  const body = JSON.stringify({
    sender: { name: fromName, email: fromEmail },
    to: [{ email: to }],
    subject,
    textContent: text,
    htmlContent: html
  });
  const https = require('https');
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.brevo.com',
        path: '/v3/smtp/email',
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 15000
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error('Brevo API error ' + res.statusCode + ': ' + data));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Brevo request timed out')); });
    req.write(body);
    req.end();
  });
};

const getEmailTransport = () => {
  const host = getSetting('SMTP_HOST', 'EMAIL_HOST', 'MAIL_HOST');
  const user = getSetting('SMTP_USER', 'EMAIL_USER', 'MAIL_USER');
  const password = getEmailPassword();
  const port = Number(getSetting('SMTP_PORT', 'EMAIL_PORT', 'MAIL_PORT') || 587);
  const secureSetting = getSetting('SMTP_SECURE', 'EMAIL_SECURE', 'MAIL_SECURE');
  const missing = [
    ['SMTP_HOST', host],
    ['SMTP_USER', user],
    ['SMTP_PASSWORD', password]
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    throw new Error('Email service is not configured: missing ' + missing.join(', '));
  }
  return nodemailer.createTransport({
    host,
    port,
    secure: secureSetting === undefined ? port === 465 : String(secureSetting).toLowerCase() === 'true',
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    auth: { user, pass: password }
  });
};

const sendPasswordResetOtp = async (email, otp, expiresInMinutes) => {
  const subject = 'GYMSTAT password reset verification code';
  const text = [
    'GYMSTAT password reset',
    '',
    'Your verification code is ' + otp + '.',
    'This code expires in ' + expiresInMinutes + ' minutes.',
    '',
    'If you did not request a password reset, you can ignore this email.'
  ].join('\n');
  const html = [
    '<div style=font-family:Arial,sans-serif;line-height:1.5;color:#333>',
    '<h2 style=color:#7a0a0a>GYMSTAT password reset</h2>',
    '<p>Use this verification code to continue resetting your password:</p>',
    '<p style=font-size:28px;font-weight:700;letter-spacing:6px;color:#7a0a0a>' + otp + '</p>',
    '<p>This code expires in ' + expiresInMinutes + ' minutes.</p>',
    '<p>If you did not request a password reset, you can ignore this email.</p>',
    '</div>'
  ].join('');

  const brevoKey = getSetting('BREVO_API_KEY');
  if (brevoKey) {
    return sendViaBrevo(email, subject, text, html);
  }

  const transporter = getEmailTransport();
  await transporter.sendMail({
    from: getSetting('SMTP_FROM', 'EMAIL_FROM', 'MAIL_FROM') || getSetting('SMTP_USER', 'EMAIL_USER', 'MAIL_USER'),
    to: email,
    subject,
    text,
    html
  });
};

module.exports = { getEmailConfigurationStatus, sendPasswordResetOtp };
