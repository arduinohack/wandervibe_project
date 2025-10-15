enum UserRole { vibeCoordinator, vibePlanner, wanderer }

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
      street: json['street'] ?? '',
      city: json['city'] ?? '',
      state: json['state'] ?? '',
      country: json['country'] ?? '',
      postalCode: json['postalCode'] ?? '',
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
      email: json['email'] ?? true,
      sms: json['sms'] ?? false,
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
      id: json['_id'] ?? '',
      firstName: json['firstName'] ?? '',
      lastName: json['lastName'] ?? '',
      email: json['email'] ?? '',
      phoneNumber: json['phoneNumber'] ?? '',
      address: Address.fromJson(json['address'] ?? {}),
      notificationPreferences: NotificationPreferences.fromJson(
        json['notificationPreferences'] ?? {},
      ),
      createdAt: DateTime.parse(
        json['createdAt'] ?? DateTime.now().toIso8601String(),
      ),
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
class TripUser {
  final String tripId;
  final String userId;
  final UserRole role;

  TripUser({required this.tripId, required this.userId, required this.role});

  // From JSON
  factory TripUser.fromJson(Map<String, dynamic> json) {
    return TripUser(
      tripId: json['tripId'] ?? '',
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
      'tripId': tripId,
      'userId': userId,
      'role': role.toString().split('.').last,
    };
  }
}
