import 'package:flutter/material.dart';
import 'package:mobile_recommender/export.dart';
import 'package:mobile_recommender/widget/description_wid.dart';
import 'package:url_launcher/url_launcher.dart';

class MobilePage extends StatelessWidget {
  static const Route = '/mobilePage';
  @override
  Widget build(BuildContext context) {
    FilterPage mobile = ModalRoute.of(context).settings.arguments;
    final size = MediaQuery.of(context).size;
    List _keys = description.keys.toList();
    List _keysMobile = mobile.specs.keys.toList();
    return Scaffold(
      appBar: AppBar(
        title: Text(mobile.name, style: bodyText(context)),
      ),
      body: Container(
        // padding: EdgeInsets.all(5),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              flex: 6,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  SingleSectionItem(
                    item: mobile,
                    displayText: false,
                    height: size.height * 0.44,
                    width: size.width * 0.66,
                  ),
                  Column(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: [
                      for (var i = 0; i < 4; i++)
                        Descriptions(
                          keys: _keys,
                          i: i,
                          mobile: mobile,
                          size: size,
                        ), // Function call for description page boxes, here arguments are passed
                    ], // See there for execution and any error
                  ),
                ],
              ),
            ),
            // SingleChildScrollView(
            // padding: EdgeInsets.only(left: 10),
            // child: Column(children: <Widget>[
            DescriptionButton(mobile: mobile),
            Padding(
              padding: const EdgeInsets.fromLTRB(8.0, 0, 8, 2),
              child: Text(
                'Description',
                style: Theme.of(context).textTheme.headline1.copyWith(
                      fontSize: 30,
                      color: Colors.white,
                    ),
              ),
            ),
            Expanded(
              // height: MediaQuery.of(context).size.height * 0.2,
              // padding: const EdgeInsets.fromLTRB(15, 5, 0, 0),
              flex: 3,
              child: SingleChildScrollView(
                padding: EdgeInsets.only(left: 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (var i = 0; i < _keysMobile.length; i++)
                      Container(
                        margin: EdgeInsets.symmetric(vertical: 5),
                        child: RichText(
                          text: TextSpan(
                            children: [
                              TextSpan(
                                text: '${_keysMobile[i]} :\n',
                                style: TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 20,
                                ),
                              ),
                              TextSpan(
                                text: '${mobile.specs[_keysMobile[i]]}',
                                style: TextStyle(
                                  fontSize: 15,
                                  // fontWeight: FontWeight.bold,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              // ]),
            ),
            Center(
              child: RaisedButton.icon(
                padding: EdgeInsets.symmetric(horizontal: 25, vertical: 10),
                onPressed: () => launch(mobile.buyLink),
                icon: Icon(Icons.shopping_bag),
                label: Text('Buy Now'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
