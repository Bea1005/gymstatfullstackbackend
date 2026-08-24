const bcrypt = require('bcryptjs');
const connectDB = require('./src/config/db');
const User = require('./src/models/User');
const jwt = require('jsonwebtoken');
(async () => {
  await connectDB();
  let user = await User.findOne({ id: 'ADMINTEST01' });
  if (!user) {
    const hashed = await bcrypt.hash('password123', 10);
    user = await User.create({ fullname: 'Admin Test', username: 'admintest', email: 'admintest@example.com', password: hashed, role: 'admin', id: 'ADMINTEST01' });
  }
  const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET || 'your_secret_key_here', { expiresIn: '7d' });

  const createRes = await fetch('http://localhost:4000/api/v1/admin/borrowing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ Name: 'API Check User', equipment: 'Basketball', quantity: 1, referenceIds: ['BSK-001'], referenceConditions: ['Good'] })
  });
  const createData = await createRes.json();
  console.log('CREATE_STATUS', createRes.status);
  console.log(JSON.stringify(createData));

  const listRes = await fetch('http://localhost:4000/api/v1/admin/borrowing', { headers: { Authorization: `Bearer ${token}` } });
  const listData = await listRes.json();
  console.log('LIST_STATUS', listRes.status);
  console.log(JSON.stringify(listData.slice(0, 3), null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
