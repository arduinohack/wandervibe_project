import 'package:flutter_test/flutter_test.dart';
import 'package:wandervibe_frontend/utils/place_suggestion_lines.dart';

void main() {
  test('a result shows rating, review count, price, address, and summary', () {
    expect(
      suggestionListSubtitle(
        rating: 4.5,
        reviewCount: 128,
        priceLevel: 'PRICE_LEVEL_MODERATE',
        address: 'Paris, France',
        summary: 'A small cafe.',
      ),
      '4.5 · 128 reviews · \$\$\nParis, France\nA small cafe.',
    );
  });

  test('missing rating, reviews, and price leave the address and summary', () {
    expect(
      suggestionListSubtitle(
        address: 'Rome, Italy',
        summary: 'A hotel.',
      ),
      'Rome, Italy\nA hotel.',
    );
  });

  test('one review uses the singular label', () {
    expect(
      suggestionListSubtitle(reviewCount: 1, priceLevel: 'PRICE_LEVEL_FREE'),
      '1 review · Free',
    );
  });
}
