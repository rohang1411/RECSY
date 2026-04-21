import 'package:flutter/material.dart';

class Mobile {
  final String id;
  final String imageUrl;
  final String buyLink;
  final Color color;
  final String name;
  final Map<String, Object> specs;
  bool isFav;

  Mobile({
    required this.id,
    required this.imageUrl,
    required this.buyLink,
    required this.color,
    required this.name,
    required this.specs,
    this.isFav = false,
  });

  void toggleFav() {
    isFav = !isFav;
  }
}
