import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:csv/csv.dart';
import 'package:mobile_recommender/models/model.dart';

List<Mobile> mobiles = [];

final List<Color> phoneColors = [
  Colors.red[200]!,
  Colors.blue[200]!,
  Colors.green[200]!,
  Colors.yellow[200]!,
  Colors.purple[200]!,
  Colors.orange[200]!,
  Colors.teal[200]!,
  Colors.pink[200]!,
];

// Helper to safely get a value from a row by column name.
String _getSafe(List<dynamic> row, List<String> header, String columnName, {String defaultValue = ''}) {
  final int index = header.indexOf(columnName);
  if (index == -1 || index >= row.length) {
    return defaultValue;
  }
  return row[index].toString();
}

Future<void> loadMobiles() async {
  if (mobiles.isNotEmpty) {
    return;
  }

  // Load image and buy links first
  final String imageLinksData = await rootBundle.loadString('assets/Image Links.csv');
  final List<List<dynamic>> imageLinksList = const CsvToListConverter().convert(imageLinksData);
  final Map<String, Map<String, String>> linksMap = {};

  if (imageLinksList.isNotEmpty) {
    final imageLinksHeader = imageLinksList[0].map((e) => e.toString()).toList();
    for (var i = 1; i < imageLinksList.length; i++) {
      final row = imageLinksList[i];
      final name = _getSafe(row, imageLinksHeader, 'Name');
      if (name.isNotEmpty) {
        linksMap[name] = {
          'image': _getSafe(row, imageLinksHeader, 'Image'),
          'buyLink': _getSafe(row, imageLinksHeader, 'Buy Link'),
        };
      }
    }
  }

  // Load main phone data
  final String rawData = await rootBundle.loadString('assets/Final Model Dataset.csv');
  final List<List<dynamic>> listData = const CsvToListConverter().convert(rawData);

  if (listData.isEmpty) return;

  final header = listData[0].map((e) => e.toString()).toList();
  final List<Mobile> loadedMobiles = [];

  for (var i = 1; i < listData.length; i++) {
    final row = listData[i];
    final name = _getSafe(row, header, 'Name');
    final links = linksMap[name] ?? {'image': '', 'buyLink': ''};

    loadedMobiles.add(
      Mobile(
        id: (i - 1).toString(),
        name: name,
        imageUrl: links['image']!,
        buyLink: links['buyLink']!,
        color: phoneColors[(i - 1) % phoneColors.length],
        specs: {
          'Price': _getSafe(row, header, 'Price'),
          'RAM': _getSafe(row, header, 'RAM'),
          'Storage': _getSafe(row, header, 'Storage'),
          'Expandable': _getSafe(row, header, 'Expandable Storage'),
          'Processor': _getSafe(row, header, 'Processor'),
          'Camera': _getSafe(row, header, 'Camera'),
          'Battery': _getSafe(row, header, 'Battery'),
          'Display': _getSafe(row, header, 'Display'),
          'Charging': _getSafe(row, header, 'Charging'),
          'Splash Proof': _getSafe(row, header, 'Splash Proof'),
          '5G': _getSafe(row, header, '5G'),
          'Audio': _getSafe(row, header, 'Audio Jack'),
          'NFC': _getSafe(row, header, 'NFC'),
          'Processor Brand': _getSafe(row, header, 'Processor Brand'),
          'OS': _getSafe(row, header, 'OS'),
        },
      ),
    );
  }
  mobiles = loadedMobiles;
}