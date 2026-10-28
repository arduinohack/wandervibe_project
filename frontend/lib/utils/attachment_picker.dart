import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';

import 'activity_attachment.dart';

class PickedAttachmentFile {
  final String filename;
  final Uint8List bytes;

  const PickedAttachmentFile({required this.filename, required this.bytes});
}

class AttachmentPickResult {
  final PickedAttachmentFile? file;
  final bool cancelled;

  const AttachmentPickResult.cancelled() : file = null, cancelled = true;

  const AttachmentPickResult.unreadable() : file = null, cancelled = false;

  const AttachmentPickResult.file(this.file) : cancelled = false;
}

/// Opens the device picker for one image or PDF. Cancel returns [cancelled].
/// The bytes stay in memory for the upload. Nothing is copied into app storage.
Future<AttachmentPickResult> pickAttachmentFile() async {
  final result = await FilePicker.pickFiles(
    type: FileType.custom,
    allowedExtensions: attachmentFileExtensions,
    withData: true,
    allowMultiple: false,
  );
  if (result == null || result.files.isEmpty) {
    return const AttachmentPickResult.cancelled();
  }
  final file = result.files.single;
  Uint8List? bytes = file.bytes;
  if ((bytes == null || bytes.isEmpty) && !kIsWeb) {
    try {
      final loaded = await file.xFile.readAsBytes();
      if (loaded.isNotEmpty) bytes = loaded;
    } catch (_) {
      bytes = null;
    }
  }
  if (bytes == null || bytes.isEmpty) {
    return const AttachmentPickResult.unreadable();
  }
  return AttachmentPickResult.file(
    PickedAttachmentFile(
      filename: attachmentUploadName(file.name),
      bytes: bytes,
    ),
  );
}
