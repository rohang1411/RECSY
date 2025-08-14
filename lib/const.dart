import 'package:flutter/material.dart';

const Color kPrimaryColor = Color(0xffFFAA00);
const Color kAccentColor = Color(0xffFCE2B9);
const Color kBackContainer = Color(0xff3E3E3E);
const Color textColor = Color(0xffB3B3B3);
const Color secondContainer = Color(0xff434343);
const String loginImage = 'assets/login-svg.png';
const String signUpImage = 'assets/signup-svg.png';
const String aboutImage = 'about-svg.jpg';
TextStyle bodyText(BuildContext context) {
  return Theme.of(context).textTheme.bodyText1.copyWith(
      fontWeight: FontWeight.bold, fontSize: 25, fontFamily: 'Segoe UI');
}

TextStyle recsyText(BuildContext context) {
  return Theme.of(context)
      .textTheme
      .bodyText1
      .copyWith(fontSize: 18, fontFamily: 'Segoe UI');
}

TextStyle spiralText(BuildContext context) {
  return Theme.of(context).textTheme.bodyText1.copyWith(
      fontWeight: FontWeight.bold, fontSize: 40, fontFamily: 'Segoe UI');
}
