import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'config/config.dart';
import 'config/constants.dart';
import 'session_bridge.dart';
import 'storage/token_store.dart';
import 'utils/logger.dart';

Future<bool>? _inFlight;

/// One refresh at a time. Parallel 401s share this future so the refresh
/// token is not rotated twice.
Future<bool> refreshSession() {
  final existing = _inFlight;
  if (existing != null) return existing;
  final run = _refreshOnce();
  _inFlight = run;
  return run.whenComplete(() {
    if (identical(_inFlight, run)) _inFlight = null;
  });
}

Future<bool> _refreshOnce() async {
  final refreshToken = await readRefreshToken();
  if (refreshToken == null || refreshToken.isEmpty) return false;
  try {
    final timeout = Duration(seconds: await AppConfig.timeoutSeconds);
    final response = await http
        .post(
          Uri.parse(backendBaseUrl + apiAuthRefresh),
          headers: {'Content-Type': 'application/json'},
          body: json.encode({'refreshToken': refreshToken}),
        )
        .timeout(timeout);
    if (response.statusCode != 200) return false;
    final decoded = json.decode(response.body);
    if (decoded is! Map) return false;
    final token = decoded['token'];
    final nextRefresh = decoded['refreshToken'];
    if (token is! String || token.isEmpty) return false;
    await writeToken(token);
    if (nextRefresh is String && nextRefresh.isNotEmpty) {
      await writeRefreshToken(nextRefresh);
    }
    final refreshed = onSessionRefreshed;
    if (refreshed != null) refreshed(token);
    return true;
  } catch (e) {
    logger.e('Refresh error: $e');
    return false;
  }
}
