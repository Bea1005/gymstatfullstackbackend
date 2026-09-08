const dns = require('dns');
const mongoose = require('mongoose');
const User = require('../models/User');

const connectDB = async () => {
  try {
    const uri = process.env.MONGO_URI;
    
    if (!uri) {
      throw new Error('❌ MONGO_URI not defined in .env file');
    }

    console.log('🔄 Connecting to MongoDB...');

    // Only override DNS when the environment explicitly requests it.
    // For Atlas SRV connections, the default resolver is usually more reliable than
    // forcing a specific set of DNS servers or IPv4-only lookups.
    if (uri.startsWith('mongodb+srv://')) {
      const dnsServers = process.env.MONGO_DNS_SERVERS
        ? process.env.MONGO_DNS_SERVERS.split(',').map(v => v.trim()).filter(Boolean)
        : [];

      if (dnsServers.length > 0) {
        dns.setServers(dnsServers);
        console.log('🌐 Custom DNS servers configured');
      }
    }

    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 60000,
      retryWrites: true,
      maxPoolSize: 10
    });

    console.log('✅ MongoDB connection established');

    await User.initializeCollections();
    
    return conn;
    
  } catch (error) {
    console.error('❌ MongoDB connection failed');
    
    if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
      console.error('💡 MongoDB DNS resolution failed');
    } else if (error.message.includes('authentication')) {
      console.error('💡 MongoDB authentication failed');
    } else if (error.message.includes('timeout')) {
      console.error('💡 MongoDB connection timed out');
    }
    
    throw error;
  }
};

// Handle connection events
mongoose.connection.on('connected', () => {
  console.log('✅ Mongoose connected to MongoDB');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ Mongoose connection error');
});

mongoose.connection.on('disconnected', () => {
  console.log('⚠️  Mongoose disconnected from MongoDB');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('👋 Mongoose connection closed due to app termination');
  process.exit(0);
});

module.exports = connectDB;
