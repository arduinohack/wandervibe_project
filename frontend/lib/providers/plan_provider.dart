import 'package:flutter/foundation.dart'; // For ChangeNotifier
import 'package:http/http.dart'
    as http; // For API calls (add to pubspec.yaml if not there)
import 'dart:convert'; // For JSON
import 'package:provider/provider.dart'; // Added for Provider.of (token from UserProvider)
import '../config/constants.dart'; // Add this line for backendBaseUrl
import '../providers/user_provider.dart'; // Add this line for UserProvider (token)
import '../models/plan.dart'; // Your Plan model
import '../models/event.dart'; // Your Event model
import '../models/user.dart'; // Your User model
import '../utils/logger.dart';

class PlanProvider extends ChangeNotifier {
  List<Plan> _plans = []; // Private list of plans
  Plan? _currentPlan; // Current selected plan
  Plan? get currentPlan => _currentPlan;
  List<Event> _events = []; // Private list of events for current plan
  bool _isLoading = false; // Loading state for UI spinners

  List<Plan> get plans => _plans; // Public getter
  List<Event> get events => _events;
  List<PlanUser> _planUsers =
      []; // Private list of users/roles for current plan
  List<PlanUser> get planUsers => _planUsers;
  bool get isLoading => _isLoading;

  String? _currentPlanId; // Track current plan for itinerary

  // Fetch itinerary for a plan (real API with token passed as param)
  Future<void> fetchPlan(String planId, String? token) async {
    _currentPlanId = planId;
    _isLoading = true;
    notifyListeners();

    try {
      if (token == null) throw Exception('No token—log in first');

      logger.i('Fetching plan ID: $planId with token'); // Added: Debug start
      final response = await http.get(
        Uri.parse(
          (await backendBaseUrl) +
              apiPlansItinerary.replaceAll('{planId}', planId),
        ),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
      );

      logger.i('Response status: ${response.statusCode}'); // Added: Status
      if (response.statusCode == 200) {
        logger.i(
          'Response body: ${response.body}',
        ); // Added: Raw JSON for parsing check
        final data = json.decode(
          response.body,
        ); // Added: Declare data as local variable
        final List<dynamic> eventsData =
            data['events'] ??
            []; // Extract 'events' array (or empty if missing)
        _events = eventsData
            .map((json) => Event.fromJson(json))
            .toList(); // Map to List<Event>
        logger.i(
          'Fetched ${_events.length} events for plan $planId from backend',
        );
        // Optional: Handle 'grouped' if used (e.g.,
        //_groupedEvents = data['grouped'] ?? {});
        _computeDayNumbers(planId); // Calculate day numbers
      }
    } catch (e) {
      logger.i('Error fetching itinerary: $e');
      _events = [];
      notifyListeners();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  // Private method to compute Day Numbers (TZ logic from requirements)
  void _computeDayNumbers(String planId) {
    final plan = _plans.firstWhere(
      (t) => t.id == planId,
      orElse: () => Plan(
        id: '',
        type: '',
        name: '',
        destination: '',
        startDate: DateTime.now(),
        endDate: DateTime.now(),
        autoCalculateStartDate: false,
        autoCalculateEndDate: false,
        location: '',
        budget: 0.0,
        planningState: 'initial',
        timeZone: 'UTC',
        ownerId: '',
        createdAt: DateTime.now(),
      ),
    );
    final planTz = plan
        .timeZone; // Mock TZ location (add luxon or flutter_timezone later for DST)

    _events.sort((a, b) {
      final dateA = a.startTime;
      final dateB = b.startTime;
      if (dateA != null && dateB != null) {
        return dateA.compareTo(dateB); // Safe compare if both non-null
      }
      return 0; // Or sort nulls last: return (dateA == null ? 1 : 0) - (dateB == null ? 1 : 0);
    });

    int currentDay = 1;
    DateTime? prevEndTime = _events.isNotEmpty
        ? _events[0].endTime
        : DateTime.now();

    for (int i = 1; i < _events.length; i++) {
      Event event = _events[i];
      DateTime eventStart =
          event.startTime ??
          DateTime.now(); // Adjust for TZ/DST in real (use tz.TZDateTime.from)

      // Increment day if startTime is after midnight relative to prevEndTime in relevant TZ
      if (eventStart.isAfter(prevEndTime!.add(const Duration(days: 1)))) {
        // Fixed line
        currentDay++;
      }
      event.dayNumber = currentDay;
      prevEndTime = event.endTime;
    }
  }

  // Fetch all plans (real API with auth token passed in)
  Future<void> fetchPlans(String? token) async {
    _isLoading = true;
    notifyListeners();

    try {
      if (token == null) {
        throw Exception('No token—log in first');
      }

      final response = await http.get(
        Uri.parse((await backendBaseUrl) + apiPlans),
        headers: {'Authorization': 'Bearer $token'},
      );

      logger.i('Fetch plans response body: ${response.body}');

      if (response.statusCode == 200) {
        final dynamic data = json.decode(response.body);
        List<dynamic> plansData;
        if (data is List<dynamic>) {
          plansData = data; // Direct list
        } else if (data is Map<String, dynamic>) {
          plansData =
              data['plans'] ??
              [
                data['plan'] ?? {},
              ]; // Extract 'plans' array or wrap single 'plan' in list
        } else {
          throw Exception('Unexpected response format: ${data.runtimeType}');
        }
        _plans = plansData
            .map((json) => Plan.fromJson(json as Map<String, dynamic>))
            .toList();
        logger.i('Parsed ${_plans.length} plans from backend'); // Existing
        // Fixed:
        for (final plan in _plans) {
          logger.i('Plan ID: ${plan.id}, Owner ID: ${plan.ownerId}');
        } // Debug optional
      } else {
        throw Exception('Failed to load plans: ${response.statusCode}');
      }
    } catch (e) {
      logger.i('Error fetching plans: $e');
      // Fallback to mock if offline
      _plans = [];
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  // Fetch PlanUsers for a plan (GET /api/plans/:planId/users with token)
  Future<void> fetchPlanUsers(String planId, String? token) async {
    _isLoading = true; // Optional: Show loading in UI
    notifyListeners();

    try {
      if (token == null) throw Exception('No token—log in first');

      final response = await http.get(
        Uri.parse((await backendBaseUrl) + '/api/plans/$planId/users'),
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

  // Create plan (real API POST /api/plans with token passed as param)
  Future<void> createPlan(Plan newPlan, String? token) async {
    try {
      if (token == null) throw Exception('No token—log in first');

      final response = await http.post(
        Uri.parse(await backendBaseUrl + apiPlans),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: json.encode(newPlan.toJson()),
      );

      if (response.statusCode == 201) {
        final data = json.decode(response.body);
        final createdPlan = Plan.fromJson(
          data['plan'],
        ); // Backend returns the created plan
        _plans.add(createdPlan);
        notifyListeners();
        print('Created plan: ${createdPlan.name} from backend');
      } else {
        throw Exception('Failed to create plan: ${response.statusCode}');
      }
    } catch (e) {
      print('Error creating plan: $e');
      // Fallback: Add mock
      _plans.add(newPlan);
      notifyListeners();
    }
  }

  // Add event to plan (real API POST /api/events with token passed as param)
  Future<void> addEvent(Event newEvent, String? token) async {
    try {
      if (token == null) throw Exception('No token—log in first');

      final baseUrl = await backendBaseUrl; // Await first (get the string)
      final url = Uri.parse(baseUrl + apiEvents);
      final response = await http.post(
        url,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: json.encode(newEvent.toJson()),
      );

      if (response.statusCode == 201) {
        final data = json.decode(response.body);
        final createdEvent = Event.fromJson(
          data['event'],
        ); // Backend returns the created event
        _events.add(createdEvent);
        _computeDayNumbers(newEvent.planId); // Recalculate days
        notifyListeners();
        logger.i('Added event: ${createdEvent.name} from backend');
      } else {
        throw Exception('Failed to add event: ${response.statusCode}');
      }
    } catch (e) {
      logger.e('Error adding event: $e');
      // Fallback: Add mock
      _events.add(newEvent);
      _computeDayNumbers(newEvent.planId);
      notifyListeners();
    }
  }

  // Add event to plan (real API POST /api/events with token passed as param)
  Future<void> updateEvent(Event updatedEvent, String? token) async {
    if (updatedEvent.id == null) {
      throw Exception(
        'Cannot update: Event ID is null. Use addEvent for new events.',
      ); // Early return with message
    }

    _isLoading = true;
    notifyListeners();

    try {
      if (token == null) throw Exception('No token—log in first');

      final baseUrl = await backendBaseUrl; // Await first (get the string)
      final url = Uri.parse('$baseUrl$apiEvents/${updatedEvent.id}');
      final response = await http.post(
        url,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: json.encode(updatedEvent.toJson()),
      );

      if (response.statusCode == 201) {
        final index = _events.indexWhere((e) => e.id == updatedEvent.id);
        if (index != -1) {
          _events[index] = updatedEvent;
        }
        _computeDayNumbers(updatedEvent.planId); // Recalculate days
        notifyListeners();
        logger.i('Updated event: ${updatedEvent.name} from backend');
      } else {
        throw Exception('Failed to update event: ${response.statusCode}');
      }
    } catch (e) {
      logger.e('Error updating event: $e');
      // Fallback: Add mock
      // _events.add(updatedEvent);
      _computeDayNumbers(updatedEvent.planId);
      notifyListeners();
    }
  }
}
