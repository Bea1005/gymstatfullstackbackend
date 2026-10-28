const nodemailer = require('nodemailer');

const getSetting = (...names) => names
  .map((name) => process.env[name])
  .find((value) => value !== undefined && value !== null && String(value).trim() !== '')
  ?.trim();
const getEmailPassword = () => String(getSetting('SMTP_PASSWORD', 'EMAIL_PASSWORD', 'MAIL_PASSWORD') || '').replace(/\s+/g, '');
const hasSmtpConfiguration = () => Boolean(
  getSetting('SMTP_HOST', 'EMAIL_HOST', 'MAIL_HOST')
  && getSetting('SMTP_USER', 'EMAIL_USER', 'MAIL_USER')
  && getEmailPassword()
);
const createEmailError = (message, code) => Object.assign(new Error(message), { code });

const getRegistrationEmailFailure = (error) => {
  const code = String(error?.code || '');
  if (code === 'EMAIL_PROVIDER_NOT_CONFIGURED') {
    return {
      code: 'provider-not-configured',
      message: 'Email sending is not configured on the backend. Check the Brevo API key and verified sender settings.'
    };
  }
  if (code === 'BREVO_HTTP_401' || code === 'BREVO_HTTP_403') {
    return {
      code: 'brevo-credentials-rejected',
      message: 'Brevo rejected the request. Check that the API key is active and the sender email is verified in Brevo.'
    };
  }
  if (code === 'BREVO_HTTP_400') {
    return {
      code: 'brevo-sender-rejected',
      message: 'Brevo rejected the sender or message. Check the verified sender email and transactional email settings in Brevo.'
    };
  }
  if (code === 'BREVO_HTTP_429') {
    return {
      code: 'brevo-rate-limited',
      message: 'Brevo is temporarily limiting email requests. Wait a little, then request another code.'
    };
  }
  if (/^BREVO_HTTP_5\d\d$/.test(code)) {
    return {
      code: 'brevo-unavailable',
      message: 'Brevo is temporarily unavailable. Please try sending the code again later.'
    };
  }
  if (code === 'EMAIL_PROVIDER_TIMEOUT' || code === 'EMAIL_PROVIDER_CONNECTION_FAILED') {
    return {
      code: 'provider-connection-failed',
      message: 'The backend could not connect to the email service. Check the backend network and try again.'
    };
  }
  if (code === 'SMTP_AUTH_FAILED') {
    return {
      code: 'smtp-auth-failed',
      message: 'The configured email provider rejected its credentials. Check the backend email settings.'
    };
  }
  return {
    code: 'delivery-failed',
    message: 'The verification email could not be sent. Check the backend email settings and provider logs, then try again.'
  };
};

const getEmailConfigurationStatus = () => {
  const host = getSetting('SMTP_HOST', 'EMAIL_HOST', 'MAIL_HOST');
  const user = getSetting('SMTP_USER', 'EMAIL_USER', 'MAIL_USER');
  const password = getEmailPassword();
  const brevoKey = getSetting('BREVO_API_KEY');
  const brevoFromEmail = getSetting('BREVO_FROM_EMAIL', 'SMTP_FROM', 'SMTP_USER', 'EMAIL_USER');
  const brevoConfigured = Boolean(brevoKey && brevoFromEmail);
  return {
    configured: Boolean((host && user && password) || brevoConfigured),
    hostConfigured: Boolean(host),
    userConfigured: Boolean(user),
    passwordConfigured: Boolean(password),
    brevoConfigured
  };
};

const sendViaBrevo = async (to, subject, text, html) => {
  const apiKey = getSetting('BREVO_API_KEY');
  const fromEmail = getSetting('BREVO_FROM_EMAIL', 'SMTP_FROM', 'SMTP_USER', 'EMAIL_USER');
  if (!apiKey || !fromEmail) {
    throw createEmailError(
      'Email provider is not configured.',
      'EMAIL_PROVIDER_NOT_CONFIGURED'
    );
  }
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
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(createEmailError(
              'Brevo rejected the email request.',
              `BREVO_HTTP_${res.statusCode}`
            ));
          }
        });
      }
    );
    req.on('error', () => reject(createEmailError(
      'Email provider connection failed.',
      'EMAIL_PROVIDER_CONNECTION_FAILED'
    )));
    req.on('timeout', () => {
      req.destroy();
      reject(createEmailError('Email provider request timed out.', 'EMAIL_PROVIDER_TIMEOUT'));
    });
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
    throw createEmailError(
      'Email provider is not configured.',
      'EMAIL_PROVIDER_NOT_CONFIGURED'
    );
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

const sendRegistrationVerificationOtp = async (email, otp, expiresInMinutes) => {
  const subject = 'GYMSTAT email verification code';
  const text = [
    'GYMSTAT email verification',
    '',
    'Your verification code is ' + otp + '.',
    'This code expires in ' + expiresInMinutes + ' minutes.',
    '',
    'If you did not start a GYMSTAT registration, you can ignore this email.'
  ].join('\n');
  const html = [
    '<div style=font-family:Arial,sans-serif;line-height:1.5;color:#333>',
    '<h2 style=color:#7a0a0a>GYMSTAT email verification</h2>',
    '<p>Enter this verification code to complete your registration:</p>',
    '<p style=font-size:28px;font-weight:700;letter-spacing:6px;color:#7a0a0a>' + otp + '</p>',
    '<p>This code expires in ' + expiresInMinutes + ' minutes.</p>',
    '<p>If you did not start a GYMSTAT registration, you can ignore this email.</p>',
    '</div>'
  ].join('');

  const brevoKey = getSetting('BREVO_API_KEY');
  if (brevoKey) {
    try {
      return await sendViaBrevo(email, subject, text, html);
    } catch (brevoError) {
      if (!hasSmtpConfiguration()) throw brevoError;
      console.warn(
        `Brevo registration email delivery failed [${brevoError?.code || 'unknown'}]; trying configured SMTP fallback.`
      );
    }
  }

  try {
    const transporter = getEmailTransport();
    await transporter.sendMail({
      from: getSetting('SMTP_FROM', 'EMAIL_FROM', 'MAIL_FROM') || getSetting('SMTP_USER', 'EMAIL_USER', 'MAIL_USER'),
      to: email,
      subject,
      text,
      html
    });
  } catch (error) {
    if (error?.code === 'EMAIL_PROVIDER_NOT_CONFIGURED') throw error;
    const code = error?.code === 'EAUTH' ? 'SMTP_AUTH_FAILED' : 'SMTP_DELIVERY_FAILED';
    throw createEmailError('SMTP email delivery failed.', code);
  }
};

const escapeEmailHtml = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
})[character]);

const sendScheduleRequestStatusEmail = async (email, request, status) => {
  if (!['approved', 'rejected'].includes(status)) {
    throw createEmailError('Invalid schedule request status.', 'INVALID_SCHEDULE_REQUEST_STATUS');
  }

  const recipient = String(email || '').trim();
  if (!recipient) {
    throw createEmailError('Schedule requester email is missing.', 'INVALID_SCHEDULE_REQUEST_EMAIL');
  }

  const eventName = String(request?.eventName || 'your schedule request');
  const decision = status === 'approved' ? 'approved' : 'rejected';
  const subject = `GYMSTAT schedule request ${decision}`;
  const rejectionReason = status === 'rejected' && request?.rejectionReason
    ? `Reason: ${request.rejectionReason}`
    : '';
  const text = [
    `Hello ${request?.requesterName || 'there'},`,
    '',
    `Your schedule request for "${eventName}" has been ${decision}.`,
    `Dates: ${request?.startDate || ''} to ${request?.endDate || ''}`,
    `Time: ${request?.startTime || ''} to ${request?.endTime || ''}`,
    rejectionReason,
    '',
    'This is an automated message from GYMSTAT.'
  ].filter(Boolean).join('\n');
  const html = [
    '<div style="font-family:Arial,sans-serif;line-height:1.5;color:#333">',
    `<p>Hello ${escapeEmailHtml(request?.requesterName || 'there')},</p>`,
    `<p>Your schedule request for <strong>${escapeEmailHtml(eventName)}</strong> has been ${decision}.</p>`,
    `<p>Dates: ${escapeEmailHtml(request?.startDate || '')} to ${escapeEmailHtml(request?.endDate || '')}<br>`,
    `Time: ${escapeEmailHtml(request?.startTime || '')} to ${escapeEmailHtml(request?.endTime || '')}</p>`,
    rejectionReason ? `<p>${escapeEmailHtml(rejectionReason)}</p>` : '',
    '<p>This is an automated message from GYMSTAT.</p>',
    '</div>'
  ].filter(Boolean).join('');

  if (getSetting('BREVO_API_KEY')) {
    return sendViaBrevo(recipient, subject, text, html);
  }

  try {
    const transporter = getEmailTransport();
    await transporter.sendMail({
      from: getSetting('SMTP_FROM', 'EMAIL_FROM', 'MAIL_FROM') || getSetting('SMTP_USER', 'EMAIL_USER', 'MAIL_USER'),
      to: recipient,
      subject,
      text,
      html
    });
  } catch (error) {
    if (error?.code === 'EMAIL_PROVIDER_NOT_CONFIGURED') throw error;
    const code = error?.code === 'EAUTH' ? 'SMTP_AUTH_FAILED' : 'SMTP_DELIVERY_FAILED';
    throw createEmailError('SMTP email delivery failed.', code);
  }
};


const sendScreenerAuthorizationEmail = async (email, screenerName, confirmUrl) => {
  const recipient = String(email || '').trim();
  const name = String(screenerName || 'Screener').trim();
  const url = String(confirmUrl || '').trim();

  if (!recipient) throw createEmailError('Screener email is missing.', 'INVALID_SCREENER_EMAIL');
  if (!url) throw createEmailError('Confirmation URL is missing.', 'INVALID_CONFIRM_URL');

  const subject = 'Screener Authorization - GYMSTAT';

  const text = [
    'Dear ' + name + ',',
    '',
    'You are hereby invited to serve as a Screener for the upcoming intramural event of Marinduque State University. Your responsibilities include reviewing and verifying Student-Athlete requirements in accordance with the university\'s established procedures.',
    '',
    'If you accept this role, please click the link below to confirm your acceptance:',
    url,
    '',
    'This authorization link expires in 48 hours.',
    '',
    'Sincerely,',
    'GYMSTAT System Administrator',
    'Marinduque State University'
  ].join('\n');

  const html = [
    '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:24px">',
    '<h2 style="color:#7a0a0a;margin-bottom:4px">GYMSTAT</h2>',
    '<p style="color:#555;font-size:13px;margin-top:0">Marinduque State University</p>',
    '<hr style="border:none;border-top:2px solid #7a0a0a;margin:16px 0">',
    '<p>Dear <strong>' + escapeEmailHtml(name) + '</strong>,</p>',
    '<p>You are hereby invited to serve as a <strong>Screener</strong> for the upcoming intramural event of Marinduque State University. Your responsibilities include reviewing and verifying Student-Athlete requirements in accordance with the university\'s established procedures.</p>',
    '<p>If you accept this role, please click the button below to confirm your acceptance.</p>',
    '<p style="margin:24px 0">',
    '<a href="' + escapeEmailHtml(url) + '" style="display:inline-block;background:#7a0a0a;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:700;font-size:15px">OK, I Agree</a>',
    '</p>',
    '<p style="font-size:13px;color:#666">Or copy and paste this link into your browser:<br><a href="' + escapeEmailHtml(url) + '" style="color:#7a0a0a">' + escapeEmailHtml(url) + '</a></p>',
    '<p style="font-size:12px;color:#888">This authorization link expires in 48 hours. Do not share this link with anyone.</p>',
    '<hr style="border:none;border-top:1px solid #ddd;margin:24px 0">',
    '<p style="margin-bottom:2px">Sincerely,</p>',
    '<p style="margin:0"><strong>GYMSTAT System Administrator</strong><br>Marinduque State University</p>',
    '<hr style="border:none;border-top:1px solid #ddd;margin:24px 0">',
    '<p style="font-size:11px;color:#aaa">This is an automated message from the GYMSTAT System. Do not reply to this email.</p>',
    '</div>'
  ].join('');

  if (getSetting('BREVO_API_KEY')) {
    return sendViaBrevo(recipient, subject, text, html);
  }

  try {
    const transporter = getEmailTransport();
    await transporter.sendMail({
      from: getSetting('SMTP_FROM', 'EMAIL_FROM', 'MAIL_FROM') || getSetting('SMTP_USER', 'EMAIL_USER', 'MAIL_USER'),
      to: recipient, subject, text, html
    });
  } catch (error) {
    if (error && error.code === 'EMAIL_PROVIDER_NOT_CONFIGURED') throw error;
    const code = error && error.code === 'EAUTH' ? 'SMTP_AUTH_FAILED' : 'SMTP_DELIVERY_FAILED';
    throw createEmailError('SMTP email delivery failed.', code);
  }
};
module.exports = {
  getEmailConfigurationStatus,
  getRegistrationEmailFailure,
  sendPasswordResetOtp,
  sendRegistrationVerificationOtp,
  sendScheduleRequestStatusEmail,
  sendScreenerAuthorizationEmail
};
