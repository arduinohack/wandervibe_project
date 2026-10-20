import 'package:flutter_test/flutter_test.dart';
import 'package:wandervibe_frontend/models/plan.dart';
import 'package:wandervibe_frontend/utils/activity_time.dart';

void main() {
  test('the first activity date is day 1 and six days later is day 7', () {
    final headers = planItineraryDayHeaders(
      [
        DateTime.utc(2026, 10, 5, 15),
        DateTime.utc(2026, 10, 11, 9),
      ],
      planTimeZone: 'UTC',
    );

    expect(headers, ['Day 1 · Mon', 'Day 7 · Sun']);
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
      'Day 1 · Thu',
      'Day 3 · Sat',
      'Day 6 · Tue',
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
      'Day 1 · Mon',
      null,
      'Day 4 · Thu',
      'Day 1 · Mon',
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
      'Day 1 · Sat',
      'Day 2 · Sun',
      'Day 7 · Fri',
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
      'Day 1 · Sat',
      'Day 7 · Fri',
    ]);
  });

  test('4pm Alaska on July 13 stays day 1 when the plan zone is Eastern', () {
    final first = instantFromWall(
      year: 2026,
      month: 7,
      day: 13,
      hour: 9,
      minute: 0,
      zone: 'America/New_York',
    );
    final alaska = instantFromWall(
      year: 2026,
      month: 7,
      day: 13,
      hour: 16,
      minute: 0,
      zone: 'America/Anchorage',
    );

    expect(alaska.toUtc(), DateTime.utc(2026, 7, 14));
    expect(
      planItineraryDayHeaders(
        [first, alaska],
        planTimeZone: 'America/New_York',
      ),
      ['Day 1 · Mon', null],
    );
    expect(
      planItineraryDayHeaders(
        [first, alaska],
        planTimeZone: 'UTC',
      ),
      ['Day 1 · Mon', 'Day 2 · Tue'],
    );
  });

  test('a missing plan time zone uses the device zone, not the UTC date', () {
    final plan = Plan.fromJson({
      '_id': 'plan-1',
      'type': 'trip',
      'name': 'July',
    });
    expect(plan.timeZone, isEmpty);

    final alaska = instantFromWall(
      year: 2026,
      month: 7,
      day: 13,
      hour: 16,
      minute: 0,
      zone: 'America/Anchorage',
    );
    final headers = planItineraryDayHeaders(
      [alaska],
      planTimeZone: plan.timeZone,
      deviceTimeZone: 'America/New_York',
    );

    expect(headers, ['Day 1 · Mon']);
  });

  test('a start with no time stays day 1 until a date exists', () {
    final headers = planItineraryDayHeaders(
      [null, DateTime.utc(2026, 10, 5, 9)],
      planTimeZone: 'UTC',
    );

    expect(headers, ['Day 1', 'Day 1 · Mon']);
  });
}
