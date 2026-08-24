const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const User = require('../models/User');
const Equipment = require('../models/Equipment');
const Borrowing = require('../models/Borrowing');
const ScheduleRequest = require('../models/ScheduleRequest');
const Schedule = require('../models/Schedule');
const { protect, authorize } = require('../middleware/auth');

// @desc    Get admin dashboard stats
// @route   GET /api/v1/admin/dashboard
// @access  Private/Admin
router.get('/admin/dashboard', protect, authorize('admin'), async (req, res) => {
  try {
    // Users
    const totalUsers = await User.countDocuments();
    const totalAthletes = await User.countDocuments({ role: 'student' });
    const totalCoaches = await User.countDocuments({ role: 'coach' });

    // Equipments
    const totalEquipments = await Equipment.countDocuments();

    // Borrowed items: count borrowings that are currently out (statuses indicating active loan)
    // Use case-insensitive matching to be resilient to status casing/variants in DB
    const borrowedStatuses = ['Out Now', 'Out', 'Overdue', 'Borrowed', 'Checked Out'];
    const borrowedItems = await Borrowing.countDocuments({
      $or: [
        { status: { $in: borrowedStatuses } },
        { status: { $regex: /(out now|out|overdue|borrowed|checked out)/i } }
      ]
    });

    // Pending gymnasium schedule requests (case-insensitive match)
    const pendingRequirements = await ScheduleRequest.countDocuments({ status: { $regex: /^pending$/i } });

    // Recent activities (derive from latest users)
    const recentUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select('fullname role createdAt');

    const activities = recentUsers.map(user => ({
      id: `user-${user._id}`,
      action: `New ${user.role} registered: ${user.fullname}`,
      time: getTimeAgo(user.createdAt)
    }));

    // Upcoming schedules: get active upcoming schedules from MongoDB
    const today = new Date().toISOString().split('T')[0];
    let upcomingSchedules = [];
    try {
      upcomingSchedules = await Schedule.find({
        status: { $regex: /^active$/i },
        $or: [
          { startDate: { $gte: today } },
          { endDate: { $gte: today } }
        ]
      })
        .sort({ startDate: 1, startTime: 1 })
        .limit(10)
        .lean();
    } catch (scheduleError) {
      console.warn('Failed to fetch upcoming schedules for dashboard:', scheduleError.message || scheduleError);
      upcomingSchedules = [];
    }

    // Return top-level keys so frontend can read data.totalUsers etc.
    res.json({
      totalUsers,
      totalAthletes,
      totalCoaches,
      totalEquipments,
      borrowedItems,
      pendingRequirements,
      activities: activities.slice(0, 5),
      upcomingSchedules
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Helper function to get time ago
function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + ' years ago';
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + ' months ago';
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + ' days ago';
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + ' hours ago';
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + ' minutes ago';
  return Math.floor(seconds) + ' seconds ago';
}

const findUserByIdentifier = async (identifier) => {
  const query = mongoose.Types.ObjectId.isValid(identifier)
    ? { $or: [{ id: identifier }, { _id: identifier }] }
    : { id: identifier };
  return User.findOne(query);
};

const sanitizeUserForAdminResponse = (user) => {
  const userObject = user?.toObject ? user.toObject() : user;
  const role = String(userObject?.role || '').trim().toLowerCase();

  if (role === 'admin') {
    return {
      _id: userObject._id,
      fullname: userObject.fullname,
      username: userObject.username,
      email: userObject.email || '',
      role,
      id: userObject.id
    };
  }

  const response = { ...userObject };

  if (response?.password !== undefined) {
    delete response.password;
  }

  delete response.department;
  delete response.sport;

  return response;
};

// NOTE: User management endpoints are centralized in `userRoutes` (mounted at `${BASE_URI}/users`).
// The admin dashboard and other admin-only endpoints remain in this file.

module.exports = router;