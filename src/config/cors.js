const parseList = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const isProduction = process.env.NODE_ENV === 'production';
const configuredOrigins = parseList(process.env.CORS_ALLOWED_ORIGINS);
const allowedOrigins = isProduction
  ? configuredOrigins
  : [...configuredOrigins, ...parseList(process.env.FRONTEND_URL)];

if (isProduction) {
  if (allowedOrigins.length === 0) {
    throw new Error('CORS_ALLOWED_ORIGINS must contain exact trusted HTTPS frontend origins');
  }

  for (const origin of allowedOrigins) {
    let parsedOrigin;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw new Error('CORS_ALLOWED_ORIGINS must contain exact trusted HTTPS frontend origins');
    }

    if (origin === '*' || parsedOrigin.protocol !== 'https:' || parsedOrigin.origin !== origin) {
      throw new Error('CORS_ALLOWED_ORIGINS must contain exact trusted HTTPS frontend origins');
    }
  }
}

const trustedOrigins = [...new Set(allowedOrigins)];
const configuredMethods = parseList(process.env.CORS_ALLOWED_METHODS)
  .map((method) => method.toUpperCase());
const allowedMethods = configuredMethods.length
  ? configuredMethods
  : ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const allowedHeaders = parseList(process.env.CORS_ALLOWED_HEADERS);

if (isProduction && ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  .some((method) => !allowedMethods.includes(method))) {
  throw new Error('CORS_ALLOWED_METHODS must include GET, OPTIONS, and all state-changing API methods');
}

if (trustedOrigins.length === 0) {
  throw new Error('CORS_ALLOWED_ORIGINS must contain at least one trusted origin');
}

const corsOptions = {
  origin(origin, callback) {
    if (!origin || trustedOrigins.includes(origin)) {
      return callback(null, true);
    }

    const error = new Error('Origin is not allowed');
    error.code = 'CORS_NOT_ALLOWED';
    return callback(error);
  },
  methods: allowedMethods,
  allowedHeaders: [...new Set([...allowedHeaders, 'Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Portal-Role'])],
  exposedHeaders: ['X-CSRF-Token'],
  credentials: true,
  optionsSuccessStatus: 204
};

module.exports = { corsOptions };
