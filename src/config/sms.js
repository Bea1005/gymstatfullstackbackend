const https = require('https');

const getSetting = (name) => {
  const val = process.env[name];
  return (val === undefined || val === null || String(val).trim() === '') ? '' : String(val).trim();
};

const normalizePhoneNumber = (value) => {
  const n = String(value || '').trim();
  if (/^09[0-9]{9}$/.test(n)) return '+63' + n.slice(1);
  if (/^[+]639[0-9]{9}$/.test(n)) return n;
  return '';
};

const getSmsConfigurationStatus = () => {
  const apiKey = getSetting('BREVO_API_KEY');
  const missing = [];
  if (!apiKey || /your-|placeholder|example|replace-me/i.test(apiKey)) missing.push('BREVO_API_KEY');
  return { configured: missing.length === 0, provider: 'brevo', missing };
};

const buildSmsNotConfiguredMessage = () => {
  const { missing } = getSmsConfigurationStatus();
  return 'SMS OTP verification is not configured. Set ' + missing.join(', ') + ' in the backend environment, or choose Email Verification.';
};

const createSmsError = (message, code) => Object.assign(new Error(message), { code });

const sendContactVerificationOtp = async (contactNumber, otp, ttlMinutes) => {
  const mins = Number(ttlMinutes) > 0 ? Number(ttlMinutes) : 5;
  const normalized = normalizePhoneNumber(contactNumber);
  if (!normalized) throw createSmsError('Please provide a valid Philippine mobile number in the format 09XXXXXXXXX or +639XXXXXXXXX.', 'SMS_INVALID_PHONE_NUMBER');
  if (!otp || !/^[0-9]{6}$/.test(String(otp))) throw createSmsError('The verification code is invalid.', 'SMS_INVALID_OTP');
  const status = getSmsConfigurationStatus();
  if (!status.configured) throw createSmsError(buildSmsNotConfiguredMessage(), 'SMS_PROVIDER_NOT_CONFIGURED');
  const apiKey = getSetting('BREVO_API_KEY');
  const sender = (getSetting('BREVO_SMS_SENDER') || 'GYMSTAT').slice(0, 11);
  const content = 'Your GYMSTAT verification code is ' + otp + '. It expires in ' + mins + ' minute' + (mins === 1 ? '' : 's') + '.';
  const body = JSON.stringify({ sender, recipient: normalized, content, type: 'transactional' });

  await new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'api.brevo.com', path: '/v3/transactionalSMS/sms', method: 'POST', headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Accept': 'application/json' }, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) { resolve(); return; }
        if (res.statusCode === 401 || res.statusCode === 403) { reject(createSmsError('Brevo rejected the SMS request. Check that BREVO_API_KEY is active and has SMS permissions.', 'BREVO_SMS_HTTP_' + res.statusCode)); return; }
        if (res.statusCode === 400) { reject(createSmsError('Brevo rejected the SMS message. Check BREVO_SMS_SENDER (max 11 alphanumeric chars) and the recipient number format.', 'BREVO_SMS_HTTP_400')); return; }
        if (res.statusCode === 402) { reject(createSmsError('Your Brevo account has insufficient SMS credits. Top up credits at brevo.com.', 'BREVO_SMS_HTTP_402')); return; }
        reject(createSmsError('The SMS provider could not send the verification code. Please try again.', 'BREVO_SMS_HTTP_' + (res.statusCode || 'ERROR')));
      });
    });
    req.on('error', () => reject(createSmsError('Could not connect to the SMS provider. Please try again later.', 'SMS_PROVIDER_CONNECTION_FAILED')));
    req.on('timeout', () => { req.destroy(); reject(createSmsError('The SMS provider request timed out.', 'SMS_PROVIDER_TIMEOUT')); });
    req.write(body);
    req.end();
  });
};

module.exports = { normalizePhoneNumber, getSmsConfigurationStatus, buildSmsNotConfiguredMessage, sendContactVerificationOtp };