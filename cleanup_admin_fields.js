require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');
const Admin = require('./src/models/Admin');

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.log('MONGO_URI not set');
    process.exit(1);
  }

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000,
    family: 4
  });

  const userResult = await User.updateMany({ role: 'admin' }, { $unset: { department: '', sport: '' } });
  const adminResult = await Admin.updateMany(
    { $or: [{ department: { $exists: true } }, { sport: { $exists: true } }] },
    { $unset: { department: '', sport: '' } }
  );

  console.log(JSON.stringify({
    usersUpdated: userResult.modifiedCount,
    adminsUpdated: adminResult.modifiedCount,
    status: 'cleanup_complete'
  }));

  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
