const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');  // Your new logger

// Test logs
console.log('=== Testing Normal Log ===');
logger.info('Trip created successfully', {
  userId: 'test456',
  event: 'tripCreated',
  context: { tripId: 'abc123', budget: 500 }
});

console.log('=== Testing Empty Message ===');
logger.info('', {  // Empty msg—should default clean
  userId: 'test789',
  event: 'emptyTest'
});

console.log('=== Testing Error ===');
try {
  throw new Error('Test boom');
} catch (err) {
  logger.error('Handled error', {
    userId: 'test000',
    event: 'errorTest',
    context: { details: err.message }
  });
}

// Wait a tick, then read & print file contents
setTimeout(() => {
  const logDir = path.join(__dirname, 'logs');
  const logFile = path.join(logDir, `app-${new Date().toISOString().split('T')[0]}.log`);
  
  if (fs.existsSync(logFile)) {
    const contents = fs.readFileSync(logFile, 'utf8');
    console.log('\n=== LOG FILE CONTENTS ===');
    console.log(contents);  // Raw lines—check for {} or full JSON
  } else {
    console.log('\n=== NO LOG FILE YET === (Check if logs/ was created)');
  }
}, 100);