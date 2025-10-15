import 'package:flutter/foundation.dart'; // For ChangeNotifier
import 'package:http/http.dart'
    as http; // For API calls (add to pubspec.yaml if not there)
import 'dart:convert'; // For JSON
import 'package:provider/provider.dart'; // Added for Provider.of (token from UserProvider)
import '../providers/user_provider.dart'; // Add this line for UserProvider (token)
import '../models/trip.dart'; // Your Trip model
import '../models/event.dart'; // Your Event model
import '../models/user.dart'; // Your User model

class TripProvider extends ChangeNotifier {
  List<Trip> _trips = []; // Private list of trips
  List<Event> _events = []; // Private list of events for current trip
  List<TripUser> _tripUsers =
      []; // Private list of users/roles for current trip
  bool _isLoading = false; // Loading state for UI spinners

  List<Trip> get trips => _trips; // Public getter
  List<Event> get events => _events;
  List<TripUser> get tripUsers => _tripUsers;
  bool get isLoading => _isLoading;

  String? _currentTripId; // Track current trip for itinerary

  // Fetch itinerary for a trip (events + day numbers; mock for now; replace with GET /api/trips/:tripId/itinerary)
  Future<void> fetchItinerary(String tripId) async {
    _currentTripId = tripId;
    _isLoading = true;
    notifyListeners();

    try {
      // Mock data (replace with http.get('http://localhost:3000/api/trips/$tripId/itinerary'))
      await Future.delayed(const Duration(seconds: 1));
      _events = [
        Event(
          id: 'event1',
          tripId: tripId,
          title: 'Flight to Paris',
          location: 'JFK Airport',
          details: 'Direct flight, economy.',
          type: EventType.flight,
          cost: 800.0,
          costType: CostType.estimated,
          startTime: DateTime.now().add(const Duration(hours: 8)),
          endTime: DateTime.now().add(const Duration(hours: 10)),
          originTimeZone: 'America/New_York',
          destinationTimeZone: 'Europe/Paris',
          resourceLinks: {'booking': 'https://example.com/booking'},
          createdAt: DateTime.now(),
        ),
        Event(
          id: 'event2',
          tripId: tripId,
          title: 'Hotel Check-in',
          location: 'Le Marais',
          details: 'Cozy boutique hotel.',
          type: EventType.hotel,
          cost: 150.0,
          costType: CostType.actual,
          startTime: DateTime.now().add(const Duration(days: 1)),
          endTime: DateTime.now().add(const Duration(days: 8)),
          originTimeZone: null, // Uses trip TZ
          destinationTimeZone: null,
          resourceLinks: {'maps': 'https://maps.example.com/hotel'},
          createdAt: DateTime.now(),
        ),
      ];
      _computeDayNumbers(tripId); // Calculate day numbers
    } catch (e) {
      print('Error fetching itinerary: $e');
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  // Private method to compute Day Numbers (TZ logic from requirements)
  void _computeDayNumbers(String tripId) {
    final trip = _trips.firstWhere(
      (t) => t.id == tripId,
      orElse: () => Trip(
        id: '',
        name: '',
        destination: '',
        startDate: DateTime.now(),
        endDate: DateTime.now(),
        budget: 0.0,
        planningState: 'initial',
        timeZone: 'UTC',
        ownerId: '',
      ),
    );
    final tripTz = trip
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

  // Fetch all trips (real API with auth token passed in)
  Future<void> fetchTrips(String? token) async {
    _isLoading = true;
    notifyListeners();

    try {
      if (token == null) {
        throw Exception('No token—log in first');
      }

      final response = await http.get(
        Uri.parse('http://localhost:3000/api/trips'),
        headers: {'Authorization': 'Bearer $token'},
      );

      if (response.statusCode == 200) {
        final List<dynamic> data = json.decode(response.body);
        _trips = data.map((json) => Trip.fromJson(json)).toList();
      } else {
        throw Exception('Failed to load trips: ${response.statusCode}');
      }
    } catch (e) {
      print('Error fetching trips: $e');
      // Fallback to mock if offline
      _trips = [
        Trip(
          id: 'trip1',
          name: 'Paris Adventure',
          destination: 'Paris, France',
          startDate: DateTime.now(),
          endDate: DateTime.now().add(const Duration(days: 7)),
          budget: 2000.0,
          planningState: 'initial',
          timeZone: 'Europe/Paris',
          ownerId: 'user123',
        ),
      ];
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  // Create trip (mock; replace with POST /api/trips)
  Future<void> createTrip(Trip newTrip) async {
    try {
      // Mock (replace with http.post('http://localhost:3000/api/trips', body: newTrip.toJson()))
      await Future.delayed(const Duration(seconds: 1));
      _trips.add(newTrip);
      notifyListeners();
      print('Created trip: ${newTrip.name}');
    } catch (e) {
      print('Error creating trip: $e');
    }
  }

  // Add event to trip (mock; replace with POST /api/events)
  Future<void> addEvent(Event newEvent) async {
    try {
      // Mock (replace with http.post('http://localhost:3000/api/events', body: newEvent.toJson()))
      await Future.delayed(const Duration(seconds: 1));
      _events.add(newEvent);
      _computeDayNumbers(newEvent.tripId); // Recalculate days
      notifyListeners();
      print('Added event: ${newEvent.title}');
    } catch (e) {
      print('Error adding event: $e');
    }
  }
}
