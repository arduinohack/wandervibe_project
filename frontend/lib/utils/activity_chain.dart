class ActivityChainTime {
  final DateTime? start;
  final DateTime? end;

  const ActivityChainTime({required this.start, required this.end});
}

/// Times for one activity dropped after a target.
/// The start is the target's end, or the target's start when that end is
/// missing. A duration sets the end to the new start plus those minutes.
/// Otherwise the end is the new start. A target with no time returns null.
ActivityChainTime? timesAfterTarget({
  required DateTime? targetStart,
  required DateTime? targetEnd,
  required int? durationMinutes,
}) {
  final start = targetEnd ?? targetStart;
  if (start == null) return null;
  final end = durationMinutes == null
      ? start
      : start.add(Duration(minutes: durationMinutes));
  return ActivityChainTime(start: start, end: end);
}

/// Indexes into [following] that stay back to back with [anchor].
/// The first row must start at [anchor]. Each later row must start at the
/// previous row's original end. A gap stops the walk. A matching start with
/// no end is included, and the walk stops there.
List<int> backToBackChainIndexes({
  required List<ActivityChainTime> following,
  required DateTime anchor,
}) {
  final indexes = <int>[];
  var priorEnd = anchor;
  for (var index = 0; index < following.length; index++) {
    final start = following[index].start;
    if (start == null || !start.toUtc().isAtSameMomentAs(priorEnd.toUtc())) {
      break;
    }
    indexes.add(index);
    final end = following[index].end;
    if (end == null) break;
    priorEnd = end;
  }
  return indexes;
}
