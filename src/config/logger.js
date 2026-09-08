const LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };
const configuredLevel = String(process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'INFO' : 'DEBUG')).toUpperCase();
const threshold = LEVELS[configuredLevel] || LEVELS.INFO;

const sanitize = (value) => {
  if (value instanceof Error) {
    return { name: value.name, code: value.code };
  }

  if (typeof value === 'string') {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
      .replace(/(password|passwd|secret|token|authorization|cookie)\s*[:=]\s*[^\s,}]+/gi, '$1=[REDACTED]')
      .replace(/([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/g, '[REDACTED_EMAIL]');
  }

  if (Array.isArray(value)) {
    return value.map(sanitize);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
      const sensitive = /password|secret|token|authorization|cookie|session/i.test(key);
      return [key, sensitive ? '[REDACTED]' : sanitize(entry)];
    }));
  }

  return value;
};

const write = (level, values) => {
  if (LEVELS[level] < threshold) {
    return;
  }

  const safeValues = values.map(sanitize);
  if (process.env.NODE_ENV === 'production' && level === 'ERROR') {
    const label = String(safeValues[0] || 'Internal server error').split(':')[0].slice(0, 100);
    return process.stderr.write(`[ERROR] ${label}\n`);
  }

  const output = safeValues.map((value) => (
    typeof value === 'object' ? JSON.stringify(value) : String(value)
  )).join(' ');
  process.stderr.write(`[${level}] ${output}\n`);
};

const installSafeConsole = () => {
  console.log = (...values) => write('DEBUG', values);
  console.info = (...values) => write('INFO', values);
  console.warn = (...values) => write('WARN', values);
  console.error = (...values) => write('ERROR', values);
};

module.exports = { installSafeConsole, logger: {
  debug: (...values) => write('DEBUG', values),
  info: (...values) => write('INFO', values),
  warn: (...values) => write('WARN', values),
  error: (...values) => write('ERROR', values)
} };
