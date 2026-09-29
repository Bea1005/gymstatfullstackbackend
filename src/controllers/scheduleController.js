const Schedule = require('../models/Schedule');
const { findScheduleConflict } = require('../utils/scheduleConflicts');
const { acquireScheduleConflictLock } = require('../utils/withScheduleConflictLock');

const isValidCalendarDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

// Create a new schedule
exports.createSchedule = async (req, res) => {
  let releaseLock;
  try {
    console.log('📅 ADMIN: Creating new schedule');
    console.log('📅 Event:', req.body.event);
    
    // Add creator if user is authenticated
    const scheduleData = {
      ...req.body,
      createdBy: req.user ? req.user._id : null
    };

    releaseLock = await acquireScheduleConflictLock();
    const conflict = await findScheduleConflict(Schedule, scheduleData);
    if (conflict) {
      return res.status(409).json({
        success: false,
        message: 'The requested time range overlaps an existing active schedule.'
      });
    }
    
    const newSchedule = new Schedule(scheduleData);
    await newSchedule.save();
    
    console.log(`✅ Schedule saved to MongoDB: ${newSchedule._id}`);
    console.log(`✅ Schedule will be visible in both Admin and Public calendars`);
    
    res.status(201).json({
      success: true,
      message: 'Schedule created successfully',
      data: newSchedule
    });
  } catch (error) {
    console.error('❌ Error creating schedule:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode === 503
        ? error.message
        : 'An unexpected server error occurred. Please try again.'
    });
  } finally {
    if (releaseLock) await releaseLock();
  }
};

// Get all schedules
exports.getSchedules = async (req, res) => {
  try {
    console.log('📅 Fetching schedules from MongoDB');
    
    const { status, startDate, endDate } = req.query;
    const filter = {};
    
    if (status) {
      filter.status = status;
    }
    
    if (startDate && endDate) {
      filter.startDate = { $gte: startDate, $lte: endDate };
    } else if (startDate) {
      filter.startDate = { $gte: startDate };
    } else if (endDate) {
      filter.endDate = { $lte: endDate };
    }
    
    const schedules = await Schedule.find(filter)
      .sort({ startDate: 1, startTime: 1 })
      .lean();
    
    console.log(`✅ Retrieved ${schedules.length} schedules from MongoDB`);
    
    res.status(200).json({
      success: true,
      count: schedules.length,
      data: schedules
    });
  } catch (error) {
    console.error('❌ Error fetching schedules:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch schedules',
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
};

// Get a single schedule by ID
exports.getScheduleById = async (req, res) => {
  try {
    const { id } = req.params;
    const schedule = await Schedule.findById(id);
    
    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: 'Schedule not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: schedule
    });
  } catch (error) {
    console.error('Error fetching schedule:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch schedule',
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
};

// Update a schedule
exports.updateSchedule = async (req, res) => {
  let releaseLock;
  try {
    const { id } = req.params;
    releaseLock = await acquireScheduleConflictLock();

    const currentSchedule = await Schedule.findById(id);
    if (!currentSchedule) {
      return res.status(404).json({
        success: false,
        message: 'Schedule not found'
      });
    }

    const currentData = typeof currentSchedule.toObject === 'function'
      ? currentSchedule.toObject()
      : currentSchedule;
    const scheduleData = { ...currentData, ...req.body };

    if (scheduleData.status === 'active') {
      const conflict = await findScheduleConflict(Schedule, scheduleData, id);
      if (conflict) {
        return res.status(409).json({
          success: false,
          message: 'The requested time range overlaps an existing active schedule.'
        });
      }
    }

    const updatedSchedule = await Schedule.findByIdAndUpdate(
      id,
      { ...req.body, updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    
    if (!updatedSchedule) {
      return res.status(404).json({
        success: false,
        message: 'Schedule not found'
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Schedule updated successfully',
      data: updatedSchedule
    });
  } catch (error) {
    console.error('Error updating schedule:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode === 503
        ? error.message
        : 'An unexpected server error occurred. Please try again.'
    });
  } finally {
    if (releaseLock) await releaseLock();
  }
};

// Delete a schedule
exports.deleteSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedSchedule = await Schedule.findByIdAndDelete(id);
    
    if (!deletedSchedule) {
      return res.status(404).json({
        success: false,
        message: 'Schedule not found'
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Schedule deleted successfully',
      data: deletedSchedule
    });
  } catch (error) {
    console.error('Error deleting schedule:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete schedule',
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
};

// Get schedules for a specific date range
exports.getSchedulesByDateRange = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!isValidCalendarDate(startDate) || !isValidCalendarDate(endDate) || startDate > endDate) {
      return res.status(400).json({
        success: false,
        message: 'A valid start date and end date are required'
      });
    }

    const rangeStart = new Date(`${startDate}T00:00:00.000Z`);
    const rangeEnd = new Date(`${endDate}T00:00:00.000Z`);
    const schedules = await Schedule.find({
      status: 'active',
      $or: [
        { startDate: { $lte: endDate }, endDate: { $gte: startDate } },
        {
          startDate: { $gt: endDate },
          prepDays: { $gt: 0 },
          $expr: {
            $lte: [
              {
                $subtract: [
                  { $dateFromString: { dateString: '$startDate', onError: null, onNull: null } },
                  { $multiply: [{ $ifNull: ['$prepDays', 0] }, 86400000] }
                ]
              },
              { $dateFromString: { dateString: endDate } }
            ]
          }
        }
      ]
    })
      .select('_id event startDate endDate startTime endTime prepDays status fromRequest')
      .sort({ startDate: 1, startTime: 1 })
      .lean();

    const calendarSchedules = schedules.filter((schedule) => {
      const scheduleStart = new Date(`${schedule.startDate}T00:00:00.000Z`);
      const scheduleEnd = new Date(`${schedule.endDate}T00:00:00.000Z`);
      if (Number.isNaN(scheduleStart.getTime()) || Number.isNaN(scheduleEnd.getTime())) return false;
      const prepStart = new Date(scheduleStart);
      prepStart.setUTCDate(prepStart.getUTCDate() - (Number(schedule.prepDays) || 0));
      return scheduleEnd >= rangeStart && prepStart <= rangeEnd;
    });
    
    res.status(200).json({
      success: true,
      count: calendarSchedules.length,
      data: calendarSchedules
    });
  } catch (error) {
    console.error('Error fetching schedules by date range:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch schedules',
      message: 'An unexpected server error occurred. Please try again.'
    });
  }
};