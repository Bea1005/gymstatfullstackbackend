const connectDB = require('../src/config/db');
const User = require('../src/models/User');
const jwt = require('jsonwebtoken');
const { getJWTSecret } = require('../src/config/security');

(async () => {
  try {
    await connectDB();
    const coach = await User.findOne({ role: 'coach' }).lean();
    if (!coach) {
      console.error('No coach user found in DB');
      process.exit(1);
    }
    const payload = { id: coach._id.toString(), role: 'coach' };
    const token = jwt.sign(payload, getJWTSecret(), { expiresIn: '7d' });
    console.log('FOUND COACH:', { id: coach._id.toString(), username: coach.username, fullname: coach.fullname });
    console.log('\nTOKEN:\n' + token);
    process.exit(0);
  } catch (err) {
    console.error('Error generating token:', err);
    process.exit(2);
  }
})();
