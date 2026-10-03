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
/// The first start stays. Each later start is the previous end, or the
/// previous start when that end is missing. When durationMinutes is set, the
/// end is the new start plus those minutes. Otherwise the end is the new start.
List<ActivityChainTime> chainActivityTimes(List<ActivityChainInput> activities) {
  final chained = <ActivityChainTime>[];
  for (var index = 0; index < activities.length; index++) {
    final activity = activities[index];
    final DateTime? start;
    if (index == 0) {
      start = activity.start;
    } else {
      final previous = chained[index - 1];
      start = previous.end ?? previous.start;
    }
    final DateTime? end;
    final minutes = activity.durationMinutes;
    if (start == null) {
      end = null;
    } else if (minutes != null) {
      end = start.add(Duration(minutes: minutes));
    } else {
      end = start;
    }
    chained.add(ActivityChainTime(start: start, end: end));
  }
  return chained;
}
