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

  it('accepts the Student Profile sports array field', () => {
    const req = httpMocks.createRequest({
      method: 'PUT',
      path: '/profile',
      body: {
        sport: 'Basketball Women',
        sports: '["Basketball Women","Volleyball Women"]',
      },
    });
    const res = httpMocks.createResponse();
    const next = jest.fn();

    validateRequestBody(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.body.sports).toBe('["Basketball Women","Volleyball Women"]');
  });

  it('accepts Coach Portal athlete badge statuses only on coach athlete updates', () => {
    const req = httpMocks.createRequest({
      method: 'PUT',
      path: '/api/v1/coach/athletes/student-id',
      body: { status: 'disqualified', athleteStatus: 'disqualified' },
    });
    const res = httpMocks.createResponse();
    const next = jest.fn();

    validateRequestBody(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.body.status).toBe('disqualified');
  });

  it('accepts Coach Record content fields and preserves multiline eligibility formatting', () => {
    const requirementsNotes = '\nFirst requirement:\n  indented detail.\n\nThird item.\n';
    const req = httpMocks.createRequest({
      method: 'PUT',
      path: '/api/v1/coach/record-content/eligibility',
      body: { requirementsNotes },
    });
    const res = httpMocks.createResponse();
    const next = jest.fn();

    validateRequestBody(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.body.requirementsNotes).toBe(requirementsNotes);
  });

  it('does not allow Coach Record content fields on unrelated endpoints', () => {
    const req = httpMocks.createRequest({
      method: 'PUT',
      path: '/api/v1/profile',
      body: { institution: 'Not allowed here' },
    });
    const res = httpMocks.createResponse();
    const next = jest.fn();

    validateRequestBody(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res._getJSONData().message).toBe('Request body contains an unexpected field.');
  });

  it('continues rejecting Coach Portal badge statuses on other endpoints', () => {
    const req = httpMocks.createRequest({
      method: 'PUT',
      path: '/api/v1/profile',
      body: { status: 'disqualified' },
    });
    const res = httpMocks.createResponse();
    const next = jest.fn();

    validateRequestBody(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res._getJSONData().message).toBe('Invalid value for status.');
  });
});