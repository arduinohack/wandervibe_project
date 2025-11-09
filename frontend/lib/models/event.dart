import 'package:flutter/material.dart'; // Added for IconData in icon getter
// import 'package:timezone/timezone.dart' as tz; // For time zone handling (add to pubspec.yaml if needed)
import './event_type.dart';

enum CostType { estimated, actual }

class UrlLink {
  final String linkName; // Optional label (e.g., 'JFK Map')
  final String linkUrl; // The link (e.g., 'https://maps.google.com/?q=JFK')

  UrlLink({this.linkName = '', required this.linkUrl});

  factory UrlLink.fromJson(Map<String, dynamic> json) {
    return UrlLink(
      linkName: json['linkName'] ?? '',
      linkUrl: json['linkUrl'] ?? '',
    );
  }

  Map<String, dynamic> toJson() {
    return {'linkName': linkName, 'linkUrl': linkUrl};
  }
}

// Sub-event class for composite events (e.g., departure/arrival in flight)
class SubEvent {
  final String name; // e.g., 'Departure'
  final String location;
  final DateTime? time;
  final int duration; // Minutes
  final String details;
  final String subType; // 'departure', 'arrival'
  final Map<String, dynamic>
  extras; // Added: User-defined fields (e.g., {'luggage': '2 bags'})

  SubEvent({
    required this.name,
    this.location = '',
    this.time, // Fixed: Default to current time (non-null)
    this.duration = 0,
    this.details = '',
    required this.subType,
    this.extras = const {}, // Default empty map
  });

  factory SubEvent.fromJson(Map<String, dynamic> json) {
    return SubEvent(
      name: json['name'] ?? '',
      location: json['location'] ?? '',
      time: json['time'] != null ? DateTime.parse(json['time']) : null,
      duration: json['duration'] ?? 0,
      details: json['details'] ?? '',
      subType: json['subType'] ?? '',
      // gate: json['gate'],
      // baggageClaim: json['baggageClaim'],
      extras: Map<String, dynamic>.from(
        json['extras'] ?? {},
      ), // Parse map or empty
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      'location': location,
      'time': time?.toIso8601String(),
      'duration': duration,
      'details': details,
      'subType': subType,
      // if (gate != null) 'gate': gate,
      // if (baggageClaim != null) 'baggageClaim': baggageClaim,
      'extras': extras, // Serialize map
    };
  }

  SubEvent copyWith({
    String? name,
    String? location,
    DateTime? startTime,
    int? duration,
    String? details,
    String? subType,
    String? gate,
    String? baggageClaim,
    Map<String, dynamic>? extras,
  }) {
    return SubEvent(
      name: name ?? this.name,
      location: location ?? this.location,
      time: startTime ?? this.time,
      duration: duration ?? this.duration,
      details: details ?? this.details,
      subType: subType ?? this.subType,
      // gate: gate ?? this.gate,
      // baggageClaim: baggageClaim ?? this.baggageClaim,
      extras: extras ?? this.extras, // Update extras
    );
  }
}

class Event {
  final String? id; // Event ID?
  final String planId;
  final String name;
  final String? location;
  final EventType type;
  final double? cost;
  final DateTime? startTime;
  final Duration? duration;
  final String? details;
  final String? customType;
  final CostType? costType;
  final DateTime? endTime;
  final int? eventNum;
  final String? status;
  final List<String>? missingFields;
  final List<SubEvent> subEvents;
  final List<UrlLink> urlLinks; // e.g., {'maps': 'url'}
  final DateTime? createdAt;
  int? dayNumber; // Computed later in provider for itinerary

  Event({
    this.id, // only populated once an event is created, null for new
    required this.planId, // the planId that this event is part of
    required this.name, // required - gotta have a name
    this.location = '',
    this.details,
    required this.type, // gotta have a type
    this.customType,
    this.cost,
    this.costType = CostType.estimated,
    this.startTime,
    this.duration,
    this.endTime,
    this.eventNum, // the order of events in a plan/trip will be sorted by a combo of eventNum and startTime
    this.status = 'draft',
    this.missingFields = const [],
    this.subEvents = const [],
    this.urlLinks = const [],
    this.createdAt, // only populated once an event is created, null for new
    this.dayNumber, // a front end calculated field
  });

  // Factory to create from JSON (for API responses from backend)
  factory Event.fromJson(Map<String, dynamic> json) {
    return Event(
      id: json['_id'] ?? json['id'], // From backend (null if not there)
      planId: json['planId'] ?? '',
      name: json['name'] ?? '',
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
      eventNum: json['eventNum'] ?? 0,
      status: json['status'] ?? 'draft',
      missingFields: List<String>.from(json['missingFields'] ?? []),
      subEvents: (json['subEvents'] ?? [])
          .map<SubEvent>((se) => SubEvent.fromJson(se))
          .toList(),
      urlLinks: (json['urlLinks'] ?? [])
          .map<UrlLink>((l) => UrlLink.fromJson(l))
          .toList(),
      createdAt: DateTime.parse(
        json['createdAt'] ?? DateTime.now().toIso8601String(),
      ),
    );
  }

  // To JSON for API sends
  Map<String, dynamic> toJson() {
    return {
      if (id != null) 'id': id, // Only send if not null (for updates)
      'planId': planId,
      'name': name,
      'location': location,
      'details': details,
      'type': type.toString().split('.').last,
      'customType': customType,
      'cost': cost,
      'costType': costType
          .toString()
          .split('.')
          .last, // Enum to string for backend
      'startTime': startTime?.toIso8601String() ?? '',
      'duration':
          duration?.inMinutes ?? 0, // Fixed: ?. for null-safe, ?? 0 for default
      'endTime': endTime?.toIso8601String() ?? '',
      'urlLinks': urlLinks.map((l) => l.toJson()).toList(), // Serialize array
      'subEvents': subEvents.map((se) => se.toJson()).toList(),
      'createdAt': createdAt?.toIso8601String() ?? '',
    };
  }

  DateTime get finishTime {
    if (duration?.isNegative ?? false) {
      return startTime ??
          DateTime.now(); // Fixed: ?. for null-safe, ?? false for default
    }
    return (startTime ?? DateTime.now()).add(
      duration ?? Duration.zero,
    ); // Null-safe add
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
