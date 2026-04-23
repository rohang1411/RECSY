import 'package:flutter/material.dart';
import 'package:mobile_recommender/export.dart';
import 'package:mobile_recommender/screen/recommendation.dart';
import 'package:mobile_recommender/services/recommendation_service.dart';

class SearchPage extends StatefulWidget {
  static const Route = '/search';

  @override
  _SearchPageState createState() => _SearchPageState();
}

class _SearchPageState extends State<SearchPage> {
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
        Navigator.of(context).pushNamed(RecommendationPage.Route, arguments: predictedIndex);
      } else {
        dialogue(context, 'No Recommendation', 'We couldn\'t find a suitable phone with the selected filters.');
      }
    } catch (e) {
      dialogue(context, 'Error', e.toString());
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Find Your Next Phone'),
        elevation: 0,
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              _buildFilterCard(),
              const SizedBox(height: 20),
              if (isLoading) const Center(child: CircularProgressIndicator()),
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

  Widget _buildFilterCard() {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
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
            Text('I\'m looking for a phone with great...', style: Theme.of(context).textTheme.titleLarge),
            _buildFeatureChips(),
            const SizedBox(height: 20),
            Text('Brand Preference', style: Theme.of(context).textTheme.titleLarge),
            _buildBrandRadios(),
          ],
        ),
      ),
    );
  }

  Widget _buildFeatureChips() {
    return Wrap(
      spacing: 8.0,
      children: <Widget>[
        FilterChip(
          label: const Text('Camera'),
          selected: flagCamera,
          onSelected: (bool value) {
            setState(() {
              flagCamera = value;
            });
          },
        ),
        FilterChip(
          label: const Text('Performance'),
          selected: flagPer,
          onSelected: (bool value) {
            setState(() {
              flagPer = value;
            });
          },
        ),
        FilterChip(
          label: const Text('Battery'),
          selected: flagBattery,
          onSelected: (bool value) {
            setState(() {
              flagBattery = value;
            });
          },
        ),
      ],
    );
  }

  Widget _buildBrandRadios() {
    return Row(
      children: [
        Expanded(
          child: RadioListTile<int>(
            title: const Text('Chinese'),
            value: 1,
            groupValue: flagChinese,
            onChanged: (int? value) {
              setState(() {
                flagChinese = value ?? 1;
              });
            },
          ),
        ),
        Expanded(
          child: RadioListTile<int>(
            title: const Text('Non-Chinese'),
            value: 0,
            groupValue: flagChinese,
            onChanged: (int? value) {
              setState(() {
                flagChinese = value ?? 0;
              });
            },
          ),
        ),
      ],
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
