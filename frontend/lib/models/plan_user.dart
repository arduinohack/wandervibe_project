import '../models/user.dart'; // For UserRole enum

class PlanUser {
  final String planId;
  final String userId;
  final UserRole role;

  PlanUser({required this.planId, required this.userId, required this.role});

  factory PlanUser.fromJson(Map<String, dynamic> json) {
    return PlanUser(
      planId: json['planId'] ?? '',
      userId: json['userId'] ?? '',
      role: _roleFromString(json['role'] ?? 'wanderer'), // Parse string to enum
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'planId': planId,
      'userId': userId,
      'role': role.toString().split('.').last, // Enum to string for backend
    };
  }

  // Helper to parse string to UserRole
  static UserRole _roleFromString(String roleStr) {
    switch (roleStr.toLowerCase()) {
      case 'vibecoordinator':
        return UserRole.vibeCoordinator;
      case 'vibeplanner':
        return UserRole.vibePlanner;
      default:
        return UserRole.wanderer;
    }
  }
}
