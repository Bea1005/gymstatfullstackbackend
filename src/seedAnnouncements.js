const mongoose = require('mongoose');
require('dotenv').config();
const Announcement = require('./models/Announcement');
const connectDB = require('./config/db');

const announcements = [
  {
    title: 'Team 1 Basketball Team Training',
    description: 'Regular team training session for basketball athletes',
    date: new Date('2026-01-23'),
    time: '8AM - 10AM',
    type: 'training',
    sport: 'Basketball',
    createdBy: null,
    isActive: true
  },
  {
    title: 'Intramural Requirements 2026',
    description: 'Important: Submit all required documents for intramural participation',
    date: new Date('2026-01-14'),
    time: 'All Day',
    type: 'requirement',
    sport: 'General',
    createdBy: null,
    isActive: true
  },
  {
    title: 'Volleyball Tournament Registration',
    description: 'Open registration for spring volleyball tournament',
    date: new Date('2026-02-10'),
    time: '3PM - 5PM',
    type: 'event',
    sport: 'Volleyball',
    createdBy: null,
    isActive: true
  },
  {
    title: 'Medical Check-up Session',
    description: 'All athletes must attend the mandatory medical check-up',
    date: new Date('2026-02-15'),
    time: '9AM - 12PM',
    type: 'requirement',
    sport: 'General',
    createdBy: null,
    isActive: true
  },
  {
    title: 'Track & Field Training',
    description: 'Spring season track and field training begins',
    date: new Date('2026-02-20'),
    time: '4PM - 6PM',
    type: 'training',
    sport: 'Track & Field',
    createdBy: null,
    isActive: true
  }
];

async function seedAnnouncements() {
  try {
    await connectDB();
    console.log('Connected to MongoDB');

    await Announcement.deleteMany({});
    console.log('Cleared existing announcements');

    const result = await Announcement.insertMany(announcements);
    console.log(`✅ Successfully seeded ${result.length} announcements`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding announcements:', error);
    process.exit(1);
  }
}

seedAnnouncements();
