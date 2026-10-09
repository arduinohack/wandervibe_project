import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/invitation_provider.dart';
import '../providers/user_provider.dart';
import 'home_screen.dart';
import 'invitations_screen.dart';

/// After signup or login: pending invites open the inbox; otherwise the plan list.
/// Does not accept or reject invitations.
Future<void> continueAfterAuth(BuildContext context) async {
  final userProvider = Provider.of<UserProvider>(context, listen: false);
  final invitationProvider = Provider.of<InvitationProvider>(
    context,
    listen: false,
  );
  final navigator = Navigator.of(context);
  final token = userProvider.token;
  if (token == null || token.isEmpty) return;
  final pending = await invitationProvider.hasPendingInvites(token);
  if (!context.mounted) return;
  navigator.pushAndRemoveUntil(
    MaterialPageRoute(builder: (context) => const HomeScreen()),
    (route) => false,
  );
  if (pending) {
    navigator.push(
      MaterialPageRoute(builder: (context) => const InvitationsScreen()),
    );
  }
}
