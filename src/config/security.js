const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const getJWTSecret = () => {
  const secret = process.env.JWT_SECRET;

  if (typeof secret !== 'string' || secret.trim().length < 32) {
    throw new Error('JWT_SECRET environment variable must be at least 32 characters');
  }

  return secret;
};

module.exports = { getJWTSecret };
