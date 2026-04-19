import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:mobile_recommender/screen/landing.dart';
import 'package:mobile_recommender/screen/login_sign.dart';
import 'package:mobile_recommender/widget/log_wid.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:email_validator/email_validator.dart';

class AuthScreen extends StatefulWidget {
  static const String Route = '/auth';

  const AuthScreen({Key? key}) : super(key: key);

  @override
  _AuthScreenState createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  bool _showLogin = true;

  // Form Keys
  final _loginFormKey = GlobalKey<FormState>();
  final _signUpFormKey = GlobalKey<FormState>();

  // Controllers
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();

  // Firebase
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final DatabaseReference _dbRef = FirebaseDatabase.instance.ref().child("Users");

  void _toggleView() {
    setState(() {
      _showLogin = !_showLogin;
    });
    // Clear fields when toggling
    _nameController.clear();
    _emailController.clear();
    _passwordController.clear();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    if (!_loginFormKey.currentState!.validate()) return;

    try {
      final result = await _auth.signInWithEmailAndPassword(
        email: _emailController.text.trim(),
        password: _passwordController.text.trim(),
      );

      Fluttertoast.showToast(
          msg: "Successfully Logged In\n" + _emailController.text,
          toastLength: Toast.LENGTH_SHORT,
          gravity: ToastGravity.SNACKBAR,
          timeInSecForIosWeb: 1,
          backgroundColor: Colors.white70,
          textColor: Colors.black,
          fontSize: 16.0);

      final snapshot = await _dbRef.child(result.user!.uid).once();
      var data = snapshot.snapshot.value as Map<dynamic, dynamic>?;

      if (data == null) {
        // User exists in Auth but not in DB. Create a record.
        final userEmail = _emailController.text.trim();
        final userName = userEmail.split('@')[0]; // Use email prefix as name
        await _dbRef.child(result.user!.uid).set({
          "email": userEmail,
          "name": userName,
          'Favourites': [],
        });
        data = {"name": userName};
      }

      final String name = data['name'] as String? ?? '';
      final String email = _emailController.text.trim();
      SharedPreferences prefs = await SharedPreferences.getInstance();
      await prefs.setString('email', email);
      await prefs.setString('name', name);

      Navigator.pushReplacement(
        context,
        MaterialPageRoute(builder: (context) => LandingPage()),
      );
    } on FirebaseAuthException catch (e) {
      Fluttertoast.showToast(
          msg: e.message ?? "An error occurred",
          toastLength: Toast.LENGTH_SHORT,
          gravity: ToastGravity.SNACKBAR,
          timeInSecForIosWeb: 1,
          backgroundColor: Colors.white70,
          textColor: Colors.black,
          fontSize: 16.0);
    }
  }

  Future<void> _signUp() async {
    if (!_signUpFormKey.currentState!.validate()) return;

    try {
      final result = await _auth.createUserWithEmailAndPassword(
        email: _emailController.text.trim(),
        password: _passwordController.text.trim(),
      );

      await _dbRef.child(result.user!.uid).set({
        "email": _emailController.text.trim(),
        "name": _nameController.text.trim(),
        'Favourites': [],
      });

      Fluttertoast.showToast(
          msg: "Successfully Registered\n" + _emailController.text,
          toastLength: Toast.LENGTH_SHORT,
          gravity: ToastGravity.SNACKBAR,
          timeInSecForIosWeb: 1,
          backgroundColor: Colors.white70,
          textColor: Colors.black,
          fontSize: 16.0);

      _toggleView(); // Switch to login page after successful registration
    } on FirebaseAuthException catch (e) {
      Fluttertoast.showToast(
          msg: e.message ?? "Registration Failed",
          toastLength: Toast.LENGTH_LONG,
          gravity: ToastGravity.SNACKBAR,
          timeInSecForIosWeb: 3,
          backgroundColor: Colors.redAccent,
          textColor: Colors.white,
          fontSize: 16.0);
    }
  }

  Future<void> _resetPassword() async {
    if (_emailController.text.trim().isEmpty || !EmailValidator.validate(_emailController.text.trim())) {
      Fluttertoast.showToast(
          msg: "Please enter a valid email to reset password",
          toastLength: Toast.LENGTH_SHORT,
          gravity: ToastGravity.SNACKBAR,
          timeInSecForIosWeb: 1,
          backgroundColor: Colors.white70,
          textColor: Colors.black,
          fontSize: 16.0);
      return;
    }
    try {
      await _auth.sendPasswordResetEmail(email: _emailController.text.trim());
      Fluttertoast.showToast(
          msg: "Password reset link sent to " + _emailController.text.trim(),
          toastLength: Toast.LENGTH_SHORT,
          gravity: ToastGravity.SNACKBAR,
          timeInSecForIosWeb: 1,
          backgroundColor: Colors.white70,
          textColor: Colors.black,
          fontSize: 16.0);
    } on FirebaseAuthException catch (e) {
      Fluttertoast.showToast(
          msg: e.message ?? "An error occurred",
          toastLength: Toast.LENGTH_SHORT,
          gravity: ToastGravity.SNACKBAR,
          timeInSecForIosWeb: 1,
          backgroundColor: Colors.white70,
          textColor: Colors.black,
          fontSize: 16.0);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_showLogin) {
      return LoginPage(
        key: const ValueKey('login'),
        onToggleView: _toggleView,
        formKey: _loginFormKey,
        emailController: _emailController,
        passwordController: _passwordController,
        loginCallback: _login,
        resetPasswordCallback: _resetPassword,
      );
    } else {
      return Sign(
        key: const ValueKey('signup'),
        onToggleView: _toggleView,
        formKey: _signUpFormKey,
        nameController: _nameController,
        emailController: _emailController,
        passwordController: _passwordController,
        signUpCallback: _signUp,
      );
    }
  }
}
