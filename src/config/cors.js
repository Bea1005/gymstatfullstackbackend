const parseList = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = parseList(process.env.CORS_ALLOWED_ORIGINS);
const allowedMethods = parseList(process.env.CORS_ALLOWED_METHODS);
const allowedHeaders = parseList(process.env.CORS_ALLOWED_HEADERS);

if (allowedOrigins.length === 0) {
  throw new Error('CORS_ALLOWED_ORIGINS must contain at least one trusted origin');
}

if (isProduction && allowedOrigins.some((origin) => !origin.startsWith('https://'))) {
  throw new Error('Production CORS origins must use HTTPS');
}

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    const error = new Error('Origin is not allowed');
    error.code = 'CORS_NOT_ALLOWED';
    return callback(error);
  },
  methods: allowedMethods,
  allowedHeaders,
  credentials: false,
  optionsSuccessStatus: 204
};

module.exports = { corsOptions };
