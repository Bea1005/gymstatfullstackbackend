const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const getJWTSecret = () => {
  const secret = process.env.JWT_SECRET;

  if (typeof secret !== 'string' || secret.trim() === '') {
    throw new Error('JWT_SECRET environment variable is required');
  }

  return secret;
};

module.exports = { getJWTSecret };
