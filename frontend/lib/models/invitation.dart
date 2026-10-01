enum InvitationRole {
  vibePlanner,
  wanderer,
} // Only these (no VibeCoordinator invites)

enum InvitationStatus { pending, accepted, rejected }

String _text(dynamic value) {
  if (value == null) return '';
  return value.toString();
}

String _idText(dynamic value) {
  if (value is Map) return _text(value['_id'] ?? value['id']);
  return _text(value);
}

String _inviterLabel(dynamic inviter) {
  if (inviter is! Map) return '';
  final first = _text(inviter['firstName']).trim();
  final last = _text(inviter['lastName']).trim();
  final name = [first, last].where((part) => part.isNotEmpty).join(' ');
  if (name.isNotEmpty) return name;
  return _text(inviter['email']).trim();
}

class Invitation {
  final String id;
  final String planId;
  final String userId;
  final String invitedBy; // User ID of inviter
  final InvitationRole role;
  final InvitationStatus status;
  final DateTime createdAt;
  final String planName;
  final String roleLabel;
  final String inviterLabel;

  Invitation({
    required this.id,
    required this.planId,
    required this.userId,
    required this.invitedBy,
    required this.role,
    required this.status,
    required this.createdAt,
    this.planName = '',
    this.roleLabel = '',
    this.inviterLabel = '',
  });

  Invitation withStatus(InvitationStatus status) {
    return Invitation(
      id: id,
      planId: planId,
      userId: userId,
      invitedBy: invitedBy,
      role: role,
      status: status,
      createdAt: createdAt,
      planName: planName,
      roleLabel: roleLabel,
      inviterLabel: inviterLabel,
    );
  }

  // Factory to create from JSON (for API responses)
  factory Invitation.fromJson(Map<String, dynamic> json) {
    final roleLabel = _text(json['role']);
    return Invitation(
      id: _text(json['_id']),
      planId: _text(json['planId']),
      userId: _idText(json['userId']),
      invitedBy: _idText(json['invitedBy']),
      role: InvitationRole.values.firstWhere(
        (r) => r.toString().split('.').last == roleLabel,
        orElse: () => InvitationRole.wanderer, // Default if invalid
      ),
      status: InvitationStatus.values.firstWhere(
        (s) => s.toString().split('.').last == _text(json['status']),
        orElse: () => InvitationStatus.pending, // Default if invalid
      ),
      createdAt:
          DateTime.tryParse(_text(json['createdAt'])) ??
          DateTime.fromMillisecondsSinceEpoch(0),
      planName: _text(json['planName']),
      roleLabel: roleLabel,
      inviterLabel: _inviterLabel(json['inviter']),
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
