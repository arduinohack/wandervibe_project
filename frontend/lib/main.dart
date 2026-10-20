import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'providers/user_provider.dart';
import 'providers/invitation_provider.dart';
import 'providers/plan_provider.dart';
import 'screens/login_screen.dart'; // Login if no token
import 'screens/signup_screen.dart';
import 'session_resume.dart';
//import 'screens/home_screen.dart'; // Home if logged in

final _rootNavigatorKey = GlobalKey<NavigatorState>();

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
    final colorScheme = ColorScheme.fromSeed(
      seedColor: const Color(0xFF0D7377),
    );
    return MaterialApp(
      navigatorKey: _rootNavigatorKey,
      title: 'PlanItVibe',
      builder: (context, child) {
        return SessionResume(
          navigatorKey: _rootNavigatorKey,
          child: child ?? const SizedBox.shrink(),
        );
      },
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: colorScheme,
        appBarTheme: AppBarTheme(
          backgroundColor: colorScheme.primary,
          foregroundColor: colorScheme.onPrimary,
        ),
      ),
      home: const LoginScreen(), // Always start with LoginScreen (no auto-stub)
      routes: {
        '/signup': (context) {
          final email = Uri.base.queryParameters['email'];
          return SignupScreen(email: email);
        },
      },
    );
  }
}
