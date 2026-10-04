class ActivityChainInput {
  final DateTime? start;
  final DateTime? end;
  final int? durationMinutes;

  const ActivityChainInput({
    required this.start,
    required this.end,
    required this.durationMinutes,
  });
}

class ActivityChainTime {
  final DateTime? start;
  final DateTime? end;

  const ActivityChainTime({required this.start, required this.end});
}

/// Times for [activities] in their current order.
/// A start that is already set stays, and so does that activity's end.
/// A cleared start uses the previous activity's end, or its start when that
/// end is missing. The first activity's cleared start stays empty.
List<ActivityChainTime> chainActivityTimes(List<ActivityChainInput> activities) {
  final chained = <ActivityChainTime>[];
  for (var index = 0; index < activities.length; index++) {
    final activity = activities[index];
    if (activity.start != null) {
      chained.add(ActivityChainTime(start: activity.start, end: activity.end));
      continue;
    }
    if (index == 0) {
      chained.add(ActivityChainTime(start: null, end: activity.end));
      continue;
    }
    final previous = chained[index - 1];
    chained.add(
      ActivityChainTime(
        start: previous.end ?? previous.start,
        end: activity.end,
      ),
    );
  }
  return chained;
}
