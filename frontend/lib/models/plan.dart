import '../models/user.dart'; // Add this line for User class in participants
import '../utils/activity_time.dart';
import 'activity.dart';

String _twoDigitDatePart(int value) => value.toString().padLeft(2, '0');

String _ymd(int year, int month, int day) {
  return '${year.toString().padLeft(4, '0')}-${_twoDigitDatePart(month)}-${_twoDigitDatePart(day)}';
}

/// UTC calendar date from a plan field. Null stays "not set".
String formatPlanDate(DateTime? value) {
  if (value == null) return 'not set';
  final utc = value.toUtc();
  return _ymd(utc.year, utc.month, utc.day);
}

/// Calendar day of [instant] in [planTimeZone]. Empty zone uses [deviceTimeZone],
/// then the device local zone.
String formatPlanHeaderDate(
  DateTime instant, {
  String planTimeZone = '',
  String? deviceTimeZone,
}) {
  final plan = planTimeZone.trim();
  final zone = plan.isNotEmpty ? plan : (deviceTimeZone ?? '').trim();
  if (zone.isEmpty) {
    final local = instant.toLocal();
    return _ymd(local.year, local.month, local.day);
  }
  final clock = clockInZone(instant, zone);
  return _ymd(clock.year, clock.month, clock.day);
}

/// Date line from a precomputed activity span. Null when [earliestStart] is null.
/// Same calendar day in the plan zone is one date. Empty plan zone uses the device zone.
String? planSpanDateLine({
  DateTime? earliestStart,
  DateTime? latestEnd,
  String planTimeZone = '',
  String? deviceTimeZone,
}) {
  if (earliestStart == null) return null;
  final startLabel = formatPlanHeaderDate(
    earliestStart,
    planTimeZone: planTimeZone,
    deviceTimeZone: deviceTimeZone,
  );
  final endLabel = formatPlanHeaderDate(
    latestEnd ?? earliestStart,
    planTimeZone: planTimeZone,
    deviceTimeZone: deviceTimeZone,
  );
  if (startLabel == endLabel) return 'Dates: $startLabel';
  return 'Dates: $startLabel - $endLabel';
}

/// Plan detail header dates from activity times. Null when there is no line to show.
/// Earliest start and latest end; an activity with no end uses its start.
/// Same calendar day in the plan zone is one date. No activities, or none with a
/// start, hides the line. Empty plan zone uses the device zone.
String? planHeaderDateLine(
  List<Activity> activities, {
  String planTimeZone = '',
  String? deviceTimeZone,
}) {
  if (activities.isEmpty) return null;
  DateTime? earliestStart;
  DateTime? latestEnd;
  for (final activity in activities) {
    final start = activity.startTime;
    final end = activity.endTime ?? start;
    if (start != null &&
        (earliestStart == null || start.isBefore(earliestStart))) {
      earliestStart = start;
    }
    if (end != null && (latestEnd == null || end.isAfter(latestEnd))) {
      latestEnd = end;
    }
  }
  return planSpanDateLine(
    earliestStart: earliestStart,
    latestEnd: latestEnd,
    planTimeZone: planTimeZone,
    deviceTimeZone: deviceTimeZone,
  );
}

String _stringValue(dynamic value, {String fallback = ''}) {
  if (value == null) return fallback;
  if (value is Map) {
    final id = value['_id'] ?? value['id'];
    if (id != null) return id.toString();
  }
  final text = value.toString();
  return text.isEmpty ? fallback : text;
}

DateTime? _dateValue(dynamic value) {
  if (value == null) return null;
  return DateTime.tryParse(value.toString());
}

List<String> _stringList(dynamic value) {
  if (value is! List) return [];
  return value.map((item) => item.toString()).toList();
}

List<PlanUser> _participants(dynamic value) {
  if (value is! List) return [];
  final people = <PlanUser>[];
  for (final item in value) {
    if (item is! Map) continue;
    final map = Map<String, dynamic>.from(item);
    final userId = map['userId'];
    if (userId is Map) {
      map['userId'] = _stringValue(userId);
    } else if (userId != null) {
      map['userId'] = userId.toString();
    }
    people.add(PlanUser.fromJson(map));
  }
  return people;
}

class Plan {
  final String id;
  final String type;
  final String name;
  final String destination;
  final DateTime? startDate;
  final DateTime? endDate;
  final bool autoCalculateStartDate;
  final bool autoCalculateEndDate;
  final String location;
  final double? budget;
  final String planningState; // "initial", "reviewing", "complete"
  final String timeZone;
  final List<PlanUser> participants;
  final String ownerId;
  final List<String> activityIds; // Links to activities
  final DateTime createdAt;
  final DateTime? earliestStart;
  final DateTime? latestEnd;
  final String sourcePlanId;
  final DateTime? linkStart;
  final DateTime? linkEnd;

  Plan({
    required this.id, // planID?
    required this.type,
    required this.name,
    required this.destination,
    required this.startDate,
    required this.endDate,
    required this.autoCalculateStartDate,
    required this.autoCalculateEndDate,
    required this.location,
    required this.budget,
    required this.planningState,
    required this.timeZone,
    this.participants = const [],
    required this.ownerId,
    this.activityIds = const [],
    required this.createdAt,
    this.earliestStart,
    this.latestEnd,
    this.sourcePlanId = '',
    this.linkStart,
    this.linkEnd,
  });

  factory Plan.fromJson(Map<String, dynamic> json) {
    /*
    logger.i(
      'Raw participants JSON: ${json['participants']} (type: ${json['participants'].runtimeType})',
    ); // Debug: See backend format
    final rawList = json['participants'] ?? [];
    logger.i('Raw list length: ${rawList.length}'); // Debug: Length before map
    final parsedList = (json['participants'] ?? [])
    .map<PlanUser>((p) => PlanUser.fromJson(p as Map<String, dynamic>))
    .toList(),
    logger.i(
      'Parsed participants length: ${parsedList.length} (type: ${parsedList.runtimeType})',
    ); // Debug: After map
    */

    return Plan(
      id: _stringValue(json['id'] ?? json['_id']),
      type: _stringValue(json['type']),
      name: _stringValue(json['name']),
      destination: _stringValue(json['destination']),
      startDate: _dateValue(json['startDate']),
      endDate: _dateValue(json['endDate']),
      autoCalculateStartDate: json['autoCalculateStartDate'] ?? false,
      autoCalculateEndDate: json['autoCalculateEndDate'] ?? false,
      location: _stringValue(json['location']),
      budget: json['budget'] is num ? (json['budget'] as num).toDouble() : null,
      planningState: _stringValue(json['planningState'], fallback: 'initial'),
      timeZone: _stringValue(json['timeZone'], fallback: 'UTC'),
      participants: _participants(json['participants']),
      activityIds: _stringList(json['eventIds'] ?? json['activityIds']),
      ownerId: _stringValue(json['ownerId']),
      createdAt:
          _dateValue(json['createdAt']) ?? DateTime.fromMillisecondsSinceEpoch(0),
      earliestStart: _dateValue(json['earliestStart']),
      latestEnd: _dateValue(json['latestEnd']),
      sourcePlanId: _stringValue(json['sourcePlanId']),
      linkStart: _dateValue(json['linkStart']),
      linkEnd: _dateValue(json['linkEnd']),
    );
  }
  /*
  // Factory to create from JSON (for API responses from backend)
  factory Plan.fromJson(Map<String, dynamic> json) {
    return Plan(
      id: json['_id'] ?? '',
      type: json['type'] ?? '',
      name: json['name'] ?? '',
      destination: json['destination'] ?? '',
      startDate: DateTime.parse(
        json['startDate'] ?? DateTime.now().toIso8601String(),
      ),
      endDate: DateTime.parse(
        json['endDate'] ?? DateTime.now().toIso8601String(),
      ),
      autoCalculateStartDate: json['autoCalculateStartDate'] ?? false,
      autoCalculateEndDate: json['autoCalculateEndDate'] ?? false,
      location: json['location'] ?? '',
      budget: (json['budget'] ?? 0.0).toDouble(),
      planningState: json['planningState'] ?? 'initial',
      timeZone: json['timeZone'] ?? 'UTC',
      participants: (json['participants'] ?? [])
          .map((p) => PlanUser.fromJson(p))
          .toList(),
      ownerId: json['ownerId'] ?? '',
      activityIds: List<String>.from(json['eventIds'] ?? []),
      createdAt: DateTime.parse(
        json['createdAt'] ?? DateTime.now().toIso8601String(),
      ),
    );
  }
  */

  // To JSON for API sends
  Map<String, dynamic> toJson() {
    return {
      'type': type,
      'name': name,
      'destination': destination,
      'startDate': startDate?.toIso8601String(),
      'endDate': endDate?.toIso8601String(),
      'autoCalculateStartDate': autoCalculateStartDate,
      'autoCalculateEndDate': autoCalculateEndDate,
      'location': location,
      'budget': budget,
      'planningState': planningState,
      'participants': participants
          .map((p) => p.toJson())
          .toList(), // Serialize list
      'timeZone': timeZone,
      'ownerId': ownerId,
    };
  }
}
