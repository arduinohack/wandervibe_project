import 'package:flutter/material.dart'; // Added for IconData in icon getter
import 'package:timezone/timezone.dart'
    as tz; // For time zone handling (add to pubspec.yaml if needed)

enum EventType {
  flight,
  car,
  dining,
  hotel,
  tour,
  activity,
  attraction,
  cruise,
  setup,
  ceremony,
  reception,
  vendor,
  custom,
}

// Extension for dynamic icon access
extension EventTypeIcon on EventType {
  IconData get icon {
    switch (this) {
      case EventType.flight:
        return Icons.flight;
      case EventType.hotel:
        return Icons.hotel;
      case EventType.activity:
        return Icons.local_activity;
      case EventType.dining:
        return Icons.restaurant;
      // Add more cases for your EventType values
      default:
        return Icons.event; // Default icon
    }
  }
}

enum CostType { estimated, actual }

class Event {
  final String id; // Event ID?
  final String planId;
  final String title;
  final String location;
  final String details;
  final EventType type;
  final String customType;
  final double cost;
  final CostType costType;
  final DateTime startTime;
  final int duration;
  final DateTime endTime;
  final String? originTimeZone; // Optional, required for flight
  final String? destinationTimeZone; // Optional, required for flight
  final Map<String, String> resourceLinks; // e.g., {'maps': 'url'}
  final DateTime createdAt;
  int? dayNumber; // Computed later in provider for itinerary

  Event({
    required this.id,
    required this.planId,
    required this.title,
    required this.location,
    required this.details,
    required this.type,
    required this.customType,
    required this.cost,
    required this.costType,
    required this.startTime,
    required this.duration,
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
      planId: json['planId'] ?? '',
      title: json['title'] ?? '',
      location: json['location'] ?? '',
      details: json['details'] ?? '',
      type: EventType.values.firstWhere(
        (e) => e.toString().split('.').last == json['type'],
        orElse: () => EventType.dining, // Default if invalid
      ),
      customType: json['customType'] ?? '',
      cost: (json['cost'] ?? 0.0).toDouble(),
      costType: CostType.values.firstWhere(
        (c) => c.toString().split('.').last == json['costType'],
        orElse: () => CostType.estimated, // Default if invalid
      ),
      startTime: DateTime.parse(
        json['startTime'] ?? DateTime.now().toIso8601String(),
      ),
      duration: json['duration'] ?? 0,
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
      'planId': planId,
      'title': title,
      'location': location,
      'details': details,
      'type': type.toString().split('.').last,
      'customType': customType,
      'cost': cost,
      'costType': costType.toString().split('.').last,
      'startTime': startTime.toIso8601String(),
      'duration': duration,
      'endTime': endTime.toIso8601String(),
      'originTimeZone': originTimeZone,
      'destinationTimeZone': destinationTimeZone,
      'resourceLinks': resourceLinks,
      'createdAt': createdAt.toIso8601String(),
    };
  }
}
