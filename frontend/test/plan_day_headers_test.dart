import 'package:flutter_test/flutter_test.dart';
import 'package:wandervibe_frontend/models/plan.dart';

void main() {
  test('the first activity date is day 1 and six days later is day 7', () {
    final headers = planItineraryDayHeaders(
      [
        DateTime.utc(2026, 10, 5, 15),
        DateTime.utc(2026, 10, 11, 9),
      ],
      planTimeZone: 'UTC',
    );

    expect(headers, ['Day 1 · 2026-10-05', 'Day 7 · 2026-10-11']);
  });

  test('a gap is the calendar span, not the count of days with activities', () {
    final headers = planItineraryDayHeaders(
      [
        DateTime.utc(2026, 10, 1, 8),
        DateTime.utc(2026, 10, 3, 8),
        DateTime.utc(2026, 10, 6, 8),
      ],
      planTimeZone: 'UTC',
    );

    expect(headers, [
      'Day 1 · 2026-10-01',
      'Day 3 · 2026-10-03',
      'Day 6 · 2026-10-06',
    ]);
  });

  test('the same calendar day keeps the same number and one header', () {
    final headers = planItineraryDayHeaders(
      [
        DateTime.utc(2026, 10, 5, 9),
        DateTime.utc(2026, 10, 5, 18),
        DateTime.utc(2026, 10, 8, 9),
        DateTime.utc(2026, 10, 5, 12),
      ],
      planTimeZone: 'UTC',
    );

    expect(headers, [
      'Day 1 · 2026-10-05',
      null,
      'Day 4 · 2026-10-08',
      'Day 1 · 2026-10-05',
    ]);
  });

  test('the plan time zone chooses the calendar date', () {
    final headers = planItineraryDayHeaders(
      [
        DateTime.utc(2026, 10, 11, 2),
        DateTime.utc(2026, 10, 11, 18),
        DateTime.utc(2026, 10, 17, 2),
      ],
      planTimeZone: 'America/Los_Angeles',
    );

    expect(headers, [
      'Day 1 · 2026-10-10',
      'Day 2 · 2026-10-11',
      'Day 7 · 2026-10-16',
    ]);
  });

  test('an empty plan time zone uses the given device time zone', () {
    final headers = planItineraryDayHeaders(
      [
        DateTime.utc(2026, 10, 11, 2),
        DateTime.utc(2026, 10, 17, 2),
      ],
      planTimeZone: '   ',
      deviceTimeZone: 'America/Los_Angeles',
    );

    expect(headers, [
      'Day 1 · 2026-10-10',
      'Day 7 · 2026-10-16',
    ]);
  });

  test('a start with no time stays day 1 until a date exists', () {
    final headers = planItineraryDayHeaders(
      [null, DateTime.utc(2026, 10, 5, 9)],
      planTimeZone: 'UTC',
    );

    expect(headers, ['Day 1', 'Day 1 · 2026-10-05']);
  });
}
