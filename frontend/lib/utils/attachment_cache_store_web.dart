import 'dart:typed_data';

import 'attachment_cache.dart';

/// Web has no persistent attachment cache. Every View downloads the file.
class DeviceAttachmentFileCache implements AttachmentFileCache {
  @override
  Future<Set<String>> savedIds() async => const {};

  @override
  Future<Uint8List?> read(String attachmentId) async => null;

  @override
  Future<bool> save({
    required String attachmentId,
    required String filename,
    required String mimeType,
    required Uint8List bytes,
  }) async {
    return false;
  }

  @override
  Future<void> remove(String attachmentId) async {}
}
