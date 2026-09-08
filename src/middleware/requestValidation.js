const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_BODY_KEYS = 60;
const MAX_STRING_LENGTH = 5000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/;
const KNOWN_FIELDS = new Set([
  'fullname', 'username', 'email', 'password', 'newPassword', 'department', 'yearLevel', 'sport', 'id', 'role',
  'event', 'eventName', 'requesterName', 'requesterEmail', 'requesterPhone', 'organization', 'purpose', 'details',
  'startDate', 'startTime', 'endDate', 'endTime', 'prepDays', 'status', 'rejectionReason', 'fromRequest',
  'Name', 'contactNo', 'facebookAccount', 'equipment', 'quantity', 'qty', 'referenceIds', 'referenceConditions',
  'borrowTimestamp', 'returnedTimestamp', 'returnedAt', 'condition', 'name', 'type', 'referenceId', 'category',
  'totalStock', 'onLoan', 'equipmentType', 'notifications', 'contactNumber', 'dateOfBirth', 'dob', 'branchCampus',
  'graduationYear', 'athleteStatus', 'profilePhoto', 'sportParticipation', 'coachPosition', 'staffMembers',
  'studentId', 'course', 'location', 'photo', 'requirementType', 'participationType', 'requirementId',
  'customRequirementLabel', 'sourceAcademicYear', 'title', 'dueDate', 'isActive', 'instructions', 'priority',
  'targetStudents', 'file', 'filename', 'originalname', 'mimetype', 'size', 'path', 'data', 'remarks', 'feedback',
  'grade', 'ids', 'createdBy', 'reviewedAt', 'reviewedBy'
]);

const allowedValues = {
  role: new Set(['student', 'student-athlete', 'coach', 'admin', 'screener']),
  status: new Set(['active', 'cancelled', 'completed', 'pending', 'approved', 'rejected', 'returned', 'out now', 'out']),
  yearLevel: new Set(['', 'I', 'II', 'III', 'IV']),
  branchCampus: new Set(['', 'Boac Main', 'Santa Cruz', 'Gasan', 'Torrijos']),
  condition: new Set(['Good', 'Fair', 'Damaged', 'Lost', 'Returned']),
  priority: new Set(['low', 'medium', 'high']),
  targetStudents: new Set(['all', 'student', 'student-athlete'])
};

const invalid = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const normalizeKeyValue = (key, value, depth = 0) => {
  if (depth > 4) {
    throw invalid('Request body is too deeply nested.');
  }

  if (DANGEROUS_KEYS.has(key)) {
    throw invalid('Request body contains an invalid field.');
  }

  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) {
      throw invalid('Request field is too long.');
    }

    const normalized = key.toLowerCase().includes('password') || key.toLowerCase().includes('base64')
      ? value
      : value.trim();
    const normalizedEmail = key.toLowerCase().includes('email')
      ? normalized.toLowerCase()
      : normalized;

    if (key.toLowerCase().includes('email') && normalizedEmail && !EMAIL_PATTERN.test(normalizedEmail)) {
      throw invalid('Please provide a valid email address.');
    }

    if ((key.toLowerCase().includes('date') || key === 'dob') && normalizedEmail && !DATE_PATTERN.test(normalizedEmail)) {
      throw invalid('Please provide a valid date.');
    }

    const values = allowedValues[key];
    if (values && !values.has(normalizedEmail) && !values.has(normalizedEmail.toLowerCase())) {
      throw invalid(`Invalid value for ${key}.`);
    }

    return normalizedEmail;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw invalid('Numeric fields must contain finite numbers.');
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length > 100) {
      throw invalid('Request contains too many items.');
    }
    return value.map((item) => normalizeKeyValue(key, item, depth + 1));
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length > MAX_BODY_KEYS) {
      throw invalid('Request body contains too many fields.');
    }
    return Object.fromEntries(keys.map((childKey) => {
      if (key === 'body' && !KNOWN_FIELDS.has(childKey)) {
        throw invalid('Request body contains an unexpected field.');
      }

      return [
      childKey,
      normalizeKeyValue(childKey, value[childKey], depth + 1)
      ];
    }));
  }

  return value;
};

const validateRequestBody = (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
    return next();
  }

  if (req.body === undefined || req.body === null) {
    return next();
  }

  if (typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({
      success: false,
      message: 'Request body must be a JSON object.'
    });
  }

  try {
    req.body = normalizeKeyValue('body', req.body);
    return next();
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    return next(error);
  }
};

module.exports = { validateRequestBody };
