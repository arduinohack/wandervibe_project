// Added for IconData in icon getter
// import 'package:timezone/timezone.dart' as tz; // For time zone handling (add to pubspec.yaml if needed)
import './activity_type.dart';

String? _optionalActivityText(dynamic value) {
  if (value == null) return null;
  final text = value.toString().trim();
  return text.isEmpty ? null : text;
}

String _storedPlaceId(dynamic value) {
  if (value == null) return '';
  return value.toString().trim();
}

Duration? _storedDurationMinutes(dynamic value) {
  if (value is! num) return null;
  return Duration(minutes: value.round());
}

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

// Sub-activity class for composite activities (e.g., departure/arrival in flight)
class SubActivity {
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

  SubActivity({
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

  factory SubActivity.fromJson(Map<String, dynamic> json) {
    return SubActivity(
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

  SubActivity copyWith({
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
    return SubActivity(
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

class Activity {
  final String? id;
  final String planId;
  final String name;
  final String? location;
  final String googlePlaceId;
  final ActivityType type;
  final String typeLabel;
  final double? cost;
  final CostType? costType;
  final DateTime? startTime; // Changed: Nullable
  final Duration? duration;
  final DateTime? endTime;
  final int? activityNum;
  final String? status;
  final List<String>? missingFields;
  final List<SubActivity> subActivities;
  final List<UrlLink> urlLinks;
  final String? details;
  final String? gate;
  final String? baggageClaim;
  final String? roomNumber;
  final String? originTimeZone;
  final String? destinationTimeZone;
  final String timeZone;
  final String startTimeZone;
  final String endTimeZone;
  final String? customType;
  final String? serviceProvider;
  final String? bookingReference;
  final Map<String, dynamic> extras;
  final DateTime? createdAt;

  Activity({
    this.id,
    required this.planId,
    required this.name,
    this.location,
    this.googlePlaceId = '',
    this.type = ActivityType.activity,
    this.typeLabel = '',
    this.cost,
    this.costType,
    this.startTime, // Changed: Optional, nullable
    this.duration,
    this.endTime,
    this.activityNum,
    this.status,
    this.missingFields,
    this.subActivities = const [],
    this.urlLinks = const [],
    this.details,
    this.gate,
    this.baggageClaim,
    this.roomNumber,
    this.originTimeZone,
    this.destinationTimeZone,
    this.timeZone = '',
    this.startTimeZone = '',
    this.endTimeZone = '',
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
    } else if (subActivities.isNotEmpty) {
      // Fallback: Use earliest sub-activity startTime, filter out nulls
      final validStartTimes = subActivities
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
    } else if (subActivities.isNotEmpty) {
      // Fallback: Use latest sub-activity startTime, filter out nulls
      final validStartTimes = subActivities
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

  factory Activity.fromJson(Map<String, dynamic> json) {
    return Activity(
      id: json['_id'] ?? json['id'],
      planId: json['planId'] ?? '',
      name: json['name'] ?? 'Unnamed Activity',
      location: json['location'],
      googlePlaceId: _storedPlaceId(json['googlePlaceId']),
      type: _typeFromString(json['type'] ?? 'activity'),
      typeLabel: json['type'] == null ? '' : json['type'].toString(),
      cost: (json['cost'] as num?)?.toDouble(),
      costType: _costTypeFromString(json['costType'] ?? 'estimated'),
      startTime: json['startTime'] != null
          ? DateTime.parse(json['startTime'])
          : null, // Matches DateTime?
      duration: _storedDurationMinutes(json['durationMinutes']),
      endTime: json['endTime'] != null ? DateTime.parse(json['endTime']) : null,
      activityNum: json['eventNum'],
      status: json['status'] ?? 'draft',
      missingFields: List<String>.from(json['missingFields'] ?? []),
      subActivities: (json['subEvents'] as List<dynamic>? ?? [])
          .map((e) => SubActivity.fromJson(e as Map<String, dynamic>))
          .toList(),
      urlLinks: (json['urlLinks'] as List<dynamic>? ?? [])
          .map((e) => UrlLink.fromJson(e as Map<String, dynamic>))
          .toList(),
      details: json['details'],
      gate: _optionalActivityText(json['gate']),
      baggageClaim: _optionalActivityText(json['baggageClaim']),
      roomNumber: _optionalActivityText(json['roomNumber']),
      originTimeZone: _optionalActivityText(json['originTimeZone']),
      destinationTimeZone: _optionalActivityText(json['destinationTimeZone']),
      timeZone: json['timeZone'] == null ? '' : json['timeZone'].toString(),
      startTimeZone: json['startTimeZone'] == null
          ? ''
          : json['startTimeZone'].toString().trim(),
      endTimeZone: json['endTimeZone'] == null
          ? ''
          : json['endTimeZone'].toString().trim(),
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
      'googlePlaceId': googlePlaceId,
      'type': type.toString().split('.').last,
      'cost': cost,
      'costType': costType?.toString().split('.').last ?? 'estimated',
      'startTime': startTime?.toIso8601String(),
      'duration': effectiveDuration?.inMinutes ?? 0, // Use adjusted duration
      'endTime': endTime?.toIso8601String(),
      'eventNum': activityNum ?? 0,
      'status': status ?? 'draft',
      'missingFields': missingFields ?? [],
      'subEvents': subActivities.map((e) => e.toJson()).toList(),
      'urlLinks': urlLinks.map((e) => e.toJson()).toList(),
      'details': details ?? '',
      if (gate != null) 'gate': gate,
      if (baggageClaim != null) 'baggageClaim': baggageClaim,
      if (roomNumber != null) 'roomNumber': roomNumber,
      if (originTimeZone != null) 'originTimeZone': originTimeZone,
      if (destinationTimeZone != null) 'destinationTimeZone': destinationTimeZone,
      'timeZone': timeZone,
      'startTimeZone': startTimeZone,
      'endTimeZone': endTimeZone,
      'customType': customType ?? '',
      if (serviceProvider != null) 'serviceProvider': serviceProvider,
      if (bookingReference != null) 'bookingReference': bookingReference,
      'extras': extras,
      if (createdAt != null) 'createdAt': createdAt!.toIso8601String(),
    };
  }

  // Helper methods outside the class
  static ActivityType _typeFromString(String typeStr) {
    switch (typeStr.toLowerCase()) {
      case 'flight':
        return ActivityType.flight;
      case 'hotel':
        return ActivityType.hotel;
      case 'train':
        return ActivityType.train;
      case 'carrental':
        return ActivityType.carRental;
      case 'car_service':
      case 'carservice':
        return ActivityType.carService;
      case 'drive':
        return ActivityType.drive;
      case 'bus':
        return ActivityType.bus;
      case 'ferry':
        return ActivityType.ferry;
      case 'dining':
        return ActivityType.dining;
      case 'tour':
        return ActivityType.tour;
      case 'attraction':
        return ActivityType.attraction;
      case 'cruise':
        return ActivityType.cruise;
      case 'ceremony':
        return ActivityType.ceremony;
      case 'reception':
        return ActivityType.reception;
      case 'custom':
        return ActivityType.custom;
      default:
        return ActivityType.activity;
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
