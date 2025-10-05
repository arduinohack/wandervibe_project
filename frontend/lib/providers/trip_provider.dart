import 'package:flutter/foundation.dart';

class TripProvider extends ChangeNotifier {
  // TODO: Manage trips, events, etc.
  String? currentTripId;

  void setCurrentTrip(String id) {
    currentTripId = id;
    notifyListeners(); // Updates UI
  }
}
