const { EventEmitter } = require('events');
const https = require('https');
const {
  getSmsConfigurationStatus,
  normalizePhoneNumber,
  sendContactVerificationOtp,
} = require('../../src/config/sms');

describe('Brevo SMS delivery configuration', () => {
  const environmentNames = ['BREVO_API_KEY', 'BREVO_SMS_SENDER'];
  let originalEnvironment;
  let httpsRequestSpy;
  let requestCapture;
  let responseStatus;
  let responseBody;

  beforeEach(() => {
    originalEnvironment = Object.fromEntries(
      environmentNames.map((name) => [name, process.env[name]])
    );
    environmentNames.forEach((name) => delete process.env[name]);
    responseStatus = 201;
    responseBody = '';
    requestCapture = { body: '' };
    httpsRequestSpy = jest.spyOn(https, 'request').mockImplementation((options, callback) => {
      const request = new EventEmitter();
      const response = new EventEmitter();
      response.statusCode = responseStatus;
      request.write = (chunk) => {
        requestCapture.body += String(chunk);
      };
      request.end = () => {
        process.nextTick(() => {
          callback(response);
          if (responseBody) response.emit('data', Buffer.from(responseBody));
          response.emit('end');
        });
      };
      requestCapture.options = options;
      return request;
    });
  });

  afterEach(() => {
    httpsRequestSpy.mockRestore();
    environmentNames.forEach((name) => {
      if (originalEnvironment[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnvironment[name];
    });
  });

  const configureBrevo = () => {
    process.env.BREVO_API_KEY = 'test-brevo-api-key';
    process.env.BREVO_SMS_SENDER = 'GYMSTAT';
  };

  it.each([
    ['09171234567', '+639171234567'],
    ['+639171234567', '+639171234567'],
  ])('normalizes valid Philippine mobile number %s', (input, expected) => {
    expect(normalizePhoneNumber(input)).toBe(expected);
  });

  it.each(['0917123456', '08171234567', '+638171234567', '0917 123 4567', ''])(
    'rejects invalid Philippine mobile number %s',
    (input) => {
      expect(normalizePhoneNumber(input)).toBe('');
    }
  );

  it('requires both the Brevo API key and a configured SMS sender', async () => {
    expect(getSmsConfigurationStatus()).toEqual({
      configured: false,
      provider: 'brevo',
      missing: ['BREVO_API_KEY', 'BREVO_SMS_SENDER'],
    });

    process.env.BREVO_API_KEY = 'test-brevo-api-key';
    expect(getSmsConfigurationStatus()).toEqual({
      configured: false,
      provider: 'brevo',
      missing: ['BREVO_SMS_SENDER'],
    });

    await expect(sendContactVerificationOtp('09171234567', '012345'))
      .rejects.toMatchObject({ code: 'SMS_PROVIDER_NOT_CONFIGURED' });
    expect(httpsRequestSpy).not.toHaveBeenCalled();
  });

  it('rejects sender IDs that do not meet Brevo format limits', () => {
    process.env.BREVO_API_KEY = 'test-brevo-api-key';
    process.env.BREVO_SMS_SENDER = 'GYMSTAT_SENDER_TOO_LONG';

    expect(getSmsConfigurationStatus()).toEqual({
      configured: false,
      provider: 'brevo',
      missing: ['BREVO_SMS_SENDER'],
    });
  });

  it('sends an OTP to a normalized Philippine number through the Brevo API', async () => {
    configureBrevo();

    await expect(sendContactVerificationOtp('09171234567', '012345', 5))
      .resolves.toBeUndefined();

    expect(requestCapture.options).toEqual(expect.objectContaining({
      hostname: 'api.brevo.com',
      path: '/v3/transactionalSMS/sms',
      method: 'POST',
      headers: expect.objectContaining({
        'api-key': 'test-brevo-api-key',
      }),
    }));
    expect(JSON.parse(requestCapture.body)).toEqual({
      sender: 'GYMSTAT',
      recipient: '+639171234567',
      content: 'Your GYMSTAT verification code is 012345. It expires in 5 minutes.',
      type: 'transactional',
    });
  });

  it('maps Brevo low-credit errors and logs safe provider details only', async () => {
    configureBrevo();
    responseStatus = 400;
    responseBody = JSON.stringify({
      code: 'not_enough_credits',
      message: 'Not enough credits for +639171234567; code 012345',
    });
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(sendContactVerificationOtp('09171234567', '012345'))
      .rejects.toMatchObject({
        code: 'BREVO_SMS_INSUFFICIENT_CREDITS',
        message: 'SMS delivery is unavailable because the Brevo account has insufficient SMS credits.',
      });

    expect(log).toHaveBeenCalledWith('Brevo SMS request failed:', expect.objectContaining({
      httpStatus: 400,
      providerCode: 'not_enough_credits',
      providerMessage: expect.not.stringContaining('+639171234567'),
    }));
    expect(JSON.stringify(log.mock.calls)).not.toContain('012345');
    log.mockRestore();
  });

  it('reports an authorization failure without exposing provider credentials', async () => {
    configureBrevo();
    responseStatus = 401;
    responseBody = JSON.stringify({ code: 'unauthorized', message: 'Authentication failed' });

    await expect(sendContactVerificationOtp('09171234567', '012345'))
      .rejects.toMatchObject({
        code: 'BREVO_SMS_AUTH_FAILED',
        message: 'Brevo rejected the SMS credentials. Check the backend API key.',
      });
  });

  it('reports transactional SMS permission errors', async () => {
    configureBrevo();
    responseStatus = 400;
    responseBody = JSON.stringify({ code: 'permission_denied', message: 'SMS sending is disabled' });

    await expect(sendContactVerificationOtp('09171234567', '012345'))
      .rejects.toMatchObject({
        code: 'BREVO_SMS_PERMISSION_DENIED',
        message: 'Brevo denied SMS sending. Check that transactional SMS is activated and the account has SMS permissions.',
      });
  });
});
