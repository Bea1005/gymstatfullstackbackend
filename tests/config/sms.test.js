const { EventEmitter } = require('events');
const https = require('https');
const {
  getSmsConfigurationStatus,
  normalizePhoneNumber,
  sendContactVerificationOtp,
} = require('../../src/config/sms');

describe('Semaphore SMS delivery configuration', () => {
  const environmentNames = ['SEMAPHORE_API_KEY', 'SEMAPHORE_SENDER_NAME'];
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
    responseStatus = 200;
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
      request.destroy = jest.fn();
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

  const configureSemaphore = () => {
    process.env.SEMAPHORE_API_KEY = 'test-semaphore-api-key';
    process.env.SEMAPHORE_SENDER_NAME = 'GYMSTAT';
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

  it('requires the Semaphore API key and does not use Brevo credentials', async () => {
    process.env.BREVO_API_KEY = 'brevo-key-is-not-an-sms-key';
    expect(getSmsConfigurationStatus()).toEqual({
      configured: false,
      provider: 'semaphore',
      missing: ['SEMAPHORE_API_KEY'],
    });

    await expect(sendContactVerificationOtp('09171234567', '012345'))
      .rejects.toMatchObject({ code: 'SMS_PROVIDER_NOT_CONFIGURED' });
    expect(httpsRequestSpy).not.toHaveBeenCalled();
  });

  it('sends an OTP to Semaphore using the normalized Philippine number', async () => {
    configureSemaphore();

    await expect(sendContactVerificationOtp('09171234567', '012345', 5))
      .resolves.toBeUndefined();

    expect(getSmsConfigurationStatus()).toEqual({
      configured: true,
      provider: 'semaphore',
      missing: [],
    });
    expect(requestCapture.options).toEqual(expect.objectContaining({
      hostname: 'api.semaphore.co',
      path: '/api/v4/messages',
      method: 'POST',
    }));
    expect(requestCapture.body).toContain('apikey=test-semaphore-api-key');
    expect(requestCapture.body).toContain('number=639171234567');
    expect(requestCapture.body).toContain('sendername=GYMSTAT');
    expect(new URLSearchParams(requestCapture.body).get('message')).toBe(
      'Your GYMSTAT verification code is 012345. It expires in 5 minutes.'
    );
  });

  it('does not require a sender override when Semaphore has its default sender', async () => {
    process.env.SEMAPHORE_API_KEY = 'test-semaphore-api-key';

    await expect(sendContactVerificationOtp('09171234567', '012345'))
      .resolves.toBeUndefined();

    expect(requestCapture.body).not.toContain('sendername=');
  });

  it('maps rejected Semaphore credentials without exposing the API key', async () => {
    configureSemaphore();
    responseStatus = 401;
    responseBody = 'unauthorized';

    await expect(sendContactVerificationOtp('09171234567', '012345'))
      .rejects.toMatchObject({ code: 'SEMAPHORE_AUTH_FAILED' });
  });

  it('maps insufficient Semaphore credits', async () => {
    configureSemaphore();
    responseStatus = 402;

    await expect(sendContactVerificationOtp('09171234567', '012345'))
      .rejects.toMatchObject({ code: 'SEMAPHORE_INSUFFICIENT_CREDITS' });
  });

  it('logs only redacted details when Semaphore rejects an SMS', async () => {
    configureSemaphore();
    responseStatus = 422;
    responseBody = 'sender rejected for 639171234567 and OTP 012345';
    const log = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(sendContactVerificationOtp('09171234567', '012345'))
      .rejects.toMatchObject({ code: 'SEMAPHORE_INVALID_SENDER' });

    expect(log).toHaveBeenCalledWith('Semaphore SMS request failed:', expect.objectContaining({
      httpStatus: 422,
      errorCode: 'SEMAPHORE_INVALID_SENDER',
    }));
    expect(JSON.stringify(log.mock.calls)).not.toContain('test-semaphore-api-key');
    expect(JSON.stringify(log.mock.calls)).not.toContain('639171234567');
    expect(JSON.stringify(log.mock.calls)).not.toContain('012345');
    log.mockRestore();
  });
});
