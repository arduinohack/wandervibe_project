import 'package:flutter/material.dart'; // For IconData in extension

// Enum for activity types (categories for flights, hotels, etc.)
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
      String activityLabel,
      String serviceProviderLabel,
      String bookingReferenceLabel,
    })
  >
  _activityTypeData = {
    ActivityType.flight: (
      icon: Icons.flight,
      spPresence: true,
      activityLabel: 'Flight',
      serviceProviderLabel: 'Airline',
      bookingReferenceLabel: 'PNR (reservation)',
    ),
    ActivityType.train: (
      icon: Icons.train,
      spPresence: true,
      activityLabel: 'Train',
      serviceProviderLabel: 'Rail Operator',
      bookingReferenceLabel: 'PNR (reservation)',
    ),
    ActivityType.carRental: (
      icon: Icons.car_rental,
      spPresence: true,
      activityLabel: 'Car Rental',
      serviceProviderLabel: 'Car Rental Agency',
      bookingReferenceLabel: 'Reservation Number',
    ),
    ActivityType.carService: (
      icon: Icons.directions_car,
      spPresence: true,
      activityLabel: 'Car Service',
      serviceProviderLabel: 'Car Service Provider',
      bookingReferenceLabel: 'Booking ID',
    ),
    ActivityType.drive: (
      icon: Icons.directions_car,
      spPresence: false,
      activityLabel: 'Drive (Self)',
      serviceProviderLabel: '',
      bookingReferenceLabel: '',
    ),
    ActivityType.taxi: (
      icon: Icons.local_taxi,
      spPresence: false,
      activityLabel: 'Taxi',
      serviceProviderLabel: '',
      bookingReferenceLabel: '',
    ),
    ActivityType.bus: (
      icon: Icons.directions_bus,
      spPresence: true,
      activityLabel: 'Bus',
      serviceProviderLabel: 'Bus Operator',
      bookingReferenceLabel: 'Ticket Number',
    ),
    ActivityType.walk: (
      icon: Icons.directions_walk,
      spPresence: false,
      activityLabel: 'Walk',
      serviceProviderLabel: '',
      bookingReferenceLabel: '',
    ),
    ActivityType.ferry: (
      icon: Icons.directions_ferry,
      spPresence: true,
      activityLabel: 'Ferry',
      serviceProviderLabel: 'Ferry Operator',
      bookingReferenceLabel: 'Booking Number',
    ),
    ActivityType.dining: (
      icon: Icons.dining,
      spPresence: false,
      activityLabel: 'Dining',
      serviceProviderLabel: '',
      bookingReferenceLabel: '',
    ),
    ActivityType.hotel: (
      icon: Icons.hotel,
      spPresence: true,
      activityLabel: 'Hotel',
      serviceProviderLabel: 'Confirmation Number',
      bookingReferenceLabel: '',
    ),
    ActivityType.tour: (
      icon: Icons.tour,
      spPresence: true,
      activityLabel: 'Tour',
      serviceProviderLabel: 'Tour Operator',
      bookingReferenceLabel: '',
    ),
    ActivityType.activity: (
      icon: Icons.local_activity,
      spPresence: false,
      activityLabel: 'Activity',
      serviceProviderLabel: '',
      bookingReferenceLabel: '',
    ),
    ActivityType.meal: (
      icon: Icons.restaurant,
      spPresence: false,
      activityLabel: 'Meal',
      serviceProviderLabel: '',
      bookingReferenceLabel: '',
    ),
    ActivityType.transport: (
      icon: Icons.emoji_transportation,
      spPresence: true,
      activityLabel: 'Transportation',
      serviceProviderLabel: 'Transportation Provider',
      bookingReferenceLabel: 'PNR',
    ),
    ActivityType.attraction: (
      icon: Icons.attractions,
      spPresence: false,
      activityLabel: 'Attraction',
      serviceProviderLabel: '',
      bookingReferenceLabel: '',
    ),
    ActivityType.cruise: (
      icon: Icons.directions_boat,
      spPresence: true,
      activityLabel: 'Cruise',
      serviceProviderLabel: 'Cruise Line',
      bookingReferenceLabel: 'Booking Number',
    ),
    ActivityType.custom: (
      icon: Icons.category,
      spPresence: false,
      activityLabel: 'Custom',
      serviceProviderLabel: '',
      bookingReferenceLabel: '',
    ),
  };

  /// Getter for activity service provider presence
  bool get spPresence => _activityTypeData[this]!.spPresence;

  /// Getter for activityLabel
  String get activityLabel => _activityTypeData[this]!.activityLabel;

  /// Getter for IconData
  IconData get icon => _activityTypeData[this]!.icon;

  // Getter for serviceProviderLabel
  String get serviceProviderLabel => _activityTypeData[this]!.serviceProviderLabel;

  // Getter for bookingReferenceLabel
  String get bookingReferenceLabel =>
      _activityTypeData[this]!.bookingReferenceLabel;
}
