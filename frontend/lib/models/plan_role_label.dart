/// UI label for a stored membership role. Only the plan type `plan` uses the
/// event labels. Any other type, including a missing type, uses the trip labels.
/// The stored role itself is unchanged.
String planRoleLabel(String? planType, String storedRole) {
  final eventType = (planType ?? '').trim().toLowerCase() == 'plan';
  switch (storedRole.trim().toLowerCase()) {
    case 'owner':
    case 'vibecoordinator':
      return eventType ? 'Host' : 'Organizer';
    case 'collaborator':
    case 'vibeplanner':
      return eventType ? 'Planner' : 'Co-Planner';
    case 'guest':
    case 'wanderer':
      return eventType ? 'Guest' : 'Attendee';
    default:
      final raw = storedRole.trim();
      return raw.isEmpty ? 'Unknown' : raw;
  }
}
