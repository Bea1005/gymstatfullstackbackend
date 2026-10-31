const { EventEmitter } = require('events');
const https = require('https');
const {
  getSmsConfigurationStatus,
  normalizePhoneNumber,
  sendContactVerificationOtp,
} = require('../../src/config/sms');

describe('SMS delivery configuration', () => {
  const environmentNames = [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE_NUMBER',
  ];
  let originalEnvironment;
  let httpsRequestSpy;
  let requestCapture;
  let responseStatus = 201;

  beforeEach(() => {
    originalEnvironment = Object.fromEntries(
      environmentNames.map((name) => [name, process.env[name]])
    );
    environmentNames.forEach((name) => delete process.env[name]);
    responseStatus = 201;
    requestCapture = { body: '' };
    httpsRequestSpy = jest.spyOn(https, 'request').mockImplementation((options, callback) => {
      const request = new EventEmitter();
      const response = new EventEmitter();
      response.statusCode = responseStatus;
      response.resume = jest.fn();
      request.write = (chunk) => {
        requestCapture.body += String(chunk);
      };
      request.end = () => {
        process.nextTick(() => {
          callback(response);
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

  it('does not claim delivery when Twilio is not configured', async () => {
    expect(getSmsConfigurationStatus()).toEqual({
      configured: false,
      provider: 'twilio',
      missing: environmentNames,
    });

    await expect(sendContactVerificationOtp('09171234567', '012345'))
      .rejects.toMatchObject({ code: 'SMS_PROVIDER_NOT_CONFIGURED' });
    expect(httpsRequestSpy).not.toHaveBeenCalled();
  });

  it('sends an OTP through the configured Twilio Messages API', async () => {
    process.env.TWILIO_ACCOUNT_SID = `AC${'a'.repeat(32)}`;
    process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
    process.env.TWILIO_PHONE_NUMBER = '+15551234567';

    await expect(sendContactVerificationOtp('09171234567', '012345', 5))
      .resolves.toBeUndefined();

    expect(requestCapture.options).toEqual(expect.objectContaining({
      hostname: 'api.twilio.com',
      path: `/2010-04-01/Accounts/AC${'a'.repeat(32)}/Messages.json`,
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: `Basic ${Buffer.from(`AC${'a'.repeat(32)}:test-auth-token`).toString('base64')}`,
      }),
    }));
    expect(new URLSearchParams(requestCapture.body).get('To')).toBe('+639171234567');
    expect(new URLSearchParams(requestCapture.body).get('From')).toBe('+15551234567');
    expect(new URLSearchParams(requestCapture.body).get('Body')).toContain('012345');
    expect(new URLSearchParams(requestCapture.body).get('Body')).toContain('expires in 5 minutes');
  });

  it('reports provider delivery failures without exposing the OTP', async () => {
    process.env.TWILIO_ACCOUNT_SID = `AC${'a'.repeat(32)}`;
    process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
    process.env.TWILIO_PHONE_NUMBER = '+15551234567';
    responseStatus = 401;

    await expect(sendContactVerificationOtp('09171234567', '012345'))
      .rejects.toMatchObject({
        code: 'TWILIO_HTTP_401',
        message: 'The SMS provider could not send the verification code. Check the backend SMS configuration and try again.',
      });
  });
});
