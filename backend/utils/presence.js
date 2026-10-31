const MEMBER_ROLES = new Set(['Owner', 'Collaborator', 'Guest']);

function memberMayJoin(role) {
  return MEMBER_ROLES.has(role);
}

function memberDisplayName(user) {
  if (!user || typeof user !== 'object') return 'Member';
  const parts = [user.firstName, user.lastName]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean);
  if (parts.length > 0) return parts.join(' ');
  if (typeof user.email === 'string' && user.email.trim()) return user.email.trim();
  return 'Member';
}

function cleanName(name) {
  if (typeof name !== 'string') return '';
  return name.trim();
}

function cleanActivityId(activityId) {
  if (typeof activityId !== 'string') return '';
  const value = activityId.trim();
  if (!value || value.length > 200) return '';
  return value;
}

// One row per userId. A later editing session wins. Idle sessions omit activityId.
function buildPresenceList(sessions) {
  const byUser = new Map();
  const list = Array.isArray(sessions) ? sessions : [];
  for (let index = 0; index < list.length; index += 1) {
    const session = list[index];
    if (!session || session.userId == null || session.userId === '') continue;
    const userId = String(session.userId);
    const name = cleanName(session.name);
    const activityId = cleanActivityId(session.activityId);
    const editedAt = Number.isFinite(session.editedAt) ? session.editedAt : index;
    let row = byUser.get(userId);
    if (!row) {
      row = {
        userId,
        name: name || 'Member',
        activityId: activityId || '',
        editedAt: activityId ? editedAt : -1,
      };
      byUser.set(userId, row);
      continue;
    }
    if (name && row.name === 'Member') row.name = name;
    if (activityId && editedAt >= row.editedAt) {
      row.activityId = activityId;
      row.editedAt = editedAt;
    }
  }
  return [...byUser.values()]
    .sort((left, right) => {
      const byName = left.name.localeCompare(right.name);
      if (byName !== 0) return byName;
      return left.userId.localeCompare(right.userId);
    })
    .map((row) => {
      const user = { userId: row.userId, name: row.name };
      if (row.activityId) user.activityId = row.activityId;
      return user;
    });
}

function createPresenceStore() {
  const sockets = new Map();

  function sessionsFor(planId) {
    const rows = [];
    for (const session of sockets.values()) {
      if (session.planId === planId) rows.push(session);
    }
    return rows;
  }

  function snapshot(planId) {
    return { users: buildPresenceList(sessionsFor(String(planId))) };
  }

  function setJoined(socketId, fields) {
    const planId = String(fields.planId);
    const previous = sockets.get(socketId);
    const samePlan = Boolean(previous && previous.planId === planId);
    const next = {
      userId: String(fields.userId),
      name: cleanName(fields.name) || 'Member',
      planId,
    };
    if (samePlan && previous.activityId) {
      next.activityId = previous.activityId;
      next.editedAt = previous.editedAt;
    }
    sockets.set(socketId, next);
    const previousPlanId = previous && previous.planId !== planId ? previous.planId : null;
    return {
      previousPlanId,
      leftPresence: previousPlanId ? snapshot(previousPlanId) : null,
      presence: snapshot(planId),
    };
  }

  function setEditing(socketId, fields) {
    const session = sockets.get(socketId);
    const planId = fields && fields.planId != null ? String(fields.planId) : '';
    if (!session || session.planId !== planId) return null;
    const activityId = cleanActivityId(fields && fields.activityId);
    if (!activityId) return null;
    session.activityId = activityId;
    session.editedAt = Date.now();
    return snapshot(planId);
  }

  function setIdle(socketId, fields) {
    const session = sockets.get(socketId);
    const planId = fields && fields.planId != null ? String(fields.planId) : '';
    if (!session || session.planId !== planId) return null;
    delete session.activityId;
    delete session.editedAt;
    return snapshot(planId);
  }

  function remove(socketId) {
    const session = sockets.get(socketId);
    if (!session) return null;
    const planId = session.planId;
    sockets.delete(socketId);
    return { planId, presence: snapshot(planId) };
  }

  return { setJoined, setEditing, setIdle, remove, snapshot };
}

module.exports = {
  buildPresenceList,
  createPresenceStore,
  memberMayJoin,
  memberDisplayName,
};
