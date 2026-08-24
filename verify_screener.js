require('dotenv').config();
const https = require('https');
const http = require('http');
const jwt = require('jsonwebtoken');
const connectDB = require('./src/config/db');
const User = require('./src/models/User');
const StudentRequirement = require('./src/models/StudentRequirement');
(async () => {
  try {
    await connectDB();
    const screener = await User.findOne({ role: 'screener' }).lean();
    console.log('screener', screener ? { id: screener.id, _id: screener._id.toString(), role: screener.role } : null);
    if (!screener) return process.exit(0);
    const secret = process.env.JWT_SECRET || 'your_super_secret_key_change_this_in_production';
    const token = jwt.sign({ id: screener._id.toString(), role: screener.role }, secret, { expiresIn: '7d' });
    console.log('token', token);
    const options = {
      hostname: '127.0.0.1',
      port: 4000,
      path: '/api/v1/screener/requirements',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        console.log('statusCode', res.statusCode);
        console.log('headers', res.headers);
        try { console.log('body', JSON.parse(body)); } catch (e) { console.log('body', body); }
        process.exit(0);
      });
    });
    req.on('error', (err) => {
      console.error('request error', err);
      process.exit(1);
    });
    req.end();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
