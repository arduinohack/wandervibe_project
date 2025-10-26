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
    required this.ownerId,
    this.eventIds = const [],
    required this.createdAt,
  });

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
      ownerId: json['ownerId'] ?? '',
      eventIds: List<String>.from(json['eventIds'] ?? []),
      createdAt: DateTime.parse(
        json['createdAt'] ?? DateTime.now().toIso8601String(),
      ),
    );
  }

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
      'timeZone': timeZone,
      'ownerId': ownerId,
    };
  }
}
