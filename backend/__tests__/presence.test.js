const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('../app');
const {
  buildPresenceList,
  createPresenceStore,
  memberMayJoin,
  memberDisplayName,
} = require('../utils/presence');
const {
  attachPresence,
  registerPresence,
  presenceCors,
  verifyClientToken,
  readHandshakeToken,
  presenceRoom,
} = require('../realtime/presence');

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const handler = socket.handlers[event];
    if (!handler) {
      reject(new Error(`missing ${event} handler`));
      return;
    }
    let settled = false;
    const ack = (response) => {
      if (settled) return;
      settled = true;
      resolve(response);
    };
    Promise.resolve(handler(payload, ack)).catch(reject);
  });
}

function createHarness(options) {
  const middlewares = [];
  let connection;
  const emitted = [];
  const io = {
    use(fn) {
      middlewares.push(fn);
    },
    on(event, fn) {
      if (event === 'connection') connection = fn;
    },
    to(room) {
      return {
        emit(event, payload) {
          emitted.push({ room, event, payload });
        },
      };
    },
  };
  registerPresence(io, options);
  let seq = 0;

  return {
    emitted,
    async connect(token) {
      const socket = {
        id: `socket-${++seq}`,
        data: {},
        connected: true,
        rooms: new Set(),
        handlers: {},
        handshake: { auth: { token }, headers: {} },
        join(room) {
          this.rooms.add(room);
        },
        leave(room) {
          this.rooms.delete(room);
        },
        on(event, fn) {
          this.handlers[event] = fn;
        },
        disconnect() {
          this.connected = false;
          if (this.handlers.disconnect) this.handlers.disconnect();
        },
      };
      let failure = null;
      await middlewares[0](socket, (err) => {
        failure = err || null;
      });
      if (failure) return { socket, error: failure };
      connection(socket);
      return { socket, error: null };
    },
  };
}

describe('presence list', () => {
  afterEach(() => {
    global.redisClient = null;
  });

  test('lists members, editing, idle, and the last disconnect', () => {
    expect(memberMayJoin('Owner')).toBe(true);
    expect(memberMayJoin('Collaborator')).toBe(true);
    expect(memberMayJoin('Guest')).toBe(true);
    expect(memberMayJoin(null)).toBe(false);
    expect(memberMayJoin('pending')).toBe(false);

    const store = createPresenceStore();
    store.setJoined('socket-a', { userId: 'alice', name: 'Alice', planId: 'plan-1' });
    store.setJoined('socket-b', { userId: 'bob', name: 'Bob', planId: 'plan-1' });
    expect(store.snapshot('plan-1')).toEqual({
      users: [
        { userId: 'alice', name: 'Alice' },
        { userId: 'bob', name: 'Bob' },
      ],
    });

    expect(store.setEditing('socket-a', { planId: 'plan-1', activityId: 'act-1' }).users[0])
      .toEqual({ userId: 'alice', name: 'Alice', activityId: 'act-1' });
    const idled = store.setIdle('socket-a', { planId: 'plan-1' });
    expect(idled.users[0]).toEqual({ userId: 'alice', name: 'Alice' });
    expect(Object.prototype.hasOwnProperty.call(idled.users[0], 'activityId')).toBe(false);

    expect(store.remove('socket-a').presence.users).toEqual([
      { userId: 'bob', name: 'Bob' },
    ]);
    expect(store.remove('socket-b').presence.users).toEqual([]);
    expect(store.remove('socket-b')).toBeNull();
  });

  test('keeps one row per person and drops them from the plan they left', () => {
    const store = createPresenceStore();
    store.setJoined('phone', { userId: 'alice', name: 'Alice', planId: 'plan-1' });
    store.setJoined('laptop', { userId: 'alice', name: 'Alice', planId: 'plan-1' });
    store.setEditing('laptop', { planId: 'plan-1', activityId: 'act-9' });
    expect(store.snapshot('plan-1').users).toEqual([
      { userId: 'alice', name: 'Alice', activityId: 'act-9' },
    ]);
    store.remove('laptop');
    expect(store.snapshot('plan-1').users).toEqual([
      { userId: 'alice', name: 'Alice' },
    ]);

    store.setJoined('other', { userId: 'bob', name: 'Bob', planId: 'plan-2' });
    const moved = store.setJoined('phone', { userId: 'alice', name: 'Alice', planId: 'plan-2' });
    expect(moved.previousPlanId).toBe('plan-1');
    expect(moved.leftPresence.users).toEqual([]);
    expect(store.snapshot('plan-1').users).toEqual([]);
    expect(store.snapshot('plan-2').users).toEqual([
      { userId: 'alice', name: 'Alice' },
      { userId: 'bob', name: 'Bob' },
    ]);
  });

  test('ignores editing until that socket has joined the plan', () => {
    const store = createPresenceStore();
    expect(store.setEditing('socket-a', { planId: 'plan-1', activityId: 'act-1' })).toBeNull();
    expect(store.setIdle('socket-a', { planId: 'plan-1' })).toBeNull();
    store.setJoined('socket-a', { userId: 'alice', name: 'Alice', planId: 'plan-1' });
    expect(store.setEditing('socket-a', { planId: 'plan-2', activityId: 'act-1' })).toBeNull();
    expect(store.snapshot('plan-1').users).toEqual([
      { userId: 'alice', name: 'Alice' },
    ]);
    expect(store.snapshot('plan-2').users).toEqual([]);
  });

  test('buildPresenceList uses the latest edit and a display name', () => {
    expect(memberDisplayName({ firstName: 'Ada', lastName: 'Lovelace' })).toBe('Ada Lovelace');
    expect(memberDisplayName({ email: 'ada@example.com' })).toBe('ada@example.com');
    expect(memberDisplayName(null)).toBe('Member');
    expect(buildPresenceList([
      { userId: 'alice', name: 'Alice' },
      { userId: 'alice', name: 'Alice', activityId: 'act-1', editedAt: 1 },
      { userId: 'alice', name: 'Alice', activityId: 'act-2', editedAt: 2 },
      { userId: 'bob', name: '  Bob  ' },
    ])).toEqual([
      { userId: 'alice', name: 'Alice', activityId: 'act-2' },
      { userId: 'bob', name: 'Bob' },
    ]);
  });

  test('rejects a token that is not a valid JWT', async () => {
    expect(readHandshakeToken({
      handshake: { auth: { token: 'Bearer abc.def.ghi' }, headers: {} },
    })).toBe('abc.def.ghi');

    await expect(verifyClientToken('not-a-jwt')).rejects.toThrow('unauthorized');
    await expect(verifyClientToken('a.b.c')).rejects.toThrow('unauthorized');
    const empty = jwt.sign({ email: 'ada@example.com' }, process.env.JWT_SECRET);
    await expect(verifyClientToken(empty)).rejects.toThrow('unauthorized');

    const token = jwt.sign({ userId: 'user-1' }, process.env.JWT_SECRET);
    await expect(verifyClientToken(token)).resolves.toEqual({ userId: 'user-1' });
    const idOnly = jwt.sign({ id: 'user-2' }, process.env.JWT_SECRET);
    await expect(verifyClientToken(idOnly)).resolves.toEqual({ userId: 'user-2' });

    global.redisClient = {
      async get() {
        return 'blacklisted';
      },
    };
    await expect(verifyClientToken(token)).rejects.toThrow('unauthorized');

    global.redisClient = {
      async get() {
        throw new Error('redis down');
      },
    };
    await expect(verifyClientToken(token)).resolves.toEqual({ userId: 'user-1' });
  });
});

describe('presence rooms', () => {
  function sign(userId) {
    return jwt.sign({ userId }, process.env.JWT_SECRET);
  }

  function lastPresence(emitted) {
    const rows = emitted.filter((row) => row.event === 'presence');
    return rows[rows.length - 1];
  }

  test('uses the API origin check and does not allow every origin', () => {
    const cors = presenceCors(app.allowsBrowserOrigin);
    cors.origin('https://planitvibe.com', (err, value) => {
      expect(err).toBeNull();
      expect(value).toBe('https://planitvibe.com');
    });
    cors.origin('https://evil.example', (err, value) => {
      expect(err).toBeNull();
      expect(value).toBe(false);
    });
    cors.origin(undefined, (err, value) => {
      expect(err).toBeNull();
      expect(value).toBe(true);
    });
  });

  test('members see each other, editing, and a non-member stays out', async () => {
    const store = createPresenceStore();
    const members = new Set(['alice', 'bob']);
    const harness = createHarness({
      store,
      canJoin: async (userId, planId) => planId === 'plan-1' && members.has(userId),
      loadName: async (userId) => {
        if (userId === 'alice') return 'Alice';
        if (userId === 'bob') return 'Bob';
        return 'Stranger';
      },
    });

    const bad = await harness.connect('not-a-jwt');
    expect(bad.error).toBeInstanceOf(Error);
    expect(bad.error.message).toBe('unauthorized');
    expect(bad.socket.handlers.join).toBeUndefined();

    const alice = await harness.connect(sign('alice'));
    expect(alice.error).toBeNull();
    expect(await emitAck(alice.socket, 'join', { planId: 'plan-1' })).toEqual({ ok: true });
    expect(alice.socket.rooms.has(presenceRoom('plan-1'))).toBe(true);
    expect(lastPresence(harness.emitted).payload).toEqual({
      users: [{ userId: 'alice', name: 'Alice' }],
    });

    const stranger = await harness.connect(sign('stranger'));
    expect(stranger.error).toBeNull();
    expect(await emitAck(stranger.socket, 'join', { planId: 'plan-1' })).toEqual({ ok: false });
    expect(stranger.socket.rooms.size).toBe(0);
    expect(await emitAck(stranger.socket, 'editing', {
      planId: 'plan-1',
      activityId: 'act-x',
    })).toEqual({ ok: false });
    expect(store.snapshot('plan-1').users).toEqual([
      { userId: 'alice', name: 'Alice' },
    ]);

    const bob = await harness.connect(sign('bob'));
    expect(await emitAck(bob.socket, 'join', { planId: 'plan-1' })).toEqual({ ok: true });
    expect(lastPresence(harness.emitted).payload).toEqual({
      users: [
        { userId: 'alice', name: 'Alice' },
        { userId: 'bob', name: 'Bob' },
      ],
    });

    expect(await emitAck(alice.socket, 'editing', {
      planId: 'plan-1',
      activityId: 'act-9',
    })).toEqual({ ok: true });
    expect(lastPresence(harness.emitted).payload.users.find((user) => user.userId === 'alice'))
      .toEqual({ userId: 'alice', name: 'Alice', activityId: 'act-9' });

    expect(await emitAck(alice.socket, 'idle', { planId: 'plan-1' })).toEqual({ ok: true });
    expect(lastPresence(harness.emitted).payload.users.find((user) => user.userId === 'alice'))
      .toEqual({ userId: 'alice', name: 'Alice' });

    alice.socket.disconnect();
    expect(lastPresence(harness.emitted).payload).toEqual({
      users: [{ userId: 'bob', name: 'Bob' }],
    });
    expect(store.snapshot('plan-1').users).toEqual([
      { userId: 'bob', name: 'Bob' },
    ]);
  });

  test('attaches to an HTTP server without listening', async () => {
    const server = http.createServer();
    const io = attachPresence(server, {
      allowsBrowserOrigin: () => false,
      canJoin: async () => false,
      loadName: async () => 'Member',
    });
    await new Promise((resolve) => io.close(resolve));
  });
});
