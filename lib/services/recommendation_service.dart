import 'dart:convert';
import 'dart:async';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:http/http.dart' as http;
import 'package:mobile_recommender/data/data.dart';
import 'package:mobile_recommender/models/model.dart';
import 'web_ml_service.dart';
import '../utils/logger.dart';

Future<int> createAlbum(List<List<double>> input, int flagChinese, List<String> labels, List<String> labelsncp) async {
  if (kIsWeb) {
    // On web, use the ML service to get a prediction.
    try {
      final result = await WebMLService.predictBrand(input, flagChinese.toDouble(), labels, labelsncp);
      logger.i('Web prediction result: $result');
      return result;
    } catch (e) {
      logger.e('Error during web prediction: $e');
      return -1; // Return an error index
    }
  } else {
    final endpoint = flagChinese == 1 ? 'predict' : 'predictncp';
    final uri = Uri.parse('https://recsyapi.herokuapp.com/$endpoint');

    final response = await http.post(
      uri,
      headers: <String, String>{
        'Content-Type': 'application/json',
      },
      body: jsonEncode([{
        "Below 10000": input[0][0],
        "10000-12000": input[0][1],
        "12000 - 15000": input[0][2],
        "15000-20000": input[0][3],
        "20000-25000": input[0][4],
        "25000-30000": input[0][5],
        "30000-40000": input[0][6],
        "40000-50000": input[0][7],
        "50000-70000": input[0][8],
        "70000-100000": input[0][9],
        "100000-120000": input[0][10],
        "Above 120000": input[0][11],
        "Performance(3)": input[0][12],
        "Camera(4)": input[0][13],
        "Battery(3)": input[0][14],
        "Display(2)": input[0][15],
        "Charging(2)": input[0][16]
      }]),
    );

    if (response.statusCode == 200) {
      try {
        logger.d('API prediction response: ${response.body}');
        String apiout = jsonDecode(response.body)['prediction'];
        // The API returns a string like '["6"]'. We need to extract the number.
        String numericString = apiout.replaceAll(RegExp(r'[^0-9]'), '');
        int predictedIndex = int.parse(numericString);
        logger.i('Predicted Index: $predictedIndex');
        return predictedIndex;
      } catch (e) {
        logger.e('Error parsing prediction response', e);
        throw Exception('Failed to parse prediction.');
      }
    } else {
      logger.e('API request failed with status: ${response.statusCode}', response.body);
      throw Exception('Failed to get prediction from API.');
    }
  }
}

/// Finds the recommended phone and a list of similar phones.
Future<List<Mobile>> getRecommendations(int predictedIndex) async {
  if (mobiles.isEmpty) {
    await loadMobiles();
  }

  Mobile? recommendedPhone;
  try {
    recommendedPhone = mobiles.firstWhere((m) => m.id == predictedIndex.toString());
  } catch (e) {
    logger.e('Recommended phone with index $predictedIndex not found.');
    return []; // Return empty if main recommendation not found
  }

  List<Mobile> similarMobiles = mobiles.where((m) {
    // Exclude the recommended phone itself
    if (m.id == recommendedPhone!.id) return false;

    // Simple similarity logic: check for same brand and price range
    final brandMatch = m.specs['Processor Brand'] == recommendedPhone.specs['Processor Brand'];
    
    final price1 = double.tryParse((m.specs['Price'] as String?)?.replaceAll(',', '') ?? '0') ?? 0;
    final price2 = double.tryParse((recommendedPhone.specs['Price'] as String?)?.replaceAll(',', '') ?? '0') ?? 0;
    final priceMatch = (price1 - price2).abs() < 10000; // Example: within 10k price range

    return brandMatch && priceMatch;
  }).toList();

  // Sort by name and take the top 5
  similarMobiles.sort((a, b) => a.name.compareTo(b.name));
  List<Mobile> finalSimilar = similarMobiles.take(5).toList();

  return [recommendedPhone, ...finalSimilar];
}
