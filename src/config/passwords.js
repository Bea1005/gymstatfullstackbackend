const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const BCRYPT_COST = 12;
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$/;

const hashPassword = (password) => {
  return bcrypt.hash(password, BCRYPT_COST);
};

const isBcryptHash = (value) => (
  typeof value === 'string' && BCRYPT_HASH_PATTERN.test(value)
);

const safeLegacyPasswordMatch = (password, storedPassword) => {
  const passwordBuffer = Buffer.from(String(password), 'utf8');
  const storedBuffer = Buffer.from(storedPassword, 'utf8');

  if (passwordBuffer.length !== storedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(passwordBuffer, storedBuffer);
};

const verifyPassword = async (password, storedPassword) => {
  if (isBcryptHash(storedPassword)) {
    const valid = await bcrypt.compare(password, storedPassword);
    return {
      valid,
      needsRehash: valid && bcrypt.getRounds(storedPassword) < BCRYPT_COST
    };
  }

  if (typeof storedPassword !== 'string' || storedPassword.length === 0) {
    return { valid: false, needsRehash: false };
  }

  try {
    if (await bcrypt.compare(password, storedPassword)) {
      return { valid: true, needsRehash: true };
    }
  } catch {
    // Legacy plaintext values are not valid bcrypt hashes.
  }

  return {
    valid: safeLegacyPasswordMatch(password, storedPassword),
    needsRehash: true
  };
};

module.exports = {
  BCRYPT_COST,
  hashPassword,
  verifyPassword
};
