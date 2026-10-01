// For ChangeNotifier
import 'package:http/http.dart'
    as http; // For API calls (add to pubspec.yaml if not there)
import 'dart:convert'; // For JSON
// Added for Provider.of (token from UserProvider)
import '../config/constants.dart'; // Add this line for backendBaseUrl
// Add this line for UserProvider (token)
import 'package:flutter/material.dart'; // Added: Required for Icon
import '../models/plan.dart'; // Your Plan model
import '../models/event.dart'; // Your Event model
import '../models/event_type.dart'; // Your Event model
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
        // _computeDayNumbers(planId); // Calculate day numbers
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

  String? _plansError;

  String? get plansError => _plansError;

  void clearPlans() {
    _plans = [];
    _plansError = null;
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
        Uri.parse((await backendBaseUrl) + apiPlans),
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

  // Fetch PlanUsers for a plan (GET /api/plans/:planId/users with token)
  Future<void> fetchPlanUsers(String planId, String? token) async {
    _isLoading = true; // Optional: Show loading in UI
    notifyListeners();

    try {
      if (token == null) throw Exception('No token—log in first');

      final response = await http.get(
        Uri.parse('${await backendBaseUrl}/api/plans/$planId/users'),
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
        Uri.parse(await backendBaseUrl + apiPlans),
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
        final errorData = json.decode(response.body);
        throw Exception(
          errorData['message'] ?? 'Failed to add event: ${response.statusCode}',
        );
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
      final body = json.encode(updatedEvent.toJson());
      logger.i('Updating event: $body'); // Log data sent
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

  Future<void> deleteEvent(String deleteEventId, String? token) async {
    if (deleteEventId.isEmpty) {
      throw Exception('Invalid event ID'); // Early check for empty ID
    }

    _isLoading = true;
    notifyListeners(); // Show spinner

    try {
      if (token == null) throw Exception('No token—log in first');

      final baseUrl = await backendBaseUrl; // Await first (get the string)
      final url = Uri.parse('$baseUrl$apiEvents/$deleteEventId');
      final response = await http.delete(
        url,
        headers: {'Authorization': 'Bearer $token'},
      );

      if (response.statusCode == 200) {
        _events.removeWhere(
          (event) => event.id == deleteEventId,
        ); // Remove from local list
        logger.i('Deleted event $deleteEventId');
      } else {
        throw Exception('Delete event failed: ${response.statusCode}');
      }
    } catch (e) {
      logger.e('Delete event error: $e');
      rethrow; // Bubble up for UI handling (e.g., SnackBar)
    } finally {
      _isLoading = false;
      notifyListeners(); // Refresh UI
    }
  }

  // Full comparator for sorting (Cases 1-4: Time prevails, eventNum fallback)
  int _compareEvents(Event a, Event b) {
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

    // Tertiary: eventNum fallback (Case 4)
    return (a.eventNum ?? 0).compareTo(b.eventNum ?? 0);
  }

  Map<String, int> _computeDayNumbers(String planId) {
    final planEvents = List<Event>.from(
      _events.where((e) => e.planId == planId),
    );
    if (planEvents.isEmpty) return {};

    planEvents.sort(_compareEvents);

    final dayNumbers = <String, int>{}; // Map to store eventId -> dayNumber
    int currentDay = 1;
    DateTime? priorEnd = planEvents.first.effectiveStartTime ?? DateTime.now();

    for (var event in planEvents) {
      final eventId = event.id ?? ''; // Use event ID as key
      dayNumbers[eventId] = currentDay;

      final nextStart = event.effectiveStartTime ?? priorEnd;
      final priorEndNonNull = priorEnd ?? DateTime.now();
      if ((nextStart?.isAfter(priorEndNonNull) ?? false) &&
          (nextStart?.day ?? 0) > (priorEndNonNull.day)) {
        currentDay++;
      }
      priorEnd =
          event.effectiveEndTime ??
          nextStart!.add(event.duration ?? Duration.zero);
    }
    return dayNumbers; // Return the computed map
  }

  Map<String, int> getDayNumbersForPlan(String planId) {
    return _computeDayNumbers(planId);
  }

  // Getter for sorted events with all logic (Cases 1-6)
  List<Event> get sortedEvents {
    final planEvents = List<Event>.from(
      _events.where((e) => e.planId == (_currentPlanId ?? '')),
    ); // Fixed: ?? '' for filter
    _computeDayNumbers(_currentPlanId ?? ''); // Fixed: ?? '' for parameter
    return planEvents..sort(_compareEvents);
  }

  // Setter for current plan ID
  set currentPlanId(String? planId) {
    _currentPlanId = planId;
    notifyListeners();
  }

  // Getter for current plan ID
  String? get currentPlanId => _currentPlanId;

  // NEW: Method to get icon based on event type
  // Method to get icon data based on event type
  IconData getIcon(EventType type) {
    switch (type) {
      case EventType.flight:
        return Icons.flight;
      case EventType.hotel:
        return Icons.hotel;
      case EventType.train:
        return Icons.train;
      case EventType.carRental:
      case EventType.carService:
      case EventType.drive:
        return Icons.directions_car;
      case EventType.taxi:
        return Icons.local_taxi;
      case EventType.bus:
        return Icons.directions_bus;
      case EventType.ferry:
        return Icons.directions_boat;
      default:
        return Icons.event;
    }
  }
}
