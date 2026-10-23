import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:local_auth/local_auth.dart';

import 'storage/token_store.dart';
import 'utils/logger.dart';

/// Fingerprint and face unlock are mobile only. Web and desktop stay on
/// the password screen.
bool get mobileBiometricPlatform {
  if (kIsWeb) return false;
  switch (defaultTargetPlatform) {
    case TargetPlatform.android:
    case TargetPlatform.iOS:
      return true;
    default:
      return false;
  }
}

Future<bool> shouldGateOnBiometric() async {
  if (!mobileBiometricPlatform) return false;
  if (!await biometricEnabled()) return false;
  return hasRefreshTokenFlag();
}

Future<bool> deviceCanUnlockWithBiometrics() async {
  if (!mobileBiometricPlatform) return false;
  try {
    final auth = LocalAuthentication();
    final supported = await auth.isDeviceSupported();
    final can = await auth.canCheckBiometrics;
    return supported && can;
  } catch (e) {
    logger.e('Biometric support check error: $e');
    return false;
  }
}

Future<bool>? _unlockInFlight;

Future<bool> unlockWithBiometric() {
  if (!mobileBiometricPlatform) return Future<bool>.value(false);
  final existing = _unlockInFlight;
  if (existing != null) return existing;
  final run = _unlockOnce();
  _unlockInFlight = run;
  return run.whenComplete(() {
    if (identical(_unlockInFlight, run)) _unlockInFlight = null;
  });
}

Future<bool> _unlockOnce() async {
  try {
    final auth = LocalAuthentication();
    return await auth.authenticate(
      localizedReason: 'Unlock PlanItVibe',
      options: const AuthenticationOptions(
        biometricOnly: true,
        stickyAuth: true,
      ),
    );
  } catch (e) {
    logger.e('Biometric error: $e');
    return false;
  }
}

/// One prompt after a successful password login. A decline is remembered
/// until logout clears it. Signup does not call this.
Future<void> offerBiometricUnlock(BuildContext context) async {
  if (!mobileBiometricPlatform) return;
  if (await biometricPrompted()) return;
  final can = await deviceCanUnlockWithBiometrics();
  await markBiometricPrompted();
  if (!can || !context.mounted) return;
  final enable = await showDialog<bool>(
    context: context,
    builder: (dialogContext) {
      return AlertDialog(
        title: const Text('Enable fingerprint / face unlock?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Not now'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Enable'),
          ),
        ],
      );
    },
  );
  if (enable == true) {
    await setBiometricEnabled(true);
  }
}
