import 'membership_tier.dart';

class PlanAccess {
  final bool plusActive;
  final bool trialActive;
  final DateTime? trialStartedAt;
  final DateTime? trialEndsAt;
  final int plansOwned;
  final String tier;
  final String tierName;
  final int planCap;

  const PlanAccess({
    required this.plusActive,
    required this.trialActive,
    required this.trialStartedAt,
    required this.trialEndsAt,
    required this.plansOwned,
    this.tier = tierTrial,
    this.tierName = tierTrialName,
    this.planCap = 2,
  });

  bool get _paidTier =>
      tier == tierPlanItVibe || tier == tierPlus || tier == tierPro;

  /// Past a started trial, and not on a paid tier. A user who has never started a
  /// trial is still able to edit when their role allows it.
  bool get readOnly =>
      !plusActive && !_paidTier && !trialActive && trialEndsAt != null;

  String? get trialEndsLabel {
    if (!trialActive || trialEndsAt == null) return null;
    final remaining = trialEndsAt!.difference(DateTime.now()).inMilliseconds;
    var days = (remaining / Duration.millisecondsPerDay).ceil();
    if (days < 1) days = 1;
    final unit = days == 1 ? 'day' : 'days';
    return 'Trial ends in $days $unit';
  }

  factory PlanAccess.fromJson(Map<String, dynamic> json) {
    final rawTier = json['tier'];
    final tier = rawTier is String && rawTier.trim().isNotEmpty
        ? rawTier.trim()
        : (json['plusActive'] == true ? tierPlus : tierTrial);
    final rawName = json['tierName'];
    final rawCap = json['planCap'];
    return PlanAccess(
      plusActive: json['plusActive'] == true || tier != tierTrial,
      trialActive: json['trialActive'] == true,
      trialStartedAt: _date(json['trialStartedAt']),
      trialEndsAt: _date(json['trialEndsAt']),
      plansOwned: json['plansOwned'] is num
          ? (json['plansOwned'] as num).round()
          : 0,
      tier: tier,
      tierName: rawName is String && rawName.trim().isNotEmpty
          ? rawName.trim()
          : tierDisplayName(tier),
      planCap: rawCap is num ? rawCap.round() : planCapForTier(tier),
    );
  }
}

DateTime? _date(Object? value) {
  if (value is! String || value.trim().isEmpty) return null;
  return DateTime.tryParse(value);
}
