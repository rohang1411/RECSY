import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:flutter/material.dart';
import 'package:mobile_recommender/export.dart';
import 'package:mobile_recommender/widget/app_drawer.dart';

class LandingPage extends StatefulWidget {
  static const LandingRoute = '/landing';

  @override
  _LandingPageState createState() => _LandingPageState();
}

class _LandingPageState extends State<LandingPage> {
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final DatabaseReference dbRef =
      FirebaseDatabase.instance.ref().child("users");

  List<String>? fav;
  List<String>? favlist;

  int strToint(String temp) {
    switch (temp[0]) {
      case '0':
        return 0;
      case '1':
        return 1;
      case '2':
        return 2;
      case '3':
        return 3;
      case '4':
        return 4;
      case '5':
        return 5;
      case '6':
        return 6;
      case '7':
        return 7;
      case '8':
        return 8;
      case '9':
        return 9;
      default:
        return 0;
    }
  }

  Map<dynamic, dynamic>? userDataMap;
  // String showName;

  Future<void> getData() async {
    print('Hi AU');
    final User? user = _auth.currentUser;
    if (user == null) return;
    final uid = user.uid;
    try {
      final DataSnapshot snapshot = await dbRef.child(uid).get();
      // print('Data : ${snapshot.value}');
      userDataMap = snapshot.value as Map<dynamic, dynamic>?;
      if (userDataMap == null) return;
      // print(userDataMap);
      List<String> favIDList = [];
      // showName = userDataMap!['Name'];
      // print(userDataMap!['Favourites']);
      final favourites = userDataMap!['Favourites'];
      if (favourites != null) {
        for (int i = 0; i < favourites.length; i++) {
          // print(userDataMap!['Favourites'][i].toString());
          favIDList.add(favourites[i].toString());
          if (favIDList[i].length == 1)
            mobiles[strToint(favIDList[i])].isFav = true;
          else if (favIDList[i].length == 2)
            mobiles[strToint(favIDList[i][0]) * 10 + strToint(favIDList[i][1])]
                .isFav = true;
        }
      }
      // favIDList = userDataMap!['Favourites'];
      // print(favIDList);
      // print('HELLO UPDATED THE FAVOURITES IN MOBILES');
    } catch (e) {
      print('Error getting data: $e');
    }
  }

  @override
  void initState() {
    super.initState();
    getData();
  }

  int current = 0;

  // List<FilterPage> mobileCard = mobiles.sublist(0, 3);

  @override
  Widget build(BuildContext context) {

    // List<FilterPage> bannerList = [];
    List<Mobile> topPerforming = [];
    List<Mobile> topCamera = [];
    List<Mobile> topRated = [];

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
      drawer: AppDrawer(),
      body: SafeArea(
        child: CustomScrollView(
          slivers: <Widget>[
            SliverAppBar(
              title: Text(
                'Recsy',
                style: TextStyle(
                  fontFamily: 'Segoe UI',
                  fontWeight: FontWeight.w900,
                  fontSize: 25,
                ),
              ),
              floating: true,
              snap: true,
              elevation: 4.0,
            ),
            SliverPadding(
              padding: const EdgeInsets.all(16.0),
              sliver: SliverList(
                delegate: SliverChildListDelegate(
                  [
                    BannerList(),
                    const SizedBox(height: 16),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 0.0),
                      child: ElevatedButton.icon(
                        onPressed: () => Navigator.of(context).pushNamed(CompareScreen.Route),
                        icon: const Icon(Icons.compare_arrows),
                        label: const Text('Compare Phones'),
                        style: ElevatedButton.styleFrom(
                          minimumSize: const Size(double.infinity, 50), // full width
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(15),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    SectionItem(
                      title: 'You May Also Like',
                      list: topRated,
                      displayText: true,
                    ),
                    const SizedBox(height: 16),
                    SectionItem(
                      title: 'Top Performing',
                      list: topPerforming,
                      displayText: true,
                    ),
                    const SizedBox(height: 16),
                    SectionItem(
                      title: 'Top Camera',
                      list: topCamera,
                      displayText: true,
                    ),
                    const SizedBox(height: 16),
                    SectionItem(
                      title: 'Top Rated',
                      list: topRated,
                      displayText: true,
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
