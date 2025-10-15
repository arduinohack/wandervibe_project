class Trip {
  final String id;
  final String name;
  final String destination;
  final DateTime startDate;
  final DateTime endDate;
  final double budget;
  final String planningState; // "initial" or "complete"
  final String timeZone;
  final String ownerId;

  Trip({
    required this.id,
    required this.name,
    required this.destination,
    required this.startDate,
    required this.endDate,
    required this.budget,
    required this.planningState,
    required this.timeZone,
    required this.ownerId,
  });

  // Factory to create from JSON (for API responses from backend)
  factory Trip.fromJson(Map<String, dynamic> json) {
    return Trip(
      id: json['_id'] ?? '',
      name: json['name'] ?? '',
      destination: json['destination'] ?? '',
      startDate: DateTime.parse(
        json['startDate'] ?? DateTime.now().toIso8601String(),
      ),
      endDate: DateTime.parse(
        json['endDate'] ?? DateTime.now().toIso8601String(),
      ),
      budget: (json['budget'] ?? 0.0).toDouble(),
      planningState: json['planningState'] ?? 'initial',
      timeZone: json['timeZone'] ?? 'UTC',
      ownerId: json['ownerId'] ?? '',
    );
  }

  // To JSON for API sends
  Map<String, dynamic> toJson() {
    return {
      'name': name,
      'destination': destination,
      'startDate': startDate.toIso8601String(),
      'endDate': endDate.toIso8601String(),
      'budget': budget,
      'planningState': planningState,
      'timeZone': timeZone,
      'ownerId': ownerId,
    };
  }
}
