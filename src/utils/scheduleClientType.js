const getScheduleClientType = (email) => {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const domainSeparator = normalizedEmail.lastIndexOf('@');
  if (domainSeparator < 0 || domainSeparator === normalizedEmail.length - 1) return null;

  return normalizedEmail.slice(domainSeparator + 1) === 'marsu.edu.ph'
    ? 'Internal Client'
    : 'External Client';
};

module.exports = { getScheduleClientType };
