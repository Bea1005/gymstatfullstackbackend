const ScheduleRequest = require('../models/ScheduleRequest');
const Schedule = require('../models/Schedule');
const mongoose = require('mongoose');

// Create a new schedule request
exports.createScheduleRequest = async (req, res) => {
  try {
    console.log('📝 PUBLIC: New schedule request submission');
    console.log('📝 Requester:', req.body.requesterName);
    console.log('📝 Event:', req.body.eventName);
    
    const requestData = {
      ...req.body,
      status: 'pending'
    };
    
    // Validate required fields
    const requiredFields = ['eventName', 'requesterName', 'requesterEmail', 'requesterPhone', 
                           'startDate', 'startTime', 'endDate', 'endTime'];
    const missingFields = requiredFields.filter(field => !req.body[field]);
    
    if (missingFields.length > 0) {
      console.log('❌ Missing required fields:', missingFields);
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missingFields.join(', ')}`
      });
    }
    
    const newRequest = new ScheduleRequest(requestData);
    await newRequest.save();
    
    console.log(`✅ Schedule request saved to MongoDB: ${newRequest._id}`);
    console.log(`📊 Event: ${newRequest.eventName} | Requester: ${newRequest.requesterName}`);
    
    res.status(201).json({
      success: true,
      message: 'Schedule request submitted successfully. Admin will review your request.',
      data: newRequest
    });
  } catch (error) {
    console.error('❌ Error creating schedule request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit schedule request',
      error: error.message
    });
  }
};

// Get all schedule requests
exports.getScheduleRequests = async (req, res) => {
  try {
    console.log('📋 ADMIN: Fetching schedule requests from MongoDB');
    
    const { status } = req.query;
    const filter = {};
    
    if (status) {
      filter.status = status;
    }
    
    const requests = await ScheduleRequest.find(filter)
      .sort({ createdAt: 1 }) // Ascending order (oldest first)
      .lean();
    
    console.log(`✅ Retrieved ${requests.length} schedule requests from MongoDB`);
    
    res.status(200).json({
      success: true,
      count: requests.length,
      data: requests
    });
  } catch (error) {
    console.error('❌ Error fetching schedule requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch schedule requests',
      error: error.message
    });
  }
};

// Get a single schedule request by ID
exports.getScheduleRequestById = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await ScheduleRequest.findById(id);
    
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Schedule request not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: request
    });
  } catch (error) {
    console.error('Error fetching schedule request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch schedule request',
      error: error.message
    });
  }
};

// Update schedule request status (approve/reject)
exports.updateScheduleRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejectionReason } = req.body;
    
    console.log(`📝 ADMIN: Updating schedule request ${id} to status: ${status}`);
    
    // Validate status
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value. Must be: pending, approved, or rejected'
      });
    }
    
    const request = await ScheduleRequest.findById(id);
    if (!request) {
      console.log(`❌ Schedule request ${id} not found`);
      return res.status(404).json({
        success: false,
        message: 'Schedule request not found'
      });
    }

    if (request.status !== 'pending') {
      return res.status(409).json({
        success: false,
        message: `Schedule request has already been ${request.status}`
      });
    }

    if (status === 'approved') {
      const existingSchedule = await Schedule.findOne({ fromRequest: request._id });
      if (existingSchedule) {
        return res.status(200).json({
          success: true,
          message: 'Schedule request was already approved',
          data: { request, schedule: existingSchedule }
        });
      }
    }

    const updateData = {
      status,
      reviewedAt: new Date(),
      updatedAt: new Date()
    };
    if (req.user && req.user._id) updateData.reviewedBy = req.user._id;
    if (status === 'rejected' && rejectionReason) updateData.rejectionReason = rejectionReason;
    
    console.log(`✅ Schedule request ${id} updated to ${status}`);
    
    // If approved, automatically create a schedule and sync to calendar
    if (status === 'approved') {
      try {
        console.log(`📅 Creating schedule from approved request ${id}`);
        
        const newSchedule = new Schedule({
          event: request.eventName,
          startDate: request.startDate,
          endDate: request.endDate,
          startTime: request.startTime,
          endTime: request.endTime,
          prepDays: request.prepDays || 0,
          organization: request.organization || '',
          purpose: request.purpose || '',
          details: request.details || '',
          status: 'active',
          fromRequest: request._id,
          createdBy: req.user ? req.user._id : null
        });
        
        await newSchedule.save();

        Object.assign(request, updateData);
        await request.save();
        
        console.log(`✅ Schedule created and saved to MongoDB: ${newSchedule._id}`);
        console.log(`✅ Schedule will be visible in both Admin and Public calendars`);
        
        return res.status(200).json({
          success: true,
          message: 'Schedule request approved and schedule created successfully',
          data: {
            request,
            schedule: newSchedule
          }
        });
      } catch (scheduleError) {
        console.error('❌ Error creating schedule from approved request:', scheduleError);
        return res.status(500).json({
          success: false,
          message: 'Schedule request could not be approved because calendar creation failed',
          error: scheduleError.message
        });
      }
    }

    Object.assign(request, updateData);
    await request.save();
    
    res.status(200).json({
      success: true,
      message: `Schedule request ${status} successfully`,
      data: request
    });
  } catch (error) {
    console.error('❌ Error updating schedule request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update schedule request',
      error: error.message
    });
  }
};

// Delete a schedule request
exports.deleteScheduleRequest = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({
        success: false,
        message: 'Schedule request not found'
      });
    }

    const deletedRequest = await ScheduleRequest.findOneAndDelete({
      _id: id,
      status: { $in: ['approved', 'rejected'] }
    });
    
    if (!deletedRequest) {
      return res.status(404).json({
        success: false,
        message: 'Schedule request not found'
      });
    }
    
    const deletedSchedule = deletedRequest.status === 'approved'
      ? await Schedule.findOneAndDelete({ fromRequest: deletedRequest._id })
      : null;

    res.status(200).json({
      success: true,
      message: 'Schedule request deleted successfully',
      data: {
        id: deletedRequest._id,
        scheduleDeleted: Boolean(deletedSchedule)
      }
    });
  } catch (error) {
    console.error('Error deleting schedule request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete schedule request',
      error: error.message
    });
  }
};

// Get schedule requests by status
exports.getRequestsByStatus = async (req, res) => {
  try {
    const { status } = req.params;
    
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status parameter'
      });
    }
    
    const requests = await ScheduleRequest.find({ status })
      .sort({ createdAt: 1 })
      .lean();
    
    res.status(200).json({
      success: true,
      count: requests.length,
      data: requests
    });
  } catch (error) {
    console.error('Error fetching requests by status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requests',
      error: error.message
    });
  }
};