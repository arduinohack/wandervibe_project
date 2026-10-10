const axios = require('axios');

const DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';
const STATIC_URL = 'https://maps.googleapis.com/maps/api/staticmap';
const MAP_ZOOM = '15';
const MAP_SIZE = '640x400';

function googleMapsKey() {
  return String(process.env.GOOGLE_MAPS_API_KEY || '').trim();
}

async function defaultGetJson(url, params) {
  const res = await axios.get(url, { params, timeout: 15000 });
  return res.data;
}

async function defaultGetBuffer(url, params) {
  const res = await axios.get(url, {
    params,
    timeout: 15000,
    responseType: 'arraybuffer',
    validateStatus: (status) => status === 200,
  });
  const type = String((res.headers && res.headers['content-type']) || '');
  if (!type.toLowerCase().startsWith('image/png')) return null;
  return Buffer.from(res.data);
}

// PNG of a Google Map around a Place ID. Zoom 15 is neighborhood scale.
async function fetchPlaceMapPng(placeId, { getJson, getBuffer } = {}) {
  const key = googleMapsKey();
  if (!key) {
    return { status: 503, msg: 'Google Maps is not configured' };
  }
  const id = String(placeId || '').trim();
  if (!id) {
    return { status: 400, msg: 'Missing placeId' };
  }

  const jsonGet = getJson || defaultGetJson;
  const bufGet = getBuffer || defaultGetBuffer;
  let details;
  try {
    details = await jsonGet(DETAILS_URL, {
      place_id: id,
      fields: 'geometry/location',
      key,
    });
  } catch (err) {
    return { status: 502, msg: 'Could not load map' };
  }

  const location = details && details.result && details.result.geometry
    && details.result.geometry.location;
  const lat = location && location.lat;
  const lng = location && location.lng;
  if (details.status !== 'OK' || typeof lat !== 'number' || typeof lng !== 'number') {
    return { status: 502, msg: 'Could not load map' };
  }

  const center = `${lat},${lng}`;
  let png;
  try {
    png = await bufGet(STATIC_URL, {
      center,
      zoom: MAP_ZOOM,
      size: MAP_SIZE,
      scale: '2',
      maptype: 'roadmap',
      markers: `color:red|${center}`,
      key,
    });
  } catch (err) {
    return { status: 502, msg: 'Could not load map' };
  }

  if (!png || !png.length) {
    return { status: 502, msg: 'Could not load map' };
  }
  return { status: 200, png, contentType: 'image/png' };
}

module.exports = {
  fetchPlaceMapPng,
  googleMapsKey,
  DETAILS_URL,
  STATIC_URL,
  MAP_ZOOM,
  MAP_SIZE,
};
