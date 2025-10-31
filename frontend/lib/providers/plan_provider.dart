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

      if (response.statusCode == 200) {
        final List<dynamic> data = json.decode(response.body);
        _events = data.map((json) => Event.fromJson(json)).toList();
        _computeDayNumbers(planId); // Calculate day numbers
        print('Fetched ${_events.length} events for plan $planId from backend');
      } else {
        throw Exception('Failed to load itinerary: ${response.statusCode}');
      }
    } catch (e) {
      print('Error fetching itinerary: $e');
      // Fallback to mock
      _events = [
        Event(
          id: 'event1',
          planId: planId,
          title: 'Flight to Paris',
          location: 'JFK Airport',
          details: 'Direct flight, economy.',
          type: EventType.flight,
          customType: '',
          cost: 800.0,
          costType: CostType.estimated,
          startTime: DateTime.now().add(const Duration(hours: 8)),
          duration: 30,
          endTime: DateTime.now().add(const Duration(hours: 10)),
          originTimeZone: 'America/New_York',
          destinationTimeZone: 'Europe/Paris',
          resourceLinks: {'booking': 'https://example.com/booking'},
          createdAt: DateTime.now(),
        ),
        Event(
          id: 'event2',
          planId: planId,
          title: 'Hotel Check-in',
          location: 'Le Marais',
          details: 'Cozy boutique hotel.',
          type: EventType.hotel,
          customType: '',
          cost: 150.0,
          costType: CostType.actual,
          startTime: DateTime.now().add(const Duration(days: 1)),
          duration: 30,
          endTime: DateTime.now().add(const Duration(days: 8)),
          originTimeZone: null,
          destinationTimeZone: null,
          resourceLinks: {'maps': 'https://maps.example.com/hotel'},
          createdAt: DateTime.now(),
        ),
      ];
      _computeDayNumbers(planId);
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

    _events.sort(
      (a, b) => a.startTime.compareTo(b.startTime),
    ); // Sort by startTime

    int currentDay = 1;
    DateTime? prevEndTime = _events.isNotEmpty
        ? _events[0].endTime
        : DateTime.now();

    for (int i = 1; i < _events.length; i++) {
      Event event = _events[i];
      DateTime eventStart =
          event.startTime; // Adjust for TZ/DST in real (use tz.TZDateTime.from)

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
      _plans = [
        Plan(
          id: 'plan1',
          type: 'trip',
          name: 'Paris Adventure',
          destination: 'Paris, France',
          startDate: DateTime.now(),
          endDate: DateTime.now().add(const Duration(days: 7)),
          autoCalculateStartDate: false,
          autoCalculateEndDate: false,
          location: '',
          budget: 2000.0,
          planningState: 'initial',
          timeZone: 'Europe/Paris',
          ownerId: 'user123',
          createdAt: DateTime.now(),
        ),
      ];
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

      print(
        'Fetch PlanUsers response: ${response.statusCode}',
      ); // Debug optional

      if (response.statusCode == 200) {
        final List<dynamic> data = json.decode(response.body);
        _planUsers = data
            .map((json) => PlanUser.fromJson(json))
            .toList(); // Parse to List<PlanUser>
        print('Fetched ${_planUsers.length} PlanUsers for plan $planId');
      } else {
        throw Exception('Failed to load PlanUsers: ${response.statusCode}');
      }
    } catch (e) {
      print('Error fetching PlanUsers: $e');
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

      final response = await http.post(
        Uri.parse(await backendBaseUrl + apiEvents),
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
        print('Added event: ${createdEvent.title} from backend');
      } else {
        throw Exception('Failed to add event: ${response.statusCode}');
      }
    } catch (e) {
      print('Error adding event: $e');
      // Fallback: Add mock
      _events.add(newEvent);
      _computeDayNumbers(newEvent.planId);
      notifyListeners();
    }
  }
}
