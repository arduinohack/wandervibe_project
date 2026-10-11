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

bool _isAcceptedMember(PlanMember member) {
  return member.status.trim().toLowerCase() == 'accepted';
}

bool _isCollaboratorRole(String role) {
  switch (role.trim().toLowerCase()) {
    case 'collaborator':
    case 'vibeplanner':
      return true;
    default:
      return false;
  }
}

/// Accepted owner, then accepted co-planners. Pending people, guests, and
/// attendees are left out. An empty email is left out.
List<PlanMember> linkedPlanPlanners(List<PlanMember> members) {
  final owners = <PlanMember>[];
  final planners = <PlanMember>[];
  for (final member in members) {
    if (!_isAcceptedMember(member) || member.email.trim().isEmpty) continue;
    if (_isStoredOwner(member.role)) {
      owners.add(member);
    } else if (_isCollaboratorRole(member.role)) {
      planners.add(member);
    }
  }
  return [...owners, ...planners];
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
