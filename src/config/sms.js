/**
 * SMS delivery via Semaphore (semaphore.co) — Philippine SMS provider.
 *
 * Required environment variables:
 *   SEMAPHORE_API_KEY     – API key from semaphore.co Account → API Keys
 *   SEMAPHORE_SENDER_NAME – (optional) approved sender name, e.g. "GYMSTAT"
 *                           defaults to your account's registered sender name
 *
 * Endpoint: POST https://api.semaphore.co/api/v4/messages
 * Rate limit: 120 requests per minute
 */
'use strict';

const https = require('https');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getSetting = (name) => {
  const value = process.env[name];
  return value === undefined || value === null || String(value).trim() === ''
    ? ''
    : String(value).trim();
};

const normalizePhoneNumber = (value) => {
  const number = String(value || '').trim();
  // 09XXXXXXXXX  → +639XXXXXXXXX
  if (/^09[0-9]{9}$/.test(number)) return `+63${number.slice(1)}`;
  // already in E.164 PH format
  if (/^\+639[0-9]{9}$/.test(number)) return number;
  return '';
};

const createSmsError = (message, code, details = {}) =>
  Object.assign(new Error(message), { code, ...details });

// ---------------------------------------------------------------------------
// Configuration status
// ---------------------------------------------------------------------------

const getSmsConfigurationStatus = () => {
  const apiKey = getSetting('SEMAPHORE_API_KEY');
  const missing = [];

  if (!apiKey || /your-|placeholder|example|replace-me/i.test(apiKey)) {
    missing.push('SEMAPHORE_API_KEY');
  }

  return { configured: missing.length === 0, provider: 'semaphore', missing };
};

const buildSmsNotConfiguredMessage = () => {
  const { missing } = getSmsConfigurationStatus();
  return `SMS OTP verification is not configured. Set ${missing.join(' and ')} in the backend environment.`;
};

// ---------------------------------------------------------------------------
// Map Semaphore HTTP errors to clean user-facing messages
// ---------------------------------------------------------------------------

const getSemaphoreError = (httpStatus, responseBody) => {
  // 401 — bad API key
  if (httpStatus === 401) {
    return {
      code: 'SEMAPHORE_AUTH_FAILED',
      message: 'Semaphore rejected the SMS credentials. Check SEMAPHORE_API_KEY.',
    };
  }
  // 402 — insufficient credits
  if (httpStatus === 402) {
    return {
      code: 'SEMAPHORE_INSUFFICIENT_CREDITS',
      message: 'Your Semaphore account has insufficient SMS credits. Top up at semaphore.co.',
    };
  }
  // 422 — validation error (bad number, bad sender, etc.)
  if (httpStatus === 422) {
    const body = String(responseBody || '').toLowerCase();
    if (body.includes('sender')) {
      return {
        code: 'SEMAPHORE_INVALID_SENDER',
        message: 'The Semaphore sender name is not approved or missing. Check SEMAPHORE_SENDER_NAME.',
      };
    }
    if (body.includes('number') || body.includes('recipient')) {
      return {
        code: 'SEMAPHORE_INVALID_NUMBER',
        message: 'The destination mobile number was rejected by Semaphore. Check the Philippine number format.',
      };
    }
    return {
      code: 'SEMAPHORE_INVALID_REQUEST',
      message: 'Semaphore rejected the SMS request. Check your sender name and recipient number.',
    };
  }
  // 429 — rate limited
  if (httpStatus === 429) {
    return {
      code: 'SEMAPHORE_RATE_LIMITED',
      message: 'Semaphore is temporarily rate-limiting SMS delivery. Please wait and try again.',
    };
  }
  // 5xx — provider down
  if (httpStatus >= 500) {
    return {
      code: 'SEMAPHORE_UNAVAILABLE',
      message: 'The Semaphore SMS service is temporarily unavailable. Please try again later.',
    };
  }
  return {
    code: 'SEMAPHORE_SMS_DELIVERY_FAILED',
    message: 'The SMS provider could not send the verification code. Check your Semaphore configuration.',
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
// Send OTP via Semaphore
// ---------------------------------------------------------------------------

const sendContactVerificationOtp = async (contactNumber, otp, ttlMinutes) => {
  const minutes   = Number(ttlMinutes) > 0 ? Number(ttlMinutes) : 5;
  const recipient = normalizePhoneNumber(contactNumber);

  if (!recipient) {
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

  const apiKey     = getSetting('SEMAPHORE_API_KEY');
  const senderName = getSetting('SEMAPHORE_SENDER_NAME'); // optional
  const message    = `Your GYMSTAT verification code is ${otp}. It expires in ${minutes} minute${minutes === 1 ? '' : 's'}.`;

  // Semaphore accepts the recipient as 09XXXXXXXXX or +639XXXXXXXXX
  // Strip the leading + so we pass 639XXXXXXXXX (Semaphore handles both formats)
  const recipientForApi = recipient.startsWith('+') ? recipient.slice(1) : recipient;

  const params = new URLSearchParams({ apikey: apiKey, number: recipientForApi, message });
  if (senderName) params.set('sendername', senderName);
  const postBody = params.toString();

  await new Promise((resolve, reject) => {
    let responseBody = '';
    const request = https.request(
      {
        hostname: 'api.semaphore.co',
        path: '/api/v4/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postBody),
        },
        timeout: 15000,
      },
      (response) => {
        response.on('data', (chunk) => {
          if (responseBody.length < 8192) responseBody += chunk.toString();
        });
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve();
            return;
          }

          const safeBody = redact(responseBody, [apiKey, recipientForApi, String(otp)]);
          const mapped   = getSemaphoreError(response.statusCode || 0, responseBody);

          console.error('Semaphore SMS request failed:', {
            httpStatus: response.statusCode || 0,
            responseBody: safeBody || 'No response body',
            errorCode: mapped.code,
          });

          reject(createSmsError(mapped.message, mapped.code, {
            providerStatusCode: response.statusCode || 0,
          }));
        });
      }
    );

    request.on('error', () => reject(createSmsError(
      'Could not connect to the SMS provider. Please try again later.',
      'SMS_PROVIDER_CONNECTION_FAILED'
    )));
    request.on('timeout', () => {
      request.destroy();
      reject(createSmsError('The SMS provider request timed out.', 'SMS_PROVIDER_TIMEOUT'));
    });

    request.write(postBody);
    request.end();
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
