const Plan = require('../models/Plan');
const { Event } = require('../models/Event');

function validDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// When a flag is on, the plan date follows the activities. No activities leaves it.
async function syncPlanDates(planId) {
  if (!planId) return;
  const plan = await Plan.findById(planId);
  if (!plan) return;
  if (!plan.autoCalculateStartDate && !plan.autoCalculateEndDate) return;

  const activities = await Event.find({ planId }).select('startTime endTime').lean();
  if (!activities.length) return;

  let earliest = null;
  let latest = null;
  for (const activity of activities) {
    const start = validDate(activity.startTime);
    const end = validDate(activity.endTime) || start;
    if (start && (!earliest || start < earliest)) earliest = start;
    if (end && (!latest || end > latest)) latest = end;
  }

  let changed = false;
  if (plan.autoCalculateStartDate && earliest) {
    plan.startDate = earliest;
    changed = true;
  }
  if (plan.autoCalculateEndDate && latest) {
    plan.endDate = latest;
    changed = true;
  }
  if (changed) await plan.save();
}

module.exports = { syncPlanDates };
