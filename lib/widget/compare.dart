import 'package:flutter/material.dart';
import 'package:mobile_recommender/export.dart';

class CompareWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final _card = Provider.of<FilterPage>(context).comparePhone;
    return Container(
      margin: EdgeInsets.all(5),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          Text(
            'Compare',
            style: bodyText(context),
          ),
          SizedBox(
            height: 10,
          ),
          Stack(
            alignment: Alignment.center,
            children: [
              Container(
                height: 70,
                padding: EdgeInsets.symmetric(horizontal: 10),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    for (var i = 0; i < 2; i++)
                      InkWell(
                        onTap: () {
                          Navigator.of(context).pushNamed(SearchPage.Route,
                              arguments: {
                                'mobiles': _card,
                                'selected': i,
                                'compare': false
                              });
                        },
                        child: LimitedBox(
                          maxWidth: 110,
                          child: Container(
                            padding: EdgeInsets.all(10),
                            child: Text(
                              _card[i].name,
                              style:
                                  TextStyle(color: Colors.black, fontSize: 15),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
                width: double.infinity,
                decoration: BoxDecoration(
                  color: kAccentColor,
                  borderRadius: BorderRadius.circular(40),
                ),
              ),
              InkWell(
                onTap: () {
                  Navigator.of(context).pushNamed(CompareScreen.Route,
                      arguments: {'mobiles': _card});
                },
                child: CircleAvatar(
                  child: Text(
                    'V/S',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 30,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  radius: 50,
                  backgroundColor: kPrimaryColor,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
