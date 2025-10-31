import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'providers/user_provider.dart';
import 'providers/invitation_provider.dart';
import 'providers/plan_provider.dart';
import 'screens/login_screen.dart'; // Login if no token
//import 'screens/home_screen.dart'; // Home if logged in

void main() {
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(
          create: (context) => UserProvider()..loadStoredToken(),
        ), // Load token on start
        ChangeNotifierProvider(create: (_) => InvitationProvider()),
        ChangeNotifierProvider(create: (_) => PlanProvider()),
      ],
      child: MyApp(),
    ),
  );
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'WanderVibe',
      theme: ThemeData(primarySwatch: Colors.blue),
      home: const LoginScreen(), // Always start with LoginScreen (no auto-stub)
    );
  }
}
