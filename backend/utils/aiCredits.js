const User = require('../models/User');

const INSUFFICIENT_MESSAGE = 'Insufficient AI credits';
const PASTE_CREDIT_COST = 1;
const SUGGEST_CREDIT_COST = 1;

// The balance is checked before a server-key model call, so a zero balance
// never spends that key. Paste deducts 1 credit after usable model JSON.
// Suggest reserves 1 credit immediately before the summary and puts it back
// when that summary does not succeed. A user key costs nothing.

function creditNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

function usesServerKey(aiClient) {
  if (!aiClient || aiClient.source !== 'server' || aiClient.supported === false) return false;
  const key = aiClient.apiKey;
  return typeof key === 'string' && key.trim().length > 0;
}

async function getBalance(userId) {
  const id = typeof userId === 'string' ? userId.trim() : '';
  if (!id) return 0;
  const user = await User.findById(id).select('aiCredits').lean();
  if (!user) return 0;
  return creditNumber(user.aiCredits);
}

// Atomic. ok is false when the balance would go below zero.
async function deduct(userId, amount) {
  const id = typeof userId === 'string' ? userId.trim() : '';
  const cost = creditNumber(amount);
  if (!id || cost <= 0) return { ok: false, aiCredits: 0 };
  const updated = await User.findOneAndUpdate(
    { _id: id, aiCredits: { $gte: cost } },
    { $inc: { aiCredits: -cost } },
    { new: true },
  ).select('aiCredits').lean();
  if (!updated) {
    return { ok: false, aiCredits: await getBalance(id) };
  }
  return { ok: true, aiCredits: creditNumber(updated.aiCredits) };
}

// Grants. Returns the new balance, or null when the user does not exist.
async function add(userId, amount) {
  const id = typeof userId === 'string' ? userId.trim() : '';
  const grant = creditNumber(amount);
  if (!id || grant <= 0) return null;
  const updated = await User.findOneAndUpdate(
    { _id: id },
    { $inc: { aiCredits: grant } },
    { new: true },
  ).select('aiCredits').lean();
  if (!updated) return null;
  return creditNumber(updated.aiCredits);
}

module.exports = {
  INSUFFICIENT_MESSAGE,
  PASTE_CREDIT_COST,
  SUGGEST_CREDIT_COST,
  usesServerKey,
  getBalance,
  deduct,
  add,
};
