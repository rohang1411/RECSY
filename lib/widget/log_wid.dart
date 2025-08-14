import 'dart:io';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:mobile_recommender/export.dart';
// import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_dynamic_links/firebase_dynamic_links.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:email_validator/email_validator.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:shared_preferences/shared_preferences.dart';

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
}

final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
final TextEditingController _nameController = TextEditingController();
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
        controller: _nameController,
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
          // print('login wid _emailController = ' + _emailController.text);
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
          // print('login wid _passwordController = ' + _passwordController.text);

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

class Texts extends StatelessWidget {
  final String text;
  Texts(this.text);
  @override
  Widget build(BuildContext context) {
    return Container(
      child: Text(
        text,
        style:
            Theme.of(context).textTheme.headline3.copyWith(color: Colors.white),
      ),
    );
  }
}

class Sign extends StatefulWidget {
  @override
  _SignState createState() => _SignState();
}

class _SignState extends State<Sign> {
  // auth variable
// Firebase.initializeApp();
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final DatabaseReference dbRef =
      FirebaseDatabase.instance.reference().child("users");

  void writeData() async {
    final User user = await _auth.currentUser;
    final uid = user.uid;
    dbRef.child(uid).set({
      'Name': _nameController.text,
      'Email': _emailController.text,
      'Favourites': [],
    });
  }

  // The email address is already in use by another account.
  @override
  Widget build(BuildContext context) {
    void _register() async {
      _auth
          .createUserWithEmailAndPassword(
              email: _emailController.text, password: _passwordController.text)
          .then((result) async {
        Fluttertoast.showToast(
            msg: "Successfully Registered" + _emailController.text,
            toastLength: Toast.LENGTH_SHORT,
            gravity: ToastGravity.SNACKBAR,
            timeInSecForIosWeb: 1,
            backgroundColor: Colors.white70,
            textColor: Colors.black,
            fontSize: 16.0);
        writeData();

        SharedPreferences prefs = await SharedPreferences.getInstance();
        prefs.setString('name', _nameController.text);
        // dbRef.child(result.user.uid).set({
        //   "email": _emailController.text,
        //   "name": _nameController.text
        Navigator.of(context).pushReplacementNamed(LoginPage.Route);
      }).catchError((err) {
        Fluttertoast.showToast(
            msg: "User Already Registered",
            toastLength: Toast.LENGTH_SHORT,
            gravity: ToastGravity.SNACKBAR,
            timeInSecForIosWeb: 1,
            backgroundColor: Colors.white70,
            textColor: Colors.black,
            fontSize: 16.0);
        Navigator.of(context).pushReplacementNamed(LoginPage.Route);
      });
    }

    return Scaffold(
      body: Form(
        key: _formKey,
        child: Container(
          padding: EdgeInsets.all(10),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Texts('Join\nUs!'),
                    FlatButton(
                      onPressed: () {
                        Navigator.of(context).pop();
                      },
                      child: Text(
                        'Login',
                        style: Theme.of(context)
                            .textTheme
                            .button
                            .copyWith(color: kPrimaryColor),
                      ),
                    )
                  ],
                ),
                SizedBox(
                  height: 30,
                ),
                Container(
                    height: 200, width: 250, child: Image.asset(signUpImage)),
                SizedBox(
                  height: 50,
                ),
                TextWidgetName('Name'),
                TextWidgetEmail('Email'),
                TextWidgetPassword('Password'),
                SizedBox(height: 20),
                RaisedButton(
                    child: Text('Sign Up'),
                    onPressed: () async {
                      try {
                        final result =
                            await InternetAddress.lookup('google.com');
                        if (result.isNotEmpty &&
                            result[0].rawAddress.isNotEmpty) {
                          isConnected = true;
                          firstMessage = "RECSY";
                        }
                      } on SocketException catch (_) {
                        print('not connected');
                        firstMessage =
                            "RECSY \n Please connect to the internet";
                      }
                      if (isConnected == true) {
                        print(isConnected);
                        if (_formKey.currentState.validate()) {
                          _register();
                          // Navigator.of(context)
                          //     .pushReplacementNamed(LoginPage.Route);
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
                    }),
                Container(
                  alignment: Alignment.center,
                  child: Text(_success == null
                      ? ''
                      : (_success
                          ? 'Successfully registered ' + _userEmail
                          : 'Registration failed')),
                )
              ],
            ),
          ),
        ),
      ),
    );

    @override
    void dispose() {
      _nameController.dispose();
      _emailController.dispose();
      _passwordController.dispose();
      super.dispose();
    }
  }
}
