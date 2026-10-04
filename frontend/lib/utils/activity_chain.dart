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
