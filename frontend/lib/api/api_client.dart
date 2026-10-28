import 'dart:convert';

import 'package:http/http.dart' as http;

import '../session_bridge.dart';
import '../session_refresh.dart';
import '../storage/token_store.dart';
import '../utils/logger.dart';

bool _exempt(Uri url) {
  final path = url.path;
  return path.endsWith('/api/auth/login') ||
      path.endsWith('/api/auth/register') ||
      path.endsWith('/api/auth/forgot-password') ||
      path.endsWith('/api/auth/verify-email') ||
      path.endsWith('/api/auth/refresh') ||
      path.endsWith('/api/auth/request-invite');
}

bool _hasBearer(Map<String, String>? headers) {
  if (headers == null) return false;
  final value = headers['Authorization'] ?? headers['authorization'];
  if (value == null) return false;
  const prefix = 'Bearer ';
  return value.startsWith(prefix) &&
      value.substring(prefix.length).trim().isNotEmpty;
}

Future<void> _abandonSession() async {
  try {
    await deleteToken();
    await deleteRefreshToken();
  } catch (e) {
    logger.e('Session clear error: $e');
  }
  final ended = onSessionEnded;
  if (ended != null) ended();
}

Future<http.Response> _withRefresh(
  Uri url,
  Map<String, String>? headers,
  Future<http.Response> Function(Map<String, String>? headers) send,
) async {
  final response = await send(headers);
  if (response.statusCode != 401 || _exempt(url) || !_hasBearer(headers)) {
    return response;
  }
  final outcome = await refreshSessionOutcome();
  if (outcome == RefreshOutcome.unauthorized) {
    await _abandonSession();
    return response;
  }
  if (outcome != RefreshOutcome.refreshed) {
    return response;
  }
  final token = await readToken();
  if (token == null || token.isEmpty) {
    await _abandonSession();
    return response;
  }
  final next = Map<String, String>.from(headers ?? {});
  next['Authorization'] = 'Bearer $token';
  return send(next);
}

Future<http.Response> get(Uri url, {Map<String, String>? headers}) {
  return _withRefresh(url, headers, (next) => http.get(url, headers: next));
}

Future<http.Response> post(
  Uri url, {
  Map<String, String>? headers,
  Object? body,
  Encoding? encoding,
}) {
  return _withRefresh(
    url,
    headers,
    (next) => http.post(url, headers: next, body: body, encoding: encoding),
  );
}

Future<http.Response> put(
  Uri url, {
  Map<String, String>? headers,
  Object? body,
  Encoding? encoding,
}) {
  return _withRefresh(
    url,
    headers,
    (next) => http.put(url, headers: next, body: body, encoding: encoding),
  );
}

Future<http.Response> patch(
  Uri url, {
  Map<String, String>? headers,
  Object? body,
  Encoding? encoding,
}) {
  return _withRefresh(
    url,
    headers,
    (next) => http.patch(url, headers: next, body: body, encoding: encoding),
  );
}

Future<http.Response> delete(
  Uri url, {
  Map<String, String>? headers,
  Object? body,
  Encoding? encoding,
}) {
  return _withRefresh(
    url,
    headers,
    (next) => http.delete(url, headers: next, body: body, encoding: encoding),
  );
}

/// Multipart POST. The file part is rebuilt on a token refresh.
/// Pass Authorization only. A Content-Type header would drop the boundary.
Future<http.Response> postFile(
  Uri url, {
  Map<String, String>? headers,
  required String filename,
  required List<int> bytes,
}) {
  Future<http.Response> send(Map<String, String>? next) async {
    final request = http.MultipartRequest('POST', url);
    if (next != null) request.headers.addAll(next);
    request.files.add(
      http.MultipartFile.fromBytes('file', bytes, filename: filename),
    );
    final streamed = await request.send();
    return http.Response.fromStream(streamed);
  }

  return _withRefresh(url, headers, send);
}
