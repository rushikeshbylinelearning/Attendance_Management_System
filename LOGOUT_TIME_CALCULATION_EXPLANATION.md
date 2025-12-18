# Required Logout Time Calculation & Time Tracking Card - Complete Guide

## Overview

The attendance system calculates a **Required Logout Time** for each employee based on their shift type, clock-in time, and break activities. This time is displayed in the **Time Tracking Card** (ShiftInfoDisplay component) and updates in real-time as breaks are taken.

---

## Core Calculation Logic

### Base Formula

The system uses a **9-hour total shift duration** (540 minutes) as the standard work requirement, regardless of shift type.

```
Required Logout Time = Clock-In Time + 9 hours - Break Adjustments + Unpaid Break Extensions
```

### Key Components

1. **Clock-In Time**: The actual time when the employee clocks in
2. **Shift Duration**: Always 9 hours (540 minutes) total
3. **Paid Break Minutes**: Deducted from shift duration (if taken)
4. **Unpaid Break Minutes**: Added to shift duration (extends logout time)
5. **Active Break Duration**: Real-time calculation for ongoing breaks

---

## Shift Types

### 1. Fixed Shifts

**Definition**: Shifts with fixed start and end times (e.g., 9:00 AM - 6:00 PM)

**Calculation Logic**:
- Base logout = Clock-In + 9 hours
- If paid break taken: Adjust based on actual break duration vs expected break
- If unpaid break taken: Add unpaid break minutes to logout time

**Example**:
- Shift: 9:00 AM - 6:00 PM
- Clock-In: 9:15 AM
- Expected Paid Break: 30 minutes
- **Before Break**: Logout = 9:15 AM + 9 hours = **6:15 PM**
- **After 30-min Paid Break**: Logout = 9:15 AM + 9 hours - 0 = **6:15 PM** (no change)
- **After 45-min Paid Break**: Logout = 9:15 AM + 9 hours - 15 = **6:00 PM** (15 min saved)

---

### 2. Flexible Shifts

**Definition**: Shifts without fixed start/end times, only duration requirement

**Calculation Logic**:
- Base logout = Clock-In + 9 hours
- Same break adjustment logic as Fixed shifts
- No shift start/end time constraints

**Example**:
- Shift: Flexible (9 hours)
- Clock-In: 10:30 AM
- **Before Break**: Logout = 10:30 AM + 9 hours = **7:30 PM**
- **After 30-min Paid Break**: Logout = **7:30 PM** (no change)
- **After 20-min Paid Break**: Logout = 10:30 AM + 9 hours - 10 = **7:40 PM** (10 min saved)

---

### 3. Special Case: 10 AM - 7 PM Shift

**Special Rule**: If employee clocks in **before 10:00 AM**, the logout time is **fixed to 7:00 PM** (regardless of early clock-in time).

**Calculation Logic**:
- If Clock-In < 10:00 AM → Logout = **7:00 PM** (fixed)
- If Clock-In ≥ 10:00 AM → Use standard 9-hour calculation
- Unpaid breaks still extend the fixed 7:00 PM time

**Examples**:

#### Example 1: Early Clock-In (Before 10 AM)
- Shift: 10:00 AM - 7:00 PM
- Clock-In: 9:30 AM
- **Logout = 7:00 PM** (fixed, regardless of early clock-in)
- **With 15-min Unpaid Break**: Logout = **7:15 PM**

#### Example 2: On-Time Clock-In (At/After 10 AM)
- Shift: 10:00 AM - 7:00 PM
- Clock-In: 10:15 AM
- **Before Break**: Logout = 10:15 AM + 9 hours = **7:15 PM**
- **After 30-min Paid Break**: Logout = **7:15 PM** (no change)

---

## Break Types & Their Impact

### Paid Breaks

**Definition**: Breaks that are part of the work day and don't extend shift duration

**Impact on Logout Time**:
- **Within Allowance**: No change to logout time
- **Exceeding Allowance**: Reduces logout time (employee works less)
- **Under Allowance**: Extends logout time (employee works more)

**Formula**:
```
Break Adjustment = Expected Break Minutes - Actual Paid Break Minutes Taken
Final Logout = Base Logout - Break Adjustment
```

**Examples**:

#### Example 1: Standard Paid Break (30 min expected, 30 min taken)
- Clock-In: 9:00 AM
- Paid Break: 30 minutes (within allowance)
- **Logout = 6:00 PM** (9:00 AM + 9 hours - 0)

#### Example 2: Short Paid Break (30 min expected, 20 min taken)
- Clock-In: 9:00 AM
- Paid Break: 20 minutes (saved 10 minutes)
- **Logout = 6:10 PM** (9:00 AM + 9 hours - (-10) = 9:00 AM + 9 hours + 10)

#### Example 3: Long Paid Break (30 min expected, 45 min taken)
- Clock-In: 9:00 AM
- Paid Break: 45 minutes (15 minutes over)
- **Logout = 5:45 PM** (9:00 AM + 9 hours - 15)

---

### Unpaid Breaks

**Definition**: Breaks that extend the shift duration (employee must work longer)

**Impact on Logout Time**:
- **Always extends logout time** by the full duration of the unpaid break
- Includes both "Unpaid" and "Extra" break types

**Formula**:
```
Final Logout = Base Logout + Total Unpaid Break Minutes
```

**Examples**:

#### Example 1: Single Unpaid Break
- Clock-In: 9:00 AM
- Unpaid Break: 15 minutes
- **Logout = 6:15 PM** (9:00 AM + 9 hours + 15 minutes)

#### Example 2: Multiple Unpaid Breaks
- Clock-In: 9:00 AM
- Unpaid Break 1: 10 minutes
- Unpaid Break 2: 20 minutes
- **Total Unpaid**: 30 minutes
- **Logout = 6:30 PM** (9:00 AM + 9 hours + 30 minutes)

#### Example 3: Unpaid Break During Special Shift
- Shift: 10:00 AM - 7:00 PM
- Clock-In: 9:30 AM (before 10 AM)
- Unpaid Break: 20 minutes
- **Base Logout = 7:00 PM** (fixed)
- **Final Logout = 7:20 PM** (7:00 PM + 20 minutes)

---

### Active Break Handling

**Real-Time Updates**: The system updates logout time in real-time when an employee is on an active unpaid break.

**Frontend Logic** (ShiftInfoDisplay.jsx):
```javascript
// Base logout time from server (includes completed unpaid breaks)
const baseLogoutTime = new Date(dailyData.calculatedLogoutTime);

// Add active unpaid break duration
const activeUnpaidBreakMs = now.getTime() - activeBreak.startTime.getTime();
const liveLogoutTime = baseLogoutTime.getTime() + activeUnpaidBreakMs;
```

**Example**:
- Clock-In: 9:00 AM
- Completed Unpaid Break: 10 minutes (already in base calculation)
- Active Unpaid Break: Started at 2:00 PM, currently 2:15 PM (15 minutes active)
- **Live Logout = 6:25 PM** (6:00 PM base + 10 min completed + 15 min active)

---

## Complete Examples by Scenario

### Scenario 1: Fixed Shift - Standard Day

**Setup**:
- Shift: 9:00 AM - 6:00 PM (Fixed)
- Expected Paid Break: 30 minutes
- Clock-In: 9:05 AM

**Timeline**:
1. **9:05 AM**: Clock-In
   - Logout = 9:05 AM + 9 hours = **6:05 PM**

2. **1:00 PM**: Start 30-minute Paid Break
   - Logout = **6:05 PM** (no change, within allowance)

3. **1:30 PM**: End Paid Break
   - Logout = **6:05 PM** (still no change)

4. **3:00 PM**: Start 15-minute Unpaid Break
   - Logout = **6:20 PM** (6:05 PM + 15 minutes)

5. **3:15 PM**: End Unpaid Break
   - Logout = **6:20 PM** (final)

---

### Scenario 2: Fixed Shift - Late Arrival with Short Break

**Setup**:
- Shift: 9:00 AM - 6:00 PM (Fixed)
- Expected Paid Break: 30 minutes
- Clock-In: 9:45 AM (45 minutes late)

**Timeline**:
1. **9:45 AM**: Clock-In
   - Logout = 9:45 AM + 9 hours = **6:45 PM**

2. **1:00 PM**: Start 20-minute Paid Break (short break)
   - Break Adjustment = 30 - 20 = 10 minutes saved
   - Logout = 9:45 AM + 9 hours - (-10) = **6:55 PM**

3. **1:20 PM**: End Paid Break
   - Logout = **6:55 PM** (final)

---

### Scenario 3: Flexible Shift - Multiple Breaks

**Setup**:
- Shift: Flexible (9 hours)
- Expected Paid Break: 30 minutes
- Clock-In: 10:00 AM

**Timeline**:
1. **10:00 AM**: Clock-In
   - Logout = 10:00 AM + 9 hours = **7:00 PM**

2. **12:00 PM**: Start 30-minute Paid Break
   - Logout = **7:00 PM** (no change)

3. **12:30 PM**: End Paid Break
   - Logout = **7:00 PM**

4. **3:00 PM**: Start 10-minute Unpaid Break
   - Logout = **7:10 PM** (7:00 PM + 10 minutes)

5. **3:10 PM**: End Unpaid Break
   - Logout = **7:10 PM**

6. **5:00 PM**: Start 20-minute Unpaid Break
   - Logout = **7:30 PM** (7:10 PM + 20 minutes)

7. **5:20 PM**: End Unpaid Break
   - Logout = **7:30 PM** (final)

---

### Scenario 4: Special 10 AM - 7 PM Shift - Early Clock-In

**Setup**:
- Shift: 10:00 AM - 7:00 PM (Fixed)
- Expected Paid Break: 30 minutes
- Clock-In: 9:30 AM (30 minutes early)

**Timeline**:
1. **9:30 AM**: Clock-In
   - Logout = **7:00 PM** (fixed, regardless of early clock-in)

2. **1:00 PM**: Start 30-minute Paid Break
   - Logout = **7:00 PM** (no change)

3. **1:30 PM**: End Paid Break
   - Logout = **7:00 PM**

4. **4:00 PM**: Start 25-minute Unpaid Break
   - Logout = **7:25 PM** (7:00 PM + 25 minutes)

5. **4:25 PM**: End Unpaid Break
   - Logout = **7:25 PM** (final)

---

### Scenario 5: Special 10 AM - 7 PM Shift - On-Time Clock-In

**Setup**:
- Shift: 10:00 AM - 7:00 PM (Fixed)
- Expected Paid Break: 30 minutes
- Clock-In: 10:15 AM (15 minutes late)

**Timeline**:
1. **10:15 AM**: Clock-In
   - Logout = 10:15 AM + 9 hours = **7:15 PM** (standard calculation)

2. **1:00 PM**: Start 45-minute Paid Break (15 minutes over)
   - Break Adjustment = 30 - 45 = -15 minutes
   - Logout = 10:15 AM + 9 hours - (-15) = **7:00 PM**

3. **1:45 PM**: End Paid Break
   - Logout = **7:00 PM** (final)

---

### Scenario 6: Overnight Fixed Shift

**Setup**:
- Shift: 10:00 PM - 6:00 AM (Fixed, overnight)
- Expected Paid Break: 30 minutes
- Clock-In: 10:05 PM

**Timeline**:
1. **10:05 PM**: Clock-In
   - Logout = 10:05 PM + 9 hours = **7:05 AM** (next day)

2. **2:00 AM**: Start 30-minute Paid Break
   - Logout = **7:05 AM** (no change)

3. **2:30 AM**: End Paid Break
   - Logout = **7:05 AM**

4. **5:00 AM**: Start 20-minute Unpaid Break
   - Logout = **7:25 AM** (7:05 AM + 20 minutes)

5. **5:20 AM**: End Unpaid Break
   - Logout = **7:25 AM** (final)

---

## Edge Cases

### Edge Case 1: No Break Taken

**Scenario**: Employee works full 9 hours without taking any break

**Calculation**:
- Clock-In: 9:00 AM
- No breaks taken
- **Logout = 6:00 PM** (9:00 AM + 9 hours)

**Note**: Even if paid break allowance exists, if not taken, logout time remains at clock-in + 9 hours.

---

### Edge Case 2: Multiple Paid Breaks Exceeding Allowance

**Scenario**: Employee takes multiple paid breaks totaling more than allowance

**Example**:
- Expected Paid Break: 30 minutes
- Paid Break 1: 20 minutes
- Paid Break 2: 15 minutes
- **Total Paid Break**: 35 minutes (5 minutes over)

**Calculation**:
- Clock-In: 9:00 AM
- Break Adjustment = 30 - 35 = -5 minutes
- **Logout = 5:55 PM** (9:00 AM + 9 hours - 5)

---

### Edge Case 3: Active Unpaid Break at Clock-Out Time

**Scenario**: Employee has an active unpaid break when logout time arrives

**Behavior**:
- System allows clock-out even with active unpaid break
- However, logout time continues to extend in real-time while break is active
- Employee should end break before clocking out (enforced by backend)

**Example**:
- Clock-In: 9:00 AM
- Logout Time: 6:00 PM
- Active Unpaid Break at 5:50 PM (10 minutes active)
- **Live Logout = 6:10 PM** (updates every second)

---

### Edge Case 4: Clock-In Exactly at Shift Start

**Scenario**: Employee clocks in exactly at shift start time

**Example**:
- Shift: 9:00 AM - 6:00 PM
- Clock-In: 9:00 AM (exact)
- **Logout = 6:00 PM** (9:00 AM + 9 hours)

**Note**: No lateness penalty, but logout time is still calculated from actual clock-in.

---

### Edge Case 5: Very Early Clock-In (Before Shift Start)

**Scenario**: Employee clocks in significantly before shift start

**For Standard Fixed Shifts**:
- Shift: 9:00 AM - 6:00 PM
- Clock-In: 8:00 AM (1 hour early)
- **Logout = 5:00 PM** (8:00 AM + 9 hours)
- **Note**: Employee works 9 hours from clock-in, not from shift start

**For Special 10 AM - 7 PM Shift**:
- Shift: 10:00 AM - 7:00 PM
- Clock-In: 8:00 AM (2 hours early)
- **Logout = 7:00 PM** (fixed, regardless of early clock-in)

---

### Edge Case 6: Clock-In After Shift End Time

**Scenario**: Employee clocks in after the shift's end time (next day calculation)

**Example**:
- Shift: 9:00 AM - 6:00 PM
- Clock-In: 7:00 PM (1 hour after shift end)
- **Logout = 4:00 AM** (next day) (7:00 PM + 9 hours)

**Note**: System handles overnight calculations correctly.

---

### Edge Case 7: Zero-Duration Break

**Scenario**: Break is started and immediately ended

**Behavior**:
- Break duration = 0 minutes
- No impact on logout time
- System handles gracefully

---

### Edge Case 8: Flexible Shift with No Duration Specified

**Scenario**: Flexible shift without durationHours field

**Behavior**:
- System defaults to 9 hours (540 minutes)
- Logout = Clock-In + 9 hours

---

## Time Tracking Card Display

### Component: ShiftInfoDisplay

**Location**: `frontend/src/components/ShiftInfoDisplay.jsx`

**Displays**:
1. **Shift Name & Times**: Shows shift name and time range (for Fixed) or duration (for Flexible)
2. **Clocked In At**: Actual clock-in time with late/half-day indicators
3. **Required Log Out**: Calculated logout time with real-time updates

### Real-Time Updates

**Update Frequency**: Every 1 second (when clocked in or on break)

**Update Logic**:
```javascript
// Updates when:
// 1. Status is 'Clocked In' or 'On Break'
// 2. Active unpaid break duration changes
// 3. Break status changes
```

**Visual Indicators**:
- **Normal**: Green/blue icon, standard display
- **Warning**: Yellow/amber icon when penalty minutes > 0
- **Awaiting**: Gray icon when not clocked in

---

## Backend Calculation (Server-Side)

### Function: `computeCalculatedLogoutTime`

**Location**: `backend/services/dailyStatusService.js`

**Inputs**:
- `sessions`: Array of attendance sessions
- `breaks`: Array of break logs
- `attendanceLog`: Attendance log document
- `userShift`: User's shift configuration
- `activeBreak`: Currently active break (optional)

**Output**: ISO string of calculated logout time

**Key Logic**:
1. Gets first clock-in session
2. Determines shift type (Fixed/Flexible/Special)
3. Calculates base logout time
4. Adjusts for paid breaks
5. Adds unpaid break extensions
6. Returns ISO string

---

## Database Fields

### AttendanceLog Schema

**Relevant Fields**:
- `clockInTime`: Date of clock-in
- `shiftDurationMinutes`: Shift duration (typically 540 = 9 hours)
- `paidBreakMinutesTaken`: Total paid break minutes
- `unpaidBreakMinutesTaken`: Total unpaid break minutes
- `penaltyMinutes`: Penalty for exceeding break allowances

### BreakLog Schema

**Relevant Fields**:
- `startTime`: Break start time
- `endTime`: Break end time (null if active)
- `breakType`: 'Paid', 'Unpaid', or 'Extra'
- `durationMinutes`: Break duration

---

## Summary of Rules

### Universal Rules

1. **Base Duration**: Always 9 hours (540 minutes) from clock-in
2. **Paid Breaks**: Adjust logout time based on actual vs expected duration
3. **Unpaid Breaks**: Always extend logout time by full duration
4. **Active Breaks**: Real-time calculation for ongoing unpaid breaks

### Shift-Specific Rules

1. **Fixed Shifts**: Calculate from clock-in + 9 hours, adjust for breaks
2. **Flexible Shifts**: Same as Fixed, but no time constraints
3. **10 AM - 7 PM Special**: If clock-in < 10 AM, logout fixed to 7 PM

### Break Rules

1. **Paid Break Within Allowance**: No change to logout
2. **Paid Break Under Allowance**: Extends logout (employee works more)
3. **Paid Break Over Allowance**: Reduces logout (employee works less)
4. **Unpaid Break**: Always extends logout by full duration
5. **Extra Break**: Treated as unpaid break

---

## Testing Scenarios

### Test Case 1: Standard Fixed Shift
- ✅ Clock-in on time
- ✅ Take standard paid break
- ✅ Verify logout time

### Test Case 2: Late Arrival
- ✅ Clock-in late
- ✅ Verify logout time extends accordingly
- ✅ Check late status marking

### Test Case 3: Special 10 AM - 7 PM Shift
- ✅ Early clock-in (before 10 AM)
- ✅ Verify fixed 7 PM logout
- ✅ On-time clock-in (at/after 10 AM)
- ✅ Verify standard 9-hour calculation

### Test Case 4: Multiple Breaks
- ✅ Multiple paid breaks
- ✅ Multiple unpaid breaks
- ✅ Mixed breaks
- ✅ Verify cumulative calculations

### Test Case 5: Real-Time Updates
- ✅ Active unpaid break
- ✅ Verify live logout time updates
- ✅ Verify updates stop after clock-out

---

## Common Issues & Solutions

### Issue 1: Logout Time Not Updating

**Cause**: Active break not detected or status not 'Clocked In'/'On Break'

**Solution**: Check `dailyData.status` and `activeBreak` in frontend

### Issue 2: Incorrect Calculation for Special Shift

**Cause**: Clock-in time comparison not using IST timezone

**Solution**: Use `getShiftStartDateTimeIST()` function for timezone-aware comparison

### Issue 3: Unpaid Break Not Extending Logout

**Cause**: Break type not recognized as 'Unpaid' or 'Extra'

**Solution**: Verify `breakType` field in BreakLog document

### Issue 4: Paid Break Over Allowance Not Reducing Logout

**Cause**: Break adjustment calculation error

**Solution**: Check `savedBreak = EXPECTED_BREAK_MINUTES - totalPaidBreakMinutes` calculation

---

## Conclusion

The logout time calculation system is designed to:
1. **Accurately track** required work hours (9 hours standard)
2. **Fairly adjust** for break variations
3. **Extend shifts** for unpaid breaks
4. **Handle special cases** like the 10 AM - 7 PM shift
5. **Update in real-time** for active breaks

The system ensures employees complete their required work duration while accounting for all break activities and shift variations.
