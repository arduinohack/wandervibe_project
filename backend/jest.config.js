module.exports = {
  testEnvironment: 'node',  // Run in Node.js mode (handles async/await natively)
  transform: {},  // No Babel needed for plain JS—Jest handles ES6+
  testMatch: ['**/__tests__/**/*.test.js'],  // Find tests in __tests__ folders
  collectCoverageFrom: [
    'routes/**/*.js',  // Cover your routes code
    '!routes/**/*.test.js'  // Skip test files
  ],
  verbose: true  // Detailed output (e.g., which test passed/failed)
};