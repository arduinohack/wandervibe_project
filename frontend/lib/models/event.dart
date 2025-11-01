import 'package:flutter/material.dart'; // Added for IconData in icon getter
import 'package:timezone/timezone.dart'
    as tz; // For time zone handling (add to pubspec.yaml if needed)
import './event_type.dart';

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
  final Duration duration;
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
    this.customType = '',
    required this.cost,
    this.costType = CostType.estimated,
    required this.startTime,
    this.duration = const Duration(),
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
      costType: _costTypeFromString(
        json['costType'] ?? 'estimated',
      ), // Parse to enum
      startTime: DateTime.parse(
        json['startTime'] ?? DateTime.now().toIso8601String(),
      ),
      duration: Duration(
        minutes: json['duration'] ?? 0,
      ), // Parse from backend (minutes as int)
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
      'costType': costType
          .toString()
          .split('.')
          .last, // Enum to string for backend
      'startTime': startTime.toIso8601String(),
      'duration': duration.inMinutes, // Serialize as minutes for backend
      'endTime': endTime.toIso8601String(),
      'originTimeZone': originTimeZone,
      'destinationTimeZone': destinationTimeZone,
      'resourceLinks': resourceLinks,
      'createdAt': createdAt.toIso8601String(),
    };
  }

  DateTime get finishTime {
    if (duration.isNegative) return startTime; // Handle invalid
    return startTime.add(
      duration,
    ); // If duration is Duration, add directly (no constructor needed)
  }

  // Helper for costType parsing
  static CostType _costTypeFromString(String typeStr) {
    switch (typeStr.toLowerCase()) {
      case 'actual':
        return CostType.actual;
      default:
        return CostType.estimated;
    }
  }
}
