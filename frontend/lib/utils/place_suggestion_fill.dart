/// Fields copied from a selected place suggestion onto the open activity form.
class ActivitySuggestionFill {
  final String name;
  final String location;
  final String googlePlaceId;
  final String details;
  final bool setLocation;

  const ActivitySuggestionFill({
    required this.name,
    required this.location,
    required this.googlePlaceId,
    required this.details,
    required this.setLocation,
  });
}

/// Appends [summary] when it has text. A blank summary leaves [details] as it is.
String appendSuggestionSummary(String details, String summary) {
  final extra = summary.trim();
  if (extra.isEmpty) return details;
  final current = details.trimRight();
  if (current.isEmpty) return extra;
  if (current == extra || current.endsWith('\n$extra')) return details;
  return '$current\n$extra';
}

/// Fills the open form from one suggestion. Does not save the activity.
ActivitySuggestionFill fillActivityFromSuggestion({
  required String currentName,
  required String currentLocation,
  required String currentDetails,
  required String placeName,
  required String address,
  required String placeId,
  required String summary,
}) {
  final name = placeName.trim();
  final place = address.trim();
  return ActivitySuggestionFill(
    name: name.isEmpty ? currentName : name,
    location: place.isEmpty ? currentLocation : place,
    googlePlaceId: placeId.trim(),
    details: appendSuggestionSummary(currentDetails, summary),
    setLocation: place.isNotEmpty,
  );
}
