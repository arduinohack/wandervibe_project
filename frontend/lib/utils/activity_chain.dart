import 'activity_time.dart';

class ActivityChainTime {
  final DateTime? start;
  final DateTime? end;
  final int? durationMinutes;

  const ActivityChainTime({
    required this.start,
    required this.end,
    this.durationMinutes,
  });
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

/// 8:30 AM in [planTimeZone], on the earliest activity's calendar day.
/// An empty plan uses [now], or the current time when [now] is omitted.
DateTime defaultChainStart({
  required List<DateTime?> existingStarts,
  required String planTimeZone,
  DateTime? now,
}) {
  final zone = planTimeZone.trim().isEmpty ? 'UTC' : planTimeZone.trim();
  DateTime? earliest;
  for (final start in existingStarts) {
    if (start == null) continue;
    final utc = start.toUtc();
    if (earliest == null || utc.isBefore(earliest)) earliest = utc;
  }
  final clock = clockInZone((earliest ?? (now ?? DateTime.now())).toUtc(), zone);
  return instantFromWall(
    year: clock.year,
    month: clock.month,
    day: clock.day,
    hour: 8,
    minute: 30,
    zone: zone,
  );
}

int? _preservedMinutes(ActivityChainTime row) {
  final stored = row.durationMinutes;
  if (stored != null && stored >= 0) return stored;
  final start = row.start;
  final end = row.end;
  if (start == null || end == null) return null;
  final minutes = end.toUtc().difference(start.toUtc()).inMinutes;
  if (minutes < 0) return null;
  return minutes;
}

/// Joined followers move onto [newPriorEnd]. Each keeps its duration.
/// The walk is the same back-to-back chain, and it stops at the first gap.
List<ActivityChainTime> shiftJoinedChain({
  required List<ActivityChainTime> following,
  required DateTime anchor,
  required DateTime? newPriorEnd,
}) {
  if (newPriorEnd == null) return const [];
  final indexes = backToBackChainIndexes(following: following, anchor: anchor);
  final shifted = <ActivityChainTime>[];
  var priorEnd = newPriorEnd.toUtc();
  for (final index in indexes) {
    final row = following[index];
    final minutes = _preservedMinutes(row);
    final start = priorEnd;
    final end = minutes == null ? null : start.add(Duration(minutes: minutes));
    shifted.add(
      ActivityChainTime(
        start: start,
        end: end,
        durationMinutes: row.durationMinutes ?? minutes,
      ),
    );
    if (row.end == null || end == null) break;
    priorEnd = end;
  }
  return shifted;
}

/// After a move, joined activities that were after the removed row close up.
List<ActivityChainTime> closeJoinedHole({
  required List<ActivityChainTime> following,
  required DateTime removedEnd,
  required DateTime? newPriorEnd,
}) {
  return shiftJoinedChain(
    following: following,
    anchor: removedEnd,
    newPriorEnd: newPriorEnd,
  );
}
