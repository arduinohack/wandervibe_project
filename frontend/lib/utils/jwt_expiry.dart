import 'dart:convert';

/// UTC expiry from a JWT `exp` claim. Null when the token has no readable expiry.
DateTime? jwtExpiryUtc(String token) {
  try {
    final parts = token.split('.');
    if (parts.length != 3) return null;
    final payload = utf8.decode(
      base64Url.decode(base64Url.normalize(parts[1])),
    );
    final data = json.decode(payload);
    if (data is! Map) return null;
    final exp = data['exp'];
    if (exp is! num) return null;
    return DateTime.fromMillisecondsSinceEpoch(
      exp.toInt() * 1000,
      isUtc: true,
    );
  } catch (_) {
    return null;
  }
}

/// True when [token] has no readable expiry, or [now] is at or after that time.
bool jwtIsExpired(String token, DateTime now) {
  final expiry = jwtExpiryUtc(token);
  if (expiry == null) return true;
  return !now.toUtc().isBefore(expiry);
}
