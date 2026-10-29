/// Subtitle lines for one row in the Suggest sheet.
String suggestionListSubtitle({
  String address = '',
  String summary = '',
}) {
  final lines = <String>[];
  final place = address.trim();
  if (place.isNotEmpty) lines.add(place);
  final note = summary.trim();
  if (note.isNotEmpty) lines.add(note);
  return lines.join('\n');
}

const suggestTypeQueryWords = <String, String>{
  'dining': 'restaurant',
  'hotel': 'hotel',
  'attraction': 'attraction',
  'tour': 'tour',
};

/// The text sent to place suggest. Null means the sheet has nothing to search.
String? suggestSearchQuery({
  required String typed,
  String? activityType,
  String location = '',
  String destination = '',
}) {
  final text = typed.trim();
  if (text.isNotEmpty) return text;
  final word = suggestTypeQueryWords[activityType?.trim().toLowerCase() ?? ''];
  if (word == null || word.isEmpty) return null;
  final supplied = location.trim();
  final place = supplied.isNotEmpty ? supplied : destination.trim();
  if (place.isEmpty) return word;
  if (word.toLowerCase().contains(place.toLowerCase())) return word;
  return '$word in $place';
}

/// Query for an activity whose type is already dining, hotel, attraction, or tour.
/// The type word, any typed text, and the form location (or plan destination) are combined.
String? suggestLockedTypeQuery({
  required String typed,
  String? activityType,
  String location = '',
  String destination = '',
}) {
  final word = suggestTypeQueryWords[activityType?.trim().toLowerCase() ?? ''];
  if (word == null || word.isEmpty) return null;
  final text = typed.trim();
  final wordLower = word.toLowerCase();
  final textLower = text.toLowerCase();
  final String core;
  if (text.isEmpty || textLower == wordLower || textLower.startsWith('$wordLower ')) {
    core = text.isEmpty ? word : text;
  } else {
    core = '$word $text';
  }
  final supplied = location.trim();
  final place = supplied.isNotEmpty ? supplied : destination.trim();
  if (place.isEmpty) return core;
  if (core.toLowerCase().contains(place.toLowerCase())) return core;
  return '$core in $place';
}
