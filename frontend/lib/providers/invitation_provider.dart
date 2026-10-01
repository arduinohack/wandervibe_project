import 'package:flutter/foundation.dart'; // For ChangeNotifier
import 'package:http/http.dart'
    as http; // For API calls (add to pubspec.yaml if not there)
import 'dart:convert'; // For JSON
// Add this line for Provider.of
import '../config/constants.dart'; // Add this line for getBackendUrl
// Add this line for UserProvider (token)
import '../models/invitation.dart'; // Your Invitation model
import '../utils/logger.dart';

class InvitationProvider extends ChangeNotifier {
  List<Invitation> _invitations = []; // Private list of invitations
  bool _isLoading = false; // Loading state for UI spinners

  List<Invitation> get invitations => _invitations; // Public getter
  bool get isLoading => _isLoading;

  // Fetch invitations (real API GET /api/invites with token passed as param)
  Future<void> fetchInvitations(String? token) async {
    _isLoading = true;
    notifyListeners();

    try {
      if (token == null) {
        throw Exception('No token—log in first');
      }

      final response = await http.get(
        Uri.parse((await backendBaseUrl) + apiInvites),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token', // Use passed token
        },
      );

      if (response.statusCode == 200) {
        final List<dynamic> data = json.decode(response.body);
        _invitations = data.map((json) => Invitation.fromJson(json)).toList();
        logger.i('Fetched ${_invitations.length} invitations from backend');
      } else {
        throw Exception('Failed to load invitations: ${response.statusCode}');
      }
    } catch (e) {
      logger.e('Error fetching invitations: $e');
      // Fallback to mock
      _invitations = [
        Invitation(
          id: 'inv1',
          planId: 'trip1',
          userId: 'user456',
          invitedBy: 'user123',
          role: InvitationRole.vibePlanner,
          status: InvitationStatus.pending,
          createdAt: DateTime.now().subtract(const Duration(days: 1)),
        ),
        Invitation(
          id: 'inv2',
          planId: 'trip2',
          userId: 'user456',
          invitedBy: 'user789',
          role: InvitationRole.wanderer,
          status: InvitationStatus.accepted,
          createdAt: DateTime.now().subtract(const Duration(hours: 2)),
        ),
      ];
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  // Respond to invitation (POST /api/invites/invitations/:id/respond).
  Future<void> respondToInvitation(
    String invitationId,
    InvitationStatus newStatus,
    String? token,
  ) async {
    try {
      if (token == null) throw Exception('No token—log in first');

      final response = await http.post(
        Uri.parse(
          (await backendBaseUrl) +
              apiInvitesRespond.replaceAll('{invitationId}', invitationId),
        ),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: json.encode({
          'status': newStatus.toString().split('.').last, // Only status needed
        }),
      );

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        final index = _invitations.indexWhere((inv) => inv.id == invitationId);
        if (index != -1) {
          final returned = data is Map ? data['invitation'] : null;
          _invitations[index] = returned is Map
              ? Invitation.fromJson(Map<String, dynamic>.from(returned))
              : Invitation(
                  id: _invitations[index].id,
                  planId: _invitations[index].planId,
                  userId: _invitations[index].userId,
                  invitedBy: _invitations[index].invitedBy,
                  role: _invitations[index].role,
                  status: newStatus,
                  createdAt: _invitations[index].createdAt,
                );
          notifyListeners();
        }
      } else {
        throw Exception('Failed to respond to invitation: ${response.statusCode}');
      }
    } catch (e) {
      logger.e('Error responding to invitation: $e');
      // Fallback: Update local mock
      final index = _invitations.indexWhere((inv) => inv.id == invitationId);
      if (index != -1) {
        _invitations[index] = Invitation(
          id: _invitations[index].id,
          planId: _invitations[index]
              .planId, // Fixed: Use existing invitation's tripId
          userId: _invitations[index].userId,
          invitedBy: _invitations[index].invitedBy,
          role: _invitations[index].role,
          status: newStatus,
          createdAt: _invitations[index].createdAt,
        );
        notifyListeners();
      }
    }
  }
}
