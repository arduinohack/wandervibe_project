String _text(dynamic value) {
  if (value == null) return '';
  return value.toString();
}

/// One accepted member or pending invitation from GET /api/plans/:planId/members.
class PlanMember {
  final String name;
  final String email;
  final String role;
  final String status;

  const PlanMember({
    required this.name,
    required this.email,
    required this.role,
    required this.status,
  });

  factory PlanMember.fromJson(Map<String, dynamic> json) {
    return PlanMember(
      name: _text(json['name']),
      email: _text(json['email']),
      role: _text(json['role']),
      status: _text(json['status']),
    );
  }
}

bool _isStoredOwner(String role) {
  switch (role.trim().toLowerCase()) {
    case 'owner':
    case 'vibecoordinator':
      return true;
    default:
      return false;
  }
}

/// Owner once at the top, then accepted Collaborators and Guests plus pending invites.
List<PlanMember> peopleScreenMembers(List<PlanMember> members) {
  PlanMember? owner;
  final rest = <PlanMember>[];
  for (final member in members) {
    if (_isStoredOwner(member.role)) {
      owner ??= member;
    } else {
      rest.add(member);
    }
  }
  return [if (owner != null) owner, ...rest];
}
