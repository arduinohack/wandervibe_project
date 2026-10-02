require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

// One-time Atlas rename. Run from backend: node scripts/rename-events-collection.js
// Renames events to activities only when events exists and activities does not.
// Does not drop a collection. Does not create activities when events is missing.
async function renameEventsCollection() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set');
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(uri);
  try {
    const existing = await mongoose.connection.db.listCollections().toArray();
    const names = new Set(existing.map((collection) => collection.name));

    if (names.has('activities')) {
      console.log('activities already exists');
      return;
    }

    if (!names.has('events')) {
      console.log('events does not exist');
      return;
    }

    await mongoose.connection.db.collection('events').rename('activities');
    console.log('renamed events to activities');
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  renameEventsCollection().catch((err) => {
    console.error('Rename failed');
    console.error(err && err.code ? err.code : 'error');
    process.exitCode = 1;
  });
}

module.exports = { renameEventsCollection };
