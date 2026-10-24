import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/user_provider.dart';
import 'auth_landing.dart';
import 'login_screen.dart';

/// Decides login versus the plan list before the login screen is shown.
/// The system fingerprint prompt runs while this blank page is up.
class ColdStartGate extends StatefulWidget {
  const ColdStartGate({super.key});

  @override
  State<ColdStartGate> createState() => _ColdStartGateState();
}

class _ColdStartGateState extends State<ColdStartGate>
    with WidgetsBindingObserver {
  var _frameReady = false;
  var _started = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _frameReady = true;
      _startIfReady();
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _startIfReady();
  }

  void _startIfReady() {
    if (_started || !_frameReady || !mounted) return;
    final state = WidgetsBinding.instance.lifecycleState;
    if (state != null && state != AppLifecycleState.resumed) return;
    _started = true;
    _run();
  }

  Future<void> _run() async {
    final user = Provider.of<UserProvider>(context, listen: false);
    final enter = await user.unlockOnColdStart();
    if (!mounted) return;
    if (enter && user.token != null && user.token!.isNotEmpty) {
      await continueAfterAuth(context);
      if (!mounted) return;
      if (user.token != null && user.token!.isNotEmpty) return;
    }
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (context) => const LoginScreen()),
      (route) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: Center(child: CircularProgressIndicator()));
  }
}
