'use strict';
/**
 * SMS delivery via Infobip (infobip.com).
 *
 * Required environment variables:
 *   INFOBIP_API_KEY   – API key from Infobip dashboard
 *   INFOBIP_BASE_URL  – your unique base URL, e.g. xxxxx.api.infobip.com
 *   INFOBIP_SENDER    – sender name or number, e.g. InfoSMS or +12015550123
 *
 * Auth: Authorization: App {api-key}
 * Endpoint: POST https://{base_url}/sms/2/text/advanced
 * Phone format: digits only, no leading + (e.g. 639171234567)
 */

const https = require('https');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getSetting = (name) => {
  const val = process.env[name];
  return (val === undefined || val === null || String(val).trim() === '')
    ? ''
    : String(val).trim();
};

const normalizePhoneNumber = (value) => {
  const n = String(value || '').trim();
  if (/^09[0-9]{9}$/.test(n)) return '+63' + n.slice(1);
  if (/^\+639[0-9]{9}$/.test(n)) return n;
  return '';
};

// Infobip requires digits only, no leading +
const toInfobipNumber = (e164) => e164.replace(/^\+/, '');

const createSmsError = (message, code, details = {}) =>
  Object.assign(new Error(message), { code, ...details });

// ---------------------------------------------------------------------------
// Configuration status
// ---------------------------------------------------------------------------

const getSmsConfigurationStatus = () => {
  const apiKey  = getSetting('INFOBIP_API_KEY');
  const baseUrl = getSetting('INFOBIP_BASE_URL');
  const sender  = getSetting('INFOBIP_SENDER');
  const missing = [];

  if (!apiKey  || /your-|placeholder|example|replace-me/i.test(apiKey))  missing.push('INFOBIP_API_KEY');
  if (!baseUrl || /your-|placeholder|example|replace-me/i.test(baseUrl)) missing.push('INFOBIP_BASE_URL');
  if (!sender  || /your-|placeholder|example|replace-me/i.test(sender))  missing.push('INFOBIP_SENDER');

  return { configured: missing.length === 0, provider: 'infobip', missing };
};

const buildSmsNotConfiguredMessage = () => {
  const { missing } = getSmsConfigurationStatus();
  return `SMS OTP is not configured. Set ${missing.join(' and ')} in the backend environment.`;
};

// ---------------------------------------------------------------------------
// Map Infobip HTTP errors to user-facing messages
// ---------------------------------------------------------------------------

const getInfobipError = (httpStatus, responseBody) => {
  const body = String(responseBody || '').toLowerCase();

  if (httpStatus === 401 || httpStatus === 403) {
    return {
      code: 'INFOBIP_AUTH_FAILED',
      message: 'Infobip rejected the SMS credentials. Check INFOBIP_API_KEY.',
    };
  }
  if (httpStatus === 400) {
    if (body.includes('invalid') && body.includes('to')) {
      return {
        code: 'INFOBIP_INVALID_NUMBER',
        message: 'The destination mobile number was rejected by Infobip. Check the format.',
      };
    }
    if (body.includes('sender') || body.includes('from')) {
      return {
        code: 'INFOBIP_INVALID_SENDER',
        message: 'The SMS sender is invalid. Check INFOBIP_SENDER.',
      };
    }
    return {
      code: 'INFOBIP_INVALID_REQUEST',
      message: 'Infobip rejected the SMS request. Check your sender name and recipient number.',
    };
  }
  if (httpStatus === 429) {
    return {
      code: 'INFOBIP_RATE_LIMITED',
      message: 'Infobip is temporarily rate-limiting SMS delivery. Please wait and try again.',
    };
  }
  if (httpStatus >= 500) {
    return {
      code: 'INFOBIP_UNAVAILABLE',
      message: 'The Infobip SMS service is temporarily unavailable. Please try again later.',
    };
  }
  return {
    code: 'INFOBIP_SMS_DELIVERY_FAILED',
    message: 'The SMS provider could not send the verification code. Check your Infobip configuration.',
  };
};

const redact = (message, values) => {
  let safe = String(message || '').replace(/[\r\n\t]+/g, ' ').trim();
  for (const v of values) {
    if (v) safe = safe.split(String(v)).join('[redacted]');
  }
  return safe.slice(0, 240);
};

// ---------------------------------------------------------------------------
// Send OTP via Infobip
// ---------------------------------------------------------------------------

const sendContactVerificationOtp = async (contactNumber, otp, ttlMinutes) => {
  const minutes   = Number(ttlMinutes) > 0 ? Number(ttlMinutes) : 5;
  const e164      = normalizePhoneNumber(contactNumber);

  if (!e164) {
    throw createSmsError(
      'Please provide a valid Philippine mobile number in the format 09XXXXXXXXX or +639XXXXXXXXX.',
      'SMS_INVALID_PHONE_NUMBER'
    );
  }
  if (!otp || !/^\d{6}$/.test(String(otp))) {
    throw createSmsError('The verification code is invalid.', 'SMS_INVALID_OTP');
  }

  const config = getSmsConfigurationStatus();
  if (!config.configured) {
    throw createSmsError(buildSmsNotConfiguredMessage(), 'SMS_PROVIDER_NOT_CONFIGURED');
  }

  const apiKey    = getSetting('INFOBIP_API_KEY');
  const baseUrl   = getSetting('INFOBIP_BASE_URL').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const sender    = getSetting('INFOBIP_SENDER');
  const recipient = toInfobipNumber(e164);
  const text      = `Your GYMSTAT verification code is ${otp}. It expires in ${minutes} minute${minutes === 1 ? '' : 's'}.`;

  const body = JSON.stringify({
    messages: [{
      from: sender,
      destinations: [{ to: recipient }],
      text,
    }],
  });

  await new Promise((resolve, reject) => {
    let responseBody = '';
    const req = https.request(
      {
        hostname: baseUrl,
        path: '/sms/2/text/advanced',
        method: 'POST',
        headers: {
          Authorization: `App ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Accept: 'application/json',
        },
        timeout: 15000,
      },
      (res) => {
        res.on('data', (chunk) => {
          if (responseBody.length < 8192) responseBody += chunk.toString();
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            // Infobip returns 200 even for some errors — check messages[0].status
            try {
              const parsed = JSON.parse(responseBody);
              const msgStatus = parsed?.messages?.[0]?.status;
              const groupId   = msgStatus?.groupId;
              // groupId 5 = REJECTED, groupId 6 = EXPIRED
              if (groupId === 5 || groupId === 6) {
                const desc = redact(msgStatus?.description, [apiKey, recipient, String(otp)]);
                console.error('Infobip message rejected:', { groupId, description: desc });
                reject(createSmsError(
                  'The SMS provider rejected the message. Check INFOBIP_SENDER and the recipient number.',
                  'INFOBIP_MESSAGE_REJECTED'
                ));
                return;
              }
            } catch { /* JSON parse failed — treat as success */ }
            resolve();
            return;
          }

          const safeBody = redact(responseBody, [apiKey, recipient, String(otp)]);
          const mapped   = getInfobipError(res.statusCode || 0, responseBody);
          console.error('Infobip SMS request failed:', {
            httpStatus: res.statusCode,
            response:   safeBody,
            errorCode:  mapped.code,
          });
          reject(createSmsError(mapped.message, mapped.code, {
            providerStatusCode: res.statusCode || 0,
          }));
        });
      }
    );

    req.on('error', () => reject(createSmsError(
      'Could not connect to the SMS provider. Please try again later.',
      'SMS_PROVIDER_CONNECTION_FAILED'
    )));
    req.on('timeout', () => {
      req.destroy();
      reject(createSmsError('The SMS provider request timed out.', 'SMS_PROVIDER_TIMEOUT'));
    });

    req.write(body);
    req.end();
  });
};

// ---------------------------------------------------------------------------
// Exports — identical surface to previous implementations
// ---------------------------------------------------------------------------

module.exports = {
  normalizePhoneNumber,
  getSmsConfigurationStatus,
  buildSmsNotConfiguredMessage,
  sendContactVerificationOtp,
};
