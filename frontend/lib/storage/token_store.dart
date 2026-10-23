import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _tokenKey = 'jwt_token';
const _refreshKey = 'refresh_token';
const _hasRefreshKey = 'has_refresh_token';
const _biometricEnabledKey = 'biometric_unlock';
const _biometricPromptedKey = 'biometric_prompted';
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

// The has-refresh flag is not the secret. Cold start can decide to prompt
// biometrics before secure storage is read.
Future<void> writeRefreshToken(String value) async {
  if (kIsWeb) {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_refreshKey, value);
  } else {
    await _secureStorage.write(key: _refreshKey, value: value);
  }
  final prefs = await SharedPreferences.getInstance();
  await prefs.setBool(_hasRefreshKey, true);
}

Future<String?> readRefreshToken() async {
  if (kIsWeb) {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(_refreshKey);
    if (value == null || value.isEmpty) return null;
    return value;
  }
  final value = await _secureStorage.read(key: _refreshKey);
  if (value == null || value.isEmpty) return null;
  return value;
}

Future<void> deleteRefreshToken() async {
  if (kIsWeb) {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_refreshKey);
  } else {
    await _secureStorage.delete(key: _refreshKey);
  }
  final prefs = await SharedPreferences.getInstance();
  await prefs.setBool(_hasRefreshKey, false);
}

Future<bool> hasRefreshTokenFlag() async {
  final prefs = await SharedPreferences.getInstance();
  return prefs.getBool(_hasRefreshKey) ?? false;
}

Future<bool> biometricEnabled() async {
  final prefs = await SharedPreferences.getInstance();
  return prefs.getBool(_biometricEnabledKey) ?? false;
}

Future<void> setBiometricEnabled(bool value) async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.setBool(_biometricEnabledKey, value);
}

Future<bool> biometricPrompted() async {
  final prefs = await SharedPreferences.getInstance();
  return prefs.getBool(_biometricPromptedKey) ?? false;
}

Future<void> markBiometricPrompted() async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.setBool(_biometricPromptedKey, true);
}

Future<void> clearBiometricPreference() async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.remove(_biometricEnabledKey);
  await prefs.remove(_biometricPromptedKey);
}
