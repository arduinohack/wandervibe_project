import '../models/user.dart'; // Add this line for User class in participants
import '../utils/logger.dart';

class Plan {
  final String id;
  final String type;
  final String name;
  final String destination;
  final DateTime startDate;
  final DateTime endDate;
  final bool autoCalculateStartDate;
  final bool autoCalculateEndDate;
  final String location;
  final double budget;
  final String planningState; // "initial", "reviewing", "complete"
  final String timeZone;
  final List<PlanUser> participants;
  final String ownerId;
  final List<String> eventIds; // Links to Events
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
    this.eventIds = const [],
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
      id: json['id'] ?? json['_id'] ?? '',
      type: json['type'] ?? '',
      name: json['name'] ?? '',
      destination: json['destination'] ?? '',
      startDate: DateTime.parse(json['startDate']),
      endDate: DateTime.parse(json['endDate']),
      autoCalculateStartDate: json['autoCalculateStartDate'] ?? false,
      autoCalculateEndDate: json['autoCalculateEndDate'] ?? false,
      location: json['location'] ?? '',
      budget: (json['budget'] ?? 0).toDouble(),
      planningState: json['planningState'] ?? 'initial',
      timeZone: json['timeZone'] ?? 'UTC',
      participants: (json['participants'] ?? [])
          .map<PlanUser>((p) => PlanUser.fromJson(p as Map<String, dynamic>))
          .toList(),
      eventIds: List<String>.from(json['eventIds'] ?? []),
      ownerId: json['ownerId'] ?? '',
      createdAt: DateTime.parse(json['createdAt']),
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
      eventIds: List<String>.from(json['eventIds'] ?? []),
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
      'startDate': startDate.toIso8601String(),
      'endDate': endDate.toIso8601String(),
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
