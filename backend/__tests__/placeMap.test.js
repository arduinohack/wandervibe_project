jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const logger = require('../utils/logger');
const {
  fetchPlaceMapPng,
  STATIC_URL,
  MAP_ZOOM,
  MAP_SIZE,
  BODY_LOG_CHARS,
} = require('../utils/placeMap');

const PLACE_ID = 'ChIJISz8NjyuEmsRFTQ9Iw7Ear8';
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function loggedContext() {
  expect(logger.info).toHaveBeenCalled();
  const last = logger.info.mock.calls[logger.info.mock.calls.length - 1];
  return { message: last[0], options: last[1] || {} };
}

describe('fetchPlaceMapPng', () => {
  const previousKey = process.env.GOOGLE_MAPS_API_KEY;

  afterEach(() => {
    if (previousKey == null) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = previousKey;
    logger.info.mockClear();
    logger.error.mockClear();
    logger.warn.mockClear();
  });

  test('no API key is 503', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const result = await fetchPlaceMapPng(PLACE_ID, {
      getStatic: jest.fn(),
    });
    expect(result).toEqual({ status: 503, msg: 'Google Maps is not configured' });
  });

  test('blank placeId is 400', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const result = await fetchPlaceMapPng('  ', {
      getStatic: jest.fn(),
    });
    expect(result).toEqual({ status: 400, msg: 'Missing placeId' });
  });

  test('requests only a Static Map PNG around the Place ID', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const getStatic = jest.fn().mockResolvedValue({
      status: 200,
      contentType: 'image/png',
      body: PNG,
    });

    const result = await fetchPlaceMapPng(`  ${PLACE_ID}  `, { getStatic });

    expect(result.status).toBe(200);
    expect(result.contentType).toBe('image/png');
    expect(result.png).toEqual(PNG);
    expect(getStatic).toHaveBeenCalledTimes(1);
    const url = getStatic.mock.calls[0][0];
    expect(url.startsWith(`${STATIC_URL}?`)).toBe(true);
    expect(url).not.toMatch(/place\/details/);
    const params = new URL(url).searchParams;
    expect(params.get('center')).toBe(`place_id:${PLACE_ID}`);
    expect(params.get('markers')).toBe(`color:red|place_id:${PLACE_ID}`);
    expect(params.get('zoom')).toBe(MAP_ZOOM);
    expect(params.get('size')).toBe(MAP_SIZE);
    expect(params.get('size')).toBe('600x400');
    expect(params.get('format')).toBe('png');
    expect(params.get('key')).toBe('test-key');
  });

  test('a JSON Google error is 502 with that error, and the log omits the key', async () => {
    const key = 'secret-map-key-value';
    process.env.GOOGLE_MAPS_API_KEY = key;
    const googleError = 'This API project is not authorized to use this API.';
    const body = JSON.stringify({
      error_message: googleError,
      status: 'REQUEST_DENIED',
      key,
    });
    const getStatic = jest.fn().mockResolvedValue({
      status: 403,
      contentType: 'application/json',
      body: Buffer.from(body),
    });

    const result = await fetchPlaceMapPng(PLACE_ID, { getStatic });

    expect(result).toEqual({ status: 502, msg: googleError });
    const logged = loggedContext();
    expect(logged.message).toBe('Google Static Map status 403');
    expect(logged.options.context.status).toBe(403);
    expect(logged.options.context.body.length).toBeLessThanOrEqual(BODY_LOG_CHARS);
    expect(logged.options.context.body).toContain('REQUEST_DENIED');
    expect(JSON.stringify(logged)).not.toContain(key);
    expect(logged.options.context.body).toContain('[redacted]');
  });
});
