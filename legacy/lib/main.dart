

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_database/firebase_database.dart';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:mobile_recommender/export.dart';

import 'package:mobile_recommender/screen/filter_screen.dart';
import 'package:mobile_recommender/screen/mobile_desc.dart';
import 'package:mobile_recommender/screen/filter_logic_screen.dart';
import 'package:mobile_recommender/screen/all_phones_screen.dart';
import 'package:mobile_recommender/screen/auth_screen.dart';
import 'package:mobile_recommender/utils/logger.dart';
import 'package:mobile_recommender/utils/page_transition.dart';
// import 'package:mailer/mailer.dart';  // Temporarily commented for web compatibility
// import 'package:mailer/smtp_server.dart';  // Temporarily commented for web compatibility
// import 'package:splashscreen/splashscreen.dart';  // Replaced with custom splash screen
import 'package:flutter/foundation.dart';
import 'firebase_options.dart';

bool isConnected = false;
String firstMessage = "";

int _strToInt(String temp) {
  if (temp.isEmpty) return 0;
  return int.tryParse(temp[0]) ?? 0;
}

Future<void> loadUserData() async {
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final DatabaseReference dbRef = FirebaseDatabase.instance.ref().child("users");
  final User? user = _auth.currentUser;

  if (user == null) {
    print('User not logged in, skipping data load.');
    return;
  }

  try {
    final DataSnapshot snapshot = await dbRef.child(user.uid).get();
    final userDataMap = snapshot.value as Map<dynamic, dynamic>?;

    if (userDataMap == null) return;

    final favourites = userDataMap['Favourites'];
    if (favourites is List) {
      for (var favId in favourites) {
        final id = favId.toString();
        if (id.length == 1) {
          mobiles[_strToInt(id)].isFav = true;
        } else if (id.length == 2) {
          mobiles[_strToInt(id[0]) * 10 + _strToInt(id[1])].isFav = true;
        }
      }
    }
    print('User data and favorites loaded successfully.');
  } catch (e, s) {
    logger.e('Error loading user data', e, s);
  }
}

Future<void> main() async {
  // Platform-specific connectivity check
  if (kIsWeb) {
    // For web, assume connection is available
    isConnected = true;
    firstMessage = "RECSY";
    print('Web platform - assuming connected');
  } else {
    // For mobile platforms, check actual connectivity
    try {
      final result = await InternetAddress.lookup('google.com');
      if (result.isNotEmpty && result[0].rawAddress.isNotEmpty) {
        print('connected');
        isConnected = true;
        firstMessage = "RECSY";
      }
    } on SocketException catch (_) {
      print('not connected');
      firstMessage = "RECSY \n Please connect to the internet";
    }
  }
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );
  await loadMobiles(); // Load mobile data at startup



  // Mailer configuration - temporarily disabled for web compatibility
  // if (!kIsWeb) {
  //   String username = 'spiraldev1415@gmail.com'; //Your Email;
  //   String password = 'Recsy@123'; //Your Email's password;
  //   final smtpServer = gmail(username, password);
  // }
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (context) => FilterPage()),
      ],
      child: MyApp(),
    ),
  );
}

class Splash2 extends StatefulWidget {
  static const Splash2Route = '/splash';

  @override
  _Splash2State createState() => _Splash2State();
}

class _Splash2State extends State<Splash2> {
  @override
  void initState() {
    super.initState();
    _navigateToHome();
  }

  _navigateToHome() async {
    // Ensure Firebase is initialized and user data is loaded before navigating.
    await loadUserData();
    await Future.delayed(const Duration(seconds: 1)); // Brief pause for effect

    if (!mounted) return;

    String route = isConnected
        ? (FirebaseAuth.instance.currentUser == null ? AuthScreen.Route : LandingPage.LandingRoute)
        : AuthScreen.Route;
    Navigator.pushReplacementNamed(context, route);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Center(
        child: TweenAnimationBuilder(
          tween: Tween<double>(begin: 0, end: 1),
          duration: const Duration(seconds: 2),
          builder: (context, double value, child) {
            return Opacity(
              opacity: value,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Image.asset('assets/spirallogo.png', width: 120, height: 120),
                  const SizedBox(height: 24),
                  Text(
                    firstMessage,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                        ),
                  ),
                  const SizedBox(height: 40),
                  const CircularProgressIndicator(
                    valueColor: AlwaysStoppedAnimation<Color>(kPrimaryColor),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class MyApp extends StatefulWidget {
  @override
  _MyAppState createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {

  @override
  Widget build(BuildContext context) {
    FirebaseAuth.instance.currentUser;

    return MaterialApp(
      onGenerateRoute: (settings) {
        Widget page;
        switch (settings.name) {
          case LandingPage.LandingRoute:
            page = LandingPage();
            break;
          case SearchPage.Route:
            page = SearchPage();
            break;
          case AuthScreen.Route:
            page = AuthScreen();
            break;
          case FilterScreen.Route:
            page = FilterScreen();
            break;
          case FilterLogicScreen.Route:
            page = FilterLogicScreen();
            break;
          case CompareScreen.Route:
            page = CompareScreen();
            break;
          case AllPhonesScreen.Route:
            page = AllPhonesScreen();
            break;
          case MobilePage.Route:
            page = MobilePage();
            break;
          case UserProfile.Route:
            page = UserProfile();
            break;
          case RecommendationPage.Route:
            page = RecommendationPage();
            break;
          case ContactUs.Route:
            page = ContactUs();
            break;
          case AboutUs.Route:
            page = AboutUs();
            break;
          case Splash2.Splash2Route:
          default:
            page = Splash2();
            return MaterialPageRoute(builder: (_) => page, settings: settings);
        }
        return FadeRoute(page: page, settings: settings);
      },
      initialRoute: Splash2.Splash2Route,
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: Colors.black,
        primaryColor: kPrimaryColor,
        colorScheme: ColorScheme.dark().copyWith(
          secondary: kAccentColor,
        ),
        appBarTheme: const AppBarTheme(color: Colors.black),
        elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
            shape: const StadiumBorder(),
            padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 15),
            backgroundColor: kPrimaryColor,
          ),
        ),
      ),
    );
  }
}
