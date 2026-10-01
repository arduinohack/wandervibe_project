// Added for IconData in icon getter
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
  final String name;
  final String? location;
  final DateTime? startTime; // Changed: Explicitly nullable
  final int? duration;
  final DateTime? endTime;
  final String? details;
  final String subType;
  final Map<String, dynamic> extras;
  final String? serviceNumber;
  final String? serviceClass;

  SubEvent({
    required this.name,
    this.location,
    this.startTime, // Changed: Optional, nullable (no 'required')
    this.duration,
    this.endTime,
    this.details,
    required this.subType,
    this.extras = const {},
    this.serviceNumber,
    this.serviceClass,
  });

  factory SubEvent.fromJson(Map<String, dynamic> json) {
    return SubEvent(
      name: json['name'] ?? '',
      location: json['location'],
      startTime: json['startTime'] != null
          ? DateTime.parse(json['startTime'])
          : null, // Matches DateTime?
      duration: json['duration'] as int?,
      endTime: json['endTime'] != null
          ? DateTime.parse(json['endTime'])
          : null, // Matches DateTime?
      details: json['details'],
      subType: json['subType'] ?? '',
      extras: Map<String, dynamic>.from(json['extras'] ?? {}),
      serviceNumber: json['serviceNumber'],
      serviceClass: json['serviceClass'],
    );
  }

  Map<String, dynamic> toJson() {
    final map = {
      'name': name,
      'location': location,
      'startTime': startTime?.toIso8601String(),
      'duration': duration,
      'endTime': endTime?.toIso8601String(),
      'details': details,
      'subType': subType,
      'extras': extras,
    };
    if (serviceNumber != null) map['serviceNumber'] = serviceNumber;
    if (serviceClass != null) map['serviceClass'] = serviceClass;
    return map;
  }

  SubEvent copyWith({
    String? name,
    String? location,
    DateTime? startTime,
    int? duration,
    DateTime? endTime,
    String? details,
    String? subType,
    String? gate,
    String? baggageClaim,
    Map<String, dynamic>? extras,
  }) {
    return SubEvent(
      name: name ?? this.name,
      location: location ?? this.location,
      startTime: startTime ?? this.startTime,
      duration: duration ?? this.duration,
      endTime: endTime ?? this.endTime,
      details: details ?? this.details,
      subType: subType ?? this.subType,
      // gate: gate ?? this.gate,
      // baggageClaim: baggageClaim ?? this.baggageClaim,
      extras: extras ?? this.extras, // Update extras
    );
  }
}

class Event {
  final String? id;
  final String planId;
  final String name;
  final String? location;
  final EventType type;
  final String typeLabel;
  final double? cost;
  final CostType? costType;
  final DateTime? startTime; // Changed: Nullable
  final Duration? duration;
  final DateTime? endTime;
  final int? eventNum;
  final String? status;
  final List<String>? missingFields;
  final List<SubEvent> subEvents;
  final List<UrlLink> urlLinks;
  final String? details;
  final String? customType;
  final String? serviceProvider;
  final String? bookingReference;
  final Map<String, dynamic> extras;
  final DateTime? createdAt;

  Event({
    this.id,
    required this.planId,
    required this.name,
    this.location,
    this.type = EventType.activity,
    this.typeLabel = '',
    this.cost,
    this.costType,
    this.startTime, // Changed: Optional, nullable
    this.duration,
    this.endTime,
    this.eventNum,
    this.status,
    this.missingFields,
    this.subEvents = const [],
    this.urlLinks = const [],
    this.details,
    this.customType,
    this.serviceProvider,
    this.bookingReference,
    this.extras = const {},
    this.createdAt,
  });

  // NEW: Getters for effective times (Cases 1-3)
  DateTime? get effectiveStartTime {
    if (startTime != null && endTime != null) {
      return startTime; // Case 1: Both defined
    } else if (startTime != null &&
        duration != null &&
        duration! > Duration.zero &&
        endTime == null) {
      return startTime; // Case 2: Start + duration
    } else if (endTime != null &&
        duration != null &&
        duration! > Duration.zero &&
        startTime == null) {
      return endTime!.subtract(duration!); // Case 3: End - duration
    } else if (subEvents.isNotEmpty) {
      // Fallback: Use earliest sub-event startTime, filter out nulls
      final validStartTimes = subEvents
          .map((se) => se.startTime)
          .where((dt) => dt != null)
          .cast<DateTime>();
      if (validStartTimes.isNotEmpty) {
        return validStartTimes.reduce((a, b) => a.isBefore(b) ? a : b);
      }
      return null; // No valid start times
    }
    return null; // Fallback for drafts
  }

  DateTime? get effectiveEndTime {
    if (startTime != null && endTime != null) {
      return endTime; // Case 1
    } else if (startTime != null &&
        duration != null &&
        duration! > Duration.zero &&
        endTime == null) {
      return startTime!.add(
        duration!,
      ); // Case 2: Start + duration (safe with !)
    } else if (endTime != null &&
        duration != null &&
        duration! > Duration.zero &&
        startTime == null) {
      return endTime; // Case 3
    } else if (subEvents.isNotEmpty) {
      // Fallback: Use latest sub-event startTime, filter out nulls
      final validStartTimes = subEvents
          .map((se) => se.startTime)
          .where((dt) => dt != null)
          .cast<DateTime>();
      if (validStartTimes.isNotEmpty) {
        return validStartTimes.reduce((a, b) => a.isAfter(b) ? a : b);
      }
      return null; // No valid start times
    }
    return null; // Fallback
  }

  factory Event.fromJson(Map<String, dynamic> json) {
    return Event(
      id: json['_id'] ?? json['id'],
      planId: json['planId'] ?? '',
      name: json['name'] ?? 'Unnamed Event',
      location: json['location'],
      type: _typeFromString(json['type'] ?? 'activity'),
      typeLabel: json['type'] == null ? '' : json['type'].toString(),
      cost: (json['cost'] as num?)?.toDouble(),
      costType: _costTypeFromString(json['costType'] ?? 'estimated'),
      startTime: json['startTime'] != null
          ? DateTime.parse(json['startTime'])
          : null, // Matches DateTime?
      duration: json['duration'] != null
          ? Duration(minutes: json['duration'] as int)
          : null,
      endTime: json['endTime'] != null ? DateTime.parse(json['endTime']) : null,
      eventNum: json['eventNum'],
      status: json['status'] ?? 'draft',
      missingFields: List<String>.from(json['missingFields'] ?? []),
      subEvents: (json['subEvents'] as List<dynamic>? ?? [])
          .map((e) => SubEvent.fromJson(e as Map<String, dynamic>))
          .toList(),
      urlLinks: (json['urlLinks'] as List<dynamic>? ?? [])
          .map((e) => UrlLink.fromJson(e as Map<String, dynamic>))
          .toList(),
      details: json['details'],
      customType: json['customType'],
      serviceProvider: json['serviceProvider'],
      bookingReference: json['bookingReference'],
      extras: Map<String, dynamic>.from(json['extras'] ?? {}),
      createdAt: json['createdAt'] != null
          ? DateTime.parse(json['createdAt'])
          : null,
    );
  }

  Map<String, dynamic> toJson() {
    // Check for negative duration and adjust if needed
    final effectiveDuration = duration != null && duration!.isNegative
        ? Duration
              .zero // Avoid negative durations
        : duration;

    return {
      if (id != null) '_id': id,
      'planId': planId,
      'name': name,
      'location': location ?? '',
      'type': type.toString().split('.').last,
      'cost': cost ?? 0.0,
      'costType': costType?.toString().split('.').last ?? 'estimated',
      'startTime': startTime?.toIso8601String(),
      'duration': effectiveDuration?.inMinutes ?? 0, // Use adjusted duration
      'endTime': endTime?.toIso8601String(),
      'eventNum': eventNum ?? 0,
      'status': status ?? 'draft',
      'missingFields': missingFields ?? [],
      'subEvents': subEvents.map((e) => e.toJson()).toList(),
      'urlLinks': urlLinks.map((e) => e.toJson()).toList(),
      'details': details ?? '',
      'customType': customType ?? '',
      if (serviceProvider != null) 'serviceProvider': serviceProvider,
      if (bookingReference != null) 'bookingReference': bookingReference,
      'extras': extras,
      if (createdAt != null) 'createdAt': createdAt!.toIso8601String(),
    };
  }

  // Helper methods outside the class
  static EventType _typeFromString(String typeStr) {
    switch (typeStr.toLowerCase()) {
      case 'flight':
        return EventType.flight;
      case 'hotel':
        return EventType.hotel;
      case 'train':
        return EventType.train;
      case 'carrental':
        return EventType.carRental;
      case 'carservice':
        return EventType.carService;
      case 'drive':
        return EventType.drive;
      case 'bus':
        return EventType.bus;
      case 'ferry':
        return EventType.ferry;
      default:
        return EventType.activity;
    }
  }

  static CostType _costTypeFromString(String typeStr) {
    switch (typeStr.toLowerCase()) {
      case 'estimated':
        return CostType.estimated;
      case 'actual':
        return CostType.actual;
      default:
        return CostType.estimated;
    }
  }

  DateTime get finishTime {
    if (duration?.isNegative ?? false) {
      // Use this.duration for class field
      return startTime ?? DateTime.now(); // Null-safe fallback
    }
    return (startTime ?? DateTime.now()).add(
      duration ?? Duration.zero, // Null-safe add
    );
  }
}
