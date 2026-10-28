import 'dart:io';
import 'dart:typed_data';

import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'attachment_cache.dart';
import 'logger.dart';

class DeviceAttachmentFileCache implements AttachmentFileCache {
  @override
  Future<Set<String>> savedIds() async {
    try {
      final index = await _readIndex();
      final kept = <String, String>{};
      for (final entry in index.paths.entries) {
        if (await File(entry.value).exists()) kept[entry.key] = entry.value;
      }
      if (kept.length != index.paths.length) {
        await _writeIndex(AttachmentCacheIndex(kept));
      }
      return kept.keys.toSet();
    } catch (e) {
      logger.e('Could not list saved attachments: $e');
      return {};
    }
  }

  @override
  Future<Uint8List?> read(String attachmentId) async {
    try {
      final index = await _readIndex();
      final path = index.pathFor(attachmentId);
      if (path == null) return null;
      final file = File(path);
      if (!await file.exists()) {
        await _writeIndex(index.without(attachmentId));
        return null;
      }
      final bytes = await file.readAsBytes();
      if (bytes.isEmpty) return null;
      return bytes;
    } catch (e) {
      logger.e('Could not read saved attachment: $e');
      return null;
    }
  }

  @override
  Future<bool> save({
    required String attachmentId,
    required String filename,
    required String mimeType,
    required Uint8List bytes,
  }) async {
    try {
      final documents = await getApplicationDocumentsDirectory();
      final full = attachmentCacheFullPath(
        documentsDir: documents.path,
        attachmentId: attachmentId,
        mimeType: mimeType,
        filename: filename,
        separator: Platform.pathSeparator,
      );
      if (full == null) return false;
      final index = await _readIndex();
      final previous = index.pathFor(attachmentId);
      final file = File(full);
      await file.parent.create(recursive: true);
      await file.writeAsBytes(bytes, flush: true);
      if (previous != null && previous != full) {
        final old = File(previous);
        if (await old.exists()) await old.delete();
      }
      await _writeIndex(index.withPath(attachmentId, full));
      return true;
    } catch (e) {
      logger.e('Could not save attachment: $e');
      return false;
    }
  }

  @override
  Future<void> remove(String attachmentId) async {
    AttachmentCacheIndex? index;
    try {
      index = await _readIndex();
      final path = index.pathFor(attachmentId);
      if (path != null) {
        final file = File(path);
        if (await file.exists()) await file.delete();
      }
    } catch (e) {
      logger.e('Could not delete saved attachment: $e');
    }
    if (index == null) return;
    try {
      await _writeIndex(index.without(attachmentId));
    } catch (e) {
      logger.e('Could not update saved attachments: $e');
    }
  }

  Future<AttachmentCacheIndex> _readIndex() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(attachmentCachePrefsKey);
    if (raw == null || raw.trim().isEmpty) return const AttachmentCacheIndex();
    try {
      return AttachmentCacheIndex.decode(raw);
    } catch (_) {
      return const AttachmentCacheIndex();
    }
  }

  Future<void> _writeIndex(AttachmentCacheIndex index) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(attachmentCachePrefsKey, index.encode());
  }
}
