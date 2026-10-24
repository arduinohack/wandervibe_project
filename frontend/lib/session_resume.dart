import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'providers/invitation_provider.dart';
import 'providers/plan_provider.dart';
import 'providers/user_provider.dart';
import 'screens/login_screen.dart';
import 'session_bridge.dart';
import 'utils/jwt_expiry.dart';

/// On resume, and on the next pointer or key, refresh an expired access token.
/// Biometric unlock, when enabled, runs first. This does not call logout.
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
  bool _leftApp = false;
  bool _pausedDuringColdStart = false;
  SessionEndedCallback? _previousEnded;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    HardwareKeyboard.instance.addHandler(_onKey);
    _previousEnded = onSessionEnded;
    onSessionEnded = _sessionEnded;
  }

  @override
  void dispose() {
    if (identical(onSessionEnded, _sessionEnded)) {
      onSessionEnded = _previousEnded;
    }
    WidgetsBinding.instance.removeObserver(this);
    HardwareKeyboard.instance.removeHandler(_onKey);
    super.dispose();
  }

  void _sessionEnded() {
    final previous = _previousEnded;
    if (previous != null) previous();
    _goToLogin();
  }

  bool _onKey(KeyEvent event) {
    if (event is KeyDownEvent) {
      _checkSession(fromResume: false);
    }
    return false;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!mounted) return;
    final user = Provider.of<UserProvider>(context, listen: false);
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden ||
        state == AppLifecycleState.detached) {
      if (user.coldStartSettled) {
        _leftApp = true;
      } else {
        _pausedDuringColdStart = true;
      }
      return;
    }
    if (state != AppLifecycleState.resumed) return;
    // The fingerprint sheet can pause and resume the activity. That resume
    // is not a return from the background, so it does not prompt again.
    if (_pausedDuringColdStart) {
      _pausedDuringColdStart = false;
      return;
    }
    if (_leftApp) {
      _leftApp = false;
      _checkSession(fromResume: true);
    }
  }

  Future<void> _checkSession({required bool fromResume}) async {
    if (_checking || !mounted) return;
    final user = Provider.of<UserProvider>(context, listen: false);
    if (!user.coldStartSettled) return;
    if (fromResume) {
      user.noteAppResumed();
    } else if (user.biometricDeclined) {
      return;
    }
    if (!fromResume) {
      final memory = user.token;
      if (memory != null &&
          memory.isNotEmpty &&
          !jwtIsExpired(memory, DateTime.now())) {
        return;
      }
      if ((memory == null || memory.isEmpty) && !user.hasSession) return;
    }
    _checking = true;
    try {
      final result = await user.keepSessionAlive(promptBiometric: true);
      if (!mounted) return;
      if (result != SessionKeep.login) return;
      Provider.of<PlanProvider>(context, listen: false).clearPlans();
      Provider.of<InvitationProvider>(context, listen: false)
          .clearInvitations();
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
      onPointerDown: (_) => _checkSession(fromResume: false),
      child: widget.child,
    );
  }
}
