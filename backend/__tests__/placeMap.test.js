jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const logger = require('../utils/logger');
const {
  fetchPlaceMapPng,
  GEOCODE_URL,
  STATIC_URL,
  MAP_ZOOM,
  MAP_SIZE,
  BODY_LOG_CHARS,
} = require('../utils/placeMap');

const PLACE_ID = 'ChIJISz8NjyuEmsRFTQ9Iw7Ear8';
const LAT = -33.8568;
const LNG = 151.2153;
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function geocodeOk() {
  return {
    status: 200,
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify({
      status: 'OK',
      results: [{ geometry: { location: { lat: LAT, lng: LNG } } }],
    })),
  };
}

function loggedCalls() {
  return logger.info.mock.calls.map(([message, options]) => ({
    message,
    options: options || {},
  }));
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
      get: jest.fn(),
    });
    expect(result).toEqual({ status: 503, msg: 'Google Maps is not configured' });
  });

  test('blank placeId is 400', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const result = await fetchPlaceMapPng('  ', {
      get: jest.fn(),
    });
    expect(result).toEqual({ status: 400, msg: 'Missing placeId' });
  });

  test('geocodes the Place ID then draws a Static Map PNG at those coordinates', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const get = jest.fn()
      .mockResolvedValueOnce(geocodeOk())
      .mockResolvedValueOnce({
        status: 200,
        contentType: 'image/png',
        body: PNG,
      });

    const result = await fetchPlaceMapPng(`  ${PLACE_ID}  `, { get });

    expect(result.status).toBe(200);
    expect(result.contentType).toBe('image/png');
    expect(result.png).toEqual(PNG);
    expect(get).toHaveBeenCalledTimes(2);

    const geoUrl = get.mock.calls[0][0];
    expect(geoUrl.startsWith(`${GEOCODE_URL}?`)).toBe(true);
    expect(geoUrl).not.toMatch(/place\/details/);
    const geoParams = new URL(geoUrl).searchParams;
    expect(geoParams.get('place_id')).toBe(PLACE_ID);
    expect(geoParams.get('key')).toBe('test-key');

    const mapUrl = get.mock.calls[1][0];
    expect(mapUrl.startsWith(`${STATIC_URL}?`)).toBe(true);
    const mapParams = new URL(mapUrl).searchParams;
    expect(mapParams.get('center')).toBe(`${LAT},${LNG}`);
    expect(mapParams.get('markers')).toBe(`color:red|${LAT},${LNG}`);
    expect(mapParams.get('zoom')).toBe(MAP_ZOOM);
    expect(mapParams.get('size')).toBe('600x400');
    expect(mapParams.get('size')).toBe(MAP_SIZE);
    expect(mapParams.get('format')).toBe('png');
    expect(mapParams.get('key')).toBe('test-key');

    const logs = loggedCalls();
    expect(logs[0].message).toBe('Google Geocode status 200');
    expect(logs[1].message).toBe('Google Static Map status 200');
    logs.forEach((logged) => {
      expect(logged.options.context.body.length).toBeLessThanOrEqual(BODY_LOG_CHARS);
    });
  });

  test('geocoding failure is 502 with that message and does not request a static map', async () => {
    const key = 'secret-map-key-value';
    process.env.GOOGLE_MAPS_API_KEY = key;
    const googleError = 'This API project is not authorized to use this API.';
    const body = JSON.stringify({
      error_message: googleError,
      status: 'REQUEST_DENIED',
      key,
    });
    const get = jest.fn().mockResolvedValue({
      status: 403,
      contentType: 'application/json',
      body: Buffer.from(body),
    });

    const result = await fetchPlaceMapPng(PLACE_ID, { get });

    expect(result).toEqual({ status: 502, msg: googleError });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0].startsWith(`${GEOCODE_URL}?`)).toBe(true);
    const logs = loggedCalls();
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe('Google Geocode status 403');
    expect(logs[0].options.context.status).toBe(403);
    expect(logs[0].options.context.body.length).toBeLessThanOrEqual(BODY_LOG_CHARS);
    expect(logs[0].options.context.body).toContain('REQUEST_DENIED');
    expect(JSON.stringify(logs)).not.toContain(key);
    expect(logs[0].options.context.body).toContain('[redacted]');
  });

  test('a JSON static map error is 502 with that error after geocoding', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const googleError = 'Static maps is not enabled.';
    const get = jest.fn()
      .mockResolvedValueOnce(geocodeOk())
      .mockResolvedValueOnce({
        status: 403,
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify({
          error_message: googleError,
          status: 'REQUEST_DENIED',
        })),
      });

    const result = await fetchPlaceMapPng(PLACE_ID, { get });

    expect(result).toEqual({ status: 502, msg: googleError });
    expect(get).toHaveBeenCalledTimes(2);
    const logs = loggedCalls();
    expect(logs.map((row) => row.message)).toEqual([
      'Google Geocode status 200',
      'Google Static Map status 403',
    ]);
    logs.forEach((logged) => {
      expect(logged.options.context.body.length).toBeLessThanOrEqual(BODY_LOG_CHARS);
    });
  });
});
