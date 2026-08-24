require('dotenv').config();
const jwt = require('jsonwebtoken');
const connectDB = require('./src/config/db');
const User = require('./src/models/User');
const http = require('http');
(async () => {
  await connectDB();
  const screener = await User.findOne({ role: 'screener' }).lean();
  if (!screener) throw new Error('No screener found');
  const secret = process.env.JWT_SECRET || 'your_super_secret_key_change_this_in_production';
  const token = jwt.sign({ id: screener._id.toString(), role: screener.role }, secret, { expiresIn: '7d' });
  console.log('token', token);
  const fs = require('fs');
  const PORT_FILE = require('path').join(__dirname, '.port');
  let targetPort = process.env.PORT || 4000;
  try {
    if (fs.existsSync(PORT_FILE)) {
      targetPort = Number(fs.readFileSync(PORT_FILE, 'utf8').trim()) || targetPort;
    }
  } catch (err) {
    console.warn('Could not read .port file, falling back to default port', err.message);
  }

  const options = {
    hostname: '127.0.0.1',
    port: targetPort,
    path: '/api/v1/screener/requirements',
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`
    }
  };
  const req = http.request(options, res => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log('status', res.statusCode);
      console.log(body);
    });
  });
  req.on('error', err => console.error('req err', err));
  req.end();
})();
