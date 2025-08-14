import 'package:flutter/material.dart';
import 'package:mobile_recommender/export.dart';
import 'filter.dart';
// import _recommend;

class RecommendationPage extends StatelessWidget {
  // @required this.myText;
  // @required this.myText2;
  // @required this.myText3;
  // @required this.myText4;

  static const Route = '/recommendation';

  @override
  Widget build(BuildContext context) {
    print('Hi AU');
    // print("RECOMMENDATION PAGE");
    List<FilterPage> _recommend = Provider.of<FilterPage>(context).rec;
    // print(_recommend);
    // List<Mobile> recommendedPhones = [];

    return Scaffold(
      appBar: AppBar(
        title: Text(
          'The best smartphone for you',
          style: bodyText(context),
        ),
      ),
      body: SafeArea(
        child: Center(
          child: Container(
            child: Column(
              // crossAxisAlignment: CrossAxisAlignment.center, //,Center,
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                SingleSectionItem(
                  item: _recommend[0],
                  displayText: true,
                  height: 420 * 0.9,
                  width: 350 * 0.9,
                ),
                Text(
                  'Similar Phones',
                  style: Theme.of(context).textTheme.headline4,
                  textAlign: TextAlign.center,
                ),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      for (var i = 0; i < _recommend.length - 1; i++)
                        // if (_recommend[i].name == 'iPhone 11 Pro Max')
                        SingleSectionItem(
                          item: _recommend[i + 1],
                          displayText: true,
                        )
                    ],
                  ),
                ),
                RaisedButton.icon(
                  onPressed: () {
                    // print(_recommend[0]);
                    Navigator.of(context).pushNamed(FilterPage.Route);
                  },
                  padding: EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                  icon: Icon(Icons.mobile_friendly),
                  label: Text('Change Filter'),
                )
              ],
            ),
          ),
        ),
      ),
    );
  }
}
