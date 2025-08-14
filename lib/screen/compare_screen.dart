import 'package:mobile_recommender/export.dart';
import 'package:flutter/material.dart';

class CompareScreen extends StatelessWidget {
  static const Route = '/compare';
  final List<FilterPage> compare;

  const CompareScreen({this.compare});
  @override
  Widget build(BuildContext context) {
    final _size = MediaQuery.of(context).size;
    final Map args = ModalRoute.of(context).settings.arguments;
    List<FilterPage> _mobile = args['mobiles'];
    List<String> keys = _mobile[0].specs.keys.toList();
    return Scaffold(
      appBar: AppBar(
        title: Text(
          'Compare',
          style: bodyText(context),
        ),
      ),
      body: SafeArea(
          child: Container(
        padding: EdgeInsets.all(10),
        // color: Colors.white,

        child: SingleChildScrollView(
          child: Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  SingleSectionItem(
                    displayText: true,
                    item: _mobile[0],
                    height: _size.height * 0.25,
                    width: _size.height * 0.25 * 0.7,
                  ),
                  Container(
                    height: 120,
                    width: 3,
                    color: Colors.white,
                  ),
                  SingleSectionItem(
                    displayText: true,
                    item: _mobile[1],
                    height: _size.height * 0.25,
                    width: _size.height * 0.25 * 0.7,
                  ),
                ],
              ),
              for (var i = 0; i < keys.length; i++)
                Container(
                  margin: EdgeInsets.only(top: 25),
                  child: Column(
                    children: [
                      Text(
                        keys[i],
                        style: Theme.of(context).textTheme.headline1.copyWith(
                              fontSize: 30,
                              color: Colors.white,
                              // fontWeight: FontWeight.bold,
                            ),
                      ),
                      SizedBox(height: 10),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceAround,
                        children: [
                          Expanded(
                            child: Container(
                              padding: EdgeInsets.symmetric(horizontal: 10),
                              alignment: Alignment.centerRight,
                              child: Text(_mobile[0].specs[keys[i]]),
                            ),
                          ),
                          Container(
                            height: 35,
                            width: 1,
                            color: Colors.white,
                          ),
                          Expanded(
                            child: Container(
                              padding: EdgeInsets.symmetric(horizontal: 10),
                              child: Text(_mobile[1].specs[keys[i]]),
                            ),
                          ),
                        ],
                      )
                    ],
                  ),
                )
            ],
          ),
        ),
      )),
    );
  }
}
