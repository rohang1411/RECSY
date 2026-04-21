import 'package:flutter/material.dart';

const Color kPrimaryColor = Color(0xffFFAA00);
const Color kAccentColor = Color(0xffFCE2B9);
const Color kBackContainer = Color(0xff3E3E3E);
const Color textColor = Color(0xffB3B3B3);
const Color secondContainer = Color(0xff434343);
const String loginImage = 'assets/login-svg.png';
const String signUpImage = 'assets/signup-svg.png';
const String aboutImage = 'about-svg.jpg';

const List<String> routes = ['/landing', '/search', '/user'];

const Map<String, String> description = {
  'Display': 'assets/display.png',
  'Processor': 'assets/cpu.png',
  'Camera': 'assets/camera.png',
  'Battery': 'assets/battery.png',
};
TextStyle bodyText(BuildContext context) {
  return Theme.of(context).textTheme.bodyLarge?.copyWith(
      fontWeight: FontWeight.bold, fontSize: 25, fontFamily: 'Segoe UI') ?? 
      TextStyle(fontWeight: FontWeight.bold, fontSize: 25, fontFamily: 'Segoe UI');
}

TextStyle recsyText(BuildContext context) {
  return Theme.of(context)
      .textTheme
      .bodyLarge
      ?.copyWith(fontSize: 18, fontFamily: 'Segoe UI') ?? 
      TextStyle(fontSize: 18, fontFamily: 'Segoe UI');
}

TextStyle spiralText(BuildContext context) {
  return Theme.of(context).textTheme.bodyLarge?.copyWith(
      fontWeight: FontWeight.bold, fontSize: 40, fontFamily: 'Segoe UI') ?? 
      TextStyle(fontWeight: FontWeight.bold, fontSize: 40, fontFamily: 'Segoe UI');
}
