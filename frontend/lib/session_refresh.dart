import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'config/config.dart';
import 'config/constants.dart';
import 'session_bridge.dart';
import 'storage/token_store.dart';
import 'utils/logger.dart';

enum RefreshOutcome { refreshed, unauthorized, failed }

Future<RefreshOutcome>? _inFlight;

/// One refresh at a time. Parallel 401s share this future so the refresh
/// token is not rotated twice.
Future<bool> refreshSession() async {
  return (await refreshSessionOutcome()) == RefreshOutcome.refreshed;
}

Future<RefreshOutcome> refreshSessionOutcome() {
  final existing = _inFlight;
  if (existing != null) return existing;
  final run = _refreshOnce();
  _inFlight = run;
  return run.whenComplete(() {
    if (identical(_inFlight, run)) _inFlight = null;
  });
}

Future<RefreshOutcome> _refreshOnce() async {
  final refreshToken = await readRefreshToken();
  if (refreshToken == null || refreshToken.isEmpty) {
    logger.i('Refresh result=failed status=none');
    return RefreshOutcome.failed;
  }
  try {
    final timeout = Duration(seconds: await AppConfig.timeoutSeconds);
    final response = await http
        .post(
          Uri.parse(backendBaseUrl + apiAuthRefresh),
          headers: {'Content-Type': 'application/json'},
          body: json.encode({'refreshToken': refreshToken}),
        )
        .timeout(timeout);
    if (response.statusCode == 401) {
      logger.i('Refresh result=unauthorized status=401');
      return RefreshOutcome.unauthorized;
    }
    if (response.statusCode != 200) {
      logger.i('Refresh result=failed status=${response.statusCode}');
      return RefreshOutcome.failed;
    }
    final decoded = json.decode(response.body);
    if (decoded is! Map) {
      logger.i('Refresh result=failed status=200');
      return RefreshOutcome.failed;
    }
    final token = decoded['token'];
    final nextRefresh = decoded['refreshToken'];
    if (token is! String || token.isEmpty) {
      logger.i('Refresh result=failed status=200');
      return RefreshOutcome.failed;
    }
    await writeToken(token);
    if (nextRefresh is String && nextRefresh.isNotEmpty) {
      await writeRefreshToken(nextRefresh);
    }
    final refreshed = onSessionRefreshed;
    if (refreshed != null) refreshed(token);
    logger.i('Refresh result=refreshed status=200');
    return RefreshOutcome.refreshed;
  } catch (e) {
    logger.e('Refresh error: $e');
    logger.i('Refresh result=failed status=error');
    return RefreshOutcome.failed;
  }
}
