import 'dart:convert';

import 'package:socket_io_client/socket_io_client.dart' as io;

class PlanViewer {
  final String userId;
  final String name;
  final String? activityId;

  const PlanViewer({
    required this.userId,
    required this.name,
    this.activityId,
  });
}

/// User id from a login JWT. Null when the token cannot be read.
String? userIdFromToken(String token) {
  try {
    final parts = token.split('.');
    if (parts.length != 3) return null;
    final payload = utf8.decode(
      base64Url.decode(base64Url.normalize(parts[1])),
    );
    final data = json.decode(payload);
    if (data is! Map) return null;
    final id = data['userId'] ?? data['id'];
    if (id == null) return null;
    final text = id.toString().trim();
    return text.isEmpty ? null : text;
  } catch (_) {
    return null;
  }
}

/// Null when the payload is not a presence list. An empty list is a real update.
List<PlanViewer>? parsePlanViewers(dynamic data) {
  if (data is! Map) return null;
  final users = data['users'];
  if (users is! List) return null;
  final rows = <PlanViewer>[];
  for (final item in users) {
    if (item is! Map) continue;
    final userId = item['userId']?.toString().trim() ?? '';
    if (userId.isEmpty) continue;
    final name = item['name']?.toString().trim() ?? '';
    final activity = item['activityId']?.toString().trim() ?? '';
    rows.add(
      PlanViewer(
        userId: userId,
        name: name.isEmpty ? 'Member' : name,
        activityId: activity.isEmpty ? null : activity,
      ),
    );
  }
  return rows;
}

/// One socket for the open plan. Errors stay quiet when the network blocks sockets.
class PlanPresenceConnection {
  PlanPresenceConnection({required this.onUsers});

  final void Function(List<PlanViewer> users) onUsers;

  io.Socket? _socket;
  String? _planId;
  String? _editingActivityId;
  bool _closed = false;

  void connect({
    required String baseUrl,
    required String token,
    required String planId,
  }) {
    if (_closed || token.isEmpty || planId.isEmpty) return;
    _planId = planId;
    final origin = baseUrl.endsWith('/')
        ? baseUrl.substring(0, baseUrl.length - 1)
        : baseUrl;
    try {
      final socket = io.io(
        origin,
        io.OptionBuilder()
            .setTransports(const ['polling', 'websocket'])
            .setAuth({'token': token})
            .enableForceNew()
            .build(),
      );
      if (_closed) {
        socket.dispose();
        return;
      }
      _socket = socket;
      socket.onConnect((_) {
        if (_closed) return;
        try {
          socket.emit('join', {'planId': planId});
          _emitEditing();
        } catch (_) {}
      });
      socket.on('presence', (data) {
        if (_closed) return;
        try {
          final users = parsePlanViewers(data);
          if (users == null) return;
          onUsers(users);
        } catch (_) {}
      });
      socket.onConnectError((_) {});
      socket.onError((_) {});
    } catch (_) {}
  }

  void editing(String planId, String activityId) {
    if (activityId.isEmpty) return;
    _planId = planId;
    _editingActivityId = activityId;
    _emitEditing();
  }

  void idle(String planId) {
    _editingActivityId = null;
    final socket = _socket;
    if (_closed || socket == null) return;
    try {
      socket.emit('idle', {'planId': planId});
    } catch (_) {}
  }

  void close() {
    _closed = true;
    final socket = _socket;
    _socket = null;
    if (socket == null) return;
    try {
      socket.dispose();
    } catch (_) {}
  }

  void _emitEditing() {
    final socket = _socket;
    final planId = _planId;
    final activityId = _editingActivityId;
    if (_closed || socket == null || planId == null || activityId == null) {
      return;
    }
    if (activityId.isEmpty) return;
    try {
      socket.emit('editing', {'planId': planId, 'activityId': activityId});
    } catch (_) {}
  }
}
