class PlanAccess {
  final bool plusActive;
  final bool trialActive;
  final DateTime? trialStartedAt;
  final DateTime? trialEndsAt;
  final int plansOwned;

  const PlanAccess({
    required this.plusActive,
    required this.trialActive,
    required this.trialStartedAt,
    required this.trialEndsAt,
    required this.plansOwned,
  });

  /// Past a started trial, and not on Plus. A user who has never started a
  /// trial is still able to edit when their role allows it.
  bool get readOnly => !plusActive && !trialActive && trialEndsAt != null;

  String? get trialEndsLabel {
    if (!trialActive || trialEndsAt == null) return null;
    final remaining = trialEndsAt!.difference(DateTime.now()).inMilliseconds;
    var days = (remaining / Duration.millisecondsPerDay).ceil();
    if (days < 1) days = 1;
    final unit = days == 1 ? 'day' : 'days';
    return 'Trial ends in $days $unit';
  }

  factory PlanAccess.fromJson(Map<String, dynamic> json) {
    return PlanAccess(
      plusActive: json['plusActive'] == true,
      trialActive: json['trialActive'] == true,
      trialStartedAt: _date(json['trialStartedAt']),
      trialEndsAt: _date(json['trialEndsAt']),
      plansOwned: json['plansOwned'] is num
          ? (json['plansOwned'] as num).round()
          : 0,
    );
  }
}

DateTime? _date(Object? value) {
  if (value is! String || value.trim().isEmpty) return null;
  return DateTime.tryParse(value);
}
