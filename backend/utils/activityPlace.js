const mongoose = require('mongoose');

function trimmed(value) {
  return String(value == null ? '' : value).trim();
}

function activitiesCollection() {
  return mongoose.connection.db.collection('activities');
}

// Match trimmed string planId and googlePlaceId on activities.
// planId may be stored as a string or an ObjectId; do not require an ObjectId cast.
async function findActivityWithPlace(planId, placeId) {
  const plan = trimmed(planId);
  const place = trimmed(placeId);
  if (!plan || !place) return null;
  return activitiesCollection().findOne({
    $expr: {
      $and: [
        {
          $eq: [
            { $trim: { input: { $toString: { $ifNull: ['$planId', ''] } } } },
            plan,
          ],
        },
        {
          $eq: [
            { $trim: { input: { $toString: { $ifNull: ['$googlePlaceId', ''] } } } },
            place,
          ],
        },
      ],
    },
  });
}

module.exports = { findActivityWithPlace, trimmed };
