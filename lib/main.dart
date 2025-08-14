import 'dart:io';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:flutter/material.dart';
import 'package:mobile_recommender/screen/mobile_desc.dart';
import 'package:mobile_recommender/screen/user.dart';
import 'package:mailer/mailer.dart';
import 'package:mailer/smtp_server.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:splashscreen/splashscreen.dart';

import 'export.dart';

var email;
var name;
bool isConnected = false;
String firstMessage = "";

Future<void> main() async {
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
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();

  SharedPreferences prefs = await SharedPreferences.getInstance();
  email = prefs.getString('email');
  name = prefs.getString('name');
  print('Hi AU');
  // fav = prefs.getStringList('fav');
  // favlist = prefs.getStringList('favList');
  // print(email);
  // print(name);
  // print(fav);
  // print(favlist);

  final FirebaseAuth _auth = FirebaseAuth.instance;
  final DatabaseReference dbRef =
      FirebaseDatabase.instance.reference().child("users");

  List<String> fav;
  List<String> favlist;

  int strToint(String temp) {
    switch (temp[0]) {
      case '0':
        return 0;
        break;

      case '1':
        return 1;
        break;

      case '2':
        return 2;
        break;

      case '3':
        return 3;
        break;

      case '4':
        return 4;
        break;

      case '5':
        return 5;
        break;

      case '6':
        return 6;
        break;

      case '7':
        return 7;
        break;

      case '8':
        return 8;
        break;

      case '9':
        return 9;
        break;
    }
  }

  Map<dynamic, dynamic> userDataMap;

  Future<void> getData() async {
    final User user = await _auth.currentUser;
    final uid = user.uid;
    dbRef.child(uid).once().then((DataSnapshot snapshot) async {
      // print('Data : ${snapshot.value}');
      userDataMap = snapshot.value;
      // print(snapshot.value);
      List<String> favIDList = [];

      // print(userDataMap['Favourites']);

      for (int i = 0; i < userDataMap['Favourites'].length; i++) {
        // print(userDataMap['Favourites'][i].toString());
        favIDList.add(userDataMap['Favourites'][i].toString());
        if (favIDList[i].length == 1)
          mobiles[strToint(favIDList[i])].isFav = true;
        else if (favIDList[i].length == 2)
          mobiles[strToint(favIDList[i][0]) * 10 + strToint(favIDList[i][1])]
              .isFav = true;
      }
      // favIDList = userDataMap['Favourites'];
      // print(favIDList);
      // print('HELLO UPDATED THE FAVOURITES IN MOBILES');
    });
  }

  getData();

  String username = 'spiraldev1415@gmail.com'; //Your Email;
  String password = 'Recsy@123'; //Your Email's password;

  final smtpServer = gmail(username, password);
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(
          create: (context) => FilterPage(),
        ),
      ],
      child: MyApp(),
    ),
  );
}

class Splash2 extends StatelessWidget {
  static const Splash2Route = '/splash';

  @override
  Widget build(BuildContext context) {
    return SplashScreen(
      seconds: 3,
      navigateAfterSeconds: isConnected
          ? (email == null ? LoginPage.Route : LandingPage.LandingRoute)
          : LoginPage.Route,
      title: new Text(
        firstMessage,
        textAlign: TextAlign.center,
        style: new TextStyle(
            fontSize: 20, color: Colors.white, fontWeight: FontWeight.bold),
        textScaleFactor: 2,
      ),
      backgroundColor: Colors.black,
      image: new Image.asset('assets/spirallogo.png'),
      // loadingText: Text("Loading"),
      photoSize: 100.0,
      loaderColor: Colors.red,
    );
  }
}

class MyApp extends StatefulWidget {
  @override
  _MyAppState createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {
  bool userbool = false;

  @override
  Widget build(BuildContext context) {
    User result = FirebaseAuth.instance.currentUser;
    final FirebaseAuth _auth = FirebaseAuth.instance;

    return MaterialApp(
      routes: {
        Splash2.Splash2Route: (context) => Splash2(),
        LandingPage.LandingRoute: (context) => LandingPage(),
        SearchPage.Route: (context) => SearchPage(),
        LoginPage.Route: (context) => LoginPage(),
        FilterPage.Route: (context) => FilterPage(),
        CompareScreen.Route: (context) => CompareScreen(),
        MobilePage.Route: (context) => MobilePage(),
        UserProfile.Route: (context) => UserProfile(),
        RecommendationPage.Route: (context) => RecommendationPage(),
        ContactUs.Route: (context) => ContactUs(),
        AboutUs.Route: (context) => AboutUs(),
      },
      // initialRoute: email == null ? LoginPage.Route : LandingPage.LandingRoute,
      initialRoute: Splash2.Splash2Route,
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: Colors.black,
        primaryColor: kPrimaryColor,
        accentColor: kAccentColor,
        appBarTheme: const AppBarTheme(color: Colors.black),
        buttonTheme: ButtonThemeData(
          shape: const StadiumBorder(),
          padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 15),
          buttonColor: kPrimaryColor,
        ),
      ),
    );
  }
}
