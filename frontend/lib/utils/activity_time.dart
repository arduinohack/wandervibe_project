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

const _zoneRegionNames = <String, String>{
  'America/New_York': 'Eastern',
  'America/Chicago': 'Central',
  'America/Denver': 'Mountain',
  'America/Phoenix': 'Arizona',
  'America/Los_Angeles': 'Pacific',
  'America/Anchorage': 'Alaska',
  'Pacific/Honolulu': 'Hawaii',
  'Europe/London': 'British',
  'Europe/Paris': 'Central European',
  'Europe/Rome': 'Central European',
  'Asia/Tokyo': 'Japan',
  'Australia/Sydney': 'Australian Eastern',
};

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

String _regionFromZoneId(String zone) {
  final slash = zone.lastIndexOf('/');
  final last = slash >= 0 ? zone.substring(slash + 1) : zone;
  return last.replaceAll('_', ' ');
}

/// Region plus ST or DT for this instant. UTC stays UTC. The stored zone is the IANA name.
String zoneDaylightLabel(DateTime instant, String zone) {
  final name = zone.trim();
  if (name.isEmpty || name.toUpperCase() == 'UTC') return 'UTC';
  final location = _location(name);
  if (location == tz.UTC) return 'UTC';
  final zoned = tz.TZDateTime.from(instant.toUtc(), location);
  final region = _zoneRegionNames[location.name] ?? _regionFromZoneId(location.name);
  return '$region ${zoned.timeZone.isDst ? 'DT' : 'ST'}';
}

String zoneAbbreviation(DateTime instant, String zone) {
  return zoneDaylightLabel(instant, zone);
}

/// Wall clock in [zone] as m/d HH:mm. A missing instant is "not set".
String itineraryClockLabel(DateTime? instant, String zone) {
  if (instant == null) return 'not set';
  final clock = clockInZone(instant, zone);
  final hour = clock.hour.toString().padLeft(2, '0');
  final minute = clock.minute.toString().padLeft(2, '0');
  return '${clock.month}/${clock.day} $hour:$minute';
}

List<String> activityZoneOptions(String selected) {
  final zone = selected.trim();
  if (zone.isEmpty || activityZoneChoices.contains(zone)) {
    return activityZoneChoices;
  }
  return [zone, ...activityZoneChoices];
}
