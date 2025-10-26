enum InvitationRole {
  vibePlanner,
  wanderer,
} // Only these (no VibeCoordinator invites)

enum InvitationStatus { pending, accepted, rejected }

class Invitation {
  final String id;
  final String planId;
  final String userId;
  final String invitedBy; // User ID of inviter
  final InvitationRole role;
  final InvitationStatus status;
  final DateTime createdAt;

  Invitation({
    required this.id,
    required this.planId,
    required this.userId,
    required this.invitedBy,
    required this.role,
    required this.status,
    required this.createdAt,
  });

  // Factory to create from JSON (for API responses)
  factory Invitation.fromJson(Map<String, dynamic> json) {
    return Invitation(
      id: json['_id'] ?? '',
      planId: json['planId'] ?? '',
      userId: json['userId'] ?? '',
      invitedBy: json['invitedBy'] ?? '',
      role: InvitationRole.values.firstWhere(
        (r) => r.toString().split('.').last == json['role'],
        orElse: () => InvitationRole.wanderer, // Default if invalid
      ),
      status: InvitationStatus.values.firstWhere(
        (s) => s.toString().split('.').last == json['status'],
        orElse: () => InvitationStatus.pending, // Default if invalid
      ),
      createdAt: DateTime.parse(
        json['createdAt'] ?? DateTime.now().toIso8601String(),
      ),
    );
  }

  // To JSON (for API sends)
  Map<String, dynamic> toJson() {
    return {
      'planId': planId,
      'userId': userId,
      'invitedBy': invitedBy,
      'role': role.toString().split('.').last,
      'status': status.toString().split('.').last,
    };
  }
}
