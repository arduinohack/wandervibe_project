import 'dart:typed_data';

class ActivityAttachment {
  final String id;
  final String activityId;
  final String planId;
  final String uploadedBy;
  final String filename;
  final String mimeType;
  final int size;
  final String createdAt;

  const ActivityAttachment({
    required this.id,
    required this.activityId,
    required this.planId,
    required this.uploadedBy,
    required this.filename,
    required this.mimeType,
    required this.size,
    this.createdAt = '',
  });

  static ActivityAttachment? tryParse(dynamic raw) {
    if (raw is! Map) return null;
    final map = Map<String, dynamic>.from(raw);
    final id = _text(map['id']);
    if (id.isEmpty) return null;
    final filename = _text(map['filename']);
    return ActivityAttachment(
      id: id,
      activityId: _text(map['activityId']),
      planId: _text(map['planId']),
      uploadedBy: _text(map['uploadedBy']),
      filename: filename.isEmpty ? 'attachment' : filename,
      mimeType: _text(map['mimeType']),
      size: _size(map['size']),
      createdAt: _text(map['createdAt']),
    );
  }
}

class ActivityAttachmentListResult {
  final int? status;
  final String? error;
  final List<ActivityAttachment> attachments;

  const ActivityAttachmentListResult({
    this.status,
    this.error,
    this.attachments = const [],
  });
}

class ActivityAttachmentWriteResult {
  final int? status;
  final String? error;

  const ActivityAttachmentWriteResult({this.status, this.error});
}

class ActivityAttachmentFileResult {
  final int? status;
  final String? error;
  final Uint8List? bytes;
  final String mimeType;

  const ActivityAttachmentFileResult({
    this.status,
    this.error,
    this.bytes,
    this.mimeType = '',
  });
}

String _text(dynamic value) {
  if (value == null) return '';
  return value.toString().trim();
}

int _size(dynamic value) {
  if (value is num) {
    final rounded = value.round();
    return rounded < 0 ? 0 : rounded;
  }
  final parsed = int.tryParse(_text(value));
  if (parsed == null || parsed < 0) return 0;
  return parsed;
}
