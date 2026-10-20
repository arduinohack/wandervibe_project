import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'providers/invitation_provider.dart';
import 'providers/plan_provider.dart';
import 'providers/user_provider.dart';
import 'screens/login_screen.dart';
import 'storage/token_store.dart';
import 'utils/jwt_expiry.dart';
import 'utils/logger.dart';

/// On resume, and on the next pointer or key, leave for login when the stored
/// token is missing or past its expiry. A valid token stays on the open screen.
/// This does not call POST /api/auth/logout.
class SessionResume extends StatefulWidget {
  final GlobalKey<NavigatorState> navigatorKey;
  final Widget child;

  const SessionResume({
    super.key,
    required this.navigatorKey,
    required this.child,
  });

  @override
  State<SessionResume> createState() => _SessionResumeState();
}

class _SessionResumeState extends State<SessionResume>
    with WidgetsBindingObserver {
  bool _checking = false;
  bool _openingLogin = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    HardwareKeyboard.instance.addHandler(_onKey);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    HardwareKeyboard.instance.removeHandler(_onKey);
    super.dispose();
  }

  bool _onKey(KeyEvent event) {
    if (event is KeyDownEvent) {
      _checkSession(readStorage: false);
    }
    return false;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _checkSession(readStorage: true);
    }
  }

  Future<void> _checkSession({required bool readStorage}) async {
    if (_checking || !mounted) return;
    final user = Provider.of<UserProvider>(context, listen: false);
    if (!readStorage) {
      final memory = user.token;
      if (memory == null || memory.isEmpty) {
        if (!user.hasSession) return;
      } else if (!jwtIsExpired(memory, DateTime.now())) {
        return;
      }
    }
    _checking = true;
    try {
      String? stored;
      try {
        stored = readStorage ? await readToken() : user.token;
      } catch (e) {
        logger.e('Session token read error: $e');
        return;
      }
      if (!mounted) return;
      final token = stored != null && stored.isNotEmpty ? stored : null;
      final expired = token == null || jwtIsExpired(token, DateTime.now());
      if (!expired) return;
      if (!user.hasSession && token == null) return;
      Provider.of<PlanProvider>(context, listen: false).clearPlans();
      Provider.of<InvitationProvider>(context, listen: false)
          .clearInvitations();
      await user.clearExpiredSession();
      if (!mounted) return;
      _goToLogin();
    } finally {
      _checking = false;
    }
  }

  void _goToLogin() {
    if (_openingLogin) return;
    _openingLogin = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _openingLogin = false;
      if (!mounted) return;
      final navigator = widget.navigatorKey.currentState;
      if (navigator == null) return;
      navigator.pushAndRemoveUntil(
        MaterialPageRoute(builder: (context) => const LoginScreen()),
        (route) => false,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      behavior: HitTestBehavior.translucent,
      onPointerDown: (_) => _checkSession(readStorage: false),
      child: widget.child,
    );
  }
}
