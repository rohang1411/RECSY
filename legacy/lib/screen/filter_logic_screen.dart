import 'package:flutter/material.dart';
import 'package:mobile_recommender/models/model.dart';
import 'package:mobile_recommender/screen/filter.dart';
import 'package:mobile_recommender/screen/recommendation.dart';
import 'package:mobile_recommender/services/recommendation_service.dart';
import 'package:provider/provider.dart';

class FilterLogicScreen extends StatefulWidget {
  static const Route = '/filterLogic';

  @override
  _FilterLogicScreenState createState() => _FilterLogicScreenState();
}

class _FilterLogicScreenState extends State<FilterLogicScreen> {
  final List<String> labels = [
    'MI',
    'OPPO',
    'Realme',
    'ASUS',
    'ONEPLUS',
    'APPLE',
    'GOOGLE',
    'POCO',
    'SAMSUNG',
    'MOTOROLA',
    'Vivo'
  ];

  final List<String> labelsncp = [
    'ASUS',
    'APPLE',
    'GOOGLE',
    'SAMSUNG',
    'MOTOROLA',
  ];
  RangeValues _currentRangeValues = const RangeValues(40000, 80000);
  bool flagCamera = false;
  bool flagPer = false;
  bool flagBattery = false;
  int flagChinese = 1;
  bool isLoading = false;

  Future<void> _getRecommendation() async {
    setState(() {
      isLoading = true;
    });

    List<double> priceVector = List.filled(12, 0.0);
    if (_currentRangeValues.start <= 10000) priceVector[0] = 1.0;
    if (_currentRangeValues.start <= 12000 && _currentRangeValues.end >= 10000) priceVector[1] = 1.0;
    if (_currentRangeValues.start <= 15000 && _currentRangeValues.end >= 12000) priceVector[2] = 1.0;
    if (_currentRangeValues.start <= 20000 && _currentRangeValues.end >= 15000) priceVector[3] = 1.0;
    if (_currentRangeValues.start <= 25000 && _currentRangeValues.end >= 20000) priceVector[4] = 1.0;
    if (_currentRangeValues.start <= 30000 && _currentRangeValues.end >= 25000) priceVector[5] = 1.0;
    if (_currentRangeValues.start <= 40000 && _currentRangeValues.end >= 30000) priceVector[6] = 1.0;
    if (_currentRangeValues.start <= 50000 && _currentRangeValues.end >= 40000) priceVector[7] = 1.0;
    if (_currentRangeValues.start <= 70000 && _currentRangeValues.end >= 50000) priceVector[8] = 1.0;
    if (_currentRangeValues.start <= 100000 && _currentRangeValues.end >= 70000) priceVector[9] = 1.0;
    if (_currentRangeValues.start <= 120000 && _currentRangeValues.end >= 100000) priceVector[10] = 1.0;
    if (_currentRangeValues.end > 120000) priceVector[11] = 1.0;

    List<double> features = [
      flagPer ? 3.0 : 0.0,
      flagCamera ? 4.0 : 0.0,
      flagBattery ? 3.0 : 0.0,
      0.0, // Display placeholder
      0.0, // Charging placeholder
    ];

    List<List<double>> input = [priceVector + features];

    try {
      final predictedIndex = await createAlbum(input, flagChinese, labels, labelsncp);
      if (predictedIndex != -1) {
        List<Mobile> recommendations = await getRecommendations(predictedIndex);
        if (recommendations.isNotEmpty) {
          Provider.of<FilterPage>(context, listen: false).recommendations = recommendations;
          Navigator.of(context).pushNamed(RecommendationPage.Route);
        } else {
          dialogue(context, 'Not Found', 'No recommendations found for the selected criteria.');
        }
      } else {
        dialogue(context, 'Error', 'Failed to get recommendation.');
      }
    } catch (e) {
      dialogue(context, 'Error', e.toString());
    } finally {
      setState(() {
        isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Filter Recommendations'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text('Price Range: ₹${_currentRangeValues.start.round()} - ₹${_currentRangeValues.end.round()}',
                  style: Theme.of(context).textTheme.titleLarge),
              RangeSlider(
                values: _currentRangeValues,
                min: 5000,
                max: 150000,
                divisions: 29,
                labels: RangeLabels(
                  '₹${_currentRangeValues.start.round()}',
                  '₹${_currentRangeValues.end.round()}',
                ),
                onChanged: (RangeValues values) {
                  setState(() {
                    _currentRangeValues = values;
                  });
                },
              ),
              const SizedBox(height: 20),
              Text('Features', style: Theme.of(context).textTheme.titleLarge),
              CheckboxListTile(
                title: const Text('Camera'),
                value: flagCamera,
                onChanged: (bool? value) {
                  setState(() {
                    flagCamera = value ?? false;
                  });
                },
              ),
              CheckboxListTile(
                title: const Text('Performance'),
                value: flagPer,
                onChanged: (bool? value) {
                  setState(() {
                    flagPer = value ?? false;
                  });
                },
              ),
              CheckboxListTile(
                title: const Text('Battery'),
                value: flagBattery,
                onChanged: (bool? value) {
                  setState(() {
                    flagBattery = value ?? false;
                  });
                },
              ),
              const SizedBox(height: 20),
              Text('Brand Type', style: Theme.of(context).textTheme.titleLarge),
              RadioListTile<int>(
                title: const Text('Chinese Brands'),
                value: 1,
                groupValue: flagChinese,
                onChanged: (int? value) {
                  setState(() {
                    flagChinese = value ?? 1;
                  });
                },
              ),
              RadioListTile<int>(
                title: const Text('Non-Chinese Brands'),
                value: 0,
                groupValue: flagChinese,
                onChanged: (int? value) {
                  setState(() {
                    flagChinese = value ?? 0;
                  });
                },
              ),
              const SizedBox(height: 20),
              if (isLoading)
                const Center(child: CircularProgressIndicator()),
            ],
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: isLoading ? null : _getRecommendation,
        icon: const Icon(Icons.search),
        label: const Text('Get Recommendation'),
        backgroundColor: isLoading ? Colors.grey : Theme.of(context).colorScheme.secondary,
      ),
    );
  }

  Future<void> dialogue(BuildContext context, String title, String content) {
    return showDialog(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          title: Text(title),
          content: Text(content),
          actions: <Widget>[
            TextButton(
              child: const Text('OK'),
              onPressed: () {
                Navigator.of(context).pop();
              },
            ),
          ],
        );
      },
    );
  }
}