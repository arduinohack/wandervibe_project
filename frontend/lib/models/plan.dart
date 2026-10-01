import '../models/user.dart'; // Add this line for User class in participants

/// UTC calendar date from a plan field. Null stays "not set".
String formatPlanDate(DateTime? value) {
  if (value == null) return 'not set';
  final utc = value.toUtc();
  final year = utc.year.toString().padLeft(4, '0');
  final month = utc.month.toString().padLeft(2, '0');
  final day = utc.day.toString().padLeft(2, '0');
  return '$year-$month-$day';
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
  final double budget;
  final String planningState; // "initial", "reviewing", "complete"
  final String timeZone;
  final List<PlanUser> participants;
  final String ownerId;
  final List<String> activityIds; // Links to activities
  final DateTime createdAt;

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
      budget: json['budget'] is num ? (json['budget'] as num).toDouble() : 0,
      planningState: _stringValue(json['planningState'], fallback: 'initial'),
      timeZone: _stringValue(json['timeZone'], fallback: 'UTC'),
      participants: _participants(json['participants']),
      activityIds: _stringList(json['eventIds'] ?? json['activityIds']),
      ownerId: _stringValue(json['ownerId']),
      createdAt:
          _dateValue(json['createdAt']) ?? DateTime.fromMillisecondsSinceEpoch(0),
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
