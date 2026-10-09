/// UI label for a stored membership role. Only the plan type `plan` uses the
/// plan labels. Any other type, including a missing type, uses the trip labels.
/// The stored role itself is unchanged.
String planRoleLabel(String? planType, String storedRole) {
  final usesPlanLabels = (planType ?? '').trim().toLowerCase() == 'plan';
  switch (storedRole.trim().toLowerCase()) {
    case 'owner':
    case 'vibecoordinator':
      return usesPlanLabels ? 'Host' : 'Organizer';
    case 'collaborator':
    case 'vibeplanner':
      return usesPlanLabels ? 'Planner' : 'Co-Planner';
    case 'guest':
    case 'wanderer':
      return usesPlanLabels ? 'Guest' : 'Attendee';
    default:
      final raw = storedRole.trim();
      return raw.isEmpty ? 'Unknown' : raw;
  }
}

/// Role line on the plan people list. Pending keeps the type label and adds Pending.
String planMemberRoleLine(String? planType, String storedRole, String status) {
  final label = planRoleLabel(planType, storedRole);
  if (status.trim().toLowerCase() == 'pending') {
    return '$label Pending';
  }
  return label;
}

/// Stored roles an Owner or Collaborator may send. Guest gets none.
/// The POST body uses these names. The form shows [planRoleLabel].
List<String> inviteStoredRoles(String? storedRole) {
  final role = storedRole?.trim();
  if (role == 'Owner') return const ['Collaborator', 'Guest'];
  if (role == 'Collaborator') return const ['Guest'];
  return const [];
}
