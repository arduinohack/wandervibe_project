import 'package:flutter/foundation.dart'; // For ChangeNotifier
import 'package:http/http.dart'
    as http; // For API calls (add to pubspec.yaml if not there)
import 'dart:convert'; // For JSON
import 'package:provider/provider.dart'; // Added for Provider.of (token from UserProvider)
import '../config/constants.dart'; // Add this line for backendBaseUrl
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

  // Fetch itinerary for a trip (real API with token passed as param)
  Future<void> fetchItinerary(String tripId, String? token) async {
    _currentTripId = tripId;
    _isLoading = true;
    notifyListeners();

    try {
      if (token == null) throw Exception('No token—log in first');

      final response = await http.get(
        Uri.parse(
          (await backendBaseUrl) +
              apiTripsItinerary.replaceAll('{tripId}', tripId),
        ),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
      );

      if (response.statusCode == 200) {
        final List<dynamic> data = json.decode(response.body);
        _events = data.map((json) => Event.fromJson(json)).toList();
        _computeDayNumbers(tripId); // Calculate day numbers
        print('Fetched ${_events.length} events for trip $tripId from backend');
      } else {
        throw Exception('Failed to load itinerary: ${response.statusCode}');
      }
    } catch (e) {
      print('Error fetching itinerary: $e');
      // Fallback to mock
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
          originTimeZone: null,
          destinationTimeZone: null,
          resourceLinks: {'maps': 'https://maps.example.com/hotel'},
          createdAt: DateTime.now(),
        ),
      ];
      _computeDayNumbers(tripId);
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
        Uri.parse((await backendBaseUrl) + apiTrips),
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

  // Create trip (real API POST /api/trips with token passed as param)
  Future<void> createTrip(Trip newTrip, String? token) async {
    try {
      if (token == null) throw Exception('No token—log in first');

      final response = await http.post(
        Uri.parse(await backendBaseUrl + apiTrips),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: json.encode(newTrip.toJson()),
      );

      if (response.statusCode == 201) {
        final data = json.decode(response.body);
        final createdTrip = Trip.fromJson(
          data['trip'],
        ); // Backend returns the created trip
        _trips.add(createdTrip);
        notifyListeners();
        print('Created trip: ${createdTrip.name} from backend');
      } else {
        throw Exception('Failed to create trip: ${response.statusCode}');
      }
    } catch (e) {
      print('Error creating trip: $e');
      // Fallback: Add mock
      _trips.add(newTrip);
      notifyListeners();
    }
  }

  // Add event to trip (real API POST /api/events with token passed as param)
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
        _computeDayNumbers(newEvent.tripId); // Recalculate days
        notifyListeners();
        print('Added event: ${createdEvent.title} from backend');
      } else {
        throw Exception('Failed to add event: ${response.statusCode}');
      }
    } catch (e) {
      print('Error adding event: $e');
      // Fallback: Add mock
      _events.add(newEvent);
      _computeDayNumbers(newEvent.tripId);
      notifyListeners();
    }
  }
}
