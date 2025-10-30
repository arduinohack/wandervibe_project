import 'package:logger/logger.dart';

final logger = Logger(
  printer: PrettyPrinter(
    methodCount: 0,
    printEmojis: false,
  ), // Clean format, no emojis
  level: Level.all, // Dynamic: debug in dev, info in prod
);

// Helper functions for levels
void logInfo(String message) => logger.i(message);
void logWarning(String message) => logger.w(message);
void logError(String message, [dynamic error]) =>
    logger.e(message, error: error);
