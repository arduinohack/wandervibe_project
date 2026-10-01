import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/invitation.dart';
import '../models/plan_role_label.dart';
import '../providers/invitation_provider.dart';
import '../providers/plan_provider.dart';
import '../providers/user_provider.dart';
import 'login_screen.dart';

class InvitationsScreen extends StatefulWidget {
  const InvitationsScreen({super.key});

  @override
  State<InvitationsScreen> createState() => _InvitationsScreenState();
}

class _InvitationsScreenState extends State<InvitationsScreen> {
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    final invitationProvider = Provider.of<InvitationProvider>(
      context,
      listen: false,
    );
    final navigator = Navigator.of(context);
    final status = await invitationProvider.fetchInvitations(userProvider.token);
    if (!mounted) return;
    setState(() => _loaded = true);
    if (status == 401) {
      await _endSession(userProvider, invitationProvider, navigator);
    }
  }

  Future<void> _endSession(
    UserProvider userProvider,
    InvitationProvider invitationProvider,
    NavigatorState navigator,
  ) async {
    invitationProvider.clearInvitations();
    await userProvider.logout();
    if (!mounted) return;
    navigator.pushAndRemoveUntil(
      MaterialPageRoute(builder: (context) => const LoginScreen()),
      (route) => false,
    );
  }

  Future<void> _respond(Invitation invite, InvitationStatus status) async {
    final userProvider = Provider.of<UserProvider>(context, listen: false);
    final invitationProvider = Provider.of<InvitationProvider>(
      context,
      listen: false,
    );
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final code = await invitationProvider.respondToInvitation(
      invite.id,
      status,
      userProvider.token,
    );
    if (!mounted) return;
    if (code == 401) {
      await _endSession(userProvider, invitationProvider, navigator);
      return;
    }
    if (code != 200) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not update invitation')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Invitations'),
        backgroundColor: Colors.blue,
      ),
      body: Consumer<InvitationProvider>(
        builder: (context, invitationProvider, child) {
          final waiting = !_loaded || invitationProvider.isLoading;
          if (waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (invitationProvider.invitationsError != null) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  invitationProvider.invitationsError!,
                  textAlign: TextAlign.center,
                ),
              ),
            );
          }
          if (invitationProvider.invitations.isEmpty) {
            return const Center(
              child: Text(
                'No invitations',
                style: TextStyle(fontSize: 20),
                textAlign: TextAlign.center,
              ),
            );
          }
          return ListView.builder(
            itemCount: invitationProvider.invitations.length,
            itemBuilder: (context, index) {
              final invite = invitationProvider.invitations[index];
              final planName = invite.planName.isEmpty
                  ? 'Unnamed plan'
                  : invite.planName;
              final from = invite.inviterLabel.isEmpty
                  ? 'Unknown'
                  : invite.inviterLabel;
              final planType = Provider.of<PlanProvider>(
                context,
              ).planTypeFor(invite.planId);
              final role = planRoleLabel(planType, invite.roleLabel);
              return Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        planName,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text('Role: $role'),
                      Text('Status: ${invite.status.name}'),
                      Text('From: $from'),
                      if (invite.status == InvitationStatus.pending)
                        Row(
                          children: [
                            TextButton(
                              onPressed: () =>
                                  _respond(invite, InvitationStatus.accepted),
                              child: const Text('Accept'),
                            ),
                            TextButton(
                              onPressed: () =>
                                  _respond(invite, InvitationStatus.rejected),
                              child: const Text('Reject'),
                            ),
                          ],
                        ),
                    ],
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
