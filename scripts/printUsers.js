require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

const User = require('../src/models/User');

(async () => {
  try {
    const uri = process.env.MONGO_URI;
    if (!uri) {
      console.error('MONGO_URI not set in .env');
      process.exit(1);
    }
    await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    const users = await User.find().limit(10).lean();
    console.log('Found', users.length, 'users');
    users.forEach(u => {
      console.log({ id: u.id, username: u.username, fullname: u.fullname, role: u.role, email: u.email, department: u.department, dept: u.dept, sport: u.sport, sports: u.sports, sportParticipation: u.sportParticipation });
    });
    await mongoose.disconnect();
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
