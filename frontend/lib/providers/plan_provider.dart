// For ChangeNotifier
import 'package:http/http.dart'
    as http; // For API calls (add to pubspec.yaml if not there)
import 'dart:convert'; // For JSON
// Added for Provider.of (token from UserProvider)
import '../config/constants.dart'; // Add this line for backendBaseUrl
// Add this line for UserProvider (token)
import 'package:flutter/material.dart'; // Added: Required for Icon
import '../models/plan.dart'; // Your Plan model
import '../models/activity.dart';
import '../models/activity_type.dart';
import '../models/user.dart'; // Your User model
import '../utils/logger.dart';

Map<String, dynamic> _itineraryActivityJson(Map source) {
  final map = Map<String, dynamic>.from(source);
  final duration = map['duration'];
  if (duration is num) {
    map['duration'] = duration.round();
  } else {
    map['duration'] = null;
  }
  final subActivities = map['subEvents'];
  map['subEvents'] = subActivities is List
      ? subActivities
            .whereType<Map>()
            .map((item) => Map<String, dynamic>.from(item))
            .toList()
      : <Map<String, dynamic>>[];
  final links = map['urlLinks'];
  map['urlLinks'] = links is List
      ? links
            .whereType<Map>()
            .map((item) => Map<String, dynamic>.from(item))
            .toList()
      : <Map<String, dynamic>>[];
  final missing = map['missingFields'];
  map['missingFields'] = missing is List
      ? missing.map((item) => item.toString()).toList()
      : <String>[];
  if (map['extras'] is! Map) map['extras'] = <String, dynamic>{};
  return map;
}

String _activityInstant(DateTime utc) {
  return utc.toUtc().toIso8601String();
}

/// Shared activity fields plus only the fields the selected type keeps.
Map<String, dynamic> _activityWriteBody({
  required String name,
  required String type,
  required DateTime startTime,
  required DateTime endTime,
  required String location,
  required String details,
  String? gate,
  String? baggageClaim,
  String? originTimeZone,
  String? destinationTimeZone,
  String? roomNumber,
  String? planId,
}) {
  final body = <String, dynamic>{
    'name': name,
    'type': type,
    'startTime': _activityInstant(startTime),
    'endTime': _activityInstant(endTime),
    'location': location,
    'details': details,
  };
  if (planId != null) body['planId'] = planId;
  if (type == 'flight' || type == 'train') {
    body['originTimeZone'] = originTimeZone ?? '';
    body['destinationTimeZone'] = destinationTimeZone ?? '';
  }
  if (type == 'flight') {
    body['gate'] = gate ?? '';
    body['baggageClaim'] = baggageClaim ?? '';
  }
  if (type == 'hotel' || type == 'ceremony' || type == 'reception') {
    body['roomNumber'] = roomNumber ?? '';
  }
  return body;
}

int _byStartTime(Activity a, Activity b) {
  final aStart = a.startTime;
  final bStart = b.startTime;
  if (aStart == null && bStart == null) return 0;
  if (aStart == null) return 1;
  if (bStart == null) return -1;
  return aStart.compareTo(bStart);
}

String? _roleFromUsersBody(String body, String userId) {
  final dynamic data = json.decode(body);
  final List<dynamic> users;
  if (data is Map && data['users'] is List) {
    users = data['users'] as List;
  } else if (data is List) {
    users = data;
  } else {
    return null;
  }
  for (final item in users) {
    if (item is! Map) continue;
    final idValue = item['userId'];
    final id = idValue is Map
        ? (idValue['_id'] ?? idValue['id'])?.toString() ?? ''
        : idValue?.toString() ?? '';
    if (id != userId) continue;
    final role = item['role'];
    if (role == null) return null;
    return role.toString();
  }
  return null;
}

class PlanDeleteResult {
  final int? status;
  final List<String> sharedWith;

  const PlanDeleteResult({this.status, this.sharedWith = const []});
}

class PlanUpdateResult {
  final int? status;
  final Plan? plan;

  const PlanUpdateResult({this.status, this.plan});
}

String _trimmed(dynamic value) {
  if (value == null) return '';
  return value.toString().trim();
}

String _personName(Map item) {
  final first = _trimmed(item['firstName']);
  final last = _trimmed(item['lastName']);
  return [
    if (first.isNotEmpty) first,
    if (last.isNotEmpty) last,
  ].join(' ');
}

String _personLabel(Map item) {
  final name = _personName(item);
  final email = _trimmed(item['email']);
  final who = name.isNotEmpty ? name : email;
  if (who.isEmpty) return '';
  final role = _trimmed(item['role']);
  return role.isEmpty ? who : '$who ($role)';
}

String _inviteLabel(Map item) {
  final email = _trimmed(item['email']);
  final role = _trimmed(item['role']);
  if (email.isEmpty && role.isEmpty) return '';
  if (email.isEmpty) return 'Invited $role';
  if (role.isEmpty) return '$email (invited)';
  return '$email (invited $role)';
}

List<String> _sharedWithLabels(String body) {
  final dynamic data;
  try {
    data = json.decode(body);
  } catch (e) {
    return [];
  }
  if (data is! Map) return [];
  final labels = <String>[];
  final people = data['people'];
  if (people is List) {
    for (final item in people) {
      if (item is! Map) continue;
      final label = _personLabel(item);
      if (label.isNotEmpty) labels.add(label);
    }
  }
  final invites = data['invites'];
  if (invites is List) {
    for (final item in invites) {
      if (item is! Map) continue;
      final label = _inviteLabel(item);
      if (label.isNotEmpty) labels.add(label);
    }
  }
  return labels;
}

class PlanProvider extends ChangeNotifier {
  List<Plan> _plans = []; // Private list of plans
  Plan? _currentPlan; // Current selected plan
  Plan? get currentPlan => _currentPlan;
  List<Activity> _activities = []; // Private list of activities for the current plan
  bool _isLoading = false; // Loading state for UI spinners

  List<Plan> get plans => _plans; // Public getter
  List<Activity> get activities => _activities;
  List<PlanUser> _planUsers =
      []; // Private list of users/roles for current plan
  List<PlanUser> get planUsers => _planUsers;
  bool get isLoading => _isLoading;

  String? _currentPlanId; // Track current plan for itinerary
  final Map<String, String> _viewerRoles = {};

  /// Stored Owner, Collaborator, or Guest for the signed-in user on this plan.
  /// Owner is known from ownerId. Other roles come from GET /api/plans/:id/users.
  String? viewerStoredRole(String planId, String? userId) {
    final fetched = _viewerRoles[planId];
    if (fetched != null && fetched.isNotEmpty) return fetched;
    if (userId == null || userId.isEmpty) return null;
    for (final plan in _plans) {
      if (plan.id == planId && plan.ownerId == userId) return 'Owner';
    }
    return null;
  }

  /// Plan type already loaded from GET /api/plans, when this plan is one of them.
  String? planTypeFor(String planId) {
    for (final plan in _plans) {
      if (plan.id == planId) {
        final type = plan.type.trim();
        return type.isEmpty ? null : type;
      }
    }
    return null;
  }

  // GET /api/plans/:planId/itinerary. 200 with an empty list is not an error.
  Future<int?> fetchPlan(String planId, String? token) async {
    _currentPlanId = planId;
    _isLoading = true;
    _itinerary = [];
    _itineraryError = null;
    notifyListeners();

    try {
      if (token == null || token.isEmpty) {
        _itineraryError = 'Session expired';
        return 401;
      }

      final response = await http.get(
        Uri.parse(
          (backendBaseUrl) +
              apiPlansItinerary.replaceAll('{planId}', planId),
        ),
        headers: {'Authorization': 'Bearer $token'},
      );

      if (response.statusCode == 401) {
        _itineraryError = 'Session expired';
        return 401;
      }
      if (response.statusCode == 403) {
        _itineraryError = 'Not allowed to view this itinerary';
        return 403;
      }
      if (response.statusCode != 200) {
        _itineraryError = 'Could not load activities (${response.statusCode})';
        return response.statusCode;
      }

      final dynamic data = json.decode(response.body);
      if (data is! Map || data['events'] is! List) {
        _itineraryError = 'Could not load activities';
        return response.statusCode;
      }

      final parsed = <Activity>[];
      for (final item in data['events'] as List) {
        if (item is! Map) continue;
        parsed.add(Activity.fromJson(_itineraryActivityJson(item)));
      }
      parsed.sort(_byStartTime);
      _itinerary = parsed;
      _activities = parsed;
      _itineraryError = null;
      logger.i('Fetched ${_itinerary.length} activities for plan $planId');
      return 200;
    } catch (e) {
      logger.e('Error fetching itinerary: $e');
      _itinerary = [];
      _itineraryError = 'Could not load activities';
      return null;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  String? _plansError;
  List<Activity> _itinerary = [];
  String? _itineraryError;

  String? get plansError => _plansError;
  List<Activity> get itineraryActivities => _itinerary;
  String? get itineraryError => _itineraryError;

  void clearPlans() {
    _plans = [];
    _viewerRoles.clear();
    _plansError = null;
    _itinerary = [];
    _itineraryError = null;
    _isLoading = false;
    notifyListeners();
  }

  // GET /api/plans. 200 with { plans: [] } is an empty list, not an error.
  // Returns the HTTP status, or null when the call did not finish.
  Future<int?> fetchPlans(String? token) async {
    _isLoading = true;
    _plansError = null;
    notifyListeners();

    try {
      if (token == null || token.isEmpty) {
        _plansError = 'Session expired';
        return 401;
      }

      final response = await http.get(
        Uri.parse((backendBaseUrl) + apiPlans),
        headers: {'Authorization': 'Bearer $token'},
      );

      if (response.statusCode == 401) {
        _plansError = 'Session expired';
        return 401;
      }

      if (response.statusCode != 200) {
        _plansError = 'Could not load plans (${response.statusCode})';
        return response.statusCode;
      }

      final dynamic data = json.decode(response.body);
      if (data is! Map || data['plans'] is! List) {
        _plansError = 'Could not load plans';
        return response.statusCode;
      }

      final parsed = <Plan>[];
      for (final item in data['plans'] as List) {
        if (item is! Map) continue;
        parsed.add(Plan.fromJson(Map<String, dynamic>.from(item)));
      }
      _plans = parsed;
      _plansError = null;
      logger.i('Parsed ${_plans.length} plans from backend');
      return 200;
    } catch (e) {
      logger.e('Error fetching plans: $e');
      _plansError = 'Could not load plans';
      return null;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Fills viewerStoredRole from GET /api/plans/:planId/users. Does not change
  /// the plan list request. Returns 401 when the token is rejected.
  Future<int?> loadViewerRoles(String? token, String? userId) async {
    if (token == null || token.isEmpty) return 401;
    final plans = List<Plan>.from(_plans);
    if (userId == null || userId.isEmpty || plans.isEmpty) return 200;

    final next = <String, String>{};
    final pending = <Future<int?>>[];
    for (final plan in plans) {
      if (plan.ownerId == userId) {
        next[plan.id] = 'Owner';
        continue;
      }
      pending.add(_readMembershipRole(plan.id, token, userId, next));
    }
    final codes = await Future.wait(pending);
    _viewerRoles
      ..clear()
      ..addAll(next);
    notifyListeners();
    if (codes.contains(401)) return 401;
    return 200;
  }

  Future<int?> _readMembershipRole(
    String planId,
    String token,
    String userId,
    Map<String, String> into,
  ) async {
    try {
      final response = await http.get(
        Uri.parse(
          (backendBaseUrl) + apiPlanUsers.replaceAll('{planId}', planId),
        ),
        headers: {'Authorization': 'Bearer $token'},
      );
      if (response.statusCode == 401) return 401;
      if (response.statusCode != 200) return response.statusCode;
      final role = _roleFromUsersBody(response.body, userId);
      if (role != null && role.isNotEmpty) into[planId] = role;
      return 200;
    } catch (e) {
      logger.e('Error reading membership role: $e');
      return null;
    }
  }

  // Fetch PlanUsers for a plan (GET /api/plans/:planId/users with token)
  Future<void> fetchPlanUsers(String planId, String? token) async {
    _isLoading = true; // Optional: Show loading in UI
    notifyListeners();

    try {
      if (token == null) throw Exception('No token—log in first');

      final response = await http.get(
        Uri.parse('$backendBaseUrl/api/plans/$planId/users'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
      );

      logger.i(
        'Fetch PlanUsers response: ${response.statusCode}',
      ); // Debug optional

      if (response.statusCode == 200) {
        final List<dynamic> data = json.decode(response.body);
        _planUsers = data
            .map((json) => PlanUser.fromJson(json))
            .toList(); // Parse to List<PlanUser>
        logger.i('Fetched ${_planUsers.length} PlanUsers for plan $planId');
      } else {
        throw Exception('Failed to load PlanUsers: ${response.statusCode}');
      }
    } catch (e) {
      logger.e('Error fetching PlanUsers: $e');
      _planUsers = []; // Empty fallback
    } finally {
      _isLoading = false;
      notifyListeners(); // Refresh UI (e.g., list in PlanDetailScreen)
    }
  }

  // POST /api/plans. Returns the HTTP status, or null when the call did not finish.
  Future<int?> createPlan(Plan newPlan, String? token) async {
    try {
      if (token == null || token.isEmpty) {
        return 401;
      }

      final response = await http.post(
        Uri.parse(backendBaseUrl + apiPlans),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: json.encode(newPlan.toJson()),
      );

      if (response.statusCode == 401) {
        return 401;
      }

      if (response.statusCode != 201) {
        return response.statusCode;
      }

      final data = json.decode(response.body);
      final planJson = data is Map ? data['plan'] : null;
      if (planJson is! Map) {
        return response.statusCode;
      }
      final createdPlan = Plan.fromJson(Map<String, dynamic>.from(planJson));
      _plans = [..._plans, createdPlan];
      _plansError = null;
      notifyListeners();
      logger.i('Created plan: ${createdPlan.name} from backend');
      return 201;
    } catch (e) {
      logger.e('Error creating plan: $e');
      return null;
    }
  }

  /// Reloads one plan from GET /api/plans without the list spinner.
  Future<void> _reloadPlan(String planId, String token) async {
    try {
      final response = await http.get(
        Uri.parse('$backendBaseUrl$apiPlans'),
        headers: {'Authorization': 'Bearer $token'},
      );
      if (response.statusCode != 200) return;
      final data = json.decode(response.body);
      final list = data is Map ? data['plans'] : null;
      if (list is! List) return;
      Plan? match;
      for (final item in list) {
        if (item is! Map) continue;
        final plan = Plan.fromJson(Map<String, dynamic>.from(item));
        if (plan.id == planId) match = plan;
      }
      if (match == null) return;
      final updated = match;
      _plans = [
        for (final plan in _plans)
          if (plan.id == planId) updated else plan,
      ];
      notifyListeners();
    } catch (e) {
      logger.e('Error reloading plan: $e');
    }
  }

  /// POST /api/activities. The body keeps shared fields and the selected type's fields.
  /// On 201 the returned activity is inserted in start-time order.
  Future<int?> createActivity({
    required String planId,
    required String name,
    required String type,
    required DateTime startTime,
    required DateTime endTime,
    required String location,
    required String details,
    String? gate,
    String? baggageClaim,
    String? originTimeZone,
    String? destinationTimeZone,
    String? roomNumber,
    required String? token,
  }) async {
    try {
      if (token == null || token.isEmpty) return 401;
      final response = await http.post(
        Uri.parse((backendBaseUrl) + apiActivities),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: json.encode(
          _activityWriteBody(
            name: name,
            type: type,
            startTime: startTime,
            endTime: endTime,
            location: location,
            details: details,
            gate: gate,
            baggageClaim: baggageClaim,
            originTimeZone: originTimeZone,
            destinationTimeZone: destinationTimeZone,
            roomNumber: roomNumber,
            planId: planId,
          ),
        ),
      );
      if (response.statusCode == 401 || response.statusCode == 403) {
        return response.statusCode;
      }
      if (response.statusCode != 201) return response.statusCode;

      final dynamic data = json.decode(response.body);
      if (data is! Map) return 201;
      final created = Activity.fromJson(_itineraryActivityJson(data));
      final next = [..._itinerary, created]..sort(_byStartTime);
      _itinerary = next;
      _activities = List<Activity>.from(next);
      notifyListeners();
      await _reloadPlan(planId, token);
      return 201;
    } catch (e) {
      logger.e('Error creating activity: $e');
      return null;
    }
  }

  /// PUT /api/activities/:id. The body keeps shared fields and the selected type's fields.
  /// On 200 the returned activity replaces that row in start-time order.
  Future<int?> updateActivity({
    required String activityId,
    required String name,
    required String type,
    required DateTime startTime,
    required DateTime endTime,
    required String location,
    required String details,
    String? gate,
    String? baggageClaim,
    String? originTimeZone,
    String? destinationTimeZone,
    String? roomNumber,
    required String planId,
    required String? token,
  }) async {
    try {
      if (token == null || token.isEmpty) return 401;
      final response = await http.put(
        Uri.parse('$backendBaseUrl$apiActivities/$activityId'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: json.encode(
          _activityWriteBody(
            name: name,
            type: type,
            startTime: startTime,
            endTime: endTime,
            location: location,
            details: details,
            gate: gate,
            baggageClaim: baggageClaim,
            originTimeZone: originTimeZone,
            destinationTimeZone: destinationTimeZone,
            roomNumber: roomNumber,
          ),
        ),
      );
      if (response.statusCode == 401 || response.statusCode == 403) {
        return response.statusCode;
      }
      if (response.statusCode != 200) return response.statusCode;

      final dynamic data = json.decode(response.body);
      if (data is Map) {
        final updated = Activity.fromJson(_itineraryActivityJson(data));
        final next = [
          for (final activity in _itinerary)
            if (activity.id == activityId) updated else activity,
        ]..sort(_byStartTime);
        _itinerary = next;
        _activities = List<Activity>.from(next);
        notifyListeners();
      }
      if (planId.isNotEmpty) await _reloadPlan(planId, token);
      return 200;
    } catch (e) {
      logger.e('Error updating activity: $e');
      return null;
    }
  }

  /// PUT /api/plans/:planId with name, destination, dates, time zone, and the
  /// auto-calculate flags. On 200 that plan in the loaded list is replaced.
  Future<PlanUpdateResult> updatePlan({
    required String planId,
    required String name,
    required String destination,
    required DateTime? startDate,
    required DateTime? endDate,
    required String timeZone,
    required bool autoCalculateStartDate,
    required bool autoCalculateEndDate,
    required String? token,
  }) async {
    try {
      if (token == null || token.isEmpty) {
        return const PlanUpdateResult(status: 401);
      }
      final response = await http.put(
        Uri.parse('$backendBaseUrl$apiPlans/$planId'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: json.encode({
          'name': name,
          'destination': destination,
          'startDate': startDate?.toUtc().toIso8601String(),
          'endDate': endDate?.toUtc().toIso8601String(),
          'timeZone': timeZone,
          'autoCalculateStartDate': autoCalculateStartDate,
          'autoCalculateEndDate': autoCalculateEndDate,
        }),
      );
      if (response.statusCode != 200) {
        return PlanUpdateResult(status: response.statusCode);
      }
      final data = json.decode(response.body);
      final planJson = data is Map ? data['plan'] : null;
      if (planJson is! Map) return const PlanUpdateResult(status: 200);
      final updated = Plan.fromJson(Map<String, dynamic>.from(planJson));
      _plans = [
        for (final plan in _plans)
          if (plan.id == planId) updated else plan,
      ];
      notifyListeners();
      return PlanUpdateResult(status: 200, plan: updated);
    } catch (e) {
      logger.e('Error updating plan: $e');
      return const PlanUpdateResult();
    }
  }

  /// DELETE /api/plans/:planId. On 200 the plan leaves the loaded list.
  /// On 409 sharedWith names the other people and pending invites.
  Future<PlanDeleteResult> deletePlan({
    required String planId,
    required String? token,
  }) async {
    try {
      if (token == null || token.isEmpty) {
        return const PlanDeleteResult(status: 401);
      }
      final response = await http.delete(
        Uri.parse('$backendBaseUrl$apiPlans/$planId'),
        headers: {'Authorization': 'Bearer $token'},
      );
      if (response.statusCode == 200) {
        _plans = [
          for (final plan in _plans)
            if (plan.id != planId) plan,
        ];
        _viewerRoles.remove(planId);
        if (_currentPlanId == planId) {
          _itinerary = [];
          _activities = [];
          _itineraryError = null;
          _currentPlanId = null;
        }
        notifyListeners();
        return const PlanDeleteResult(status: 200);
      }
      if (response.statusCode == 409) {
        return PlanDeleteResult(
          status: 409,
          sharedWith: _sharedWithLabels(response.body),
        );
      }
      return PlanDeleteResult(status: response.statusCode);
    } catch (e) {
      logger.e('Error deleting plan: $e');
      return const PlanDeleteResult();
    }
  }

  /// DELETE /api/activities/:id. On 200 that row leaves the itinerary.
  Future<int?> deleteActivity({
    required String activityId,
    required String planId,
    required String? token,
  }) async {
    try {
      if (token == null || token.isEmpty) return 401;
      final response = await http.delete(
        Uri.parse('$backendBaseUrl$apiActivities/$activityId'),
        headers: {'Authorization': 'Bearer $token'},
      );
      if (response.statusCode == 401 || response.statusCode == 403) {
        return response.statusCode;
      }
      if (response.statusCode != 200) return response.statusCode;
      _itinerary = [
        for (final activity in _itinerary)
          if (activity.id != activityId) activity,
      ];
      _activities = List<Activity>.from(_itinerary);
      notifyListeners();
      if (planId.isNotEmpty) await _reloadPlan(planId, token);
      return 200;
    } catch (e) {
      logger.e('Error deleting activity: $e');
      return null;
    }
  }

  // Add activity to plan (real API POST /api/activities with token passed as param)
  Future<void> addActivity(Activity newActivity, String? token) async {
    try {
      if (token == null) throw Exception('No token—log in first');

      final baseUrl = backendBaseUrl;
      final url = Uri.parse(baseUrl + apiActivities);
      final response = await http.post(
        url,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: json.encode(newActivity.toJson()),
      );

      if (response.statusCode == 201) {
        final data = json.decode(response.body);
        final createdActivity = Activity.fromJson(
          data['event'],
        ); // Backend returns the created activity
        _activities.add(createdActivity);
        _computeDayNumbers(newActivity.planId); // Recalculate days
        notifyListeners();
        logger.i('Added activity: ${createdActivity.name} from backend');
      } else {
        final errorData = json.decode(response.body);
        throw Exception(
          errorData['message'] ??
              'Failed to add activity: ${response.statusCode}',
        );
      }
    } catch (e) {
      logger.e('Error adding activity: $e');
      // Fallback: Add mock
      _activities.add(newActivity);
      _computeDayNumbers(newActivity.planId);
      notifyListeners();
    }
  }

  // Update activity (real API PUT /api/activities/:id with token passed as param)
  Future<void> updateActivityDocument(Activity updatedActivity, String? token) async {
    if (updatedActivity.id == null) {
      throw Exception(
        'Cannot update: Activity ID is null. Use addActivity for new activities.',
      ); // Early return with message
    }

    _isLoading = true;
    notifyListeners();

    try {
      if (token == null) throw Exception('No token—log in first');

      final baseUrl = backendBaseUrl;
      final url = Uri.parse('$baseUrl$apiActivities/${updatedActivity.id}');
      final body = json.encode(updatedActivity.toJson());
      logger.i('Updating activity: $body'); // Log data sent
      final response = await http.put(
        url,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: body,
      );

      logger.i(
        'Update response: ${response.statusCode} ${response.body}',
      ); // Log response
      if (response.statusCode == 200) {
        final index = _activities.indexWhere((e) => e.id == updatedActivity.id);
        if (index != -1) {
          _activities[index] = updatedActivity;
        }
        _computeDayNumbers(updatedActivity.planId); // Recalculate days
        notifyListeners();
        logger.i('Updated activity: ${updatedActivity.name} from backend');
      } else {
        throw Exception('Failed to update activity: ${response.statusCode}');
      }
    } catch (e) {
      logger.e('Error updating activity: $e');
      // Fallback: Add mock
      // _activities.add(updatedActivity);
      _computeDayNumbers(updatedActivity.planId);
      notifyListeners();
    }
  }

  Future<void> deleteActivityDocument(String activityId, String? token) async {
    if (activityId.isEmpty) {
      throw Exception('Invalid activity ID'); // Early check for empty ID
    }

    _isLoading = true;
    notifyListeners(); // Show spinner

    try {
      if (token == null) throw Exception('No token—log in first');

      final baseUrl = backendBaseUrl;
      final url = Uri.parse('$baseUrl$apiActivities/$activityId');
      final response = await http.delete(
        url,
        headers: {'Authorization': 'Bearer $token'},
      );

      if (response.statusCode == 200) {
        _activities.removeWhere(
          (activity) => activity.id == activityId,
        ); // Remove from local list
        logger.i('Deleted activity $activityId');
      } else {
        throw Exception('Delete activity failed: ${response.statusCode}');
      }
    } catch (e) {
      logger.e('Delete activity error: $e');
      rethrow; // Bubble up for UI handling (e.g., SnackBar)
    } finally {
      _isLoading = false;
      notifyListeners(); // Refresh UI
    }
  }

  // Full comparator for sorting (Cases 1-4: Time prevails, activityNum fallback)
  int _compareActivities(Activity a, Activity b) {
    // Primary: effectiveStartTime (Cases 1-3)
    final aStart =
        a.effectiveStartTime ?? DateTime(2100); // Nulls last (far future)
    final bStart = b.effectiveStartTime ?? DateTime(2100);
    final compareStart = aStart.compareTo(bStart);
    if (compareStart != 0) return compareStart;

    // Secondary: effectiveEndTime if start ties
    final aEnd = a.effectiveEndTime ?? DateTime(2100);
    final bEnd = b.effectiveEndTime ?? DateTime(2100);
    final compareEnd = aEnd.compareTo(bEnd);
    if (compareEnd != 0) return compareEnd;

    // Tertiary: activityNum fallback (Case 4)
    return (a.activityNum ?? 0).compareTo(b.activityNum ?? 0);
  }

  Map<String, int> _computeDayNumbers(String planId) {
    final planActivities = List<Activity>.from(
      _activities.where((e) => e.planId == planId),
    );
    if (planActivities.isEmpty) return {};

    planActivities.sort(_compareActivities);

    final dayNumbers = <String, int>{}; // Map to store activityId -> dayNumber
    int currentDay = 1;
    DateTime? priorEnd = planActivities.first.effectiveStartTime ?? DateTime.now();

    for (var activity in planActivities) {
      final activityId = activity.id ?? '';
      dayNumbers[activityId] = currentDay;

      final nextStart = activity.effectiveStartTime ?? priorEnd;
      final priorEndNonNull = priorEnd ?? DateTime.now();
      if ((nextStart?.isAfter(priorEndNonNull) ?? false) &&
          (nextStart?.day ?? 0) > (priorEndNonNull.day)) {
        currentDay++;
      }
      priorEnd =
          activity.effectiveEndTime ??
          nextStart!.add(activity.duration ?? Duration.zero);
    }
    return dayNumbers; // Return the computed map
  }

  Map<String, int> getDayNumbersForPlan(String planId) {
    return _computeDayNumbers(planId);
  }

  // Getter for sorted activities with all logic (Cases 1-6)
  List<Activity> get sortedActivities {
    final planActivities = List<Activity>.from(
      _activities.where((e) => e.planId == (_currentPlanId ?? '')),
    ); // Fixed: ?? '' for filter
    _computeDayNumbers(_currentPlanId ?? ''); // Fixed: ?? '' for parameter
    return planActivities..sort(_compareActivities);
  }

  // Setter for current plan ID
  set currentPlanId(String? planId) {
    _currentPlanId = planId;
    notifyListeners();
  }

  // Getter for current plan ID
  String? get currentPlanId => _currentPlanId;

  // Method to get icon data based on activity type
  IconData getIcon(ActivityType type) {
    switch (type) {
      case ActivityType.flight:
        return Icons.flight;
      case ActivityType.hotel:
        return Icons.hotel;
      case ActivityType.train:
        return Icons.train;
      case ActivityType.carRental:
      case ActivityType.carService:
      case ActivityType.drive:
        return Icons.directions_car;
      case ActivityType.taxi:
        return Icons.local_taxi;
      case ActivityType.bus:
        return Icons.directions_bus;
      case ActivityType.ferry:
        return Icons.directions_boat;
      default:
        return Icons.event;
    }
  }
}
