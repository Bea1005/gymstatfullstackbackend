const httpMocks = require('node-mocks-http');
const { validateRequestBody } = require('../../src/middleware/requestValidation');

describe('validateRequestBody requirement upload fields', () => {
  it('accepts the fields sent by the Admin Requirements FormData', () => {
    const req = httpMocks.createRequest({
      method: 'POST',
      path: '/requirements',
      body: {
        title: 'Consent Form',
        description: 'Parent/Guardian consent for Consent Form',
        type: 'consent',
        sport: 'General',
        priority: 'medium',
        dueDate: '2026-10-29T00:00:00.000Z',
        instructions: 'Please submit your Consent Form',
        targetStudents: 'all',
        isActive: 'true',
      },
    });
    const res = httpMocks.createResponse();
    const next = jest.fn();

    validateRequestBody(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(req.body.description).toBe('Parent/Guardian consent for Consent Form');
  });

  it('continues rejecting fields outside the explicit allowlist', () => {
    const req = httpMocks.createRequest({
      method: 'POST',
      path: '/requirements',
      body: { title: 'Consent Form', unrecognizedField: 'not allowed' },
    });
    const res = httpMocks.createResponse();
    const next = jest.fn();

    validateRequestBody(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res._getJSONData().message).toBe('Request body contains an unexpected field.');
  });

  it('accepts the existing PSA document identifier for an authenticated replacement upload', () => {
    const req = httpMocks.createRequest({
      method: 'POST',
      path: '/student/requirements',
      body: {
        requirementType: 'psa',
        participationType: 'Intrams',
        replacementSubmissionId: '507f1f77bcf86cd799439011',
      },
    });
    const res = httpMocks.createResponse();
    const next = jest.fn();

    validateRequestBody(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.body.replacementSubmissionId).toBe('507f1f77bcf86cd799439011');
  });
});