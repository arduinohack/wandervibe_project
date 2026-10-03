import 'package:timezone/data/latest.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

const activityZoneChoices = <String>[
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Rome',
  'Asia/Tokyo',
  'Australia/Sydney',
];

bool _zonesReady = false;

void _ensureZones() {
  if (_zonesReady) return;
  tzdata.initializeTimeZones();
  _zonesReady = true;
}

tz.Location _location(String zone) {
  _ensureZones();
  final name = zone.trim().isEmpty ? 'UTC' : zone.trim();
  try {
    return tz.getLocation(name);
  } catch (_) {
    return tz.UTC;
  }
}

class ActivityClock {
  final int year;
  final int month;
  final int day;
  final int hour;
  final int minute;
  final String abbreviation;

  const ActivityClock({
    required this.year,
    required this.month,
    required this.day,
    required this.hour,
    required this.minute,
    required this.abbreviation,
  });
}

ActivityClock clockInZone(DateTime instant, String zone) {
  final zoned = tz.TZDateTime.from(instant.toUtc(), _location(zone));
  return ActivityClock(
    year: zoned.year,
    month: zoned.month,
    day: zoned.day,
    hour: zoned.hour,
    minute: zoned.minute,
    abbreviation: zoned.timeZoneName,
  );
}

DateTime instantFromWall({
  required int year,
  required int month,
  required int day,
  required int hour,
  required int minute,
  required String zone,
}) {
  return tz.TZDateTime(
    _location(zone),
    year,
    month,
    day,
    hour,
    minute,
  ).toUtc();
}

DateTime? wallValue(DateTime? instant, String zone) {
  if (instant == null) return null;
  final clock = clockInZone(instant, zone);
  return DateTime.utc(clock.year, clock.month, clock.day, clock.hour, clock.minute);
}

String zoneAbbreviation(DateTime instant, String zone) {
  return clockInZone(instant, zone).abbreviation;
}

/// Wall-clock start in the activity zone, with that zone's abbreviation.
String activityStartLabel(DateTime? instant, String zone) {
  if (instant == null) return 'not set';
  final clock = clockInZone(instant, zone);
  String two(int number) => number.toString().padLeft(2, '0');
  final year = clock.year.toString().padLeft(4, '0');
  return '$year-${two(clock.month)}-${two(clock.day)} ${two(clock.hour)}:${two(clock.minute)} ${clock.abbreviation}';
}

List<String> activityZoneOptions(String selected) {
  final zone = selected.trim();
  if (zone.isEmpty || activityZoneChoices.contains(zone)) {
    return activityZoneChoices;
  }
  return [zone, ...activityZoneChoices];
}
