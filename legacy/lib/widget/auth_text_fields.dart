import 'package:flutter/material.dart';
import 'package:email_validator/email_validator.dart';
import 'package:mobile_recommender/export.dart';

class TextWidgetName extends StatelessWidget {
  final String labelText;
  final TextEditingController controller;

  const TextWidgetName(this.labelText, this.controller, {Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
      child: TextFormField(
        controller: controller,
        validator: (String? value) {
          if (value == null || value.isEmpty) {
            return 'Please enter some text';
          }
          return null;
        },
        showCursor: true,
        decoration: InputDecoration(
          hintText: labelText,
          contentPadding: const EdgeInsets.only(left: 20),
          filled: true,
          fillColor: secondContainer,
          labelStyle: TextStyle(
            color: textColor,
          ),
          border: OutlineInputBorder(
            borderSide: BorderSide(color: kPrimaryColor),
            borderRadius: const BorderRadius.all(
              Radius.circular(60),
            ),
          ),
          enabledBorder: OutlineInputBorder(
            borderSide: BorderSide(color: kPrimaryColor),
            borderRadius: const BorderRadius.all(
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
  final TextEditingController controller;

  const TextWidgetEmail(this.labelText, this.controller, {Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
      child: TextFormField(
        controller: controller,
        validator: (String? value) {
          if (value == null || value.isEmpty) {
            return 'Please enter some text';
          }
          final bool isValid = EmailValidator.validate(value);
          if (!isValid) return "Email is INVALID";
          return null;
        },
        showCursor: true,
        decoration: InputDecoration(
          hintText: labelText,
          contentPadding: const EdgeInsets.only(left: 20),
          filled: true,
          fillColor: secondContainer,
          labelStyle: TextStyle(
            color: textColor,
          ),
          border: OutlineInputBorder(
            borderSide: BorderSide(color: kPrimaryColor),
            borderRadius: const BorderRadius.all(
              Radius.circular(60),
            ),
          ),
          enabledBorder: OutlineInputBorder(
            borderSide: BorderSide(color: kPrimaryColor),
            borderRadius: const BorderRadius.all(
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
  final TextEditingController controller;

  const TextWidgetPassword(this.labelText, this.controller, {Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
      child: TextFormField(
        obscureText: true,
        controller: controller,
        validator: (String? value) {
          if (value == null || value.isEmpty || value.length < 7) {
            return 'Password must be at least 7 characters long.';
          }
          return null;
        },
        showCursor: true,
        decoration: InputDecoration(
          hintText: labelText,
          contentPadding: const EdgeInsets.only(left: 20),
          filled: true,
          fillColor: secondContainer,
          labelStyle: TextStyle(
            color: textColor,
          ),
          border: OutlineInputBorder(
            borderSide: BorderSide(color: kPrimaryColor),
            borderRadius: const BorderRadius.all(
              Radius.circular(60),
            ),
          ),
          enabledBorder: OutlineInputBorder(
            borderSide: BorderSide(color: kPrimaryColor),
            borderRadius: const BorderRadius.all(
              Radius.circular(60),
            ),
          ),
        ),
      ),
    );
  }
}
