import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:flutter/material.dart';
import 'package:mobile_recommender/export.dart';

class LandingPage extends StatefulWidget {
  static const LandingRoute = '/landing';

  @override
  _LandingPageState createState() => _LandingPageState();
}

class _LandingPageState extends State<LandingPage> {
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final DatabaseReference dbRef =
      FirebaseDatabase.instance.reference().child("users");

  List<String> fav;
  List<String> favlist;

  int strToint(String temp) {
    switch (temp[0]) {
      case '0':
        return 0;
        break;

      case '1':
        return 1;
        break;

      case '2':
        return 2;
        break;

      case '3':
        return 3;
        break;

      case '4':
        return 4;
        break;

      case '5':
        return 5;
        break;

      case '6':
        return 6;
        break;

      case '7':
        return 7;
        break;

      case '8':
        return 8;
        break;

      case '9':
        return 9;
        break;
    }
  }

  Map<dynamic, dynamic> userDataMap;
  // String showName;

  Future<void> getData() async {
    print('Hi AU');
    final User user = await _auth.currentUser;
    final uid = user.uid;
    dbRef.child(uid).once().then((DataSnapshot snapshot) async {
      // print('Data : ${snapshot.value}');
      userDataMap = snapshot.value;
      // print(snapshot.value);
      List<String> favIDList = [];
      // showName = userDataMap['Name'];
      // print(userDataMap['Favourites']);
      for (int i = 0; i < userDataMap['Favourites'].length; i++) {
        // print(userDataMap['Favourites'][i].toString());
        favIDList.add(userDataMap['Favourites'][i].toString());
        if (favIDList[i].length == 1)
          mobiles[strToint(favIDList[i])].isFav = true;
        else if (favIDList[i].length == 2)
          mobiles[strToint(favIDList[i][0]) * 10 + strToint(favIDList[i][1])]
              .isFav = true;
      }
      // favIDList = userDataMap['Favourites'];
      // print(favIDList);
      // print('HELLO UPDATED THE FAVOURITES IN MOBILES');
    });
  }

  @override
  void initState() {
    getData();
  }

  int current = 0;

  // List<FilterPage> mobileCard = mobiles.sublist(0, 3);

  @override
  Widget build(BuildContext context) {
    final _mob = Provider.of<FilterPage>(context).comparePhone;

    // List<FilterPage> bannerList = [];
    List<FilterPage> topPerforming = [];
    List<FilterPage> topCamera = [];
    List<FilterPage> topRated = [];

    void randomFunction() {
      List<int> topPerformingIndex = [
        0,
        10,
        26,
        27,
        28,
        30,
        31,
        32,
        37,
        38,
        39,
        40,
        68,
        69,
        70,
        71,
        72,
        73,
        75
      ];

      topPerformingIndex.shuffle();

      for (int i = 0; i < 5; i++) {
        // print("hellllo");
        // print(mobiles[topPerformingIndex[i]]);
        topPerforming.add(mobiles[topPerformingIndex[i]]);
      }

      List<int> topCameraIndex = [
        10,
        31,
        37,
        38,
        39,
        40,
        41,
        42,
        43,
        50,
        68,
        70,
        72,
        75,
      ];

      topCameraIndex.shuffle();

      for (int i = 0; i < 5; i++) {
        // print(mobiles[topCameraIndex[i]]);
        topCamera.add(mobiles[topCameraIndex[i]]);
      }

      List<int> topRatedIndex = [
        2,
        6,
        13,
        16,
        21,
        22,
        30,
        31,
        36,
        37,
        38,
        39,
        40,
        41,
        42,
        43,
        50,
        59,
        68,
        70,
        75,
        82,
        86
      ];

      topRatedIndex.shuffle();

      for (int i = 0; i < 5; i++) {
        // print(mobiles[topRatedIndex[i]]);
        topRated.add(mobiles[topRatedIndex[i]]);
      }
    }

    randomFunction();
    return Scaffold(
      bottomNavigationBar: BottomBar(
        current: current,
        routes: routes,
      ),
      drawer: Drawer(
        elevation: 10,
        child: Container(
          color: Colors.black,
          child: Column(
            children: [
              DrawerHeader(
                decoration: BoxDecoration(
                  color: kPrimaryColor,
                ),
                padding: EdgeInsets.zero,
                child: Container(
                  padding: EdgeInsets.all(20),
                  alignment: Alignment.bottomLeft,
                  width: double.infinity,
                  child: Text(
                    'Recsy',
                    style: TextStyle(fontSize: 40),
                  ),
                  color: kPrimaryColor,
                ),
              ),
              Container(
                child: Column(
                  children: [
                    ListTile(
                      leading: CircleAvatar(
                        backgroundColor: kPrimaryColor,
                        foregroundColor: Colors.white,
                        child: Text('V/S'),
                      ),
                      title: Text('Compare'),
                      onTap: () {
                        Navigator.of(context).pushNamed(
                          SearchPage.Route,
                          arguments: {
                            'mobiles': _mob,
                            'selected': 0,
                            'compare': true
                          },
                        );
                      },
                    ),
                    Divider(
                      color: Colors.grey,
                      endIndent: 30,
                    ),
                    ListTile(
                      onTap: () {
                        Navigator.of(context).pushNamed(AboutUs.Route);
                      },
                      leading: Icon(
                        Icons.supervisor_account_rounded,
                        size: 40,
                        color: kPrimaryColor,
                      ),
                      title: Text('About Us'),
                    ),
                    Divider(
                      color: Colors.grey,
                      endIndent: 30,
                    ),
                    ListTile(
                      onTap: () {
                        Navigator.of(context).pushNamed(ContactUs.Route);
                      },
                      leading: Icon(
                        Icons.mail,
                        size: 40,
                        color: kPrimaryColor,
                      ),
                      title: Text('Contact Us'),
                    ),
                  ],
                ),
              )
            ],
          ),
        ),
      ),
      appBar: AppBar(
        title: Text(
          'Recsy',
          style: TextStyle(
            fontFamily: 'Segoe UI',
            fontWeight: FontWeight.w900,
            fontSize: 25,
          ),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.all(10),
          child: Column(
            children: [
              BannerList(),
              SectionItem(
                title: 'You May Also Like',
                list: topRated,
                displayText: true,
              ),
              CompareWidget(),
              SectionItem(
                title: 'Top Performing',
                list: topPerforming,
                displayText: true,
              ),
              SectionItem(
                title: 'Top Camera',
                list: topCamera,
                displayText: true,
              ),
              SectionItem(
                title: 'Top Rated',
                list: topRated,
                displayText: true,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
