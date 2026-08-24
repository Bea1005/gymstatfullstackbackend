require('dotenv').config();
const express = require('express');
const http = require('http');
const jwt = require('jsonwebtoken');
const connectDB = require('./src/config/db');
const User = require('./src/models/User');
const { protect, authorize } = require('./src/middleware/auth');
(async () => {
  await connectDB();
  const screener = await User.findOne({ role: 'screener' }).lean();
  if (!screener) throw new Error('No screener found');
  const secret = process.env.JWT_SECRET || 'your_super_secret_key_change_this_in_production';
  const token = jwt.sign({ id: screener._id.toString(), role: screener.role }, secret, { expiresIn: '7d' });
  const app = express();
  app.use(express.json());
  app.get('/test', protect, authorize('screener','admin'), (req,res) => {
    res.json({ ok:true, role:req.user.role, userRole:req.user.userRole, id:req.user.id });
  });
  const server = app.listen(0, '127.0.0.1', async () => {
    const port = server.address().port;
    const options = {
      hostname: '127.0.0.1',
      port,
      path: '/test',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`
      }
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        console.log('status', res.statusCode);
        console.log('body', body);
        server.close(() => process.exit(0));
      });
    });
    req.on('error', (err) => {
      console.error('req err', err);
      server.close(() => process.exit(1));
    });
    req.end();
  });
})();
