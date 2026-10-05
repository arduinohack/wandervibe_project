enum UserRole { vibeCoordinator, vibePlanner, wanderer }

String _text(dynamic value) {
  if (value == null) return '';
  return value.toString();
}

Map<String, dynamic> _objectMap(dynamic value) {
  if (value is Map) return Map<String, dynamic>.from(value);
  return <String, dynamic>{};
}

bool _boolOr(dynamic value, bool fallback) {
  if (value is bool) return value;
  return fallback;
}

class Address {
  final String street;
  final String city;
  final String state;
  final String country;
  final String postalCode;

  Address({
    required this.street,
    required this.city,
    required this.state,
    required this.country,
    required this.postalCode,
  });

  // From JSON
  factory Address.fromJson(Map<String, dynamic> json) {
    return Address(
      street: _text(json['street']),
      city: _text(json['city']),
      state: _text(json['state']),
      country: _text(json['country']),
      postalCode: _text(json['postalCode']),
    );
  }

  // To JSON
  Map<String, dynamic> toJson() {
    return {
      'street': street,
      'city': city,
      'state': state,
      'country': country,
      'postalCode': postalCode,
    };
  }
}

class NotificationPreferences {
  final bool email;
  final bool sms;

  NotificationPreferences({required this.email, required this.sms});

  // From JSON
  factory NotificationPreferences.fromJson(Map<String, dynamic> json) {
    return NotificationPreferences(
      email: _boolOr(json['email'], true),
      sms: _boolOr(json['sms'], false),
    );
  }

  // To JSON
  Map<String, dynamic> toJson() {
    return {'email': email, 'sms': sms};
  }

  // copyWith for immutable updates (e.g., change one field without modifying original)
  NotificationPreferences copyWith({bool? email, bool? sms}) {
    return NotificationPreferences(
      email: email ?? this.email,
      sms: sms ?? this.sms,
    );
  }
}

class User {
  final String id;
  final String firstName;
  final String lastName;
  final String email;
  final String phoneNumber;
  final Address address;
  final NotificationPreferences notificationPreferences;
  final DateTime createdAt;

  User({
    required this.id,
    required this.firstName,
    required this.lastName,
    required this.email,
    required this.phoneNumber,
    required this.address,
    required this.notificationPreferences,
    required this.createdAt,
  });

  // From JSON (for API responses)
  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: _text(json['_id'] ?? json['id']),
      firstName: _text(json['firstName']),
      lastName: _text(json['lastName']),
      email: _text(json['email']),
      phoneNumber: _text(json['phoneNumber']),
      address: Address.fromJson(_objectMap(json['address'])),
      notificationPreferences: NotificationPreferences.fromJson(
        _objectMap(json['notificationPreferences']),
      ),
      createdAt:
          DateTime.tryParse(_text(json['createdAt'])) ?? DateTime.now(),
    );
  }

  // To JSON (for API sends)
  Map<String, dynamic> toJson() {
    return {
      'firstName': firstName,
      'lastName': lastName,
      'email': email,
      'phoneNumber': phoneNumber,
      'address': address.toJson(),
      'notificationPreferences': notificationPreferences.toJson(),
    };
  }

  // copyWith for immutable updates (e.g., change one field without modifying original)
  User copyWith({
    String? id,
    String? firstName,
    String? lastName,
    String? email,
    String? phoneNumber,
    Address? address,
    NotificationPreferences? notificationPreferences,
    DateTime? createdAt,
  }) {
    return User(
      id: id ?? this.id,
      firstName: firstName ?? this.firstName,
      lastName: lastName ?? this.lastName,
      email: email ?? this.email,
      phoneNumber: phoneNumber ?? this.phoneNumber,
      address: address ?? this.address,
      notificationPreferences:
          notificationPreferences ?? this.notificationPreferences,
      createdAt: createdAt ?? this.createdAt,
    );
  }
}

// Separate model for trip-specific roles (from trip_users collection)
class PlanUser {
  final String planId;
  final String userId;
  final UserRole role;

  PlanUser({required this.planId, required this.userId, required this.role});

  // From JSON
  factory PlanUser.fromJson(Map<String, dynamic> json) {
    return PlanUser(
      planId: json['planId'] ?? '',
      userId: json['userId'] ?? '',
      role: UserRole.values.firstWhere(
        (r) => r.toString().split('.').last == json['role'],
        orElse: () => UserRole.wanderer, // Default
      ),
    );
  }

  // To JSON
  Map<String, dynamic> toJson() {
    return {
      'planId': planId,
      'userId': userId,
      'role': role.toString().split('.').last,
    };
  }
}
