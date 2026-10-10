import 'package:flutter_test/flutter_test.dart';
import 'package:wandervibe_frontend/models/activity.dart';
import 'package:wandervibe_frontend/models/plan.dart';

Activity _activity({DateTime? start, DateTime? end}) {
  return Activity(
    planId: 'plan-1',
    name: 'Stop',
    startTime: start,
    endTime: end,
  );
}

void main() {
  test('no activities hides the date line', () {
    expect(planHeaderDateLine(const []), isNull);
  });

  test('activities with no start hide the date line', () {
    expect(planHeaderDateLine([_activity()]), isNull);
    expect(
      planHeaderDateLine([_activity(end: DateTime.utc(2026, 10, 6))]),
      isNull,
    );
  });

  test('a missing end uses that activity start', () {
    expect(
      planHeaderDateLine([
        _activity(start: DateTime.utc(2026, 10, 5, 9)),
      ]),
      'Dates: 2026-10-05',
    );
  });

  test('the same UTC day is one date', () {
    expect(
      planHeaderDateLine([
        _activity(
          start: DateTime.utc(2026, 10, 5, 9),
          end: DateTime.utc(2026, 10, 5, 18),
        ),
      ]),
      'Dates: 2026-10-05',
    );
  });

  test('earliest start and latest end span two dates', () {
    expect(
      planHeaderDateLine([
        _activity(
          start: DateTime.utc(2026, 10, 7, 10),
          end: DateTime.utc(2026, 10, 7, 12),
        ),
        _activity(start: DateTime.utc(2026, 10, 5, 8)),
        _activity(
          start: DateTime.utc(2026, 10, 6, 9),
          end: DateTime.utc(2026, 10, 9, 17),
        ),
      ]),
      'Dates: 2026-10-05 - 2026-10-09',
    );
  });
}
