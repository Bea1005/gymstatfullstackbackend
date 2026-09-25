const fs = require('fs');

const MAX_LENGTHS = {
  eventName: 120,
  requesterName: 120,
  requesterEmail: 254,
  requesterPhone: 25,
  organization: 160,
  purpose: 500,
  details: 2000,
  startDate: 10,
  endDate: 10,
  startTime: 8,
  endTime: 8,
};

const REQUIRED_FIELDS = [
  'eventName',
  'requesterName',
  'requesterEmail',
  'requesterPhone',
  'startDate',
  'startTime',
  'endDate',
  'endTime',
];
const OPTIONAL_TEXT_FIELDS = ['organization', 'purpose', 'details'];

const ALLOWED_FIELDS = new Set([
  ...Object.keys(MAX_LENGTHS),
  'prepDays',
  'website',
  'formStartedAt',
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[0-9+()\-\s]{7,25}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(0?[1-9]|1[0-2]):[0-5]\d [AP]M$/;

const invalid = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const parseDate = (value) => {
  if (!DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
};

const toMinutes = (value) => {
  const [clock, meridian] = value.split(' ');
  const [hours, minutes] = clock.split(':').map(Number);
  let normalizedHours = hours % 12;
  if (meridian === 'PM') normalizedHours += 12;
  return normalizedHours * 60 + minutes;
};

const validateScheduleRequest = (req, res, next) => {
  try {
    if (!req.file) throw invalid('A request letter is required.');

    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body
      : {};
    const unexpectedField = Object.keys(body).find((field) => !ALLOWED_FIELDS.has(field));
    if (unexpectedField) throw invalid('Request contains an unexpected field.');

    const missingField = REQUIRED_FIELDS.find((field) => typeof body[field] !== 'string' || !body[field].trim());
    if (missingField) throw invalid('All required fields must be provided.');

    const normalized = { ...body };
    OPTIONAL_TEXT_FIELDS.forEach((field) => {
      if (normalized[field] === undefined) normalized[field] = '';
    });
    Object.keys(MAX_LENGTHS).forEach((field) => {
      if (typeof normalized[field] !== 'string') throw invalid('Request fields must be text values.');
      normalized[field] = normalized[field].trim();
      if (normalized[field].length > MAX_LENGTHS[field]) throw invalid('A request field is too long.');
    });

    if (!EMAIL_PATTERN.test(normalized.requesterEmail)) throw invalid('Please provide a valid email address.');
    if (!PHONE_PATTERN.test(normalized.requesterPhone)) throw invalid('Please provide a valid phone number.');
    if (!parseDate(normalized.startDate) || !parseDate(normalized.endDate)) throw invalid('Please provide valid dates.');
    if (!TIME_PATTERN.test(normalized.startTime) || !TIME_PATTERN.test(normalized.endTime)) throw invalid('Please provide valid times.');
    if (normalized.endDate < normalized.startDate || (
      normalized.endDate === normalized.startDate
      && toMinutes(normalized.endTime) <= toMinutes(normalized.startTime)
    )) throw invalid('The requested end must be after the start.');

    const prepDays = normalized.prepDays === undefined || normalized.prepDays === ''
      ? 0
      : Number(normalized.prepDays);
    if (!Number.isInteger(prepDays) || prepDays < 0 || prepDays > 30) throw invalid('Prep days must be a whole number from 0 to 30.');
    normalized.prepDays = prepDays;

    if (normalized.website) throw invalid('Request could not be verified.');
    const formStartedAt = Number(normalized.formStartedAt);
    const elapsed = Date.now() - formStartedAt;
    if (!Number.isFinite(formStartedAt) || elapsed < 1000 || elapsed > 24 * 60 * 60 * 1000) {
      throw invalid('Request could not be verified.');
    }

    req.body = normalized;
    return next();
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    if (error.statusCode === 400) {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
};

module.exports = { validateScheduleRequest };