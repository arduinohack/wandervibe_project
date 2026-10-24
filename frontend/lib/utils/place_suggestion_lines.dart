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
