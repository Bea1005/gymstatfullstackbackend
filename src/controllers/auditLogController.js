const SecurityLog = require('../models/SecurityLog');

const MAX_PAGE_SIZE = 100;
const MAX_EXPORT_ROWS = 25000;
const SEARCH_FIELDS = [
  'actorName',
  'userId',
  'identifier',
  'action',
  'module',
  'description',
  'affectedRecord',
  'resource'
];
const CSV_COLUMNS = [
  ['timestamp', 'Date and Time'],
  ['actorName', 'User'],
  ['userId', 'User ID'],
  ['role', 'Role'],
  ['action', 'Action'],
  ['module', 'Module'],
  ['description', 'Description'],
  ['affectedRecord', 'Affected Record'],
  ['result', 'Status'],
  ['httpStatus', 'HTTP Status'],
  ['changedFields', 'Changed Fields']
];
const SAFE_AUDIT_FIELDS = 'timestamp level action userId actorName role module description affectedRecord changedFields httpStatus result';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseDate = (value, label) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    const error = new Error(`Invalid ${label} date.`);
    error.status = 400;
    throw error;
  }
  return parsed;
};

const buildAuditFilter = (query = {}) => {
  const filter = {};
  const search = String(query.search || '').trim().slice(0, 160);
  const role = String(query.role || '').trim().toLowerCase();
  const action = String(query.action || '').trim().toUpperCase();
  const module = String(query.module || '').trim();
  const result = String(query.result || '').trim().toUpperCase();
  const startDate = parseDate(query.startDate, 'start');
  const endDate = parseDate(query.endDate, 'end');

  if (role) filter.role = role;
  if (action) filter.action = action;
  if (module) filter.module = module;
  if (result) {
    if (!['SUCCESS', 'FAILURE'].includes(result)) {
      const error = new Error('Choose a valid audit status.');
      error.status = 400;
      throw error;
    }
    filter.result = result;
  }
  if (startDate || endDate) {
    filter.timestamp = {};
    if (startDate) filter.timestamp.$gte = startDate;
    if (endDate) filter.timestamp.$lt = endDate;
    if (startDate && endDate && startDate >= endDate) {
      const error = new Error('The end date must be after the start date.');
      error.status = 400;
      throw error;
    }
  }
  if (search) {
    const expression = new RegExp(escapeRegex(search), 'i');
    filter.$or = SEARCH_FIELDS.map((field) => ({ [field]: expression }));
  }

  return filter;
};

const parsePagination = (query = {}) => {
  const parsedPage = Number.parseInt(query.page, 10);
  const parsedPageSize = Number.parseInt(query.pageSize, 10);
  return {
    page: Number.isInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 1_000_000) : 1,
    pageSize: Number.isInteger(parsedPageSize) && parsedPageSize > 0
      ? Math.min(parsedPageSize, MAX_PAGE_SIZE)
      : 25
  };
};

const csvCell = (value) => {
  let text = Array.isArray(value) ? value.join(', ') : String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`;
};

const serializeCsv = (records) => [
  CSV_COLUMNS.map(([, title]) => csvCell(title)).join(','),
  ...records.map((record) => CSV_COLUMNS.map(([field]) => (
    field === 'timestamp'
      ? csvCell(record.timestamp ? new Date(record.timestamp).toISOString() : '')
      : csvCell(record[field])
  )).join(','))
].join('\r\n');

exports.getAuditLogs = async (req, res) => {
  try {
    const filter = buildAuditFilter(req.query);
    const { page, pageSize } = parsePagination(req.query);
    const [records, total] = await Promise.all([
      SecurityLog.find(filter)
        .select(SAFE_AUDIT_FIELDS)
        .sort({ timestamp: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      SecurityLog.countDocuments(filter)
    ]);

    return res.json({
      success: true,
      records,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error('Audit log query failed:', error?.name || 'unknown');
    return res.status(500).json({ success: false, message: 'Unable to load audit records.' });
  }
};

exports.exportAuditLogs = async (req, res) => {
  try {
    const filter = buildAuditFilter(req.query);
    const total = await SecurityLog.countDocuments(filter);
    if (total > MAX_EXPORT_ROWS) {
      return res.status(413).json({
        success: false,
        message: 'The filtered export is too large. Narrow the date range or filters and try again.'
      });
    }
    const records = await SecurityLog.find(filter)
      .select(SAFE_AUDIT_FIELDS)
      .sort({ timestamp: -1, _id: -1 })
      .limit(MAX_EXPORT_ROWS)
      .lean();
    const csv = serializeCsv(records);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="gymstat-audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(csv);
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error('Audit log export failed:', error?.name || 'unknown');
    return res.status(500).json({ success: false, message: 'Unable to export audit records.' });
  }
};
