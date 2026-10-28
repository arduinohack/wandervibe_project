const attachmentMaxBytes = 10 * 1024 * 1024;

const attachmentFileExtensions = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'heic',
  'heif',
  'pdf',
];

const attachmentNetworkMessage = 'Could not reach the server.';
const attachmentSizeMessage = 'File must be 10 MB or smaller.';
const attachmentTypeMessage = 'Only images and PDF files can be attached.';

String attachmentUploadName(String filename) {
  final normalized = filename.replaceAll('\\', '/');
  final base = normalized.split('/').last.trim();
  return base.isEmpty ? 'attachment' : base;
}

String formatAttachmentSize(int bytes) {
  final size = bytes < 0 ? 0 : bytes;
  if (size < 1024) return '$size B';
  if (size < 1024 * 1024) return '${_oneDecimal(size / 1024)} KB';
  return '${_oneDecimal(size / (1024 * 1024))} MB';
}

String attachmentErrorMessage(int? status, String? apiMessage) {
  if (status == null) return attachmentNetworkMessage;
  final message = apiMessage?.trim() ?? '';
  switch (status) {
    case 401:
      return message.isEmpty ? 'Sign in again to continue.' : message;
    case 403:
      return message.isEmpty
          ? 'Only a plan member can open this file.'
          : message;
    case 413:
      return message.isEmpty ? attachmentSizeMessage : message;
    case 415:
      return message.isEmpty ? attachmentTypeMessage : message;
    default:
      return message.isEmpty ? 'Could not update attachments.' : message;
  }
}

bool canAddActivityAttachment(String? storedRole) {
  final role = storedRole?.trim();
  return role == 'Owner' || role == 'Collaborator';
}

bool canDeleteActivityAttachment({
  required String? storedRole,
  required String? userId,
  required String uploadedBy,
}) {
  if (storedRole?.trim() == 'Guest') return false;
  if (storedRole?.trim() == 'Owner') return true;
  final me = userId?.trim() ?? '';
  final author = uploadedBy.trim();
  return me.isNotEmpty && me == author;
}

bool attachmentIsPdf(String mimeType, String filename) {
  if (_mime(mimeType) == 'application/pdf') return true;
  return filename.toLowerCase().endsWith('.pdf');
}

bool attachmentIsImage(String mimeType, String filename) {
  final mime = _mime(mimeType);
  if (mime.startsWith('image/')) return true;
  final lower = filename.toLowerCase();
  for (final extension in attachmentFileExtensions) {
    if (extension == 'pdf') continue;
    if (lower.endsWith('.$extension')) return true;
  }
  return false;
}

String _mime(String mimeType) {
  return mimeType.toLowerCase().split(';').first.trim();
}

String _oneDecimal(double value) {
  final rounded = (value * 10).round() / 10;
  if (rounded == rounded.roundToDouble()) return rounded.round().toString();
  return rounded.toStringAsFixed(1);
}
