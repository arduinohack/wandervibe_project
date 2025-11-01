import 'package:shared_preferences/shared_preferences.dart';

class AppConfig {
  static const String _timeoutKey = 'network_timeout_seconds';
  static const String _durationKey = 'default_duration_minutes';
  static const int _defaultTimeoutSeconds = 30;
  static const int _defaultDurationMinutes = 60;

  // Get timeout seconds from SharedPreferences (default 30s)
  static Future<int> get timeoutSeconds async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getInt(_timeoutKey) ?? _defaultTimeoutSeconds;
  }

  // Set timeout seconds
  static Future<void> setTimeoutSeconds(int seconds) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(_timeoutKey, seconds);
  }

  // Get default duration in minutes (default 60min)
  static Future<int> get defaultDurationMinutes async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getInt(_durationKey) ?? _defaultDurationMinutes;
  }

  // Set default duration in minutes
  static Future<void> setDefaultDurationMinutes(int minutes) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(_durationKey, minutes);
  }
}
