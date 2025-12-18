// backend/routes/employees.js
const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();

// --- Middleware ---
const authenticateToken = require('../middleware/authenticateToken');

// --- Models ---
const User = require('../models/User');
const Setting = require('../models/Setting');

// --- Services ---
const { sendEmail } = require('../services/mailService');

const SALT_ROUNDS = 10;

const isAdminOrHr = (req, res, next) => {
    if (!['Admin', 'HR'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Access forbidden: Requires Admin or HR role.' });
    }
    next();
};

// Function to send employment status change notifications
const sendEmploymentStatusChangeNotification = async (employee, oldStatus, newStatus) => {
    try {
        // Get hiring email recipients
        let recipients = null;
        
        const hiringEmailSetting = await Setting.findOne({ key: 'hiringNotificationEmails' });
        if (hiringEmailSetting && Array.isArray(hiringEmailSetting.value) && hiringEmailSetting.value.length > 0) {
            recipients = hiringEmailSetting.value.join(',');
        } else {
            // Fallback to general HR emails if hiring emails not configured
            const hrEmailSetting = await Setting.findOne({ key: 'hrNotificationEmails' });
            if (hrEmailSetting && Array.isArray(hrEmailSetting.value) && hrEmailSetting.value.length > 0) {
                recipients = hrEmailSetting.value.join(',');
            }
        }

        if (!recipients) {
            console.log('[Employment Status] No hiring/HR email recipients configured. Skipping notification.');
            return;
        }

        const subject = `Employment Status Update: ${employee.fullName} - ${oldStatus} to ${newStatus}`;
        const html = `
            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <h2 style="color: #D32F2F;">Employment Status Update</h2>
                <p>This is a notification that an employee's employment status has been updated:</p>
                <ul>
                    <li><strong>Employee Name:</strong> ${employee.fullName}</li>
                    <li><strong>Employee Code:</strong> ${employee.employeeCode}</li>
                    <li><strong>Previous Status:</strong> ${oldStatus}</li>
                    <li><strong>New Status:</strong> ${newStatus}</li>
                    <li><strong>Updated On:</strong> ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</li>
                </ul>
                <p>Please review this change in the admin panel and take any necessary actions.</p>
                <p style="font-size: 0.9em; color: #777;">This is an automated message from the Attendance Management System.</p>
            </div>
        `;
        
        await sendEmail({ to: recipients, subject, html, isHREmail: true });
        console.log(`[Employment Status] Notification sent for ${employee.fullName}'s status change from ${oldStatus} to ${newStatus}`);
    } catch (error) {
        console.error(`[Employment Status] Failed to send notification for ${employee.fullName}:`, error);
    }
};

// GET /api/admin/employees
router.get('/', [authenticateToken, isAdminOrHr], async (req, res) => {
    try {
        const getAllEmployees = req.query.all === 'true';
        
        // --- START OF FIX: Ensure leave balances are always included ---
        // Both `all=true` and paginated requests now include these critical fields.
        const fieldsToSelect = '_id fullName employeeCode alternateSaturdayPolicy shiftGroup department email leaveBalances leaveEntitlements isActive role joiningDate profileImageUrl';

        if (getAllEmployees) {
            const employees = await User.find({})
                .select(fieldsToSelect)
                .populate('shiftGroup', 'shiftName startTime endTime durationHours paidBreakMinutes')
                .sort({ fullName: 1 })
                .lean();
            return res.json(employees);
        }
        
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        
        const totalCount = await User.countDocuments({});
        // Use the same `fieldsToSelect` for the paginated query
        const employees = await User.find({})
            .select(fieldsToSelect) // Added select here as well for consistency
            .populate('shiftGroup')
            .sort({ fullName: 1 })
            .skip(skip)
            .limit(limit)
            .lean();
            
        res.json({
            employees,
            totalCount,
            currentPage: page,
            totalPages: Math.ceil(totalCount / limit)
        });
        // --- END OF FIX ---
    } catch (error) {
        console.error('Failed to fetch employees:', error);
        res.status(500).json({ error: 'Failed to fetch employees' });
    }
});

// POST /api/admin/employees
router.post('/', [authenticateToken, isAdminOrHr], async (req, res) => {
    const { 
        employeeCode, fullName, email, password, role, domain, designation, 
        department, joiningDate, shiftGroup, alternateSaturdayPolicy,
        employmentStatus, leaveBalances, internshipDurationMonths, workingDays
    } = req.body;
    if (!employeeCode || !fullName || !email || !password) {
        return res.status(400).json({ error: 'Employee Code, Name, Email, and Password are required.' });
    }
    try {
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        
        // IMPORTANT: Save email exactly as typed by admin (trim whitespace only, no normalization)
        // Email normalization is only applied in SSO authentication flow, not for admin-created users
        const emailToSave = email.trim();
        
        const newUser = new User({ 
            employeeCode, 
            fullName, 
            email: emailToSave, // Save exactly as typed
            passwordHash, 
            role, 
            domain,
            designation, 
            department, 
            joiningDate, 
            shiftGroup: shiftGroup || null,
            alternateSaturdayPolicy,
            employmentStatus,
            leaveBalances,
            internshipDurationMonths: employmentStatus === 'Intern' ? internshipDurationMonths : null,
            workingDays
        });
        await newUser.save();
        res.status(201).json({ message: 'Employee created successfully!' });
    } catch (error) {
        if (error.code === 11000) { return res.status(409).json({ error: 'Employee with this email or code already exists.' });}
        console.error('Create Employee Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/admin/employees/:id
router.put('/:id', [authenticateToken, isAdminOrHr], async (req, res) => {
    const { id } = req.params;
    const { 
        employeeCode, fullName, email, role, domain, designation, department, 
        joiningDate, shiftGroup, isActive, alternateSaturdayPolicy,
        employmentStatus, leaveBalances, internshipDurationMonths, workingDays,
        password
    } = req.body;
    
    // IMPORTANT: Save email exactly as typed by admin (trim whitespace only, no normalization)
    // Email normalization is only applied in SSO authentication flow, not for admin-edited users
    const emailToSave = email ? email.trim() : undefined;
    
    const updateData = { 
        employeeCode, fullName, email: emailToSave, role, domain, designation, department, 
        joiningDate, shiftGroup: shiftGroup || null, isActive, alternateSaturdayPolicy,
        employmentStatus, leaveBalances,
        internshipDurationMonths: employmentStatus === 'Intern' ? internshipDurationMonths : null,
        workingDays
    };

    try {
        const currentEmployee = await User.findById(id);
        if (!currentEmployee) {
            return res.status(404).json({ error: 'Employee not found.' });
        }

        if (password && password.trim() !== '') {
            updateData.passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        }

        const result = await User.findByIdAndUpdate(id, updateData, { new: true });
        if (!result) { return res.status(404).json({ error: 'Employee not found.' });}

        if (currentEmployee.employmentStatus !== employmentStatus) {
            sendEmploymentStatusChangeNotification(result, currentEmployee.employmentStatus, employmentStatus)
                .catch(err => console.error('Error sending employment status change notification:', err));
            
            // Emit Socket.IO event to notify the employee about employment status change
            try {
                const { getIO } = require('../socketManager');
                const io = getIO();
                if (io) {
                    io.emit('employment_status_updated', {
                        userId: result._id,
                        employeeCode: result.employeeCode,
                        fullName: result.fullName,
                        oldStatus: currentEmployee.employmentStatus,
                        newStatus: employmentStatus,
                        updatedBy: req.user.userId,
                        timestamp: new Date().toISOString(),
                        message: `Your employment status has been updated from ${currentEmployee.employmentStatus} to ${employmentStatus}`
                    });
                    console.log(`📡 Emitted employment_status_updated event for user ${result._id}`);
                }
            } catch (socketError) {
                console.error('Failed to emit Socket.IO event:', socketError);
            }
        }

        res.json({ message: 'Employee updated successfully.' });
    } catch (error) {
        if (error.code === 11000) { return res.status(409).json({ error: 'Employee with this email or code already exists.' });}
        console.error('Update Employee Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// PATCH /api/admin/employees/:id/shift
router.patch('/:id/shift', [authenticateToken, isAdminOrHr], async (req, res) => {
    const { id } = req.params;
    const { shiftGroup } = req.body;

    if (shiftGroup === undefined) { 
        return res.status(400).json({ error: 'shiftGroup property is required.' }); 
    }
    
    try {
        const result = await User.findByIdAndUpdate(id, { shiftGroup: shiftGroup || null });
        if (!result) { return res.status(404).json({ error: 'Employee not found.' }); }
        res.json({ message: 'Employee shift updated successfully.' });
    } catch (error) {
        console.error("Error updating employee shift:", error);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// PATCH /api/admin/employees/:id/saturday-policy
router.patch('/:id/saturday-policy', [authenticateToken, isAdminOrHr], async (req, res) => {
    const { id } = req.params;
    const { newPolicy } = req.body;

    const validPolicies = ['Week 1 & 3 Off', 'Week 2 & 4 Off', 'All Saturdays Working', 'All Saturdays Off'];
    if (!newPolicy || !validPolicies.includes(newPolicy)) {
        return res.status(400).json({ error: 'A valid new policy is required.' });
    }

    try {
        const updatedUser = await User.findByIdAndUpdate(
            id,
            { alternateSaturdayPolicy: newPolicy },
            { new: true }
        ).select('fullName employeeCode alternateSaturdayPolicy');

        if (!updatedUser) {
            return res.status(404).json({ error: 'Employee not found.' });
        }

        res.json({ message: `${updatedUser.fullName}'s Saturday policy updated successfully.`, user: updatedUser });
    } catch (error) {
        console.error("Error updating Saturday policy:", error);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// DELETE /api/admin/employees/:id
router.delete('/:id', [authenticateToken, isAdminOrHr], async (req, res) => {
    const { id } = req.params;
    try {
        const result = await User.findByIdAndDelete(id);
        if (!result) { return res.status(404).json({ error: 'Employee not found.' }); }
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting employee:', error);
        res.status(500).json({ error: 'Failed to delete employee.' });
    }
});

// POST /api/admin/employees/:id/probation-settings
router.post('/:id/probation-settings', [authenticateToken, isAdminOrHr], async (req, res) => {
    const { id } = req.params;
    const { 
        employeeType, 
        probationStatus, 
        conversionDate, 
        probationDurationMonths 
    } = req.body;

    try {
        const employee = await User.findById(id);
        if (!employee) {
            return res.status(404).json({ error: 'Employee not found.' });
        }

        const updateData = {};
        
        // Update employee type
        if (employeeType) {
            updateData.employeeType = employeeType;
        }

        // Update probation status
        if (probationStatus) {
            updateData.probationStatus = probationStatus;
        }

        // Handle conversion from Intern to On-Role
        if (conversionDate && probationDurationMonths) {
            const convDate = new Date(conversionDate);
            updateData.conversionDate = convDate;
            updateData.probationStartDate = convDate;
            updateData.probationDurationMonths = probationDurationMonths;
            
            // Calculate probation end date
            const endDate = new Date(convDate);
            endDate.setMonth(endDate.getMonth() + parseInt(probationDurationMonths));
            updateData.probationEndDate = endDate;
            
            // Set probation status to 'On Probation' when converting
            if (employeeType === 'On-Role' && !probationStatus) {
                updateData.probationStatus = 'On Probation';
            }
        }

        const updatedEmployee = await User.findByIdAndUpdate(
            id,
            updateData,
            { new: true }
        ).select('fullName employeeCode employeeType probationStatus probationStartDate probationEndDate probationDurationMonths conversionDate');

        // Send notification email about probation settings update
        try {
            const hiringEmailSetting = await Setting.findOne({ key: 'hiringNotificationEmails' });
            let recipients = null;
            
            if (hiringEmailSetting && Array.isArray(hiringEmailSetting.value) && hiringEmailSetting.value.length > 0) {
                recipients = hiringEmailSetting.value.join(',');
            } else {
                const hrEmailSetting = await Setting.findOne({ key: 'hrNotificationEmails' });
                if (hrEmailSetting && Array.isArray(hrEmailSetting.value) && hrEmailSetting.value.length > 0) {
                    recipients = hrEmailSetting.value.join(',');
                }
            }

            if (recipients) {
                const subject = `Probation Settings Updated: ${updatedEmployee.fullName}`;
                const html = `
                    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                        <h2 style="color: #D32F2F;">Probation Settings Update</h2>
                        <p>Probation settings have been updated for an employee:</p>
                        <ul>
                            <li><strong>Employee Name:</strong> ${updatedEmployee.fullName}</li>
                            <li><strong>Employee Code:</strong> ${updatedEmployee.employeeCode}</li>
                            <li><strong>Employee Type:</strong> ${updatedEmployee.employeeType || 'N/A'}</li>
                            <li><strong>Probation Status:</strong> ${updatedEmployee.probationStatus || 'N/A'}</li>
                            ${updatedEmployee.conversionDate ? `<li><strong>Conversion Date:</strong> ${new Date(updatedEmployee.conversionDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</li>` : ''}
                            ${updatedEmployee.probationStartDate ? `<li><strong>Probation Start Date:</strong> ${new Date(updatedEmployee.probationStartDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</li>` : ''}
                            ${updatedEmployee.probationEndDate ? `<li><strong>Probation End Date:</strong> ${new Date(updatedEmployee.probationEndDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</li>` : ''}
                            ${updatedEmployee.probationDurationMonths ? `<li><strong>Probation Duration:</strong> ${updatedEmployee.probationDurationMonths} months</li>` : ''}
                        </ul>
                        <p style="font-size: 0.9em; color: #777;">This is an automated message from the Attendance Management System.</p>
                    </div>
                `;
                
                await sendEmail({ to: recipients, subject, html, isHREmail: true });
            }
        } catch (emailError) {
            console.error('Failed to send probation settings notification email:', emailError);
        }

        // Emit Socket.IO event
        try {
            const { getIO } = require('../socketManager');
            const io = getIO();
            if (io) {
                io.emit('probation_settings_updated', {
                    userId: updatedEmployee._id,
                    employeeCode: updatedEmployee.employeeCode,
                    fullName: updatedEmployee.fullName,
                    employeeType: updatedEmployee.employeeType,
                    probationStatus: updatedEmployee.probationStatus,
                    conversionDate: updatedEmployee.conversionDate,
                    probationEndDate: updatedEmployee.probationEndDate,
                    updatedBy: req.user.userId,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (socketError) {
            console.error('Failed to emit Socket.IO event:', socketError);
        }

        res.json({ 
            message: 'Probation settings updated successfully.', 
            employee: updatedEmployee 
        });
    } catch (error) {
        console.error('Error updating probation settings:', error);
        res.status(500).json({ error: 'Failed to update probation settings.' });
    }
});

// GET /api/admin/employees/:id/probation-status
router.get('/:id/probation-status', [authenticateToken, isAdminOrHr], async (req, res) => {
    const { id } = req.params;
    
    try {
        const employee = await User.findById(id)
            .select('fullName employeeCode employeeType probationStatus probationStartDate probationEndDate probationDurationMonths conversionDate joiningDate');
        
        if (!employee) {
            return res.status(404).json({ error: 'Employee not found.' });
        }

        let remainingDays = null;
        if (employee.probationEndDate && employee.probationStatus === 'On Probation') {
            const today = new Date();
            const endDate = new Date(employee.probationEndDate);
            const diffTime = endDate - today;
            remainingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }

        res.json({
            employee: {
                id: employee._id,
                fullName: employee.fullName,
                employeeCode: employee.employeeCode,
                employeeType: employee.employeeType,
                probationStatus: employee.probationStatus,
                probationStartDate: employee.probationStartDate,
                probationEndDate: employee.probationEndDate,
                probationDurationMonths: employee.probationDurationMonths,
                conversionDate: employee.conversionDate,
                joiningDate: employee.joiningDate,
                remainingDays
            }
        });
    } catch (error) {
        console.error('Error fetching probation status:', error);
        res.status(500).json({ error: 'Failed to fetch probation status.' });
    }
});

module.exports = router;