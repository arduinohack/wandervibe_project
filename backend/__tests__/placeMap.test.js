const { fetchPlaceMapPng, DETAILS_URL, STATIC_URL, MAP_ZOOM, MAP_SIZE } = require('../utils/placeMap');

const PLACE_ID = 'ChIJISz8NjyuEmsRFTQ9Iw7Ear8';
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

describe('fetchPlaceMapPng', () => {
  const previousKey = process.env.GOOGLE_MAPS_API_KEY;

  afterEach(() => {
    if (previousKey == null) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = previousKey;
  });

  test('no API key is 503', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const result = await fetchPlaceMapPng(PLACE_ID, {
      getJson: jest.fn(),
      getBuffer: jest.fn(),
    });
    expect(result).toEqual({ status: 503, msg: 'Google Maps is not configured' });
  });

  test('blank placeId is 400', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const result = await fetchPlaceMapPng('  ', {
      getJson: jest.fn(),
      getBuffer: jest.fn(),
    });
    expect(result).toEqual({ status: 400, msg: 'Missing placeId' });
  });

  test('loads Place Details then a neighborhood Static Map PNG', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const getJson = jest.fn().mockResolvedValue({
      status: 'OK',
      result: { geometry: { location: { lat: -33.8568, lng: 151.2153 } } },
    });
    const getBuffer = jest.fn().mockResolvedValue(PNG);

    const result = await fetchPlaceMapPng(`  ${PLACE_ID}  `, { getJson, getBuffer });

    expect(result.status).toBe(200);
    expect(result.contentType).toBe('image/png');
    expect(result.png).toEqual(PNG);
    expect(getJson).toHaveBeenCalledWith(DETAILS_URL, {
      place_id: PLACE_ID,
      fields: 'geometry/location',
      key: 'test-key',
    });
    expect(getBuffer).toHaveBeenCalledWith(STATIC_URL, {
      center: '-33.8568,151.2153',
      zoom: MAP_ZOOM,
      size: MAP_SIZE,
      scale: '2',
      maptype: 'roadmap',
      markers: 'color:red|-33.8568,151.2153',
      key: 'test-key',
    });
  });

  test('unknown Google place is 502', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const result = await fetchPlaceMapPng(PLACE_ID, {
      getJson: jest.fn().mockResolvedValue({ status: 'NOT_FOUND' }),
      getBuffer: jest.fn(),
    });
    expect(result).toEqual({ status: 502, msg: 'Could not load map' });
  });
});
