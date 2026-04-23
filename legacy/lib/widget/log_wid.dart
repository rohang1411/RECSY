import 'package:flutter/material.dart';
import 'package:fluttertoast/fluttertoast.dart';
import 'package:mobile_recommender/export.dart';
import 'package:mobile_recommender/widget/auth_text_fields.dart';

class Sign extends StatelessWidget {
  final VoidCallback onToggleView;
  final GlobalKey<FormState> formKey;
  final TextEditingController nameController;
  final TextEditingController emailController;
  final TextEditingController passwordController;
  final VoidCallback signUpCallback;

  const Sign({
    Key? key,
    required this.onToggleView,
    required this.formKey,
    required this.nameController,
    required this.emailController,
    required this.passwordController,
    required this.signUpCallback,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Form(
        key: formKey,
        child: Container(
          padding: const EdgeInsets.all(10),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Texts('Join\nUs!'),
                    TextButton(
                      onPressed: onToggleView,
                      child: Text(
                        'Login',
                        style: Theme.of(context)
                            .textTheme
                            .labelLarge
                            ?.copyWith(color: kPrimaryColor),
                      ),
                    )
                  ],
                ),
                const SizedBox(
                  height: 30,
                ),
                SizedBox(
                    height: 200, width: 250, child: Image.asset(signUpImage)),
                const SizedBox(
                  height: 50,
                ),
                TextWidgetName('Name', nameController),
                TextWidgetEmail('Email', emailController),
                TextWidgetPassword('Password', passwordController),
                const SizedBox(height: 20),
                ElevatedButton(
                    child: const Text('Sign Up'),
                    onPressed: () {
                      if (formKey.currentState!.validate()) {
                        signUpCallback();
                      } else {
                        Fluttertoast.showToast(
                            msg: "Please fill all fields correctly",
                            toastLength: Toast.LENGTH_SHORT,
                            gravity: ToastGravity.SNACKBAR,
                            timeInSecForIosWeb: 1,
                            backgroundColor: Colors.white70,
                            textColor: Colors.black,
                            fontSize: 16.0);
                      }
                    }),
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
