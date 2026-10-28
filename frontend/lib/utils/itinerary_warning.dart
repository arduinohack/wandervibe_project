/// Short label for an activity whose time overlaps the one before it.
String overlapWarningText() => 'Overlaps previous';

/// Short label for a gap that is shorter than the estimated trip.
String tightTravelWarningText(int? minutes) {
  if (minutes == null) return 'Tight travel';
  return 'Tight travel (~$minutes min)';
}

String overlapWarningDetail(String name) {
  final label = name.trim().isEmpty ? 'This activity' : name.trim();
  return '$label overlaps the previous activity.';
}

String tightTravelWarningDetail(int? minutes) {
  if (minutes == null) {
    return 'There is not enough time to travel from the previous activity.';
  }
  return 'Travel from the previous activity takes about $minutes min, and the gap is shorter.';
}
