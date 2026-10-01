const request = require('supertest');
const app = require('../app');

const flutterOrigin = 'http://localhost:63582';
const adminOrigins = [
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:8080',
];

function preflight(origin) {
  const req = request(app)
    .options('/api/auth/login')
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'authorization, content-type');
  if (origin) req.set('Origin', origin);
  return req;
}

describe('browser CORS', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  });

  test('development preflight allows a Flutter web localhost port', async () => {
    process.env.NODE_ENV = 'development';
    const response = await preflight(flutterOrigin);
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(flutterOrigin);
    expect(response.headers['access-control-allow-origin']).not.toBe('*');
    expect(response.headers['access-control-allow-headers']).toContain('Authorization');
    expect(response.headers['access-control-allow-headers']).toContain('Content-Type');
  });

  test('an unset NODE_ENV allows 127.0.0.1 on any port', async () => {
    delete process.env.NODE_ENV;
    const origin = 'http://127.0.0.1:49999';
    const response = await preflight(origin);
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(origin);
  });

  test('development keeps the admin origins and requests with no Origin', async () => {
    process.env.NODE_ENV = 'development';
    for (const origin of adminOrigins) {
      const response = await preflight(origin);
      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
    }

    const noOrigin = await request(app).get('/');
    expect(noOrigin.status).toBe(200);
    expect(noOrigin.text).toContain('WanderVibe Backend is running');
    expect(noOrigin.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('development rejects non-local origins', async () => {
    process.env.NODE_ENV = 'development';
    const response = await preflight('https://localhost:63582');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    const foreign = await request(app).get('/').set('Origin', 'http://example.com');
    expect(foreign.status).toBe(200);
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('production allows only the admin origins', async () => {
    process.env.NODE_ENV = 'production';
    for (const origin of adminOrigins) {
      const response = await preflight(origin);
      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
    }

    const flutter = await preflight(flutterOrigin);
    expect(flutter.headers['access-control-allow-origin']).toBeUndefined();
    expect(flutter.headers['access-control-allow-origin']).not.toBe('*');

    const loopback = await request(app)
      .get('/')
      .set('Origin', 'http://127.0.0.1:63582');
    expect(loopback.status).toBe(200);
    expect(loopback.headers['access-control-allow-origin']).toBeUndefined();

    const noOrigin = await request(app).options('/api/auth/login');
    expect(noOrigin.status).toBe(204);
    expect(noOrigin.headers['access-control-allow-origin']).toBeUndefined();
  });
});
