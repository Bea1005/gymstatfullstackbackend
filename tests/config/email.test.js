const { EventEmitter } = require('events');
const https = require('https');
const {
  getEmailConfigurationStatus,
  getRegistrationEmailFailure,
  sendPasswordResetOtp,
  sendRegistrationVerificationOtp
} = require('../../src/config/email');

describe('Email delivery configuration', () => {
  const previousEnvironment = {};
  const environmentNames = [
    'BREVO_API_KEY',
    'BREVO_FROM_EMAIL',
    'BREVO_FROM_NAME',
    'SMTP_HOST',
    'SMTP_USER',
    'SMTP_PASSWORD',
    'SMTP_FROM'
  ];
  let requestCapture;
  let httpsRequestSpy;

  beforeEach(() => {
    environmentNames.forEach((name) => {
      previousEnvironment[name] = process.env[name];
    });
    process.env.BREVO_API_KEY = 'test-brevo-api-key';
    process.env.BREVO_FROM_EMAIL = 'verified@example.test';
    process.env.BREVO_FROM_NAME = 'GYMSTAT Test';
    httpsRequestSpy = jest.spyOn(https, 'request').mockImplementation((options, callback) => {
      const response = new EventEmitter();
      response.statusCode = 201;
      const request = new EventEmitter();
      request.write = (chunk) => {
        requestCapture.body += String(chunk);
      };
      request.end = () => {
        process.nextTick(() => {
          callback(response);
          response.emit('data', '{}');
          response.emit('end');
        });
      };
      request.destroy = jest.fn();
      requestCapture = { options, body: '' };
      return request;
    });
  });

  afterEach(() => {
    httpsRequestSpy.mockRestore();
    environmentNames.forEach((name) => {
      if (previousEnvironment[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnvironment[name];
    });
  });

  it('sends registration verification codes through the configured Brevo API', async () => {
    await sendRegistrationVerificationOtp('jane@example.test', '012345', 10);

    expect(httpsRequestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: 'api.brevo.com',
        path: '/v3/smtp/email',
        method: 'POST',
        headers: expect.objectContaining({ 'api-key': 'test-brevo-api-key' })
      }),
      expect.any(Function)
    );
    expect(JSON.parse(requestCapture.body)).toEqual(expect.objectContaining({
      sender: { name: 'GYMSTAT Test', email: 'verified@example.test' },
      to: [{ email: 'jane@example.test' }],
      subject: 'GYMSTAT email verification code',
      textContent: expect.stringContaining('012345'),
      htmlContent: expect.stringContaining('expires in 10 minutes')
    }));
  });

  it('keeps password-reset delivery on the existing Brevo integration', async () => {
    await sendPasswordResetOtp('jane@example.test', '987654', 10);

    expect(httpsRequestSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(requestCapture.body).subject).toBe('GYMSTAT password reset verification code');
    expect(getEmailConfigurationStatus()).toEqual(expect.objectContaining({
      configured: true,
      brevoConfigured: true
    }));
  });

  it('classifies Brevo credential rejection without exposing provider response content', async () => {
    httpsRequestSpy.mockImplementationOnce((_options, callback) => {
      const response = new EventEmitter();
      response.statusCode = 401;
      const request = new EventEmitter();
      request.write = jest.fn();
      request.end = () => {
        process.nextTick(() => {
          callback(response);
          response.emit('data', '{"message":"sensitive provider response"}');
          response.emit('end');
        });
      };
      request.destroy = jest.fn();
      return request;
    });

    let deliveryError;
    try {
      await sendRegistrationVerificationOtp('jane@example.test', '123456', 10);
    } catch (error) {
      deliveryError = error;
    }

    expect(deliveryError).toMatchObject({ code: 'BREVO_HTTP_401' });
    expect(deliveryError.message).not.toContain('sensitive provider response');
    expect(getRegistrationEmailFailure(deliveryError)).toEqual({
      code: 'brevo-credentials-rejected',
      message: 'Brevo rejected the request. Check that the API key is active and the sender email is verified in Brevo.'
    });
  });
});
