import 'package:email_validator/email_validator.dart';
import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:mobile_recommender/widget/auth_text_fields.dart';
import '../export.dart';

class LoginPage extends StatelessWidget {
  static const Route = '/login';
  final VoidCallback onToggleView;
  final GlobalKey<FormState> formKey;
  final TextEditingController emailController;
  final TextEditingController passwordController;
  final VoidCallback loginCallback;
  final VoidCallback resetPasswordCallback;

  const LoginPage({
    Key? key,
    required this.onToggleView,
    required this.formKey,
    required this.emailController,
    required this.passwordController,
    required this.loginCallback,
    required this.resetPasswordCallback,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Form(
      key: formKey,
      child: Scaffold(
        body: Padding(
          padding: const EdgeInsets.all(10.0),
          child: SingleChildScrollView(
            child: Column(
              children: [
                Row(
                  children: [const Texts('Welcome\nBack!')],
                ),
                Column(
                  children: <Widget>[
                    const SizedBox(
                      height: 50,
                    ),
                    TextWidgetEmail('Email', emailController),
                    TextWidgetPassword('Password', passwordController),
                  ],
                ),
                const SizedBox(
                  height: 30,
                ),
                Center(
                    child: Column(children: [
                  ElevatedButton(
                      child: const Text('Login'),
                      onPressed: () {
                        if (formKey.currentState!.validate()) {
                          loginCallback();
                        } else {
                          Fluttertoast.showToast(
                              msg: "Please check your email and password",
                              toastLength: Toast.LENGTH_SHORT,
                              gravity: ToastGravity.SNACKBAR,
                              timeInSecForIosWeb: 1,
                              backgroundColor: Colors.white70,
                              textColor: Colors.black,
                              fontSize: 16.0);
                        }
                      }),
                ])),
                Center(
                  child: Column(
                    children: [
                      TextButton(
                        onPressed: () => onToggleView(),
                        child: Text(
                          'New User? Sign Up',
                          style: TextStyle(color: kAccentColor),
                        ),
                      ),
                      TextButton(
                        onPressed: () {
                          if (emailController.text.isNotEmpty &&
                              EmailValidator.validate(emailController.text)) {
                            resetPasswordCallback();
                          } else {
                            Fluttertoast.showToast(
                                msg: "Please enter a valid email to reset password",
                                toastLength: Toast.LENGTH_SHORT,
                                gravity: ToastGravity.SNACKBAR,
                                timeInSecForIosWeb: 1,
                                backgroundColor: Colors.white70,
                                textColor: Colors.black,
                                fontSize: 16.0);
                          }
                        },
                        child: Text(
                          'Forgot Password?',
                          style: TextStyle(color: kAccentColor),
                        ),
                      ),
                    ],
                  ),
                )
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class Texts extends StatelessWidget {
  final String text;

  const Texts(this.text, {Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: Theme.of(context)
          .textTheme
          .displaySmall
          ?.copyWith(color: Colors.white),
    );
  }
}
