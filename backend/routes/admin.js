const express = require('express');
const SupportLog = require('../models/SupportLog');

const router = express.Router();

function parseBound(value) {
  if (value === undefined || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

router.get('/logs', async (req, res) => {
  try {
    const query = {};
    if (req.query.event) query.event = req.query.event;
    if (req.query.level) query.level = req.query.level;
    if (req.query.userId) query.actorUserId = req.query.userId;
    if (req.query.planId) query.planId = req.query.planId;

    const createdAt = {};
    const from = parseBound(req.query.from);
    const to = parseBound(req.query.to);
    if (from === undefined || to === undefined) {
      return res.status(400).json({ message: 'from and to must be ISO dates' });
    }
    if (from) createdAt.$gte = from;
    if (to) createdAt.$lte = to;
    if (from || to) query.createdAt = createdAt;

    let limit = parseInt(req.query.limit, 10);
    if (!Number.isFinite(limit) || limit < 1) limit = 50;
    if (limit > 100) limit = 100;

    let skip = parseInt(req.query.skip, 10);
    if (!Number.isFinite(skip) || skip < 0) skip = 0;

    const direction = String(req.query.dir || '').toLowerCase() === 'asc' ? 1 : -1;
    const logs = await SupportLog.find(query)
      .sort({ createdAt: direction })
      .skip(skip)
      .limit(limit);

    res.json({ logs });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
