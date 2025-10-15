import 'package:timezone/timezone.dart'
    as tz; // For time zone handling (add to pubspec.yaml if needed)

enum EventType { flight, car, dining, hotel, tour, attraction, cruise }

enum CostType { estimated, actual }

class Event {
  final String id;
  final String tripId;
  final String title;
  final String location;
  final String details;
  final EventType type;
  final double cost;
  final CostType costType;
  final DateTime startTime;
  final DateTime endTime;
  final String? originTimeZone; // Optional, required for flight
  final String? destinationTimeZone; // Optional, required for flight
  final Map<String, String> resourceLinks; // e.g., {'maps': 'url'}
  final DateTime createdAt;
  int? dayNumber; // Computed later in provider for itinerary

  Event({
    required this.id,
    required this.tripId,
    required this.title,
    required this.location,
    required this.details,
    required this.type,
    required this.cost,
    required this.costType,
    required this.startTime,
    required this.endTime,
    this.originTimeZone,
    this.destinationTimeZone,
    this.resourceLinks = const {},
    required this.createdAt,
    this.dayNumber,
  });

  // Factory to create from JSON (for API responses from backend)
  factory Event.fromJson(Map<String, dynamic> json) {
    return Event(
      id: json['_id'] ?? '',
      tripId: json['tripId'] ?? '',
      title: json['title'] ?? '',
      location: json['location'] ?? '',
      details: json['details'] ?? '',
      type: EventType.values.firstWhere(
        (e) => e.toString().split('.').last == json['type'],
        orElse: () => EventType.dining, // Default if invalid
      ),
      cost: (json['cost'] ?? 0.0).toDouble(),
      costType: CostType.values.firstWhere(
        (c) => c.toString().split('.').last == json['costType'],
        orElse: () => CostType.estimated, // Default if invalid
      ),
      startTime: DateTime.parse(
        json['startTime'] ?? DateTime.now().toIso8601String(),
      ),
      endTime: DateTime.parse(
        json['endTime'] ?? DateTime.now().toIso8601String(),
      ),
      originTimeZone: json['originTimeZone'],
      destinationTimeZone: json['destinationTimeZone'],
      resourceLinks: Map<String, String>.from(json['resourceLinks'] ?? {}),
      createdAt: DateTime.parse(
        json['createdAt'] ?? DateTime.now().toIso8601String(),
      ),
    );
  }

  // To JSON for API sends
  Map<String, dynamic> toJson() {
    return {
      'tripId': tripId,
      'title': title,
      'location': location,
      'details': details,
      'type': type.toString().split('.').last,
      'cost': cost,
      'costType': costType.toString().split('.').last,
      'startTime': startTime.toIso8601String(),
      'endTime': endTime.toIso8601String(),
      'originTimeZone': originTimeZone,
      'destinationTimeZone': destinationTimeZone,
      'resourceLinks': resourceLinks,
      'createdAt': createdAt.toIso8601String(),
    };
  }
}
