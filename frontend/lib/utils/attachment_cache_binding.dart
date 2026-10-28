import 'package:flutter/foundation.dart';

import 'attachment_cache.dart';
import 'attachment_cache_store_web.dart'
    if (dart.library.io) 'attachment_cache_store.dart';

AttachmentFileCache? createAttachmentFileCache() {
  if (!attachmentCacheEnabled(
    web: kIsWeb,
    platform: defaultTargetPlatform.name,
  )) {
    return null;
  }
  return DeviceAttachmentFileCache();
}
