import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/user_provider.dart';

const verifyEmailBeforePlanMessage =
    'Verify your email before creating a plan.';

Future<void> showVerifyEmailDialog(
  BuildContext context, {
  required String message,
}) async {
  final messenger = ScaffoldMessenger.of(context);
  await showDialog<void>(
    context: context,
    builder: (dialogContext) {
      return AlertDialog(
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Close'),
          ),
          TextButton(
            onPressed: () async {
              final note = await Provider.of<UserProvider>(
                dialogContext,
                listen: false,
              ).resendVerification();
              if (!dialogContext.mounted) return;
              Navigator.pop(dialogContext);
              messenger.showSnackBar(SnackBar(content: Text(note)));
            },
            child: const Text('Resend'),
          ),
        ],
      );
    },
  );
}
