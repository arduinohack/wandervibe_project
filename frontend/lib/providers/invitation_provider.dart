import 'package:flutter/foundation.dart'; // For ChangeNotifier
import 'package:http/http.dart'
    as http; // For API calls (add to pubspec.yaml if not there)
import 'dart:convert'; // For JSON
import '../models/invitation.dart'; // Your Invitation model

class InvitationProvider extends ChangeNotifier {
  List<Invitation> _invitations = []; // Private list of invitations
  bool _isLoading = false; // Loading state for UI spinners

  List<Invitation> get invitations => _invitations; // Public getter
  bool get isLoading => _isLoading;

  // Fetch invitations (mock for now; replace with API)
  Future<void> fetchInvitations() async {
    _isLoading = true;
    notifyListeners(); // Update UI immediately (show spinner)

    try {
      // Mock data (replace with http.get('http://localhost:3000/api/invitations?userId=user123'))
      await Future.delayed(
        const Duration(seconds: 1),
      ); // Simulate network delay
      _invitations = [
        Invitation(
          id: 'inv1',
          tripId: 'trip1',
          userId: 'user456',
          invitedBy: 'user123',
          role: InvitationRole.vibePlanner,
          status: InvitationStatus.pending,
          createdAt: DateTime.now().subtract(const Duration(days: 1)),
        ),
        Invitation(
          id: 'inv2',
          tripId: 'trip2',
          userId: 'user456',
          invitedBy: 'user789',
          role: InvitationRole.wanderer,
          status: InvitationStatus.accepted,
          createdAt: DateTime.now().subtract(const Duration(hours: 2)),
        ),
      ];
    } catch (e) {
      // Handle error (e.g., show snackbar in UI)
      print('Error fetching invitations: $e');
    } finally {
      _isLoading = false;
      notifyListeners(); // Update UI (hide spinner, show list)
    }
  }

  // Create invitation (mock; replace with POST /api/trips/:tripId/invite)
  Future<void> createInvitation(
    String tripId,
    String userId,
    InvitationRole role,
    String invitedBy,
  ) async {
    try {
      // Mock (replace with http.post('http://localhost:3000/api/trips/$tripId/invite', body: {...}))
      await Future.delayed(const Duration(seconds: 1));
      final newInvitation = Invitation(
        id: 'inv${_invitations.length + 1}',
        tripId: tripId,
        userId: userId,
        invitedBy: invitedBy,
        role: role,
        status: InvitationStatus.pending,
        createdAt: DateTime.now(),
      );
      _invitations.add(newInvitation);
      notifyListeners(); // Update UI (add to list)
      print('Created invitation: ${newInvitation.id} for $userId as $role');
    } catch (e) {
      print('Error creating invitation: $e');
    }
  }

  // Respond to invitation (accept/reject; mock; replace with PATCH /api/invitations/:invitationId/respond)
  Future<void> respondToInvitation(
    String invitationId,
    InvitationStatus newStatus,
  ) async {
    try {
      // Mock (replace with http.patch('http://localhost:3000/api/invitations/$invitationId/respond', body: {'status': newStatus}))
      await Future.delayed(const Duration(seconds: 1));
      final index = _invitations.indexWhere((inv) => inv.id == invitationId);
      if (index != -1) {
        _invitations[index] = Invitation(
          id: _invitations[index].id,
          tripId: _invitations[index].tripId,
          userId: _invitations[index].userId,
          invitedBy: _invitations[index].invitedBy,
          role: _invitations[index].role,
          status: newStatus,
          createdAt: _invitations[index].createdAt,
        );
        notifyListeners(); // Update UI
        print('Updated invitation $invitationId to $newStatus');
      }
    } catch (e) {
      print('Error responding to invitation: $e');
    }
  }
}
