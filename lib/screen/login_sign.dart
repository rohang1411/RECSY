import 'dart:io';

import 'package:flutter/material.dart';
import 'package:mobile_recommender/const.dart';
import 'package:mobile_recommender/export.dart';
import '../widget/log_wid.dart';
import 'package:mobile_recommender/main.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_dynamic_links/firebase_dynamic_links.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:email_validator/email_validator.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:shared_preferences/shared_preferences.dart';

bool isConnected = false;
// String firstMessage = "";

// Future<void> main() async {
//   try {
//     final result = await InternetAddress.lookup('google.com');
//     if (result.isNotEmpty && result[0].rawAddress.isNotEmpty) {
//       print('connected');
//       isConnected = true;
//       firstMessage = "RECSY";
//     }
//   } on SocketException catch (_) {
//     print('not connected');
//     firstMessage = "RECSY \n Please connect to the internet";
//   }
// }

final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
// final TextEditingController _nameController = TextEditingController();
final TextEditingController _emailController = TextEditingController();
final TextEditingController _passwordController = TextEditingController();
bool _success;
String _userEmail;

class TextWidgetName extends StatelessWidget {
  final String labelText;

  TextWidgetName(this.labelText);
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
      child: TextFormField(
        validator: (String value) {
          if (value.isEmpty) {
            return 'Please enter some text';
          }
          return null;
        },
        showCursor: true,
        decoration: InputDecoration(
          hintText: labelText,
          contentPadding: EdgeInsets.only(left: 20),
          filled: true,
          fillColor: secondContainer,
          labelStyle: TextStyle(
            color: textColor,
          ),
          border: OutlineInputBorder(
            borderSide: BorderSide(color: kPrimaryColor),
            borderRadius: BorderRadius.all(
              Radius.circular(60),
            ),
          ),
          enabledBorder: OutlineInputBorder(
            borderSide: BorderSide(color: kPrimaryColor),
            borderRadius: BorderRadius.all(
              Radius.circular(60),
            ),
          ),
        ),
      ),
    );
  }
}

class TextWidgetEmail extends StatelessWidget {
  final String labelText;

  // final myController = TextEditingController();

  // final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  // final TextEditingController _emailController = TextEditingController();
  // final TextEditingController _passwordController = TextEditingController();
  TextWidgetEmail(this.labelText);
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
      child: TextFormField(
        controller: _emailController,
        validator: (String value) {
          final bool isValid = EmailValidator.validate(value);
          // print('log wid email = ' + value);
          // print('login sign _emailController = ' + _emailController.text);
          if (value.isEmpty) {
            return 'Please enter some text';
          }
          if (!isValid) return "Email is INVALID";
          return null;
        },
        showCursor: true,
        decoration: InputDecoration(
          hintText: labelText,
          contentPadding: EdgeInsets.only(left: 20),
          filled: true,
          fillColor: secondContainer,
          labelStyle: TextStyle(
            color: textColor,
          ),
          border: OutlineInputBorder(
            borderSide: BorderSide(color: kPrimaryColor),
            borderRadius: BorderRadius.all(
              Radius.circular(60),
            ),
          ),
          enabledBorder: OutlineInputBorder(
            borderSide: BorderSide(color: kPrimaryColor),
            borderRadius: BorderRadius.all(
              Radius.circular(60),
            ),
          ),
        ),
      ),
    );
  }
}

class TextWidgetPassword extends StatelessWidget {
  final String labelText;

  // final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  // final TextEditingController _emailController = TextEditingController();
  // final TextEditingController _passwordController = TextEditingController();
  TextWidgetPassword(this.labelText);
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
      child: TextFormField(
        obscureText: true,
        controller: _passwordController,
        validator: (String value) {
          // print('log wid pass = ' + value);
          // print('login sign _passwordController = ' + _passwordController.text);

          if (value.isEmpty || value.length < 7) {
            return 'Password must be at least 7 characters long.';
          }
          return null;
        },
        showCursor: true,
        decoration: InputDecoration(
          hintText: labelText,
          contentPadding: EdgeInsets.only(left: 20),
          filled: true,
          fillColor: secondContainer,
          labelStyle: TextStyle(
            color: textColor,
          ),
          border: OutlineInputBorder(
            borderSide: BorderSide(color: kPrimaryColor),
            borderRadius: BorderRadius.all(
              Radius.circular(60),
            ),
          ),
          enabledBorder: OutlineInputBorder(
            borderSide: BorderSide(color: kPrimaryColor),
            borderRadius: BorderRadius.all(
              Radius.circular(60),
            ),
          ),
        ),
      ),
    );
  }
}

class LoginPage extends StatefulWidget {
  static const Route = '/login';

  @override
  _LoginPageState createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final FirebaseAuth _auth = FirebaseAuth.instance;
  DatabaseReference dbRef =
      FirebaseDatabase.instance.reference().child("Users");

  // Widget _signInButton() {
  //   return OutlineButton(
  //     splashColor: Colors.grey,
  //     onPressed: () {
  //       signInWithGoogle().then((result) {
  //         if (result != null) {
  //           Navigator.of(context).push(
  //             MaterialPageRoute(
  //               builder: (context) {
  //                 return LandingPage();
  //               },
  //             ),
  //           );
  //         }
  //       });
  //     },
  //     shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(40)),
  //     highlightElevation: 0,
  //     borderSide: BorderSide(color: Colors.grey),
  //     child: Padding(
  //       padding: const EdgeInsets.fromLTRB(0, 5, 0, 5),
  //       child: Row(
  //         mainAxisSize: MainAxisSize.min,
  //         mainAxisAlignment: MainAxisAlignment.center,
  //         children: <Widget>[
  //           Image(image: AssetImage("assets/google_logo.png"), height: 15.0),
  //           Padding(
  //             padding: const EdgeInsets.only(left: 10),
  //             child: Text(
  //               'Sign in with Google',
  //               style: TextStyle(
  //                 fontSize: 10,
  //                 color: Colors.grey,
  //               ),
  //             ),
  //           )
  //         ],
  //       ),
  //     ),
  //   );
  // }

  // final GoogleSignIn googleSignIn = GoogleSignIn();

  // Future<String> signInWithGoogle() async {
  //   await Firebase.initializeApp();

  //   final GoogleSignInAccount googleSignInAccount = await googleSignIn.signIn();
  //   final GoogleSignInAuthentication googleSignInAuthentication =
  //       await googleSignInAccount.authentication;

  //   final AuthCredential credential = GoogleAuthProvider.credential(
  //     accessToken: googleSignInAuthentication.accessToken,
  //     idToken: googleSignInAuthentication.idToken,
  //   );

  //   final UserCredential authResult =
  //       await _auth.signInWithCredential(credential);
  //   final User user = authResult.user;

  //   if (user != null) {
  //     assert(!user.isAnonymous);
  //     assert(await user.getIdToken() != null);

  //     final User currentUser = _auth.currentUser;
  //     assert(user.uid == currentUser.uid);

  //     print('signInWithGoogle succeeded: $user');

  //     return '$user';
  //   }

  //   return null;
  // }

  // Future<void> signOutGoogle() async {
  //   await googleSignIn.signOut();

  //   print("User Signed Out");
  // }

  @override
  Widget build(BuildContext context) {
    User result = FirebaseAuth.instance.currentUser;
    @override
    Future<void> resetPassword(String email) async {
      await _auth.sendPasswordResetEmail(email: email);
    }

    void _login() async {
      // print('email = ' + _emailController.text);
      // print('pass = ' + _passwordController.text);

      _auth
          .signInWithEmailAndPassword(
              email: _emailController.text, password: _passwordController.text)
          .then((result) {
        Fluttertoast.showToast(
            msg: "Successfully Logged In\n" + _emailController.text,
            toastLength: Toast.LENGTH_SHORT,
            gravity: ToastGravity.SNACKBAR,
            timeInSecForIosWeb: 1,
            backgroundColor: Colors.white70,
            textColor: Colors.black,
            fontSize: 16.0);
      }).then((res) async {
        // Navigator.pushReplacement(
        //   context,
        //   MaterialPageRoute(
        //       builder: (context) => LandingPage(uid: result.user.uid)),
        // );
        SharedPreferences prefs = await SharedPreferences.getInstance();
        prefs.setString('email', _emailController.text);

        Navigator.of(context).pushReplacementNamed(LandingPage.LandingRoute);
      }).catchError((err) {
        Fluttertoast.showToast(
            msg:
                "Email or Password is Incorrect \n or \n Email is not registred",
            toastLength: Toast.LENGTH_SHORT,
            gravity: ToastGravity.SNACKBAR,
            timeInSecForIosWeb: 1,
            backgroundColor: Colors.white70,
            textColor: Colors.black,
            fontSize: 16.0);
      });
    }

    return Scaffold(
      body: Form(
        key: _formKey,
        child: Container(
          padding: EdgeInsets.all(20),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Texts('Welcome\nBack!'),
                SizedBox(
                  height: 30,
                ),
                Container(
                  child: Image.asset(
                    loginImage,
                    fit: BoxFit.fill,
                  ),
                ),
                TextWidgetEmail('E-mail'),
                TextWidgetPassword('Password'),
                SizedBox(
                  height: 20,
                ),
                Center(
                    child: Column(children: <Widget>[
                  RaisedButton(
                      child: Text('Login'),
                      onPressed: () async {
                        try {
                          print('Hi AU');
                          final result =
                              await InternetAddress.lookup('google.com');
                          if (result.isNotEmpty &&
                              result[0].rawAddress.isNotEmpty) {
                            print('connected');
                            isConnected = true;
                            // firstMessage = "RECSY";
                          }
                        } on SocketException catch (_) {
                          print('not connected');
                          // firstMessage =
                          //     "RECSY \n Please connect to the internet";
                        }
                        if (isConnected == true) {
                          if (_formKey.currentState.validate()) {
                            _login();
                          }
                        } else {
                          Fluttertoast.showToast(
                              msg: "Please connect to the INTERNET",
                              toastLength: Toast.LENGTH_SHORT,
                              gravity: ToastGravity.SNACKBAR,
                              timeInSecForIosWeb: 1,
                              backgroundColor: Colors.white70,
                              textColor: Colors.black,
                              fontSize: 16.0);
                        }
                        // Navigator.of(context)
                        //     .pushReplacementNamed(LoginPage.Route);
                      }),
                  // _signInButton(),
                ])),
                Center(
                  child: Column(
                    children: [
                      FlatButton(
                        onPressed: () {
                          Navigator.push(
                            context,
                            MaterialPageRoute(builder: (context) => Sign()),
                          );
                        },
                        child: Text(
                          'New User? Sign Up',
                          style: TextStyle(color: kAccentColor),
                        ),
                      ),
                      FlatButton(
                        onPressed: () {
                          // final bool isValid =
                          //     EmailValidator.validate(_emailController.text);
                          // if (isValid).
                          if (_formKey.currentState.validate()) {
                            resetPassword(_emailController.text);
                            Fluttertoast.showToast(
                                msg: "We have sent a password reset link to\n" +
                                    _emailController.text,
                                toastLength: Toast.LENGTH_SHORT,
                                gravity: ToastGravity.SNACKBAR,
                                timeInSecForIosWeb: 1,
                                backgroundColor: Colors.white70,
                                textColor: Colors.black,
                                fontSize: 16.0);
                          }
                        },
                        child: Text(
                          'Forgot Password',
                          style: TextStyle(color: kAccentColor),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );

    @override
    void dispose() {
      // _nameController.dispose();
      _emailController.dispose();
      _passwordController.dispose();
      super.dispose();
    }
  }
}
