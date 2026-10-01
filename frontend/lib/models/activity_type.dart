import 'package:flutter/material.dart'; // For IconData in extension

// Enum for event types (categories for flights, hotels, etc.)
enum ActivityType {
  flight,
  train,
  carRental,
  carService,
  drive,
  taxi,
  bus,
  walk,
  ferry,
  dining, // more of a formal reservation vs walk in meal
  hotel,
  tour,
  activity,
  meal,
  transport,
  attraction,
  cruise,
  setup,
  ceremony,
  reception,
  vendor,
  custom,
}

// Define a mapping of ActivityType to IconData and serviceProviderLabel
extension ActivityTypeExtension on ActivityType {
  static const Map<
    ActivityType,
    ({
      IconData icon,
      bool spPresence,
      String eventLabel,
      String serviceProviderLabel,
      String bookingReferenceLabel,
    })
  >
  _eventTypeData = {
    ActivityType.flight: (
      icon: Icons.flight,
      spPresence: true,
      eventLabel: 'Flight',
      serviceProviderLabel: 'Airline',
      bookingReferenceLabel: 'PNR (reservation)',
    ),
    ActivityType.train: (
      icon: Icons.train,
      spPresence: true,
      eventLabel: 'Train',
      serviceProviderLabel: 'Rail Operator',
      bookingReferenceLabel: 'PNR (reservation)',
    ),
    ActivityType.carRental: (
      icon: Icons.car_rental,
      spPresence: true,
      eventLabel: 'Car Rental',
      serviceProviderLabel: 'Car Rental Agency',
      bookingReferenceLabel: 'Reservation Number',
    ),
    ActivityType.carService: (
      icon: Icons.directions_car,
      spPresence: true,
      eventLabel: 'Car Service',
      serviceProviderLabel: 'Car Service Provider',
      bookingReferenceLabel: 'Booking ID',
    ),
    ActivityType.drive: (
      icon: Icons.directions_car,
      spPresence: false,
      eventLabel: 'Drive (Self)',
      serviceProviderLabel: '',
      bookingReferenceLabel: '',
    ),
    ActivityType.taxi: (
      icon: Icons.local_taxi,
      spPresence: false,
      eventLabel: 'Taxi',
      serviceProviderLabel: '',
      bookingReferenceLabel: '',
    ),
    ActivityType.bus: (
      icon: Icons.directions_bus,
      spPresence: true,
      eventLabel: 'Bus',
      serviceProviderLabel: 'Bus Operator',
      bookingReferenceLabel: 'Ticket Number',
    ),
    ActivityType.walk: (
      icon: Icons.directions_walk,
      spPresence: false,
      eventLabel: 'Walk',
      serviceProviderLabel: '',
      bookingReferenceLabel: '',
    ),
    ActivityType.ferry: (
      icon: Icons.directions_ferry,
      spPresence: true,
      eventLabel: 'Ferry',
      serviceProviderLabel: 'Ferry Operator',
      bookingReferenceLabel: 'Booking Number',
    ),
    ActivityType.dining: (
      icon: Icons.dining,
      spPresence: false,
      eventLabel: 'Dining',
      serviceProviderLabel: '',
      bookingReferenceLabel: '',
    ),
    ActivityType.hotel: (
      icon: Icons.hotel,
      spPresence: true,
      eventLabel: 'Hotel',
      serviceProviderLabel: 'Confirmation Number',
      bookingReferenceLabel: '',
    ),
    ActivityType.tour: (
      icon: Icons.tour,
      spPresence: true,
      eventLabel: 'Tour',
      serviceProviderLabel: 'Tour Operator',
      bookingReferenceLabel: '',
    ),
    ActivityType.activity: (
      icon: Icons.local_activity,
      spPresence: false,
      eventLabel: 'Activity',
      serviceProviderLabel: '',
      bookingReferenceLabel: '',
    ),
    ActivityType.meal: (
      icon: Icons.restaurant,
      spPresence: false,
      eventLabel: 'Meal',
      serviceProviderLabel: '',
      bookingReferenceLabel: '',
    ),
    ActivityType.transport: (
      icon: Icons.emoji_transportation,
      spPresence: true,
      eventLabel: 'Transportation',
      serviceProviderLabel: 'Transportation Provider',
      bookingReferenceLabel: 'PNR',
    ),
    ActivityType.attraction: (
      icon: Icons.attractions,
      spPresence: false,
      eventLabel: 'Attraction',
      serviceProviderLabel: '',
      bookingReferenceLabel: '',
    ),
    ActivityType.cruise: (
      icon: Icons.directions_boat,
      spPresence: true,
      eventLabel: 'Cruise',
      serviceProviderLabel: 'Cruise Line',
      bookingReferenceLabel: 'Booking Number',
    ),
    ActivityType.custom: (
      icon: Icons.category,
      spPresence: false,
      eventLabel: 'Custom',
      serviceProviderLabel: '',
      bookingReferenceLabel: '',
    ),
  };

  /// Getter for event service provider presence
  bool get spPresence => _eventTypeData[this]!.spPresence;

  /// Getter for eventLabel
  String get eventLabel => _eventTypeData[this]!.eventLabel;

  /// Getter for IconData
  IconData get icon => _eventTypeData[this]!.icon;

  // Getter for serviceProviderLabel
  String get serviceProviderLabel => _eventTypeData[this]!.serviceProviderLabel;

  // Getter for bookingReferenceLabel
  String get bookingReferenceLabel =>
      _eventTypeData[this]!.bookingReferenceLabel;
}
