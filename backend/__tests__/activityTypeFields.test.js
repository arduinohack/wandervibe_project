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
    expect(assertTypeRequirements('flight', result).message).toMatch(/startTimeZone/);

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
    expect(assertTypeRequirements('train', {
      originTimeZone: 'UTC',
      destinationTimeZone: 'Europe/Paris',
    })).toBeNull();
    expect(assertTypeRequirements('train', {
      startTimeZone: 'UTC',
      endTimeZone: 'Europe/Paris',
    })).toBeNull();
    expect(assertTypeRequirements('flight', {
      startTimeZone: 'America/New_York',
      endTimeZone: 'Europe/Paris',
    })).toBeNull();
    expect(assertTypeRequirements('dining', {})).toBeNull();
    expect(assertTypeRequirements('hotel', {})).toBeNull();
    expect(assertTypeRequirements('car_service', {})).toBeNull();
    expect(specificFieldsFor('car_service')).not.toContain('roomNumber');
    expect(specificFieldsFor('car_service')).not.toContain('originTimeZone');
  });

  test('shuttle keeps its own confirmation apart from the booking reference', () => {
    const shuttle = {
      type: 'shuttle',
      name: 'Airport shuttle',
      startTime: flight.startTime,
      endTime: flight.endTime,
      origin: 'Hotel',
      originCountry: 'France',
      destination: 'CDG',
      bookingReference: 'BK1',
      confirmation: 'CONF9',
      cost: 40,
    };

    const kept = applyTypeChange(shuttle, 'shuttle', { name: 'Hotel shuttle' });
    expect(kept.name).toBe('Hotel shuttle');
    expect(kept.origin).toBe('Hotel');
    expect(kept.originCountry).toBe('France');
    expect(kept.destination).toBe('CDG');
    expect(kept.bookingReference).toBe('BK1');
    expect(kept.confirmation).toBe('CONF9');
    expect(kept.cost).toBe(40);

    const replaced = applyTypeChange(shuttle, 'shuttle', { confirmation: 'CONF2' });
    expect(replaced.confirmation).toBe('CONF2');
    expect(replaced.bookingReference).toBe('BK1');

    const dining = applyTypeChange(shuttle, 'dining', { confirmation: 'CONF9' });
    expect(dining.type).toBe('dining');
    expect(dining.name).toBe('Airport shuttle');
    expect(dining.startTime).toBe(shuttle.startTime);
    expect(dining.endTime).toBe(shuttle.endTime);
    expect(dining.cost).toBe(40);
    expect(dining.bookingReference).toBe('BK1');
    expect(dining.confirmation).toBeUndefined();
    expect(dining.origin).toBeUndefined();
    expect(dining.originCountry).toBeUndefined();
    expect(dining.destination).toBeUndefined();

    expect(specificFieldsFor('shuttle')).toEqual(expect.arrayContaining([
      'origin',
      'originCountry',
      'destination',
      'confirmation',
    ]));
    expect(specificFieldsFor('shuttle')).not.toContain('roomNumber');
    expect(specificFieldsFor('shuttle')).not.toContain('originTimeZone');
    expect(specificFieldsFor('dining')).not.toContain('confirmation');
    expect(assertTypeRequirements('shuttle', {})).toBeNull();
  });
});
