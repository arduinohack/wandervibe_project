/// Subtitle lines for one row in the Suggest sheet.
String suggestionListSubtitle({
  double? rating,
  int? reviewCount,
  String? priceLevel,
  String address = '',
  String summary = '',
}) {
  final lines = <String>[];
  final facts = <String>[
    if (rating != null && rating.isFinite) rating.toStringAsFixed(1),
    if (reviewCount != null && reviewCount >= 0) suggestionReviewLabel(reviewCount),
    suggestionPriceLabel(priceLevel),
  ].where((line) => line.isNotEmpty).toList();
  if (facts.isNotEmpty) lines.add(facts.join(' · '));
  final place = address.trim();
  if (place.isNotEmpty) lines.add(place);
  final note = summary.trim();
  if (note.isNotEmpty) lines.add(note);
  return lines.join('\n');
}

/// Places price enums shown as dollar signs. An empty or unknown value is blank.
String suggestionPriceLabel(String? priceLevel) {
  switch (priceLevel) {
    case 'PRICE_LEVEL_FREE':
      return 'Free';
    case 'PRICE_LEVEL_INEXPENSIVE':
      return r'$';
    case 'PRICE_LEVEL_MODERATE':
      return r'$$';
    case 'PRICE_LEVEL_EXPENSIVE':
      return r'$$$';
    case 'PRICE_LEVEL_VERY_EXPENSIVE':
      return r'$$$$';
    default:
      return '';
  }
}

String suggestionReviewLabel(int count) {
  if (count == 1) return '1 review';
  return '$count reviews';
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
