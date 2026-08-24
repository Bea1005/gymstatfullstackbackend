const Schedule = require('../models/Schedule');

// Create a new schedule
exports.createSchedule = async (req, res) => {
  try {
    console.log('📅 ADMIN: Creating new schedule');
    console.log('📅 Event:', req.body.event);
    
    // Add creator if user is authenticated
    const scheduleData = {
      ...req.body,
      createdBy: req.user ? req.user._id : null
    };
    
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
    res.status(500).json({
      success: false,
      message: 'Failed to create schedule',
      error: error.message
    });
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
      error: error.message
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
      error: error.message
    });
  }
};

// Update a schedule
exports.updateSchedule = async (req, res) => {
  try {
    const { id } = req.params;
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
    res.status(500).json({
      success: false,
      message: 'Failed to update schedule',
      error: error.message
    });
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
      error: error.message
    });
  }
};

// Get schedules for a specific date range
exports.getSchedulesByDateRange = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date and end date are required'
      });
    }
    
    const schedules = await Schedule.find({
      $or: [
        { startDate: { $gte: startDate, $lte: endDate } },
        { endDate: { $gte: startDate, $lte: endDate } },
        { startDate: { $lte: startDate }, endDate: { $gte: endDate } }
      ],
      status: 'active'
    }).sort({ startDate: 1, startTime: 1 });
    
    res.status(200).json({
      success: true,
      count: schedules.length,
      data: schedules
    });
  } catch (error) {
    console.error('Error fetching schedules by date range:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch schedules',
      error: error.message
    });
  }
};