require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 })
  .then(async () => {
    console.log('MongoDB connected OK');
    const User = require('./src/models/User');

    try {
      console.log('Testing User.findOne({ id: "23B1519" })...');
      const result = await User.findOne({ id: '23B1519' });
      console.log('findOne result:', result ? 'FOUND user' : 'null (not found - available)');
    } catch (err) {
      console.error('ERROR:', err.name);
      console.error('MSG:', err.message);
    }

    try {
      console.log('Testing User.hasRegisteredId("23B1519")...');
      const taken = await User.hasRegisteredId('23B1519');
      console.log('hasRegisteredId result:', taken);
    } catch (err) {
      console.error('hasRegisteredId ERROR:', err.name, err.message);
    }

    await mongoose.disconnect();
    process.exit(0);
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });