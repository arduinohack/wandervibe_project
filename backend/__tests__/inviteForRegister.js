const { v4: uuidv4 } = require('uuid');
const Invitation = require('../models/Invitation');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// Lets a test register. The row is removed after register so later counts stay unchanged.
async function allowRegister(email) {
  await Invitation.create({
    _id: uuidv4(),
    planId: 'register-invite',
    email: normalizeEmail(email),
    invitedBy: 'register-seed',
    role: 'Guest',
    status: 'pending',
  });
}

async function clearRegisterInvite(email) {
  await Invitation.deleteMany({
    planId: 'register-invite',
    email: normalizeEmail(email),
  });
}

module.exports = { allowRegister, clearRegisterInvite };
