class ActivityReactions {
  static const types = ['up', 'down', 'yes', 'no', 'maybe'];

  final Map<String, int> counts;
  final List<String> myVotes;

  const ActivityReactions({
    this.counts = const {},
    this.myVotes = const [],
  });

  static const empty = ActivityReactions();

  int count(String type) => counts[type] ?? 0;

  bool mine(String type) => myVotes.contains(type);

  factory ActivityReactions.fromJson(Map<String, dynamic> json) {
    final raw = json['counts'];
    final counts = <String, int>{};
    if (raw is Map) {
      for (final type in types) {
        final value = raw[type];
        counts[type] = value is num ? value.round() : 0;
      }
    }
    final votes = <String>[];
    final mine = json['myVotes'];
    if (mine is List) {
      for (final item in mine) {
        final type = item == null ? '' : item.toString();
        if (types.contains(type) && !votes.contains(type)) votes.add(type);
      }
    }
    return ActivityReactions(counts: counts, myVotes: votes);
  }
}

class ActivityReactionResult {
  final int? status;
  final String? error;

  const ActivityReactionResult({this.status, this.error});
}
