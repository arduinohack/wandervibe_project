import 'package:flutter/foundation.dart'; // For ChangeNotifier
import 'package:http/http.dart'
    as http; // For API calls (add to pubspec.yaml if not there)
import 'dart:convert'; // For JSON
import 'package:provider/provider.dart'; // Add this line for Provider.of
import '../config/constants.dart'; // Add this line for getBackendUrl
import 'user_provider.dart'; // Add this line for UserProvider (token)
import '../models/invitation.dart'; // Your Invitation model

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
        print('Fetched ${_invitations.length} invitations from backend');
      } else {
        throw Exception('Failed to load invitations: ${response.statusCode}');
      }
    } catch (e) {
      print('Error fetching invitations: $e');
      // Fallback to mock
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
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  // Create invitation (real API POST /api/invites with token)
  // Respond to invitation (real API POST /api/invites/:id/respond with token passed as param)
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

      if (response.statusCode == 201) {
        final data = json.decode(response.body);
        final newInvitation = Invitation.fromJson(
          data['invitation'],
        ); // Backend returns the created invitation
        _invitations.add(newInvitation);
        notifyListeners();
        print('Created invitation: ${newInvitation.id} from backend');
      } else {
        throw Exception('Failed to create invitation: ${response.statusCode}');
      }
    } catch (e) {
      print('Error responding to invitation: $e');
      // Fallback: Update local mock
      final index = _invitations.indexWhere((inv) => inv.id == invitationId);
      if (index != -1) {
        _invitations[index] = Invitation(
          id: _invitations[index].id,
          tripId: _invitations[index]
              .tripId, // Fixed: Use existing invitation's tripId
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
