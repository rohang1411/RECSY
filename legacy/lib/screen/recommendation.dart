import 'package:flutter/material.dart';
import 'package:mobile_recommender/export.dart';
import 'package:mobile_recommender/services/recommendation_service.dart';
import 'package:mobile_recommender/screen/mobile_desc.dart';

class RecommendationPage extends StatefulWidget {
  static const Route = '/recommendation';

  @override
  _RecommendationPageState createState() => _RecommendationPageState();
}

class _RecommendationPageState extends State<RecommendationPage> {
  late Future<List<Mobile>> _recommendationsFuture;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final predictedIndex = ModalRoute.of(context)!.settings.arguments as int;
    _recommendationsFuture = getRecommendations(predictedIndex);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          'The best smartphone for you',
          style: bodyText(context),
        ),
      ),
      body: SafeArea(
        child: FutureBuilder<List<Mobile>>(
          future: _recommendationsFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError || !snapshot.hasData || snapshot.data!.isEmpty) {
              return Center(child: Text('Could not find recommendations.'));
            }

            final _recommend = snapshot.data!;

            return Center(
              child: Container(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    GestureDetector(
                      onTap: () => Navigator.of(context).pushNamed(MobilePage.Route, arguments: _recommend[0]),
                      child: SingleSectionItem(
                        item: _recommend[0],
                        displayText: true,
                        height: 420 * 0.9,
                        width: 350 * 0.9,
                      ),
                    ),
                    Text(
                      'Similar Phones',
                      style: Theme.of(context).textTheme.headlineMedium,
                      textAlign: TextAlign.center,
                    ),
                    SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: [
                          for (var i = 1; i < _recommend.length; i++)
                            GestureDetector(
                              onTap: () => Navigator.of(context).pushNamed(MobilePage.Route, arguments: _recommend[i]),
                              child: SingleSectionItem(
                                item: _recommend[i],
                                displayText: true,
                              ),
                            )
                        ],
                      ),
                    ),
                    ElevatedButton.icon(
                      onPressed: () {
                        Navigator.of(context).pop();
                      },
                      icon: Icon(Icons.filter_alt_outlined),
                      label: Text('Change Filter'),
                    )
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}