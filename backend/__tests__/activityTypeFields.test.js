const {
  specificFieldsFor,
  applyTypeChange,
  assertTypeRequirements,
} = require('../utils/activityTypeFields');

const flight = {
  type: 'flight',
  name: 'AA 100',
  startTime: '2026-06-01T15:00:00.000Z',
  endTime: '2026-06-01T18:00:00.000Z',
  location: 'JFK',
  originTimeZone: 'America/New_York',
  destinationTimeZone: 'Europe/Paris',
  gate: 'B12',
  baggageClaim: '4',
  planId: 'plan-1',
  ownerId: 'user-1',
};

describe('activityTypeFields', () => {
  test('flight to hotel clears flight fields and keeps shared fields', () => {
    const result = applyTypeChange(flight, 'hotel', { gate: 'Z9' });

    expect(result.type).toBe('hotel');
    expect(result.name).toBe('AA 100');
    expect(result.startTime).toBe(flight.startTime);
    expect(result.endTime).toBe(flight.endTime);
    expect(result.location).toBe('JFK');
    expect(result.planId).toBe('plan-1');
    expect(result.originTimeZone).toBeUndefined();
    expect(result.destinationTimeZone).toBeUndefined();
    expect(result.gate).toBeUndefined();
    expect(result.baggageClaim).toBeUndefined();
    expect(result.customType).toBe('');
    expect(assertTypeRequirements(result.type, result)).toBeNull();
  });

  test('hotel to flight clears roomNumber and requires time zones', () => {
    const hotel = {
      type: 'hotel',
      name: 'Inn',
      startTime: flight.startTime,
      endTime: flight.endTime,
      location: 'Paris',
      roomNumber: '12',
    };

    const result = applyTypeChange(hotel, 'flight', {});
    expect(result.roomNumber).toBeUndefined();
    expect(result.name).toBe('Inn');
    expect(result.location).toBe('Paris');
    expect(assertTypeRequirements('flight', result)).toBeTruthy();
    expect(assertTypeRequirements('flight', result).message).toMatch(/originTimeZone/);

    const withZones = applyTypeChange(hotel, 'flight', {
      originTimeZone: 'Europe/Paris',
      destinationTimeZone: 'America/New_York',
    });
    expect(withZones.roomNumber).toBeUndefined();
    expect(assertTypeRequirements(withZones.type, withZones)).toBeNull();
  });

  test('dining to tour does not clear shared fields', () => {
    const dining = {
      type: 'dining',
      name: 'Lunch',
      startTime: flight.startTime,
      endTime: flight.endTime,
      location: 'Cafe',
      cost: 20,
    };

    const result = applyTypeChange(dining, 'tour', {});
    expect(result.type).toBe('tour');
    expect(result.name).toBe('Lunch');
    expect(result.startTime).toBe(dining.startTime);
    expect(result.endTime).toBe(dining.endTime);
    expect(result.location).toBe('Cafe');
    expect(result.cost).toBe(20);
    expect(assertTypeRequirements(result.type, result)).toBeNull();
  });

  test('same type keeps an omitted flight gate', () => {
    const result = applyTypeChange(flight, 'flight', { name: 'AA 200' });
    expect(result.name).toBe('AA 200');
    expect(result.gate).toBe('B12');
    expect(result.baggageClaim).toBe('4');
    expect(result.originTimeZone).toBe('America/New_York');
    expect(result.destinationTimeZone).toBe('Europe/Paris');
  });

  test('ceremony and reception keep roomNumber like hotel', () => {
    expect(specificFieldsFor('hotel')).toContain('roomNumber');
    expect(specificFieldsFor('ceremony')).toEqual(expect.arrayContaining(['roomNumber']));
    expect(specificFieldsFor('reception')).toContain('roomNumber');
    expect(specificFieldsFor('flight')).not.toContain('roomNumber');

    const stay = { type: 'hotel', name: 'Stay', roomNumber: '12', location: 'Hall' };
    const ceremony = applyTypeChange(stay, 'ceremony', {});
    expect(ceremony.roomNumber).toBe('12');
    expect(ceremony.name).toBe('Stay');

    const reception = applyTypeChange(ceremony, 'reception', {});
    expect(reception.roomNumber).toBe('12');

    const dining = applyTypeChange(reception, 'dining', { roomNumber: '99' });
    expect(dining.roomNumber).toBeUndefined();
    expect(dining.name).toBe('Stay');
  });

  test('train requires both time zones and other types do not', () => {
    expect(assertTypeRequirements('train', { originTimeZone: 'UTC' })).toBeTruthy();
    expect(assertTypeRequirements('dining', {})).toBeNull();
    expect(assertTypeRequirements('hotel', {})).toBeNull();
  });
});
