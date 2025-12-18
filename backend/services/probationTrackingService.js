// backend/services/probationTrackingService.js
const User = require('../models/User');
const AttendanceLog = require('../models/AttendanceLog');
const LeaveRequest = require('../models/LeaveRequest');
const NewNotificationService = require('./NewNotificationService');

class ProbationTrackingService {
    /**
     * Calculate working days completed for a probation employee
     * @param {string} userId - Employee ID
     * @param {Date} startDate - Probation start date (joining date)
     * @returns {Object} - { workingDaysCompleted, totalDays, isCompleted }
     */
    static async calculateProbationProgress(userId, startDate) {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            // Calculate total days from joining date to today
            const totalDays = Math.floor((today - startDate) / (1000 * 60 * 60 * 24));
            
            // Get all attendance logs for the user
            const attendanceLogs = await AttendanceLog.find({
                user: userId,
                attendanceDate: { $gte: startDate.toISOString().split('T')[0] }
            }).lean();
            
            // Get all approved leave requests that overlap with probation period
            const leaveRequests = await LeaveRequest.find({
                employee: userId,
                status: 'Approved',
                $or: [
                    { leaveDates: { $elemMatch: { $gte: startDate } } },
                    { createdAt: { $gte: startDate } }
                ]
            }).lean();
            
            // Calculate working days (attendance days)
            let workingDaysCompleted = 0;
            const workingDaysSet = new Set();
            
            attendanceLogs.forEach(log => {
                if (log.clockInTime && log.clockOutTime) {
                    const logDate = new Date(log.attendanceDate);
                    if (logDate >= startDate && logDate <= today) {
                        workingDaysSet.add(log.attendanceDate);
                    }
                }
            });
            
            workingDaysCompleted = workingDaysSet.size;
            
            // Calculate leave days taken during probation
            let leaveDaysTaken = 0;
            leaveRequests.forEach(request => {
                request.leaveDates.forEach(leaveDate => {
                    const leaveDateObj = new Date(leaveDate);
                    if (leaveDateObj >= startDate && leaveDateObj <= today) {
                        const leaveTypeMultiplier = request.leaveType === 'Full Day' ? 1 : 0.5;
                        leaveDaysTaken += leaveTypeMultiplier;
                    }
                });
            });
            
            // Probation is considered complete after 180 working days (excluding leaves)
            const probationPeriodDays = 180;
            const isCompleted = workingDaysCompleted >= probationPeriodDays;
            
            return {
                workingDaysCompleted,
                totalDays,
                leaveDaysTaken,
                probationPeriodDays,
                isCompleted,
                remainingDays: Math.max(0, probationPeriodDays - workingDaysCompleted)
            };
        } catch (error) {
            console.error('Error calculating probation progress:', error);
            throw error;
        }
    }
    
    /**
     * Check if any probation employees have completed their probation
     * and send notifications to admins
     */
    static async checkProbationCompletions() {
        try {
            console.log('[ProbationTracking] Checking for completed probations...');
            
            // Find all employees on probation (legacy method - based on working days)
            const probationEmployees = await User.find({
                employmentStatus: 'Probation',
                isActive: true
            }).select('_id fullName employeeCode joiningDate email');
            
            console.log(`[ProbationTracking] Found ${probationEmployees.length} employees on probation (legacy)`);
            
            for (const employee of probationEmployees) {
                try {
                    const progress = await this.calculateProbationProgress(
                        employee._id, 
                        employee.joiningDate
                    );
                    
                    if (progress.isCompleted) {
                        console.log(`[ProbationTracking] Employee ${employee.fullName} has completed probation`);
                        
                        // Check if notification already exists for this employee
                        const existingNotification = await this.getExistingProbationNotification(employee._id);
                        
                        if (!existingNotification) {
                            await this.createProbationCompletionNotification(employee, progress);
                        }
                    }
                } catch (error) {
                    console.error(`[ProbationTracking] Error processing employee ${employee.fullName}:`, error);
                }
            }

            // NEW: Check date-based probation status updates
            await this.checkDateBasedProbationStatus();
        } catch (error) {
            console.error('[ProbationTracking] Error checking probation completions:', error);
        }
    }

    /**
     * Check and auto-update probation status based on probation end dates
     * This runs daily via cron job
     */
    static async checkDateBasedProbationStatus() {
        try {
            console.log('[ProbationTracking] Checking date-based probation status...');
            
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            // Find all employees with active probation that should end today or earlier
            const employeesToUpdate = await User.find({
                probationStatus: 'On Probation',
                probationEndDate: { $lte: today },
                isActive: true
            }).select('_id fullName employeeCode email probationEndDate probationStartDate conversionDate');
            
            console.log(`[ProbationTracking] Found ${employeesToUpdate.length} employees whose probation period has ended`);
            
            for (const employee of employeesToUpdate) {
                try {
                    // Auto-update to Permanent status
                    await User.findByIdAndUpdate(employee._id, {
                        probationStatus: 'Permanent',
                        employmentStatus: 'Permanent'
                    });
                    
                    console.log(`[ProbationTracking] Auto-updated ${employee.fullName} to Permanent status`);
                    
                    // Send notification to admins
                    await this.createProbationCompletionNotificationNew(employee);
                    
                    // Send notification to employee
                    await NewNotificationService.createAndEmitNotification({
                        message: `Congratulations! Your probation period has successfully completed. You are now a permanent employee.`,
                        type: 'success',
                        userId: employee._id,
                        userName: employee.fullName,
                        recipientType: 'user',
                        category: 'probation',
                        priority: 'high'
                    });
                    
                } catch (error) {
                    console.error(`[ProbationTracking] Error auto-updating employee ${employee.fullName}:`, error);
                }
            }
        } catch (error) {
            console.error('[ProbationTracking] Error checking date-based probation status:', error);
        }
    }

    /**
     * Create notification for probation completion (new date-based system)
     */
    static async createProbationCompletionNotificationNew(employee) {
        try {
            const notificationData = {
                message: `${employee.fullName} (${employee.employeeCode}) has completed their probation period and has been automatically promoted to permanent employee status.`,
                type: 'probation_completion',
                userId: null, // Will be set for each admin
                userName: 'System',
                recipientType: 'admin',
                category: 'probation',
                priority: 'medium',
                actionData: {
                    actionType: 'view_employee',
                    actionUrl: '/admin/employees',
                    actionParams: {
                        employeeId: employee._id,
                        employeeName: employee.fullName,
                        employeeCode: employee.employeeCode,
                        probationEndDate: employee.probationEndDate
                    },
                    requiresAction: false
                },
                navigationData: {
                    page: 'admin/employees',
                    params: { employeeId: employee._id }
                }
            };
            
            // Send to all admins
            await NewNotificationService.broadcastToAdmins(notificationData);
            
            console.log(`[ProbationTracking] Created probation completion notification for ${employee.fullName}`);
        } catch (error) {
            console.error('[ProbationTracking] Error creating probation completion notification:', error);
        }
    }
    
    /**
     * Create notification for probation completion
     */
    static async createProbationCompletionNotification(employee, progress) {
        try {
            const notificationData = {
                message: `${employee.fullName} (${employee.employeeCode}) has completed their probation period. Click to promote to permanent employee.`,
                type: 'probation_completion',
                userId: null, // Will be set for each admin
                userName: 'System',
                recipientType: 'admin',
                category: 'probation',
                priority: 'high',
                actionData: {
                    actionType: 'promote_employee',
                    actionUrl: '/admin/employees',
                    actionParams: {
                        employeeId: employee._id,
                        employeeName: employee.fullName,
                        employeeCode: employee.employeeCode,
                        workingDaysCompleted: progress.workingDaysCompleted,
                        leaveDaysTaken: progress.leaveDaysTaken
                    },
                    requiresAction: true
                },
                navigationData: {
                    page: 'admin/employees',
                    params: { employeeId: employee._id }
                }
            };
            
            // Send to all admins
            await NewNotificationService.broadcastToAdmins(notificationData);
            
            console.log(`[ProbationTracking] Created probation completion notification for ${employee.fullName}`);
        } catch (error) {
            console.error('[ProbationTracking] Error creating probation completion notification:', error);
        }
    }
    
    /**
     * Check if notification already exists for this employee
     */
    static async getExistingProbationNotification(employeeId) {
        try {
            const NewNotification = require('../models/NewNotification');
            return await NewNotification.findOne({
                type: 'probation_completion',
                'actionData.actionParams.employeeId': employeeId,
                archived: false
            });
        } catch (error) {
            console.error('[ProbationTracking] Error checking existing notification:', error);
            return null;
        }
    }
    
    /**
     * Promote employee to permanent status with leave allocation
     */
    static async promoteEmployeeToPermanent(employeeId, adminUserId) {
        try {
            const employee = await User.findById(employeeId);
            if (!employee) {
                throw new Error('Employee not found');
            }
            
            if (employee.employmentStatus !== 'Probation') {
                throw new Error('Employee is not on probation');
            }
            
            // Update employment status to Permanent
            employee.employmentStatus = 'Permanent';
            
            // Allocate standard leave balances for permanent employees
            employee.leaveBalances = {
                sick: 12,      // 12 sick leave days
                casual: 12,    // 12 casual leave days  
                paid: 0        // No planned leave initially
            };
            
            employee.leaveEntitlements = {
                sick: 12,
                casual: 12,
                paid: 0
            };
            
            await employee.save();
            
            // Create success notification for admin
            await NewNotificationService.createAndEmitNotification({
                message: `${employee.fullName} has been successfully promoted to permanent employee with leave allocations.`,
                type: 'success',
                userId: adminUserId,
                userName: 'System',
                recipientType: 'admin',
                category: 'probation',
                priority: 'medium'
            });
            
            // Create notification for the employee
            await NewNotificationService.createAndEmitNotification({
                message: `Congratulations! You have been promoted to permanent employee status. Your leave balances have been allocated.`,
                type: 'success',
                userId: employeeId,
                userName: employee.fullName,
                recipientType: 'user',
                category: 'probation',
                priority: 'high'
            });
            
            console.log(`[ProbationTracking] Successfully promoted ${employee.fullName} to permanent`);
            
            return {
                success: true,
                message: 'Employee promoted to permanent status successfully',
                employee: {
                    id: employee._id,
                    name: employee.fullName,
                    employeeCode: employee.employeeCode,
                    employmentStatus: employee.employmentStatus,
                    leaveBalances: employee.leaveBalances
                }
            };
        } catch (error) {
            console.error('[ProbationTracking] Error promoting employee:', error);
            throw error;
        }
    }
}

module.exports = ProbationTrackingService;
