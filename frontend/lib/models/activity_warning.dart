/// One advisory row from GET /api/plans/:planId/warnings.
class ActivityWarning {
  final String type;
  final String activityId;
  final String otherActivityId;
  final String message;
  final String severity;

  const ActivityWarning({
    required this.type,
    required this.activityId,
    required this.otherActivityId,
    required this.message,
    required this.severity,
  });

  factory ActivityWarning.fromJson(Map<String, dynamic> json) {
    return ActivityWarning(
      type: json['type']?.toString() ?? '',
      activityId: json['activityId']?.toString() ?? '',
      otherActivityId: json['otherActivityId']?.toString() ?? '',
      message: json['message']?.toString().trim() ?? '',
      severity: json['severity']?.toString() ?? 'warning',
    );
  }
}
