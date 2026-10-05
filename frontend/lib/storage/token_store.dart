import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _tokenKey = 'jwt_token';
const FlutterSecureStorage _secureStorage = FlutterSecureStorage();

// Web secure storage null-checks window.crypto and a missing localStorage
// value. Shared preferences returns null when the key is absent.
Future<void> writeToken(String value) async {
  if (kIsWeb) {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenKey, value);
    return;
  }
  await _secureStorage.write(key: _tokenKey, value: value);
}

Future<String?> readToken() async {
  if (kIsWeb) {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(_tokenKey);
    if (value == null || value.isEmpty) return null;
    return value;
  }
  final value = await _secureStorage.read(key: _tokenKey);
  if (value == null || value.isEmpty) return null;
  return value;
}

Future<void> deleteToken() async {
  if (kIsWeb) {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_tokenKey);
    return;
  }
  await _secureStorage.delete(key: _tokenKey);
}
