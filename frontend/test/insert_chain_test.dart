import 'package:flutter_test/flutter_test.dart';
import 'package:wandervibe_frontend/utils/activity_chain.dart';

void main() {
  final ten = DateTime.utc(2026, 10, 5, 10);
  final eleven = DateTime.utc(2026, 10, 5, 11);
  final elevenTwenty = DateTime.utc(2026, 10, 5, 11, 20);
  final elevenThirty = DateTime.utc(2026, 10, 5, 11, 30);
  final noon = DateTime.utc(2026, 10, 5, 12);

  test('insert after keeps the 11:00 follower and leaves the noon gap', () {
    final indexes = backToBackChainIndexes(
      following: [
        const ActivityChainTime(start: null, end: null),
      ],
      anchor: eleven,
    );
    expect(indexes, isEmpty);

    final chain = backToBackChainIndexes(
      following: [
        ActivityChainTime(start: eleven, end: elevenTwenty),
        ActivityChainTime(start: noon, end: noon.add(const Duration(hours: 1))),
      ],
      anchor: eleven,
    );
    expect(chain, [0]);

    final missed = backToBackChainIndexes(
      following: [
        ActivityChainTime(start: eleven, end: elevenTwenty),
      ],
      anchor: elevenThirty,
    );
    expect(missed, isEmpty);
  });

  test('a matching start with no end is shifted and stops the chain', () {
    final indexes = backToBackChainIndexes(
      following: [
        ActivityChainTime(start: eleven, end: null),
        ActivityChainTime(start: eleven, end: elevenThirty),
      ],
      anchor: eleven,
    );
    expect(indexes, [0]);
  });

  test('insert above at the top includes the old first row and its chain', () {
    final indexes = backToBackChainIndexes(
      following: [
        ActivityChainTime(start: ten, end: eleven),
        ActivityChainTime(start: eleven, end: elevenTwenty),
        ActivityChainTime(start: noon, end: null),
      ],
      anchor: ten,
    );
    expect(indexes, [0, 1]);
  });

  test('insert above stops when the selected row does not meet the row above', () {
    final indexes = backToBackChainIndexes(
      following: [
        ActivityChainTime(start: eleven, end: elevenTwenty),
        ActivityChainTime(start: noon, end: null),
      ],
      anchor: ten,
    );
    expect(indexes, isEmpty);
  });

  test('two touching rows shift and the row after a gap stays', () {
    final indexes = backToBackChainIndexes(
      following: [
        ActivityChainTime(start: eleven, end: elevenTwenty),
        ActivityChainTime(start: elevenTwenty, end: elevenThirty),
        ActivityChainTime(start: noon, end: noon.add(const Duration(hours: 1))),
      ],
      anchor: eleven,
    );
    expect(indexes, [0, 1]);
  });
}
