const nodemailer = require('nodemailer');

const requiredEmailSettings = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'];

const getEmailTransport = () => {
  const missing = requiredEmailSettings.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error('Email service is not configured');
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });
};

const sendPasswordResetOtp = async (email, otp, expiresInMinutes) => {
  const transporter = getEmailTransport();

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: 'GYMSTAT password reset verification code',
    text: [
      'GYMSTAT password reset',
      '',
      `Your verification code is ${otp}.`,
      `This code expires in ${expiresInMinutes} minutes.`,
      '',
      'If you did not request a password reset, you can ignore this email.'
    ].join('\n'),
    html: [
      '<div style="font-family:Arial,sans-serif;line-height:1.5;color:#333">',
      '<h2 style="color:#7a0a0a">GYMSTAT password reset</h2>',
      '<p>Use this verification code to continue resetting your password:</p>',
      `<p style="font-size:28px;font-weight:700;letter-spacing:6px;color:#7a0a0a">${otp}</p>`,
      `<p>This code expires in ${expiresInMinutes} minutes.</p>`,
      '<p>If you did not request a password reset, you can ignore this email.</p>',
      '</div>'
    ].join('')
  });
};

module.exports = { sendPasswordResetOtp };
