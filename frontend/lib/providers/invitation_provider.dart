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
  String? _invitationsError;

  List<Invitation> get invitations => _invitations; // Public getter
  bool get isLoading => _isLoading;
  String? get invitationsError => _invitationsError;

  void clearInvitations() {
    _invitations = [];
    _invitationsError = null;
    _isLoading = false;
    notifyListeners();
  }

  // GET /api/invites. The body is a raw array. [] is empty, not an error.
  Future<int?> fetchInvitations(String? token) async {
    _isLoading = true;
    _invitationsError = null;
    notifyListeners();

    try {
      if (token == null || token.isEmpty) {
        _invitationsError = 'Session expired';
        return 401;
      }

      final response = await http.get(
        Uri.parse((await backendBaseUrl) + apiInvites),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
      );

      if (response.statusCode == 401) {
        _invitationsError = 'Session expired';
        return 401;
      }
      if (response.statusCode != 200) {
        _invitationsError = 'Could not load invitations (${response.statusCode})';
        return response.statusCode;
      }

      final dynamic data = json.decode(response.body);
      if (data is! List) {
        _invitationsError = 'Could not load invitations';
        return response.statusCode;
      }

      final parsed = <Invitation>[];
      for (final item in data) {
        if (item is! Map) continue;
        parsed.add(Invitation.fromJson(Map<String, dynamic>.from(item)));
      }
      _invitations = parsed;
      _invitationsError = null;
      logger.i('Fetched ${_invitations.length} invitations from backend');
      return 200;
    } catch (e) {
      logger.e('Error fetching invitations: $e');
      _invitationsError = 'Could not load invitations';
      return null;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  // POST /api/invites/invitations/:id/respond with { status }.
  Future<int?> respondToInvitation(
    String invitationId,
    InvitationStatus newStatus,
    String? token,
  ) async {
    try {
      if (token == null || token.isEmpty) return 401;

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

      if (response.statusCode == 401) return 401;
      if (response.statusCode != 200) return response.statusCode;

      final index = _invitations.indexWhere((inv) => inv.id == invitationId);
      if (index != -1) {
        final current = _invitations[index];
        final data = json.decode(response.body);
        final returned = data is Map ? data['invitation'] : null;
        Invitation next = current.withStatus(newStatus);
        if (returned is Map) {
          final parsed = Invitation.fromJson(Map<String, dynamic>.from(returned));
          next = Invitation(
            id: parsed.id.isEmpty ? current.id : parsed.id,
            planId: parsed.planId.isEmpty ? current.planId : parsed.planId,
            userId: parsed.userId.isEmpty ? current.userId : parsed.userId,
            invitedBy: parsed.invitedBy.isEmpty ? current.invitedBy : parsed.invitedBy,
            role: parsed.role,
            status: parsed.status,
            createdAt: parsed.createdAt,
            planName: parsed.planName.isEmpty ? current.planName : parsed.planName,
            roleLabel: parsed.roleLabel.isEmpty ? current.roleLabel : parsed.roleLabel,
            inviterLabel: parsed.inviterLabel.isEmpty
                ? current.inviterLabel
                : parsed.inviterLabel,
          );
        }
        _invitations[index] = next;
        notifyListeners();
      }
      return 200;
    } catch (e) {
      logger.e('Error responding to invitation: $e');
      return null;
    }
  }
}
