import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'providers/trip_provider.dart'; // We'll create this next

void main() {
  runApp(
    ChangeNotifierProvider(create: (context) => TripProvider(), child: MyApp()),
  );
}

class MyApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'WanderVibe',
      theme: ThemeData(primarySwatch: Colors.blue),
      home: HomeScreen(), // Placeholder
    );
  }
}

class HomeScreen extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('WanderVibe')),
      body: Center(child: Text('Welcome! Trip planning starts here.')),
    );
  }
}
