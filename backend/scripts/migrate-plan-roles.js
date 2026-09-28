require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

// One-time Atlas migration. Run from backend: node scripts/migrate-plan-roles.js
// Rewrites leftover plan role strings. Safe to run again; already-new rows are left alone.
const ROLE_MAP = {
  VibeCoordinator: 'Owner',
  coordinator: 'Owner',
  VibePlanner: 'Collaborator',
  planner: 'Collaborator',
  Wanderer: 'Guest',
  wanderer: 'Guest',
};

async function migratePlanRoles() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set');
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(uri);
  const collections = ['planusers', 'invitations'];
  try {
    for (const name of collections) {
      const collection = mongoose.connection.collection(name);
      for (const [from, to] of Object.entries(ROLE_MAP)) {
        const result = await collection.updateMany({ role: from }, { $set: { role: to } });
        console.log(`${name}: ${from} -> ${to} matched ${result.matchedCount} modified ${result.modifiedCount}`);
      }
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  migratePlanRoles().catch((err) => {
    console.error('Migration failed');
    console.error(err && err.code ? err.code : 'error');
    process.exitCode = 1;
  });
}

module.exports = { migratePlanRoles, ROLE_MAP };
