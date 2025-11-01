import 'package:flutter/material.dart'; // For IconData in extension

// Enum for event types (categories for flights, hotels, etc.)
enum EventType {
  flight,
  car,
  dining,
  hotel,
  tour,
  activity,
  meal,
  transport,
  attraction,
  cruise,
  setup,
  ceremony,
  reception,
  vendor,
  custom,
}

/*
// Extension for String capitalize (title case first letter)
extension StringExtension on String {
  String get capitalize =>
      isEmpty ? this : this[0].toUpperCase() + substring(1).toLowerCase();
}
*/

extension EventTypeExtension on EventType {
  // Extension for display string (e.g., 'Flight' for UI dropdowns)
  String get displayName {
    switch (this) {
      case EventType.flight:
        return 'Flight';
      case EventType.car:
        return 'Car';
      case EventType.dining:
        return 'Dining';
      case EventType.hotel:
        return 'Hotel';
      case EventType.tour:
        return 'Tour';
      case EventType.activity:
        return 'Activity';
      case EventType.meal:
        return 'Meal';
      case EventType.transport:
        return 'Transport';
      case EventType.attraction:
        return 'Attraction';
      case EventType.cruise:
        return 'Cruise';
      case EventType.setup:
        return 'Setup';
      case EventType.ceremony:
        return 'Ceremony';
      case EventType.reception:
        return 'Reception';
      case EventType.vendor:
        return 'Vendor';
      case EventType.custom:
        return 'Custom';
      default:
        return 'Other';
    }
  }
}

// Extension for dynamic icon access
extension EventTypeIcon on EventType {
  IconData get icon {
    switch (this) {
      case EventType.flight:
        return Icons.flight;
      case EventType.car:
        return Icons.flight;
      case EventType.dining:
        return Icons.dining;
      case EventType.hotel:
        return Icons.hotel;
      case EventType.tour:
        return Icons.tour;
      case EventType.activity:
        return Icons.local_activity;
      case EventType.meal:
        return Icons.dining;
      case EventType.transport:
        return Icons.flight;
      case EventType.attraction:
        return Icons.hotel;
      case EventType.cruise:
        return Icons.hotel;
      case EventType.setup:
        return Icons.hotel;
      case EventType.ceremony:
        return Icons.hotel;
      case EventType.reception:
        return Icons.hotel;
      case EventType.vendor:
        return Icons.hotel;
      case EventType.custom:
        return Icons.hotel;
      // Add more cases for your EventType values
      default:
        return Icons.event; // Default icon
    }
  }
}
